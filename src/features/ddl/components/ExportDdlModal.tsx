/**
 * ExportDdlModal (Screen 10 — Export DDL, `#pd`).
 *
 * Opened from the canvas toolbar's **Export DDL** action. Renders over the
 * design-system Dialog with the **canvas** backdrop (only the modeling surface
 * below the 64px toolbar is dimmed+blurred; the toolbar stays sharp).
 *
 * Generates **Databricks** DDL live from the active diagram (canonical
 * tables/columns/relationships) and a panel of options:
 *  - dialect selector (Databricks enabled · Oracle locked),
 *  - include views / pk·fk / comments / partitions / index,
 *  - table format (USING delta|parquet|avro|…),
 *  - Unity Catalog (catalog.schema.table) + catalog/default-schema,
 *  - External table (CREATE EXTERNAL TABLE … LOCATION '<path>'),
 *  - optional TBLPROPERTIES key/value pairs,
 *  - per-table selection (which tables to export).
 *
 * Footer: **Download** (a `.zip` with one `.sql` per object — `[TABLE] X.sql` /
 * `[VIEW] Y.sql` — each table and its views under a folder named after the
 * table) and **Copy to clipboard** (single concatenated SQL). UI-only — no
 * persistence.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FileCode2, Download, Copy, Lock, Plus, Trash2, Check, Search, Table2, Database, Hexagon,
} from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import SchemaSelect from '@/features/modeler/components/SchemaSelect';
import type { Diagram } from '@/features/modeler/services/modeler.service';
import { listViewsForTables } from '@/services/views.service';
import {
  databricksDdl, ddlZipName, tableStatements, viewStatements,
  DEFAULT_DATABRICKS_OPTS,
  type DatabricksDdlOptions, type DdlDialect, type DdlTableFormat, type DdlTable, type DdlView,
} from '../generators';
import { fetchExportRules, renderWithRules, selectableRules, type ExportRule } from '../rulesBridge';
import { buildZip } from '@/lib/zip';
import { plainToObjects, statementsToObjects, objectsToEntries, viewKey } from '../ddlExportBundle';

export interface ExportDdlModalProps {
  open: boolean;
  diagram: Diagram | null;
  modelName: string;
  onClose: () => void;
}

const FORMATS: DdlTableFormat[] = ['delta', 'parquet', 'avro', 'orc', 'csv', 'json'];

/** Display label for a format chip (ORC/CSV/JSON upper, rest capitalised). */
function fmtLabel(f: DdlTableFormat): string {
  return f === 'orc' || f === 'csv' || f === 'json' ? f.toUpperCase() : f.charAt(0).toUpperCase() + f.slice(1);
}

/** A labelled switch row (on/off slider) used for the boolean options. */
function SwitchRow({
  on, onClick, label, hint,
}: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <div className="exd-swrow">
      <span className="exd-swrow-txt">
        <span className="exd-swrow-label">{label}</span>
        {hint && <span className="exd-swrow-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`exd-swt${on ? ' on' : ''}`}
        onClick={onClick}
      />
    </div>
  );
}

export default function ExportDdlModal({ open, diagram, modelName, onClose }: ExportDdlModalProps) {
  const [dialect, setDialect] = useState<DdlDialect>('databricks');
  const [opts, setOpts] = useState<DatabricksDdlOptions>(DEFAULT_DATABRICKS_OPTS);
  const set = <K extends keyof DatabricksDdlOptions>(k: K, v: DatabricksDdlOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

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
      // F3: sourceTableIds/joinOverride viajan al generador (multi-fuente).
      // showOnCanvas NO se mapea a propósito: no afecta el export.
      .then((vs) => { if (alive) setViews(vs.map((v) => ({ id: v.id, tableId: v.tableId, sourceTableIds: v.sourceTableIds, joinOverride: v.joinOverride, name: v.name, schema: v.schema, sql: v.sql, filter: v.filter, description: v.description, sources: v.sources, showOnCanvas: v.showOnCanvas, customSql: v.customSql }))); })
      .catch(() => { if (alive) setViews([]); });
    return () => { alive = false; };
  }, [open, diagram]);

  // DDL Export rules (doc 30 F10): habilitadas+válidas del catálogo, TODAS
  // marcadas por default. Sin selección el export sale byte-idéntico al de
  // siempre (cero regresión).
  const [exportRules, setExportRules] = useState<ExportRule[]>([]);
  const [selRules, setSelRules] = useState<Set<string> | null>(null);
  const [rendering, setRendering] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchExportRules()
      .then((rs) => { if (alive) { setExportRules(selectableRules(rs)); setSelRules(null); } })
      .catch(() => { if (alive) setExportRules([]); });
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

  // Todo lo que cambia el resultado invalida el preview renderizado.
  useEffect(() => { setRulesPreview(null); }, [ddlInput, opts, selRuleIds]);

  /** El `.sql` final: con reglas seleccionadas pasa por el motor del backend
   *  (`POST /api/ddl-rules/render`); sin reglas, el texto base tal cual. */
  const buildFinalSql = async (): Promise<string> => {
    if (!diagram || !ddlInput || selRuleIds.size === 0) return ddl;
    if (rulesPreview) return rulesPreview.sql;        // ya renderizado, idéntico
    setRendering(true);
    try {
      const { sql } = await renderWithRules({
        diagram, input: ddlInput, opts, ruleIds: [...selRuleIds], modelName,
      });
      return sql;
    } finally { setRendering(false); }
  };

  /** Botón "Apply rules" del Preview: mismo motor, mismo texto que el download. */
  const applyRulesToPreview = async () => {
    if (!diagram || !ddlInput || selRuleIds.size === 0) return;
    setRendering(true);
    try {
      const { sql, rendered } = await renderWithRules({
        diagram, input: ddlInput, opts, ruleIds: [...selRuleIds], modelName,
      });
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

  const addProp = () => set('tblProperties', [...opts.tblProperties, { key: '', value: '' }]);
  const setProp = (i: number, patch: Partial<{ key: string; value: string }>) =>
    set('tblProperties', opts.tblProperties.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const delProp = (i: number) => set('tblProperties', opts.tblProperties.filter((_, idx) => idx !== i));

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
        const { rendered } = await renderWithRules({
          diagram, input: ddlInput, opts, ruleIds: [...selRuleIds], modelName,
        });
        const viewSources = new Map<string, string[]>();
        views.forEach((v) => viewSources.set(
          viewKey(v.schema ?? null, v.name),
          v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []),
        ));
        const tablesById = new Map(exportTables.map((t) => [t.id, { physicalName: t.physicalName, schema: t.schema }]));
        objects = statementsToObjects({ statements: rendered.statements, viewSources, tablesById });
      }

      const entries = objectsToEntries(objects);
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

  const isDbx = dialect === 'databricks';
  const canExport = isDbx && exportTables.length > 0;

  const footer = (
    <>
      <span className="dmh-dialog-foot-left exd-foot-count">
        {exportTables.length}/{allTables.length} tables
        {selRuleIds.size > 0 && ` · ${selRuleIds.size} rule${selRuleIds.size === 1 ? '' : 's'}`}
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
            <span className="exd-section">Include</span>
            <div className="exd-switches">
              <SwitchRow on={opts.includeViews} onClick={() => set('includeViews', !opts.includeViews)} label="Views" hint={views.length ? `${views.length} view(s) on the canvas` : 'No views on the canvas'} />
              <SwitchRow on={opts.includeKeys} onClick={() => set('includeKeys', !opts.includeKeys)} label="Primary & foreign keys" hint="PK / FK constraints" />
              <SwitchRow on={opts.includeComments} onClick={() => set('includeComments', !opts.includeComments)} label="Comments" hint="Functional definitions" />
              <SwitchRow on={opts.includePartitions} onClick={() => set('includePartitions', !opts.includePartitions)} label="Partitions" hint="PARTITIONED BY" />
              <SwitchRow on={opts.includeIndexes} onClick={() => set('includeIndexes', !opts.includeIndexes)} label="Indexes" hint="Hint ZORDER" />
            </div>

            {/* ── Export rules (doc 30 §12): lista compacta, todas ON ── */}
            {exportRules.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                  <span className="exd-section" style={{ margin: 0 }}>Export rules</span>
                  <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10.5, color: '#8A93A5' }}>
                    {selRuleIds.size}/{exportRules.length}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="exd-tablesx-link"
                    onClick={() => setSelRules(new Set(exportRules.map((r) => r.id)))}>All</button>
                  <span className="exd-tablesx-dot">·</span>
                  <button type="button" className="exd-tablesx-link is-muted"
                    onClick={() => setSelRules(new Set<string>())}>None</button>
                </div>
                <div style={{ border: '1px solid #E6EAF0', borderRadius: 9, padding: '4px 2px', margin: '6px 0 2px', maxHeight: 168, overflowY: 'auto' }}>
                  {exportRules.map((r) => {
                    const on = selRuleIds.has(r.id);
                    return (
                      <button key={r.id} type="button" onClick={() => toggleRule(r.id)} aria-pressed={on}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 26, padding: '0 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        <span className={`exd-cbox${on ? ' is-on' : ''}`}>
                          {on && <Check size={11} strokeWidth={2.6} aria-hidden />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono, monospace)', fontSize: 11.5, color: on ? '#1A2B4A' : '#9AA3B2' }}>
                          {r.name}
                        </span>
                        {r.validationState === 'stale' && (
                          <span title="A UDP list value this rule uses was removed"
                            style={{ width: 6, height: 6, borderRadius: '50%', background: '#E5A83B', flex: 'none' }} />
                        )}
                        <span style={{ flex: 'none', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: r.kind === 'generator' ? '#8B5CF6' : '#2E5BFF', background: r.kind === 'generator' ? '#F3EEFF' : '#EAF0FF', borderRadius: 4, padding: '1px 5px' }}>
                          {r.kind === 'generator' ? 'GEN' : 'RULE'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <span className="exd-empty">
                  Applied on download/copy · manage in Data Standards → DDL Export rules.
                </span>
              </>
            )}

            <span className="exd-section">Identifier casing</span>
            <div className="rd-seg exd-caseseg" role="group" aria-label="Identifier casing">
              {(['as-is', 'lower', 'upper'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={opts.identifierCase === c ? 'active' : ''}
                  onClick={() => set('identifierCase', c)}
                  aria-pressed={opts.identifierCase === c}
                  title={c === 'as-is'
                    ? 'Identifiers as they are in the model'
                    : c === 'lower' ? 'Identifiers in lowercase' : 'Identifiers in UPPERCASE'}
                >
                  {c === 'as-is' ? 'As-is' : c === 'lower' ? 'lower' : 'UPPER'}
                </button>
              ))}
            </div>

            <span className="exd-section">Table format · USING</span>
            <div className="exd-chips">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`exd-chip${opts.tableFormat === f ? ' is-on' : ''}`}
                  onClick={() => set('tableFormat', f)}
                  aria-pressed={opts.tableFormat === f}
                >
                  {fmtLabel(f)}
                </button>
              ))}
            </div>

            <SwitchRow on={opts.unityCatalog} onClick={() => set('unityCatalog', !opts.unityCatalog)} label="Unity Catalog" hint="catalog.schema.table" />
            <div className="exd-row2">
              <div className="exd-field">
                <span className="exd-sublbl">Catalog</span>
                <input className="rd-input exd-input" value={opts.catalog} disabled={!opts.unityCatalog} onChange={(e) => set('catalog', e.target.value)} placeholder="main" />
              </div>
              <div className="exd-field">
                <span className="exd-sublbl">Default schema</span>
                {/* Dropdown de esquemas (doc 18): se crean desde Structure · Esquemas. */}
                <SchemaSelect className="rd-input exd-input" value={opts.defaultSchema} onChange={(v) => set('defaultSchema', v)} />
              </div>
            </div>

            <SwitchRow on={opts.external} onClick={() => set('external', !opts.external)} label="External table" hint="CREATE EXTERNAL TABLE … LOCATION" />
            {opts.external && (
              <div className="exd-field">
                <span className="exd-sublbl">Location (S3 / ADLS)</span>
                <input className="rd-input exd-input" value={opts.location} onChange={(e) => set('location', e.target.value)} placeholder="s3://bucket/path" />
              </div>
            )}

            <div className="exd-tblprops-head">
              <span className="exd-section">TBLPROPERTIES</span>
              <button type="button" className="exd-add" onClick={addProp}><Plus size={13} strokeWidth={2} />Add</button>
            </div>
            {opts.tblProperties.length === 0
              ? <span className="exd-empty">No properties.</span>
              : opts.tblProperties.map((p, i) => (
                <div key={i} className="exd-prop">
                  <input className="rd-input exd-input exd-mono" value={p.key} onChange={(e) => setProp(i, { key: e.target.value })} placeholder="delta.appendOnly" />
                  <input className="rd-input exd-input exd-mono" value={p.value} onChange={(e) => setProp(i, { value: e.target.value })} placeholder="true" />
                  <button type="button" className="exd-iconbtn" onClick={() => delProp(i)} aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              ))}
          </div>

          {/* ── Preview column (dark) ── */}
          <div className="exd-previewcol">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="exd-lbl" style={{ margin: 0 }}>
                Preview{selRuleIds.size > 0 ? (rulesPreview ? ` · with rules · ${rulesPreview.version}` : ' · base DDL') : ''}
              </span>
              <span style={{ flex: 1 }} />
              {canExport && selRuleIds.size > 0 && !rulesPreview && (
                <button type="button" onClick={applyRulesToPreview} disabled={rendering}
                  style={{ height: 24, padding: '0 10px', border: '1px solid #D4E0FF', background: '#EAF0FF', color: '#2E5BFF', borderRadius: 6, fontSize: 11.5, fontWeight: 600, cursor: rendering ? 'default' : 'pointer', fontFamily: 'inherit', opacity: rendering ? 0.6 : 1 }}>
                  {rendering ? 'Applying…' : `Apply ${selRuleIds.size} rule${selRuleIds.size === 1 ? '' : 's'}`}
                </button>
              )}
              {rulesPreview && (
                <span style={{ fontSize: 10.5, color: '#8A93A5' }}>
                  {rulesPreview.applied} applied — same text as the download
                </span>
              )}
            </div>
            <pre className="exd-code" aria-label="DDL preview">
              {canExport
                ? (rulesPreview ? rulesPreview.sql : ddl)
                : '-- Select at least one table (Databricks dialect).'}
            </pre>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
