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
 * Footer: **Download .sql** (single file; named after the table when exactly
 * one is selected) and **Copy to clipboard**. UI-only — no persistence.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FileCode2, Download, Copy, Lock, Plus, Trash2, Check, Search, Table2, Database, Hexagon,
} from 'lucide-react';

import { Button, Dialog } from '@/components/ui';
import type { Diagram } from '@/features/modeler/services/modeler.service';
import { listViewsForTables } from '@/services/views.service';
import {
  databricksDdl, ddlFilename, DEFAULT_DATABRICKS_OPTS,
  type DatabricksDdlOptions, type DdlDialect, type DdlTableFormat, type DdlTable, type DdlView,
} from '../generators';

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
      .then((vs) => { if (alive) setViews(vs.map((v) => ({ id: v.id, tableId: v.tableId, name: v.name, schema: v.schema, sql: v.sql, filter: v.filter, description: v.description, sources: v.sources }))); })
      .catch(() => { if (alive) setViews([]); });
    return () => { alive = false; };
  }, [open, diagram]);

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

  const ddl = useMemo(() => {
    if (!diagram) return '';
    return databricksDdl(
      {
        tables: diagram.tables,
        columns: diagram.columns,
        relationships: diagram.relationships,
        views,
        tableIds: [...selectedIds],
        modelName,
      },
      opts,
    );
  }, [diagram, selectedIds, modelName, opts, views]);

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
    return allTables.filter(
      (t) => t.physicalName.toLowerCase().includes(q) || (t.logicalName ?? '').toLowerCase().includes(q),
    );
  }, [allTables, tableFilter]);

  const addProp = () => set('tblProperties', [...opts.tblProperties, { key: '', value: '' }]);
  const setProp = (i: number, patch: Partial<{ key: string; value: string }>) =>
    set('tblProperties', opts.tblProperties.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const delProp = (i: number) => set('tblProperties', opts.tblProperties.filter((_, idx) => idx !== i));

  const copy = async () => {
    if (!exportTables.length) return;
    try { await navigator.clipboard.writeText(ddl); toast.success('DDL copiado al portapapeles'); }
    catch { toast.error('No se pudo copiar al portapapeles'); }
  };

  const download = () => {
    if (!exportTables.length) return;
    const blob = new Blob([ddl], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ddlFilename(exportTables, modelName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Descargado ${ddlFilename(exportTables, modelName)}`);
  };

  const isDbx = dialect === 'databricks';
  const canExport = isDbx && exportTables.length > 0;

  const footer = (
    <>
      <span className="dmh-dialog-foot-left exd-foot-count">
        {exportTables.length}/{allTables.length} tablas
      </span>
      <Button variant="secondary" onClick={onClose}>Cerrar</Button>
      <Button variant="secondary" icon={Copy} onClick={copy} disabled={!canExport}>Copiar</Button>
      <Button variant="primary" icon={Download} onClick={download} disabled={!canExport}>Descargar .sql</Button>
    </>
  );

  return (
    <Dialog
      open={open}
      title="Export DDL"
      subtitle={`Genera DDL desde el modelo · ${allTables.length} tablas`}
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
              placeholder="Filter tables…"
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
              <span className="exd-empty">El canvas no tiene tablas.</span>
            ) : filteredTables.length === 0 ? (
              <span className="exd-empty">Ninguna tabla coincide con el filtro.</span>
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
                    <span className={`exd-tablesx-row-name${on ? '' : ' is-off'}`}>{t.physicalName}</span>
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
            <button type="button" className="exd-dialect" disabled aria-disabled="true" title="Oracle aún no está disponible">
              <span className="exd-dialect-ico exd-dialect-ico--oracle"><Database size={16} strokeWidth={1.4} aria-hidden /></span>
              <span className="exd-dialect-txt">
                <span className="exd-dialect-name">Oracle</span>
                <span className="exd-dialect-sub">PL/SQL · pronto</span>
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
              <SwitchRow on={opts.includeViews} onClick={() => set('includeViews', !opts.includeViews)} label="Views" hint={views.length ? `${views.length} vista(s) en el canvas` : 'Sin vistas en el canvas'} />
              <SwitchRow on={opts.includeKeys} onClick={() => set('includeKeys', !opts.includeKeys)} label="Primary & foreign keys" hint="PK / FK constraints" />
              <SwitchRow on={opts.includeComments} onClick={() => set('includeComments', !opts.includeComments)} label="Comments" hint="Definiciones funcionales" />
              <SwitchRow on={opts.includePartitions} onClick={() => set('includePartitions', !opts.includePartitions)} label="Partitions" hint="PARTITIONED BY" />
              <SwitchRow on={opts.includeIndexes} onClick={() => set('includeIndexes', !opts.includeIndexes)} label="Indexes" hint="Hint ZORDER" />
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
                <span className="exd-sublbl">Schema por defecto</span>
                <input className="rd-input exd-input" value={opts.defaultSchema} onChange={(e) => set('defaultSchema', e.target.value)} placeholder="default" />
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
              <button type="button" className="exd-add" onClick={addProp}><Plus size={13} strokeWidth={2} />Añadir</button>
            </div>
            {opts.tblProperties.length === 0
              ? <span className="exd-empty">Sin propiedades.</span>
              : opts.tblProperties.map((p, i) => (
                <div key={i} className="exd-prop">
                  <input className="rd-input exd-input exd-mono" value={p.key} onChange={(e) => setProp(i, { key: e.target.value })} placeholder="delta.appendOnly" />
                  <input className="rd-input exd-input exd-mono" value={p.value} onChange={(e) => setProp(i, { value: e.target.value })} placeholder="true" />
                  <button type="button" className="exd-iconbtn" onClick={() => delProp(i)} aria-label="Quitar"><Trash2 size={14} /></button>
                </div>
              ))}
          </div>

          {/* ── Preview column (dark) ── */}
          <div className="exd-previewcol">
            <span className="exd-lbl">Preview</span>
            <pre className="exd-code" aria-label="DDL preview">{canExport ? ddl : '-- Seleccioná al menos una tabla (dialecto Databricks).'}</pre>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
