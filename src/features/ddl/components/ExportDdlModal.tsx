/**
 * ExportDdlModal: pantalla Export DDL.
 *
 * Se abre desde la acción **Export DDL** de la barra del canvas. Se renderiza con
 * el Dialog del sistema de diseño y el fondo **canvas** (solo se oscurece la
 * superficie de modelado debajo de la barra; la barra queda nítida).
 *
 * Arriba, las tablas a exportar y con qué se genera el DDL:
 *  - **Use export settings**: DDL de **Databricks** u **Oracle** en vivo desde el
 *    diagrama activo (tablas/columnas/relaciones canónicas), con el dialecto (abre
 *    con el por defecto del proyecto, definido en Output settings) y las opciones
 *    de **Output** (`DdlOutputForm`), que arrancan desde las Output settings del
 *    proyecto (Data Standards) y se pueden ajustar para este export.
 *  - **Use export rules**: el DDL sale solo de las reglas del proyecto (Data
 *    Standards); dialecto y opciones se ocultan y se pueden desmarcar reglas para
 *    este export (`ExportRulesPanel`). Las reglas corren en el backend
 *    (`rulesBridge`): el preview se pide con «Apply N rules» y es el mismo texto
 *    que Copy. Si el proyecto tiene reglas activas, el popup abre con esta opción.
 *
 * Pie: **Download** (un `.zip`: con la configuración, un `.sql` por objeto,
 * `TABLE-X.sql` / `VIEW_NEG-Y.sql`, cada tabla y sus vistas en una carpeta con el
 * nombre de la tabla; con las reglas, los archivos que ellas escriben) y **Copy to
 * clipboard** (un solo SQL concatenado). Solo UI, sin persistencia. Exporta solo
 * las vistas del canvas (`diagram.views`), no todas las de sus tablas.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Braces, FileCode2, Download, Copy, Check, Search, SlidersHorizontal, Table2, Database, Hexagon,
} from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import type { Diagram } from '@/features/modeler/services/modeler.service';
import { canvasDdlViews } from '../canvasDdlViews';
import {
  databricksDdl, ddlZipName, sourceIdsOf, tableStatements, viewStatements,
  type DdlDialect, type DdlTable,
} from '../generators';
import { oracleDdl, oracleForeignKeysFile, oracleTableStatements, oracleViewStatements } from '../oracle';
import {
  fetchDdlConfig, fetchExportRules, renderWithRules, ruleErrorText, rulesSql,
  type ExportRule, type RenderedExport,
} from '../rulesBridge';
import {
  DEFAULT_OUTPUT_SETTINGS, mergeOutputSettings, splitOutputSettings, type DdlOutputSettings,
} from '../outputSettings';
import { sessionProjectId } from '@/store/useSessionStore';
import { runBlocking } from '@/store/useBusyStore';
import { buildZip, type ZipEntry } from '@/lib/zip';
import { plainToObjects, objectsToEntries } from '../ddlExportBundle';
import ExportRulesPanel from './ExportRulesPanel';
import DdlOutputForm from './DdlOutputForm';
import { exportGate, initialMode, type ExportMode } from '../exportGate';
import { pickedTableIds } from '../tableSelection';
import { useAuthStore } from '@/store/useAuthStore';
import { NO_EXPORT_HINT } from '@/lib/permissionHints';

const NO_FILES = 'The export rules generated no files for the selected tables.';

/** Resultado de las reglas con las tablas y reglas con que se pidió. */
interface RulesPreview { sql: string; rendered: RenderedExport; input: unknown; ruleIds: string[] }

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
  // Con qué se genera: la configuración del popup o solo las reglas del proyecto.
  const [mode, setMode] = useState<ExportMode>('settings');
  const byRules = mode === 'rules';
  // Las Output settings del proyecto son el punto de partida; lo que se
  // cambie aquí vale solo para este export.
  const [settings, setSettings] = useState<DdlOutputSettings>(DEFAULT_OUTPUT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  // Las últimas settings leídas del proyecto: al reabrir se ven de entrada (no
  // el dialecto que se eligió para el export anterior) mientras se refrescan.
  const lastLoaded = useRef<{ projectId: string; settings: DdlOutputSettings } | null>(null);
  const { opts, fileNames } = useMemo(() => splitOutputSettings(settings), [settings]);

  // El modal vive montado en la barra y el diagrama cambia con cada edición del
  // canvas: cerrado no lo recorre (en un canvas gigante, armar el DDL en cada
  // recarga costaba decenas de ms).
  const source = open ? diagram : null;

  // Todas las tablas del diagrama, ordenadas para que la lista de selección sea estable.
  const allTables = useMemo<DdlTable[]>(
    () => (source?.tables ?? [])
      .map((t) => ({ id: t.id, physicalName: t.physicalName, logicalName: t.logicalName, schema: t.schema, description: t.description }))
      .sort((a, b) => a.physicalName.localeCompare(b.physicalName)),
    [source],
  );

  // Vistas del export = las miembro de este canvas (`diagram.views`, la misma
  // lista que el canvas dibuja), no todas las vistas de sus tablas. Los
  // sourceTableIds viajan al generador (multi-fuente, `FROM t1, t2`).
  const views = useMemo(() => canvasDdlViews(source), [source]);

  // Reglas activas del proyecto, en el orden de Data Standards; todas marcadas
  // por defecto. La lista se pide en cada apertura; hasta que llega no se
  // exporta (de ella sale con qué opción abre el popup).
  const [exportRules, setExportRules] = useState<ExportRule[]>([]);
  const [selRules, setSelRules] = useState<Set<string> | null>(null);
  const [rulesState, setRulesState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [rendering, setRendering] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSelected(null); setSettingsReady(false);
    const projectId = sessionProjectId();
    const last = lastLoaded.current?.projectId === projectId ? lastLoaded.current.settings : DEFAULT_OUTPUT_SETTINGS;
    setSettings(last); setDialect(last.dialect);
    setExportRules([]); setSelRules(null); setRulesState('loading'); setMode('settings');
    fetchExportRules(projectId)
      .then((rs) => {
        if (!alive) return;
        const active = rs.filter((r) => r.enabled);
        setExportRules(active); setRulesState('ready'); setMode(initialMode(active.length));
      })
      .catch(() => { if (alive) { setExportRules([]); setRulesState('failed'); } });
    fetchDdlConfig(projectId)
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
  // Las reglas que corren, en el orden de la lista.
  const ruleIds = useMemo(() => exportRules.filter((r) => selRuleIds.has(r.id)).map((r) => r.id), [exportRules, selRuleIds]);
  const toggleRule = (id: string) => {
    const base = new Set(selRuleIds);
    if (base.has(id)) base.delete(id); else base.add(id);
    setSelRules(base);
  };

  // Preview con reglas: bajo demanda («Apply N rules»), nunca en vivo, porque
  // es una llamada al backend y debe coincidir exactamente con el download.
  // Vale solo para las tablas y reglas con que se pidió (ver `preview`).
  const [rulesPreview, setRulesPreview] = useState<RulesPreview | null>(null);

  // Tablas a exportar: por defecto ninguna; cada vez que se abre el modal se
  // empieza sin elección. Una tabla que dejó el canvas sale de la elección.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [tableFilter, setTableFilter] = useState('');
  const selectedIds = useMemo(() => pickedTableIds(selected, allTables.map((t) => t.id)), [selected, allTables]);

  const exportTables = allTables.filter((t) => selectedIds.has(t.id));

  const ddlInput = useMemo(() => (source ? {
    tables: source.tables,
    columns: source.columns,
    relationships: source.relationships,
    views,
    tableIds: [...selectedIds],
    modelName,
  } : null), [source, selectedIds, modelName, views]);

  const oracleOpts = settings.oracle;
  // Con la configuración, el DDL en vivo; con las reglas sale del backend.
  const ddl = useMemo(
    () => (ddlInput && !byRules ? (isDbx ? databricksDdl(ddlInput, opts) : oracleDdl(ddlInput, oracleOpts)) : ''),
    [ddlInput, opts, isDbx, oracleOpts, byRules],
  );

  // El preview vale para las tablas y reglas con que se pidió: si cambian (o
  // el diagrama se recarga mientras corre), deja de verse y no se reutiliza.
  const preview = rulesPreview && byRules && rulesPreview.input === ddlInput && rulesPreview.ruleIds === ruleIds
    ? rulesPreview : null;

  /** Corre las reglas elegidas sobre el export (si el preview ya está, es el
   *  mismo resultado). Un error de una regla detiene todo: no sale nada. */
  const renderRules = async (): Promise<RulesPreview> => {
    if (preview) return preview;
    const input = ddlInput!;
    const rendered = await runBlocking('Applying export rules…', () => renderWithRules({
      projectId: sessionProjectId(), diagram: diagram!, input, ruleIds,
    }));
    return { sql: rulesSql(rendered, modelName, exportTables.length), rendered, input, ruleIds };
  };
  const failText = (e: unknown, fallback: string) =>
    ruleErrorText(e) ?? (e instanceof Error && e.message ? e.message : fallback);

  /** Botón «Apply N rules» del preview: mismo resultado que Copy y el download. */
  const applyRulesToPreview = async () => {
    if (!diagram || !ddlInput || !byRules) return;
    setRendering(true);
    try { setRulesPreview(await renderRules()); }
    catch (e) { toast.error(failText(e, "Couldn't apply the export rules")); }
    finally { setRendering(false); }
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
    (source?.columns ?? []).forEach((c) => m.set(c.tableId, (m.get(c.tableId) ?? 0) + 1));
    return m;
  }, [source]);
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
    if (!exportTables.length || !diagram || !ddlInput) return;
    setRendering(true);
    try {
      let sql = ddl;
      if (byRules) {
        const out = await renderRules();
        if (!out.rendered.files.length) { toast.info(NO_FILES); return; }
        sql = out.sql;
      }
      await navigator.clipboard.writeText(sql);
      toast.success('DDL copied to clipboard');
    } catch (e) {
      toast.error(failText(e, "Couldn't copy to clipboard"));
    } finally {
      setRendering(false);
    }
  };

  const download = async () => {
    if (!exportTables.length || !diagram || !ddlInput) return;
    setRendering(true);
    try {
      let entries: ZipEntry[];
      let renamed = 0;
      if (byRules) {
        // Con las reglas: los archivos que ellas escriben, con su ruta.
        const { rendered } = await renderRules();
        if (!rendered.files.length) { toast.info(NO_FILES); return; }
        entries = rendered.files.map((f) => ({ path: f.path, content: f.content }));
        renamed = rendered.log.filter((e) => e.status === 'renamed').length;
      } else {
        // Con la configuración: DDL partido por objeto (mismo texto que el archivo único).
        const ts = (isDbx ? tableStatements(ddlInput, opts) : oracleTableStatements(ddlInput, oracleOpts)).map(({ table, sql }) => ({
          id: table.id, physicalName: table.physicalName, schema: table.schema, sql,
        }));
        const withViews = isDbx ? opts.includeViews : oracleOpts.includeViews;
        const views = !withViews ? [] : isDbx ? viewStatements(ddlInput, opts) : oracleViewStatements(ddlInput, oracleOpts);
        const vs = views.map(({ view, sql }) => ({ name: view.name, schema: view.schema, sourceTableIds: sourceIdsOf(view), sql }));
        entries = objectsToEntries(plainToObjects({ tables: ts, views: vs }), fileNames);
        // Oracle: las FK en su propio archivo, para correrlo después de todas las
        // tablas (en el archivo de la tabla hija podrían correr antes que el padre).
        const fks = isDbx ? null : oracleForeignKeysFile(ddlInput, oracleOpts);
        if (fks) entries.push({ path: 'FOREIGN_KEYS.sql', content: fks });
      }
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
      toast.success(`Downloaded ${zipName} · ${entries.length} file${entries.length === 1 ? '' : 's'}`
        + (renamed ? ` · ${renamed} renamed (repeated name or invalid characters)` : ''));
    } catch (e) {
      toast.error(failText(e, "Couldn't build the DDL download"));
    } finally {
      setRendering(false);
    }
  };

  const rulesReady = rulesState !== 'loading';
  // Sin las Output settings y la lista de reglas no se exporta.
  const gate = exportGate({ settingsReady, rulesReady, rulesFailed: rulesState === 'failed', mode, rulesSelected: ruleIds.length });
  const canExport = exportTables.length > 0 && gate.ready;
  // Descargar o copiar el DDL exige el permiso `export`.
  const allowed = useAuthStore((st) => st.has('export'));
  const deniedTip = allowed ? undefined : NO_EXPORT_HINT;
  const rulesAvailable = rulesReady && exportRules.length > 0;
  const settingsRadio = useRef<HTMLButtonElement>(null);
  const rulesRadio = useRef<HTMLButtonElement>(null);
  /** Flechas en el grupo de opciones (radio): pasan a la otra opción si se puede. */
  const modeKeys = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || !rulesReady) return;
    e.preventDefault();
    const next: ExportMode = byRules ? 'settings' : 'rules';
    if (next === 'rules' && !rulesAvailable) return;
    setMode(next);
    (next === 'rules' ? rulesRadio : settingsRadio).current?.focus();
  };
  const rulesSub = !rulesReady ? 'Loading…'
    : rulesState === 'failed' ? "Couldn't load the export rules — reopen the dialog to try again"
      : exportRules.length === 0 ? 'This project has no active export rules'
        : `Only the ${exportRules.length} rule${exportRules.length === 1 ? '' : 's'} of Data Standards`;

  const footer = (
    <>
      <span className="dmh-dialog-foot-left exd-foot-count">
        {exportTables.length}/{allTables.length} tables
        {byRules && ` · ${ruleIds.length} rule${ruleIds.length === 1 ? '' : 's'}`}
        {gate.note && ` · ${gate.note}`}
      </span>
      <Button variant="secondary" onClick={onClose}>Close</Button>
      <Button variant="secondary" icon={Copy} onClick={copy} disabled={!allowed || !canExport || rendering} title={deniedTip}>Copy</Button>
      <Button variant="primary" icon={Download} onClick={download} disabled={!allowed || !canExport || rendering} title={deniedTip}>
        {rendering && byRules ? 'Applying rules…' : 'Download .zip'}
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

        {/* Con qué se genera: la configuración del popup o solo las reglas */}
        <div className="exd-field">
          <span className="exd-lbl">Generate with</span>
          <div className="exd-dialects" role="radiogroup" aria-label="Generate with" onKeyDown={modeKeys}>
            <button
              ref={settingsRadio}
              type="button" role="radio" aria-checked={!byRules} tabIndex={byRules ? -1 : 0}
              className={`exd-dialect${!byRules ? ' is-on' : ''}`}
              onClick={() => setMode('settings')}
              disabled={!rulesReady}
            >
              <span className="exd-dialect-ico exd-dialect-ico--settings"><SlidersHorizontal size={16} strokeWidth={1.4} aria-hidden /></span>
              <span className="exd-dialect-txt">
                <span className="exd-dialect-name">Use export settings</span>
                <span className="exd-dialect-sub">Dialect and output options of this dialog</span>
              </span>
            </button>
            <button
              ref={rulesRadio}
              type="button" role="radio" aria-checked={byRules} tabIndex={byRules ? 0 : -1}
              className={`exd-dialect${byRules ? ' is-on' : ''}`}
              onClick={() => setMode('rules')}
              disabled={!rulesAvailable}
            >
              <span className="exd-dialect-ico exd-dialect-ico--rules"><Braces size={16} strokeWidth={1.4} aria-hidden /></span>
              <span className="exd-dialect-txt">
                <span className="exd-dialect-name">Use export rules</span>
                <span className="exd-dialect-sub">{rulesSub}</span>
              </span>
            </button>
          </div>
        </div>

        {!byRules && (
          /* Dialecto (tarjetas) */
          <div className="exd-field">
            <span className="exd-lbl">Target dialect</span>
            <div className="exd-dialects">
              {/* Hasta que llegan las Output settings no se elige: el valor por
                  defecto del proyecto pisaría la elección. */}
              <button
                type="button"
                className={`exd-dialect${!isDbx ? ' is-on' : ''}`}
                onClick={() => setDialect('oracle')}
                disabled={!settingsReady || !rulesReady}
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
                onClick={() => setDialect('databricks')}
                disabled={!settingsReady || !rulesReady}
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
        )}

        <div className="exd-cols">
          {/* ── Columna de opciones: las de Output o la lista de reglas ── */}
          <div className="exd-opts">
            {byRules ? (
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
                disabled={!settingsReady || !rulesReady}
                dialect={dialect}
                viewsHint={views.length ? `${views.length} view(s) on the canvas` : 'No views on the canvas'}
              />
            )}
          </div>

          {/* ── Columna de preview (oscura) ── */}
          <div className="exd-previewcol">
            <div className="exd-previewhead">
              <span className="exd-lbl">
                Preview{byRules ? (preview ? ` · export rules${preview.rendered.rulesetVersion ? ` · ${preview.rendered.rulesetVersion}` : ''}` : ' · export rules') : ''}
              </span>
              <span className="exd-tablesx-spacer" />
              {canExport && byRules && !preview && (
                <button type="button" className="exd-applybtn" onClick={applyRulesToPreview} disabled={rendering}>
                  {rendering ? 'Applying…' : `Apply ${ruleIds.length} rule${ruleIds.length === 1 ? '' : 's'}`}
                </button>
              )}
              {preview && (
                <span className="exd-previewnote">
                  {preview.rendered.files.length} file{preview.rendered.files.length === 1 ? '' : 's'} — same text as Copy
                </span>
              )}
            </div>
            <pre className="exd-code" aria-label="DDL preview">
              {!canExport
                ? (gate.note ? `-- ${gate.note}` : '-- Select at least one table.')
                : !byRules ? ddl
                  : preview ? (preview.rendered.files.length ? preview.sql : `-- ${NO_FILES}`)
                    : `-- Press "Apply ${ruleIds.length} rule${ruleIds.length === 1 ? '' : 's'}" to see the DDL the export rules generate.`}
            </pre>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
