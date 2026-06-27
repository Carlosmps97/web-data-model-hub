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

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FileCode2, Download, Copy, Lock, Plus, Trash2, Check,
} from 'lucide-react';

import { Button, Dialog, SegmentedControl } from '@/components/ui';
import type { Diagram } from '@/features/modeler/services/modeler.service';
import {
  databricksDdl, ddlFilename, DEFAULT_DATABRICKS_OPTS,
  type DatabricksDdlOptions, type DdlDialect, type DdlTableFormat, type DdlTable,
} from '../generators';

export interface ExportDdlModalProps {
  open: boolean;
  diagram: Diagram | null;
  modelName: string;
  onClose: () => void;
}

const DIALECTS: { value: DdlDialect; label: string }[] = [
  { value: 'databricks', label: 'Databricks' },
  { value: 'oracle', label: 'Oracle' },
];

const FORMATS: DdlTableFormat[] = ['delta', 'parquet', 'avro', 'orc', 'csv', 'json'];

/** A labelled toggle row (checkbox-style) used for the boolean options. */
function Toggle({
  on, onClick, label, hint,
}: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button type="button" className={`exd-toggle${on ? ' is-on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="exd-toggle-box">{on && <Check size={12} strokeWidth={3} aria-hidden />}</span>
      <span className="exd-toggle-txt">
        <span className="exd-toggle-label">{label}</span>
        {hint && <span className="exd-toggle-hint">{hint}</span>}
      </span>
    </button>
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

  // Which table ids to export — defaults to all; recomputed if the diagram changes.
  const [selected, setSelected] = useState<Set<string> | null>(null);
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
        tableIds: [...selectedIds],
        modelName,
      },
      opts,
    );
  }, [diagram, selectedIds, modelName, opts]);

  const toggleTable = (id: string) => {
    const base = new Set(selectedIds);
    if (base.has(id)) base.delete(id); else base.add(id);
    setSelected(base);
  };
  const allOn = exportTables.length === allTables.length && allTables.length > 0;
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(allTables.map((t) => t.id)));

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
      canvasTop={64}
    >
      <div className="exd">
        {/* Dialect */}
        <div className="exd-field">
          <span className="exd-lbl">Dialecto</span>
          <SegmentedControl
            aria-label="Dialecto"
            value={dialect}
            onChange={(v) => { if (v === 'databricks') setDialect(v); }}
            options={DIALECTS.map((d) => ({
              value: d.value,
              label: d.value === 'oracle' ? `${d.label} · pronto` : d.label,
              icon: d.value === 'oracle' ? Lock : undefined,
            }))}
          />
          {!isDbx && <span className="exd-locked">Oracle aún no está disponible.</span>}
        </div>

        <div className="exd-cols">
          {/* ── Options column ── */}
          <div className="exd-opts">
            <span className="exd-section">Incluir</span>
            <div className="exd-toggles">
              <Toggle on={opts.includeViews} onClick={() => set('includeViews', !opts.includeViews)} label="Vistas" hint="CREATE VIEW por rol" />
              <Toggle on={opts.includeKeys} onClick={() => set('includeKeys', !opts.includeKeys)} label="PK / FK" hint="PRIMARY/FOREIGN KEY" />
              <Toggle on={opts.includeComments} onClick={() => set('includeComments', !opts.includeComments)} label="Comments" hint="Definiciones funcionales" />
              <Toggle on={opts.includePartitions} onClick={() => set('includePartitions', !opts.includePartitions)} label="Partitions" hint="PARTITIONED BY" />
              <Toggle on={opts.includeIndexes} onClick={() => set('includeIndexes', !opts.includeIndexes)} label="Index" hint="Hint ZORDER" />
            </div>

            <span className="exd-section">Tabla</span>
            <div className="exd-field">
              <span className="exd-sublbl">Tipo de tabla · USING</span>
              <select className="rd-input exd-input" value={opts.tableFormat} onChange={(e) => set('tableFormat', e.target.value as DdlTableFormat)}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <Toggle on={opts.unityCatalog} onClick={() => set('unityCatalog', !opts.unityCatalog)} label="Unity Catalog" hint="catalog.schema.table" />
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

            <Toggle on={opts.external} onClick={() => set('external', !opts.external)} label="External table" hint="CREATE EXTERNAL TABLE … LOCATION" />
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

          {/* ── Table selection column ── */}
          <div className="exd-tables">
            <div className="exd-tables-head">
              <span className="exd-section">Tablas</span>
              <button type="button" className="exd-selall" onClick={toggleAll} disabled={allTables.length === 0}>
                {allOn ? 'Ninguna' : 'Todas'}
              </button>
            </div>
            <div className="exd-tablelist">
              {allTables.length === 0
                ? <span className="exd-empty">El canvas no tiene tablas.</span>
                : allTables.map((t) => (
                  <button key={t.id} type="button" className={`exd-tablerow${selectedIds.has(t.id) ? ' is-on' : ''}`} onClick={() => toggleTable(t.id)} aria-pressed={selectedIds.has(t.id)}>
                    <span className="exd-toggle-box">{selectedIds.has(t.id) && <Check size={12} strokeWidth={3} aria-hidden />}</span>
                    <span className="exd-tablerow-txt">
                      <span className="exd-tablerow-name exd-mono">{t.physicalName}</span>
                      {t.logicalName && t.logicalName !== t.physicalName && <span className="exd-tablerow-sub">{t.logicalName}</span>}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* ── Live preview ── */}
        <div className="exd-field">
          <span className="exd-lbl">Preview</span>
          <pre className="exd-code" aria-label="DDL preview">{canExport ? ddl : '-- Seleccioná al menos una tabla (dialecto Databricks).'}</pre>
        </div>
      </div>
    </Dialog>
  );
}
