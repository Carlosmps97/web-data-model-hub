/**
 * ExportDdlModal (Screen 10 — Export DDL, `#pd`).
 *
 * Opened from the canvas toolbar's **Export DDL** action. Renders over the
 * design-system Dialog with the **canvas** backdrop (only the modeling surface
 * below the 64px toolbar is dimmed+blurred; the toolbar stays sharp).
 *
 * Generates **Databricks** DDL live from the active diagram (canonical
 * tables/columns/relationships), con la selección de tablas y el dialecto
 * arriba (Databricks habilitado · Oracle bajo llave) y la columna de opciones
 * partida en DOS PESTAÑAS:
 *  - **Output** — cómo se escribe el DDL y cómo se nombran los archivos: el
 *    formulario compartido `DdlOutputForm` (doc 93 D1). Arranca desde las
 *    Output settings del proyecto (Data Standards) y se puede ajustar para
 *    este export.
 *  - **Export rules** (`ExportRulesPanel`) — el ruleset del proyecto: qué
 *    reglas corren al exportar. Van aparte porque no son formato — la mitad
 *    son GENERADORES que agregan objetos al `.zip`.
 *
 * Footer: **Download** (a `.zip` with one `.sql` per object — `TABLE-X.sql` /
 * `VIEW_NEG-Y.sql` / `VIEW_TEC-Z.sql`, doc 93 D11 — each table and its views
 * under a folder named after the table) and **Copy to clipboard** (single
 * concatenated SQL). UI-only — no persistence.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FileCode2, Download, Copy, Lock, Check, Search, Table2, Database, Hexagon,
} from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import type { Diagram } from '@/features/modeler/services/modeler.service';
import { listViewsForTables } from '@/services/views.service';
import {
  databricksDdl, ddlZipName, tableStatements, viewStatements,
  type DdlDialect, type DdlTable, type DdlView,
} from '../generators';
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

export interface ExportDdlModalProps {
  open: boolean;
  diagram: Diagram | null;
  modelName: string;
  onClose: () => void;
}

export default function ExportDdlModal({ open, diagram, modelName, onClose }: ExportDdlModalProps) {
  const [dialect, setDialect] = useState<DdlDialect>('databricks');
  // Pestaña de la columna de opciones: formato del DDL vs ruleset del proyecto.
  const [tab, setTab] = useState<'output' | 'rules'>('output');
  // Doc 93 D1: las Output settings del proyecto son el punto de partida; lo
  // que se cambie acá vale solo para este export.
  const [settings, setSettings] = useState<DdlOutputSettings>(DEFAULT_OUTPUT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const { opts, fileNames } = useMemo(() => splitOutputSettings(settings), [settings]);

  // All tables of the diagram, sorted for a stable checklist.
  const allTables = useMemo<DdlTable[]>(
    () => (diagram?.tables ?? [])
      .map((t) => ({ id: t.id, physicalName: t.physicalName, logicalName: t.logicalName, schema: t.schema, description: t.description }))
      .sort((a, b) => a.physicalName.localeCompare(b.physicalName)),
    [diagram],
  );

  // Vistas del canvas (las tablas no traen sus vistas en el Diagram) — se cargan
  // al abrir el modal, en UNA request por tableIds, y alimentan `includeViews`.
  const [views, setViews] = useState<DdlView[]>([]);
  useEffect(() => {
    if (!open || !diagram?.tables.length) { setViews([]); return; }
    let alive = true;
    listViewsForTables(diagram.tables.map((t) => t.id))
      // F3: sourceTableIds viajan al generador (multi-fuente, `FROM t1, t2`).
      // showOnCanvas NO se mapea a propósito: no afecta el export.
      .then((vs) => { if (alive) setViews(vs.map((v) => ({ id: v.id, tableId: v.tableId, sourceTableIds: v.sourceTableIds, name: v.name, schema: v.schema, sql: v.sql, description: v.description, sources: v.sources, showOnCanvas: v.showOnCanvas, customSql: v.customSql }))); })
      .catch(() => { if (alive) setViews([]); });
    return () => { alive = false; };
  }, [open, diagram]);

  // DDL Export rules (doc 30 F10): habilitadas+válidas del catálogo, TODAS
  // marcadas por default. Sin selección el export sale byte-idéntico al de
  // siempre (cero regresión).
  const [exportRules, setExportRules] = useState<ExportRule[]>([]);
  const [selRules, setSelRules] = useState<Set<string> | null>(null);
  const [rendering, setRendering] = useState(false);
  // Doc 93 D10: defs UDP del proyecto — resuelven por nombre el UDP de columna
  // que DEFINE las particiones (regla de layout `partitionUdp`). null = cargando.
  const [udpDefs, setUdpDefs] = useState<UdpDefLite[] | null>(null);
  const [udpFailed, setUdpFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTab('output');
    setUdpDefs(null); setUdpFailed(false); setSettingsReady(false);
    fetchExportRules(sessionProjectId())
      .then((rs) => { if (alive) { setExportRules(selectableRules(rs)); setSelRules(null); } })
      .catch(() => { if (alive) setExportRules([]); });
    fetchUdpDefs(sessionProjectId())
      .then((ds) => { if (alive) setUdpDefs(ds); })
      .catch(() => { if (alive) { setUdpDefs([]); setUdpFailed(true); } });
    fetchDdlConfig(sessionProjectId())
      .then((cfg) => { if (alive) { setSettings(mergeOutputSettings(cfg?.output ?? null)); setSettingsReady(true); } })
      .catch(() => { if (alive) { setSettings(DEFAULT_OUTPUT_SETTINGS); setSettingsReady(true); } });
    return () => { alive = false; };
  }, [open]);
  const selRuleIds = useMemo(
    () => selRules ?? new Set(exportRules.map((r) => r.id)),
    [selRules, exportRules],
  );
  const toggleRule = (id: string) => {
    const base = new Set(selRuleIds);
    if (base.has(id)) base.delete(id); else base.add(id);
    setSelRules(base);
  };

  // Preview CON reglas aplicadas: bajo demanda ("Apply rules"), nunca en vivo
  // — es una llamada al motor del backend y debe coincidir EXACTO con el
  // download. Cualquier cambio de opciones/selección lo invalida.
  const [rulesPreview, setRulesPreview] = useState<{ sql: string; applied: number; version: string } | null>(null);

  // Which table ids to export — defaults to all; recomputed if the diagram changes.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [tableFilter, setTableFilter] = useState('');
  const selectedIds = useMemo(() => {
    const all = new Set(allTables.map((t) => t.id));
    if (!selected) return all;
    // Drop ids no longer present (diagram changed under us).
    return new Set([...selected].filter((id) => all.has(id)));
  }, [selected, allTables]);

  const exportTables = allTables.filter((t) => selectedIds.has(t.id));

  const ddlInput = useMemo(() => (diagram ? {
    tables: diagram.tables,
    columns: diagram.columns,
    relationships: diagram.relationships,
    views,
    tableIds: [...selectedIds],
    modelName,
  } : null), [diagram, selectedIds, modelName, views]);

  const ddl = useMemo(() => (ddlInput ? databricksDdl(ddlInput, opts) : ''), [ddlInput, opts]);
  // Doc 73: el layout de columnas (regla «Partition columns last») lo dictan las
  // reglas SELECCIONADAS — sólo el export con reglas lo aplica; sin reglas el
  // DDL base sigue byte-idéntico.
  const layout = useMemo(() => layoutFromRules(exportRules, selRuleIds), [exportRules, selRuleIds]);
  const effOpts = useMemo(() => ({ ...opts, partitionsLast: layout.partitionsLast }), [opts, layout]);
  // Doc 93 D10: con la regla de layout, las particiones salen del UDP que ella
  // nombra (PART_nn = partición y su orden) → el CREATE físico y el motor
  // coinciden; sin esa regla (o sin el UDP) rige el flag de la plataforma.
  const rulesInput = useMemo(() => (ddlInput
    ? { ...ddlInput, columns: withUdpPartitions(ddlInput.columns, udpDefs ?? [], layout.partitionUdp) }
    : null), [ddlInput, udpDefs, layout]);

  // Todo lo que cambia el resultado invalida el preview renderizado.
  useEffect(() => { setRulesPreview(null); }, [ddlInput, opts, selRuleIds, udpDefs]);

  /** El `.sql` final: con reglas seleccionadas pasa por el motor del backend
   *  (`POST /api/ddl-rules/render`); sin reglas, el texto base tal cual. */
  const buildFinalSql = async (): Promise<string> => {
    if (!diagram || !ddlInput || selRuleIds.size === 0) return ddl;
    if (rulesPreview) return rulesPreview.sql;        // ya renderizado, idéntico
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
    if (!diagram || !ddlInput || selRuleIds.size === 0) return;
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

  // Column count per table (for the "N cols" hint) + name filter over the list.
  const colCountByTable = useMemo(() => {
    const m = new Map<string, number>();
    (diagram?.columns ?? []).forEach((c) => m.set(c.tableId, (m.get(c.tableId) ?? 0) + 1));
    return m;
  }, [diagram]);
  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return allTables;
    // También por ESQUEMA y "esquema.tabla": dos tablas pueden llamarse igual
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
      if (selRuleIds.size === 0) {
        // Sin reglas: DDL base partido por objeto (mismo texto que el archivo único).
        const ts = tableStatements(ddlInput, opts).map(({ table, sql }) => ({
          id: table.id, physicalName: table.physicalName, schema: table.schema, sql,
        }));
        const vs = (opts.includeViews ? viewStatements(ddlInput, opts) : []).map(({ view, sql }) => ({
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

  const showRules = tab === 'rules' && exportRules.length > 0;
  const isDbx = dialect === 'databricks';
  // Final review #7/#15: sin las Output settings y las defs UDP cargadas no se
  // exporta (la física y la _rej podían diferir en particiones).
  const gate = exportGate({ settingsReady, udpDefsReady: udpDefs !== null, udpDefsFailed: udpFailed, rulesSelected: selRuleIds.size });
  const canExport = isDbx && exportTables.length > 0 && gate.ready;

  const footer = (
    <>
      <span className="dmh-dialog-foot-left exd-foot-count">
        {exportTables.length}/{allTables.length} tables
        {selRuleIds.size > 0 && ` · ${selRuleIds.size} rule${selRuleIds.size === 1 ? '' : 's'}`}
        {gate.note && ` · ${gate.note}`}
      </span>
      <Button variant="secondary" onClick={onClose}>Close</Button>
      <Button variant="secondary" icon={Copy} onClick={copy} disabled={!canExport || rendering}>Copy</Button>
      <Button variant="primary" icon={Download} onClick={download} disabled={!canExport || rendering}>
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
        {/* Tables to export — from current canvas */}
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
            <button type="button" className="exd-tablesx-link" onClick={selectAll} disabled={allTables.length === 0}>All</button>
            <span className="exd-tablesx-dot">·</span>
            <button type="button" className="exd-tablesx-link is-muted" onClick={selectNone} disabled={allTables.length === 0}>None</button>
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

        {/* Dialect (cards) */}
        <div className="exd-field">
          <span className="exd-lbl">Target dialect</span>
          <div className="exd-dialects">
            <button type="button" className="exd-dialect" disabled aria-disabled="true" title="Oracle is not available yet">
              <span className="exd-dialect-ico exd-dialect-ico--oracle"><Database size={16} strokeWidth={1.4} aria-hidden /></span>
              <span className="exd-dialect-txt">
                <span className="exd-dialect-name">Oracle</span>
                <span className="exd-dialect-sub">PL/SQL · soon</span>
              </span>
              <Lock size={13} className="exd-dialect-lock" aria-hidden />
            </button>
            <button
              type="button"
              className={`exd-dialect${isDbx ? ' is-on' : ''}`}
              onClick={() => setDialect('databricks')}
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
          {/* ── Options column ── */}
          <div className="exd-opts">
            {/* Las reglas NO son opciones de formato — la mitad GENERA objetos
                nuevos (la _rej, las vistas _v/DAC): van en su propia pestaña, con
                toda la altura de la columna. Proyecto sin reglas ⇒ sin pestañas. */}
            {exportRules.length > 0 && (
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
                viewsHint={views.length ? `${views.length} view(s) on the canvas` : 'No views on the canvas'}
              />
            )}
          </div>

          {/* ── Preview column (dark) ── */}
          <div className="exd-previewcol">
            <div className="exd-previewhead">
              <span className="exd-lbl">
                Preview{selRuleIds.size > 0 ? (rulesPreview ? ` · with rules · ${rulesPreview.version}` : ' · base DDL') : ''}
              </span>
              <span className="exd-tablesx-spacer" />
              {canExport && selRuleIds.size > 0 && !rulesPreview && (
                <button type="button" className="exd-applybtn" onClick={applyRulesToPreview} disabled={rendering}>
                  {rendering ? 'Applying…' : `Apply ${selRuleIds.size} rule${selRuleIds.size === 1 ? '' : 's'}`}
                </button>
              )}
              {rulesPreview && (
                <span className="exd-previewnote">
                  {rulesPreview.applied} applied — same text as the download
                </span>
              )}
            </div>
            <pre className="exd-code" aria-label="DDL preview">
              {canExport
                ? (rulesPreview ? rulesPreview.sql : ddl)
                : gate.note ? `-- ${gate.note}` : '-- Select at least one table (Databricks dialect).'}
            </pre>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
