/**
 * ExportDdlModal: pantalla Export DDL.
 *
 * Se abre desde la acción **Export DDL** de la barra del canvas. Se renderiza con
 * el Dialog del sistema de diseño y el fondo **canvas** (solo se oscurece la
 * superficie de modelado debajo de la barra; la barra queda nítida).
 *
 * Genera DDL de **Databricks** u **Oracle** en vivo desde el diagrama activo
 * (tablas/columnas/relaciones canónicas), con la selección de tablas y el
 * dialecto arriba (el modal abre con el dialecto por defecto del proyecto,
 * definido en Output settings; Databricks salvo que el proyecto diga otra cosa)
 * y la columna de opciones partida en dos pestañas:
 *  - **Output**: cómo se escribe el DDL y cómo se nombran los archivos, con el
 *    formulario compartido `DdlOutputForm`. Arranca desde las Output settings
 *    del proyecto (Data Standards) y se puede ajustar para este export.
 *  - **Export rules** (`ExportRulesPanel`): el ruleset del proyecto, es decir,
 *    qué reglas corren al exportar. Van aparte porque no son formato: la mitad
 *    son generadores que agregan objetos al `.zip`. Son de Databricks (SET TAGS,
 *    TBLPROPERTIES, tablas _rej…): con Oracle no corren y la pestaña no aparece.
 *
 * Pie: **Download** (un `.zip` con un `.sql` por objeto, `TABLE-X.sql` /
 * `VIEW_NEG-Y.sql` / `VIEW_TEC-Z.sql`, cada tabla y sus vistas en una carpeta con
 * el nombre de la tabla) y **Copy to clipboard** (un solo SQL concatenado). Solo
 * UI, sin persistencia. Exporta solo las vistas del canvas (`diagram.views`), no
 * todas las de sus tablas.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  FileCode2, Download, Copy, Check, Search, Table2, Database, Hexagon,
} from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import type { Diagram } from '@/features/modeler/services/modeler.service';
import { canvasDdlViews } from '../canvasDdlViews';
import {
  databricksDdl, ddlZipName, tableStatements, viewStatements,
  type DdlDialect, type DdlTable,
} from '../generators';
import { oracleDdl, oracleForeignKeysFile, oracleTableStatements, oracleViewStatements } from '../oracle';
import {
  fetchDdlConfig, fetchExportRules, fetchUdpDefs, layoutFromRules, renderWithRules, selectableRules, withUdpPartitions,
  type ExportRule, type UdpDefLite,
} from '../rulesBridge';
import {
  DEFAULT_OUTPUT_SETTINGS, mergeOutputSettings, splitOutputSettings, type DdlOutputSettings,
} from '../outputSettings';
import { sessionProjectId } from '@/store/useSessionStore';
import { runBlocking } from '@/store/useBusyStore';
import { buildZip } from '@/lib/zip';
import { plainToObjects, statementsToObjects, objectsToEntries, viewKey } from '../ddlExportBundle';
import ExportRulesPanel from './ExportRulesPanel';
import DdlOutputForm from './DdlOutputForm';
import { exportGate } from '../exportGate';
import { pickedTableIds } from '../tableSelection';
import { useAuthStore } from '@/store/useAuthStore';
import { NO_EXPORT_HINT } from '@/lib/permissionHints';

export interface ExportDdlModalProps {
  open: boolean;
  diagram: Diagram | null;
  modelName: string;
  onClose: () => void;
}

export default function ExportDdlModal({ open, diagram, modelName, onClose }: ExportDdlModalProps) {
  // Arranca con el dialecto por defecto del proyecto (Output settings);
  // cambiarlo aquí vale solo para este export.
  const [dialect, setDialect] = useState<DdlDialect>('databricks');
  const isDbx = dialect === 'databricks';
  // Pestaña de la columna de opciones: formato del DDL vs ruleset del proyecto.
  const [tab, setTab] = useState<'output' | 'rules'>('output');
  const pickDialect = (d: DdlDialect) => { setDialect(d); setTab('output'); };
  // Las Output settings del proyecto son el punto de partida; lo que se
  // cambie aquí vale solo para este export.
  const [settings, setSettings] = useState<DdlOutputSettings>(DEFAULT_OUTPUT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  // Las últimas settings leídas del proyecto: al reabrir se ven de entrada (no
  // el dialecto que se eligió para el export anterior) mientras se refrescan.
  const lastLoaded = useRef<{ projectId: string; settings: DdlOutputSettings } | null>(null);
  const { opts, fileNames } = useMemo(() => splitOutputSettings(settings), [settings]);

  // Todas las tablas del diagrama, ordenadas para que la lista de selección sea estable.
  const allTables = useMemo<DdlTable[]>(
    () => (diagram?.tables ?? [])
      .map((t) => ({ id: t.id, physicalName: t.physicalName, logicalName: t.logicalName, schema: t.schema, description: t.description }))
      .sort((a, b) => a.physicalName.localeCompare(b.physicalName)),
    [diagram],
  );

  // Vistas del export = las miembro de este canvas (`diagram.views`, la misma
  // lista que el canvas dibuja), no todas las vistas de sus tablas. Los
  // sourceTableIds viajan al generador (multi-fuente, `FROM t1, t2`).
  const views = useMemo(() => canvasDdlViews(diagram), [diagram]);

  // DDL Export rules: las habilitadas y válidas del catálogo, todas marcadas por
  // defecto. Sin selección, el export sale idéntico byte a byte al DDL base.
  const [exportRules, setExportRules] = useState<ExportRule[]>([]);
  const [selRules, setSelRules] = useState<Set<string> | null>(null);
  // La lista de reglas se pide en cada apertura; hasta que llega no vale
  // ninguna selección anterior (ni se exporta).
  const [rulesState, setRulesState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [rendering, setRendering] = useState(false);
  // Defs UDP del proyecto: resuelven por nombre el UDP de columna que define
  // las particiones (regla de layout `partitionUdp`). null = cargando.
  const [udpDefs, setUdpDefs] = useState<UdpDefLite[] | null>(null);
  const [udpFailed, setUdpFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTab('output');
    setSelected(null);
    setUdpDefs(null); setUdpFailed(false); setSettingsReady(false);
    const projectId = sessionProjectId();
    const last = lastLoaded.current?.projectId === projectId ? lastLoaded.current.settings : DEFAULT_OUTPUT_SETTINGS;
    setSettings(last); setDialect(last.dialect);
    setExportRules([]); setSelRules(null); setRulesState('loading');
    fetchExportRules(sessionProjectId())
      .then((rs) => { if (alive) { setExportRules(selectableRules(rs)); setSelRules(null); setRulesState('ready'); } })
      .catch(() => { if (alive) { setExportRules([]); setSelRules(null); setRulesState('failed'); } });
    fetchUdpDefs(sessionProjectId())
      .then((ds) => { if (alive) setUdpDefs(ds); })
      .catch(() => { if (alive) { setUdpDefs([]); setUdpFailed(true); } });
    fetchDdlConfig(sessionProjectId())
      .then((cfg) => {
        if (!alive) return;
        const merged = mergeOutputSettings(cfg?.output ?? null);
        lastLoaded.current = { projectId, settings: merged };
        setSettings(merged); setDialect(merged.dialect); setSettingsReady(true);
      })
      .catch(() => { if (alive) { setSettings(DEFAULT_OUTPUT_SETTINGS); setDialect(DEFAULT_OUTPUT_SETTINGS.dialect); setSettingsReady(true); } });
    return () => { alive = false; };
  }, [open]);
  const selRuleIds = useMemo(
    () => selRules ?? new Set(exportRules.map((r) => r.id)),
    [selRules, exportRules],
  );
  // Las reglas son de Databricks: con Oracle no corre ninguna.
  const activeRuleIds = useMemo(() => (isDbx ? selRuleIds : new Set<string>()), [isDbx, selRuleIds]);
  const toggleRule = (id: string) => {
    const base = new Set(selRuleIds);
    if (base.has(id)) base.delete(id); else base.add(id);
    setSelRules(base);
  };

  // Preview con reglas aplicadas: bajo demanda ("Apply rules"), nunca en vivo,
  // porque es una llamada al motor del backend y debe coincidir exactamente con
  // el download. Cualquier cambio de opciones/selección lo invalida.
  const [rulesPreview, setRulesPreview] = useState<{ sql: string; applied: number; version: string } | null>(null);

  // Tablas a exportar: por defecto ninguna; cada vez que se abre el modal se
  // empieza sin elección. Una tabla que dejó el canvas sale de la elección.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [tableFilter, setTableFilter] = useState('');
  const selectedIds = useMemo(() => pickedTableIds(selected, allTables.map((t) => t.id)), [selected, allTables]);

  const exportTables = allTables.filter((t) => selectedIds.has(t.id));

  const ddlInput = useMemo(() => (diagram ? {
    tables: diagram.tables,
    columns: diagram.columns,
    relationships: diagram.relationships,
    views,
    tableIds: [...selectedIds],
    modelName,
  } : null), [diagram, selectedIds, modelName, views]);

  const oracleOpts = settings.oracle;
  const ddl = useMemo(
    () => (ddlInput ? (isDbx ? databricksDdl(ddlInput, opts) : oracleDdl(ddlInput, oracleOpts)) : ''),
    [ddlInput, opts, isDbx, oracleOpts],
  );
  // El layout de columnas (regla «Partition columns last») lo dictan las reglas
  // seleccionadas: solo el export con reglas lo aplica; sin reglas, el DDL base
  // no cambia.
  const layout = useMemo(() => layoutFromRules(exportRules, selRuleIds), [exportRules, selRuleIds]);
  const effOpts = useMemo(() => ({ ...opts, partitionsLast: layout.partitionsLast }), [opts, layout]);
  // Con la regla de layout, las particiones salen del UDP que ella
  // nombra (PART_nn = partición y su orden) → el CREATE físico y el motor
  // coinciden; sin esa regla (o sin el UDP) rige el flag de la plataforma.
  const rulesInput = useMemo(() => (ddlInput
    ? { ...ddlInput, columns: withUdpPartitions(ddlInput.columns, udpDefs ?? [], layout.partitionUdp) }
    : null), [ddlInput, udpDefs, layout]);

  // Todo lo que cambia el resultado invalida el preview renderizado.
  useEffect(() => { setRulesPreview(null); }, [ddlInput, opts, selRuleIds, udpDefs, dialect]);
  // Con Oracle no hay reglas: el render de Databricks nunca se muestra ni se
  // descarga (ni en el render intermedio, antes de que el efecto lo limpie).
  const shownRulesPreview = activeRuleIds.size > 0 ? rulesPreview : null;

  /** El `.sql` final: con reglas seleccionadas pasa por el motor del backend
   *  (`POST /api/ddl-rules/render`); sin reglas, el texto base tal cual. */
  const buildFinalSql = async (): Promise<string> => {
    if (!diagram || !ddlInput || activeRuleIds.size === 0) return ddl;
    if (shownRulesPreview) return shownRulesPreview.sql;   // ya renderizado, idéntico
    setRendering(true);
    try {
      const { sql } = await runBlocking('Applying export rules…', () => renderWithRules({
        projectId: sessionProjectId(), diagram, input: rulesInput ?? ddlInput, opts: effOpts, ruleIds: [...selRuleIds], modelName,
      }));
      return sql;
    } finally { setRendering(false); }
  };

  /** Botón "Apply rules" del Preview: mismo motor, mismo texto que el download. */
  const applyRulesToPreview = async () => {
    if (!diagram || !ddlInput || activeRuleIds.size === 0) return;
    setRendering(true);
    try {
      const { sql, rendered } = await runBlocking('Applying export rules…', () => renderWithRules({
        projectId: sessionProjectId(), diagram, input: rulesInput ?? ddlInput, opts: effOpts, ruleIds: [...selRuleIds], modelName,
      }));
      setRulesPreview({ sql, applied: rendered.applied, version: rendered.rulesetVersion });
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't apply the export rules");
    } finally { setRendering(false); }
  };

  const toggleTable = (id: string) => {
    const base = new Set(selectedIds);
    if (base.has(id)) base.delete(id); else base.add(id);
    setSelected(base);
  };
  const selectAll = () => setSelected(new Set(allTables.map((t) => t.id)));
  const selectNone = () => setSelected(new Set<string>());

  // Cantidad de columnas por tabla (para la pista "N cols") + filtro por nombre sobre la lista.
  const colCountByTable = useMemo(() => {
    const m = new Map<string, number>();
    (diagram?.columns ?? []).forEach((c) => m.set(c.tableId, (m.get(c.tableId) ?? 0) + 1));
    return m;
  }, [diagram]);
  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return allTables;
    // También por esquema y "esquema.tabla": dos tablas pueden llamarse igual
    // en esquemas distintos y el filtro debe poder distinguirlas.
    return allTables.filter(
      (t) => t.physicalName.toLowerCase().includes(q)
        || (t.logicalName ?? '').toLowerCase().includes(q)
        || (t.schema ?? '').toLowerCase().includes(q)
        || `${t.schema ?? ''}.${t.physicalName}`.toLowerCase().includes(q),
    );
  }, [allTables, tableFilter]);

  const copy = async () => {
    if (!exportTables.length) return;
    try {
      const sql = await buildFinalSql();
      await navigator.clipboard.writeText(sql);
      toast.success('DDL copied to clipboard');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't copy to clipboard");
    }
  };

  const download = async () => {
    if (!exportTables.length || !diagram || !ddlInput) return;
    setRendering(true);
    try {
      let objects;
      if (activeRuleIds.size === 0) {
        // Sin reglas (u Oracle): DDL base partido por objeto (mismo texto que el archivo único).
        const ts = (isDbx ? tableStatements(ddlInput, opts) : oracleTableStatements(ddlInput, oracleOpts)).map(({ table, sql }) => ({
          id: table.id, physicalName: table.physicalName, schema: table.schema, sql,
        }));
        const withViews = isDbx ? opts.includeViews : oracleOpts.includeViews;
        const views = !withViews ? [] : isDbx ? viewStatements(ddlInput, opts) : oracleViewStatements(ddlInput, oracleOpts);
        const vs = views.map(({ view, sql }) => ({
          name: view.name, schema: view.schema,
          sourceTableIds: view.sourceTableIds?.length ? view.sourceTableIds : (view.tableId ? [view.tableId] : []),
          sql,
        }));
        objects = plainToObjects({ tables: ts, views: vs });
      } else {
        // Con reglas: el motor devuelve una sentencia por objeto.
        const { rendered } = await runBlocking('Applying export rules…', () => renderWithRules({
          projectId: sessionProjectId(), diagram, input: rulesInput ?? ddlInput, opts: effOpts, ruleIds: [...selRuleIds], modelName,
        }));
        const viewSources = new Map<string, string[]>();
        views.forEach((v) => viewSources.set(
          viewKey(v.schema ?? null, v.name),
          v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []),
        ));
        const tablesById = new Map(exportTables.map((t) => [t.id, { physicalName: t.physicalName, schema: t.schema }]));
        objects = statementsToObjects({ statements: rendered.statements, viewSources, tablesById });
      }

      const entries = objectsToEntries(objects, fileNames);
      // Oracle: las FK en su propio archivo, para correrlo después de todas las
      // tablas (en el archivo de la tabla hija podrían correr antes que el padre).
      const fks = isDbx ? null : oracleForeignKeysFile(ddlInput, oracleOpts);
      if (fks) entries.push({ path: 'FOREIGN_KEYS.sql', content: fks });
      const zipName = ddlZipName(exportTables, modelName);
      const blob = buildZip(entries);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${zipName} · ${entries.length} file${entries.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't build the DDL download");
    } finally {
      setRendering(false);
    }
  };

  // Proyecto sin reglas, u Oracle (las reglas son de Databricks) ⇒ sin pestañas.
  const rulesTab = isDbx && exportRules.length > 0;
  const showRules = tab === 'rules' && rulesTab;
  // Sin las Output settings y las defs UDP cargadas no se exporta (la física y
  // la _rej podrían diferir en particiones).
  // Oracle no usa las defs UDP ni las reglas (son de Databricks): no las espera.
  const gate = exportGate({
    settingsReady,
    udpDefsReady: udpDefs !== null || !isDbx,
    udpDefsFailed: udpFailed,
    rulesReady: rulesState !== 'loading' || !isDbx,
    rulesFailed: rulesState === 'failed' && isDbx,
    rulesSelected: activeRuleIds.size,
  });
  const canExport = exportTables.length > 0 && gate.ready;
  // Descargar o copiar el DDL exige el permiso `export`.
  const allowed = useAuthStore((st) => st.has('export'));
  const deniedTip = allowed ? undefined : NO_EXPORT_HINT;

  const footer = (
    <>
      <span className="dmh-dialog-foot-left exd-foot-count">
        {exportTables.length}/{allTables.length} tables
        {activeRuleIds.size > 0 && ` · ${activeRuleIds.size} rule${activeRuleIds.size === 1 ? '' : 's'}`}
        {gate.note && ` · ${gate.note}`}
      </span>
      <Button variant="secondary" onClick={onClose}>Close</Button>
      <Button variant="secondary" icon={Copy} onClick={copy} disabled={!allowed || !canExport || rendering} title={deniedTip}>Copy</Button>
      <Button variant="primary" icon={Download} onClick={download} disabled={!allowed || !canExport || rendering} title={deniedTip}>
        {rendering ? 'Applying rules…' : 'Download .zip'}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      title="Export DDL"
      subtitle={`Generate DDL from the model · ${allTables.length} tables`}
      icon={FileCode2}
      onClose={onClose}
      footer={footer}
      width={920}
      backdrop="canvas"
      canvasTop={136}
    >
      <div className="exd">
        {/* Tablas a exportar, del canvas actual */}
        <div className="exd-tablesx">
          <div className="exd-tablesx-head">
            <span className="exd-tablesx-title">Tables to export</span>
            <span className="exd-tablesx-sub">from current canvas</span>
            <span className="exd-tablesx-spacer" />
            <span className="exd-tablesx-count">{exportTables.length} / {allTables.length}</span>
          </div>
          <div className="exd-tablesx-filter">
            <Search size={14} strokeWidth={1.5} className="exd-tablesx-filter-ico" aria-hidden />
            <input
              className="exd-tablesx-filter-input"
              placeholder="Filter by schema or table…"
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              aria-label="Filter tables"
            />
            <button type="button" className="rd-btn rd-btn-secondary rd-btn-xs" onClick={selectAll} disabled={allTables.length === 0}>All</button>
            <button type="button" className="rd-btn rd-btn-secondary rd-btn-xs" onClick={selectNone} disabled={allTables.length === 0}>None</button>
          </div>
          <div className="exd-tablesx-list">
            {allTables.length === 0 ? (
              <span className="exd-empty">The canvas has no tables.</span>
            ) : filteredTables.length === 0 ? (
              <span className="exd-empty">No table matches the filter.</span>
            ) : (
              filteredTables.map((t) => {
                const on = selectedIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="exd-tablesx-row"
                    onClick={() => toggleTable(t.id)}
                    aria-pressed={on}
                  >
                    <span className={`exd-cbox${on ? ' is-on' : ''}`}>
                      {on && <Check size={11} strokeWidth={2.6} aria-hidden />}
                    </span>
                    <Table2 size={14} strokeWidth={1.5} className="exd-tablesx-row-ico" aria-hidden />
                    <span className={`exd-tablesx-row-name${on ? '' : ' is-off'}`}>
                      {t.schema && <span className="exd-tablesx-row-schema">{t.schema}.</span>}
                      {t.physicalName}
                    </span>
                    <span className="exd-tablesx-row-cols">{colCountByTable.get(t.id) ?? 0} cols</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Dialecto (tarjetas) */}
        <div className="exd-field">
          <span className="exd-lbl">Target dialect</span>
          <div className="exd-dialects">
            {/* Hasta que llegan las Output settings no se elige: el valor por
                defecto del proyecto pisaría la elección. */}
            <button
              type="button"
              className={`exd-dialect${!isDbx ? ' is-on' : ''}`}
              onClick={() => pickDialect('oracle')}
              disabled={!settingsReady}
              aria-pressed={!isDbx}
            >
              <span className="exd-dialect-ico exd-dialect-ico--oracle"><Database size={16} strokeWidth={1.4} aria-hidden /></span>
              <span className="exd-dialect-txt">
                <span className="exd-dialect-name">Oracle</span>
                <span className="exd-dialect-sub">{!isDbx ? 'selected' : 'Oracle Database'}</span>
              </span>
            </button>
            <button
              type="button"
              className={`exd-dialect${isDbx ? ' is-on' : ''}`}
              onClick={() => pickDialect('databricks')}
              disabled={!settingsReady}
              aria-pressed={isDbx}
            >
              <span className="exd-dialect-ico exd-dialect-ico--dbx"><Hexagon size={16} strokeWidth={1.4} aria-hidden /></span>
              <span className="exd-dialect-txt">
                <span className="exd-dialect-name">Databricks</span>
                <span className="exd-dialect-sub">{isDbx ? 'selected' : 'Delta / Spark SQL'}</span>
              </span>
            </button>
          </div>
        </div>

        <div className="exd-cols">
          {/* ── Columna de opciones ── */}
          <div className="exd-opts">
            {/* Las reglas no son opciones de formato: la mitad genera objetos
                adicionales (la _rej, las vistas _v/DAC) y van en su propia pestaña,
                con toda la altura de la columna. Proyecto sin reglas ⇒ sin pestañas. */}
            {!isDbx && exportRules.length > 0 && (
              <span className="exd-dialect-note">The export rules apply to Databricks only — Oracle exports the model as is.</span>
            )}
            {rulesTab && (
              <div className="wk-pp-tabs exd-tabs" role="tablist">
                <button
                  type="button" role="tab" aria-selected={tab === 'output'}
                  className={`wk-pp-tab${tab === 'output' ? ' active' : ''}`}
                  onClick={() => setTab('output')}
                >
                  Output
                </button>
                <button
                  type="button" role="tab" aria-selected={tab === 'rules'}
                  className={`wk-pp-tab${tab === 'rules' ? ' active' : ''}`}
                  onClick={() => setTab('rules')}
                >
                  Export rules
                  <span className="wk-pp-tab-count">{selRuleIds.size}</span>
                </button>
              </div>
            )}

            {showRules ? (
              <ExportRulesPanel
                rules={exportRules}
                selected={selRuleIds}
                onToggle={toggleRule}
                onAll={() => setSelRules(new Set(exportRules.map((r) => r.id)))}
                onNone={() => setSelRules(new Set<string>())}
              />
            ) : (
              <DdlOutputForm
                value={settings}
                onChange={setSettings}
                disabled={!settingsReady}
                dialect={dialect}
                viewsHint={views.length ? `${views.length} view(s) on the canvas` : 'No views on the canvas'}
              />
            )}
          </div>

          {/* ── Columna de preview (oscura) ── */}
          <div className="exd-previewcol">
            <div className="exd-previewhead">
              <span className="exd-lbl">
                Preview{activeRuleIds.size > 0 ? (shownRulesPreview ? ` · with rules · ${shownRulesPreview.version}` : ' · base DDL') : ''}
              </span>
              <span className="exd-tablesx-spacer" />
              {canExport && activeRuleIds.size > 0 && !shownRulesPreview && (
                <button type="button" className="exd-applybtn" onClick={applyRulesToPreview} disabled={rendering}>
                  {rendering ? 'Applying…' : `Apply ${activeRuleIds.size} rule${activeRuleIds.size === 1 ? '' : 's'}`}
                </button>
              )}
              {shownRulesPreview && (
                <span className="exd-previewnote">
                  {shownRulesPreview.applied} applied — same text as the download
                </span>
              )}
            </div>
            <pre className="exd-code" aria-label="DDL preview">
              {canExport
                ? (shownRulesPreview ? shownRulesPreview.sql : ddl)
                : gate.note ? `-- ${gate.note}` : '-- Select at least one table.'}
            </pre>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
