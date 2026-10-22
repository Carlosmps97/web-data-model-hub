/**
 * DdlOutputForm: cómo se escribe el DDL exportado y cómo se nombran sus
 * archivos. Un solo formulario para dos lugares: la pestaña Output del modal
 * Export DDL (ajuste de un export puntual) y el editor «Output settings» de
 * Data Standards (el estándar del proyecto, versionado). Controlado y sin
 * estado propio.
 *
 * `dialect` elige qué configuración se edita. Databricks = el formulario base
 * (claves planas). Oracle = su configuración propia (`value.oracle`): solo lo
 * que existe en Oracle, sin particiones, índices ZORDER, CREATE OR REPLACE,
 * tags, USING, Unity Catalog, LOCATION ni TBLPROPERTIES. Los nombres de archivo
 * son de los dos. En Oracle los tipos salen tal cual (sin mapeo de tipos ni
 * tamaño máximo de strings).
 */
import { Plus, Trash2 } from 'lucide-react';

import SchemaSelect from '@/features/modeler/components/SchemaSelect';
import type { DdlDialect, DdlTableFormat, IdentifierCase } from '../generators';
import type { DdlFileNames } from '../ddlExportBundle';
import type { DdlOutputSettings } from '../outputSettings';
import type { OracleDdlOptions } from '../oracle';

const FORMATS: DdlTableFormat[] = ['delta', 'parquet', 'avro', 'orc', 'csv', 'json'];

/** Etiqueta visible del chip de formato (ORC/CSV/JSON en mayúsculas, el resto capitalizado). */
const fmtLabel = (f: DdlTableFormat): string =>
  (f === 'orc' || f === 'csv' || f === 'json' ? f.toUpperCase() : f.charAt(0).toUpperCase() + f.slice(1));

function SwitchRow({ on, onClick, label, hint, disabled }: {
  on: boolean; onClick: () => void; label: string; hint?: string; disabled?: boolean;
}) {
  return (
    <div className="exd-swrow">
      <span className="exd-swrow-txt">
        <span className="exd-swrow-label">{label}</span>
        {hint && <span className="exd-swrow-hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
        className={`exd-swt${on ? ' on' : ''}`} onClick={onClick} />
    </div>
  );
}

/** Segmented control (mismo estilo que el casing de identificadores). */
function Seg<T extends string>({ value, options, onPick, label, disabled }: {
  value: T; options: [T, string, string][]; onPick: (v: T) => void; label: string; disabled?: boolean;
}) {
  return (
    <div className="rd-seg exd-caseseg" role="group" aria-label={label}>
      {options.map(([v, text, title]) => (
        <button key={v} type="button" className={value === v ? 'active' : ''} aria-pressed={value === v}
          title={title} disabled={disabled} onClick={() => onPick(v)}>{text}</button>
      ))}
    </div>
  );
}

const CASES: [IdentifierCase, string, string][] = [
  ['as-is', 'As-is', 'As they are in the model'], ['lower', 'lower', 'Lowercase'], ['upper', 'UPPER', 'Uppercase'],
];

/** Nombres de los archivos del `.zip` — los mismos para los dos dialectos. */
function FileNamesFields({ value, onChange, disabled }: {
  value: DdlOutputSettings; onChange: (next: DdlOutputSettings) => void; disabled?: boolean;
}) {
  const f = value.fileNames;
  const setFile = <K extends keyof DdlFileNames>(k: K, v: DdlFileNames[K]) =>
    onChange({ ...value, fileNames: { ...value.fileNames, [k]: v } });
  const example = (prefix: string, name: string) => `${prefix ? `${prefix}${f.separator}` : ''}${
    f.nameCase === 'upper' ? name.toUpperCase() : f.nameCase === 'lower' ? name.toLowerCase() : name}.sql`;
  return (
    <>
      <span className="exd-section">File names <span className="exd-section-note">· shared by Databricks and Oracle</span></span>
      <div className="exd-row3">
        <div className="exd-field">
          <span className="exd-sublbl">Tables</span>
          <input className="rd-input exd-input exd-mono" value={f.table} disabled={disabled} onChange={(e) => setFile('table', e.target.value)} placeholder="TABLE" />
        </div>
        <div className="exd-field">
          <span className="exd-sublbl">Modeled views</span>
          <input className="rd-input exd-input exd-mono" value={f.modeledView} disabled={disabled} onChange={(e) => setFile('modeledView', e.target.value)} placeholder="VIEW_NEG" />
        </div>
        <div className="exd-field">
          <span className="exd-sublbl">Generated views</span>
          <input className="rd-input exd-input exd-mono" value={f.generatedView} disabled={disabled} onChange={(e) => setFile('generatedView', e.target.value)} placeholder="VIEW_TEC" />
        </div>
      </div>
      <div className="exd-row3">
        <div className="exd-field">
          <span className="exd-sublbl">Separator</span>
          <input className="rd-input exd-input exd-mono" value={f.separator} disabled={disabled} maxLength={3} onChange={(e) => setFile('separator', e.target.value)} placeholder="-" />
        </div>
        <div className="exd-field">
          <span className="exd-sublbl">Name case</span>
          <Seg label="File name case" disabled={disabled} value={f.nameCase} onPick={(v) => setFile('nameCase', v)}
            options={[['upper', 'UPPER', 'H_VENTA'], ['lower', 'lower', 'h_venta'], ['as-is', 'As-is', 'As in the model']]} />
        </div>
        <div className="exd-field">
          <span className="exd-sublbl">Schema in name</span>
          <Seg label="Schema in file name" disabled={disabled} value={f.schema} onPick={(v) => setFile('schema', v)}
            options={[['when-needed', 'When needed', 'Only when two files would clash'], ['always', 'Always', 'Always <SCHEMA>.<NAME>']]} />
        </div>
      </div>
      <span className="exd-example">
        e.g. {example(f.table, 'h_venta')} · {example(f.modeledView, 'h_venta')} · {example(f.generatedView, 'h_ventadac')}
      </span>
    </>
  );
}

/** Configuración propia de Oracle. */
function OracleFields({ value, onChange, disabled, viewsHint }: {
  value: DdlOutputSettings; onChange: (next: DdlOutputSettings) => void; disabled?: boolean; viewsHint?: string;
}) {
  const o = value.oracle;
  const set = <K extends keyof OracleDdlOptions>(k: K, v: OracleDdlOptions[K]) =>
    onChange({ ...value, oracle: { ...value.oracle, [k]: v } });

  return (
    <>
      <span className="exd-section">Include</span>
      <div className="exd-switches">
        <SwitchRow disabled={disabled} on={o.includeViews} onClick={() => set('includeViews', !o.includeViews)} label="Views" hint={viewsHint ?? 'Modeled views'} />
        <SwitchRow disabled={disabled} on={o.includeKeys} onClick={() => set('includeKeys', !o.includeKeys)} label="Primary & foreign keys" hint="PRIMARY KEY (…) DISABLE NOVALIDATE · FK" />
        <SwitchRow disabled={disabled} on={o.includeNotNull} onClick={() => set('includeNotNull', !o.includeNotNull)} label="NOT NULL" hint="Required columns" />
        <SwitchRow disabled={disabled} on={o.includeComments} onClick={() => set('includeComments', !o.includeComments)} label="Comments" hint="COMMENT ON TABLE / COLUMN" />
      </div>

      <span className="exd-section">Identifier casing</span>
      <Seg label="Identifier casing" disabled={disabled} value={o.identifierCase} options={CASES} onPick={(v) => set('identifierCase', v)} />

      <span className="exd-section">Quote identifiers</span>
      <Seg label="Quote identifiers" disabled={disabled} value={o.quoteIdentifiers} onPick={(v) => set('quoteIdentifiers', v)}
        options={[['when-needed', 'When needed', 'Double quotes only for names with spaces, special characters or Oracle reserved words'],
                  ['always', 'Always', 'Double quotes on every identifier (Oracle then keeps the exact case)']]} />

      <span className="exd-section">Data types</span>
      <Seg label="Data types" disabled={disabled} value={o.typeCase} onPick={(v) => set('typeCase', v)}
        options={[['lower', 'lower', 'varchar(128), number(19,4), date'], ['upper', 'UPPER', 'VARCHAR(128), NUMBER(19,4), DATE']]} />

      {/* Sin esquema por defecto (`CREATE TABLE DE_X`, como Erwin). */}
      <span className="exd-section">Schema</span>
      <Seg label="Schema" disabled={disabled} value={o.schemaMode} onPick={(v) => set('schemaMode', v)}
        options={[['none', 'No schema', 'CREATE TABLE DE_X'], ['model', 'Model schema', 'Each object with its schema in the model'],
                  ['custom', 'Custom', 'The same schema for every object']]} />
      {o.schemaMode === 'custom' && (
        <div className="exd-field">
          <span className="exd-sublbl">Schema for every object (empty = no schema)</span>
          <SchemaSelect className="rd-input exd-input" value={o.defaultSchema} disabled={disabled} onChange={(v) => set('defaultSchema', v)} />
        </div>
      )}

      <FileNamesFields value={value} onChange={onChange} disabled={disabled} />
    </>
  );
}

export default function DdlOutputForm({ value, onChange, disabled, viewsHint, dialect = 'databricks' }: {
  value: DdlOutputSettings;
  onChange: (next: DdlOutputSettings) => void;
  disabled?: boolean;
  /** Pista del switch Views (el modal cuenta las vistas del canvas). */
  viewsHint?: string;
  /** Qué configuración se edita (por defecto, la de Databricks). */
  dialect?: DdlDialect;
}) {
  if (dialect === 'oracle') {
    return <OracleFields value={value} onChange={onChange} disabled={disabled} viewsHint={viewsHint} />;
  }

  const set = <K extends keyof DdlOutputSettings>(k: K, v: DdlOutputSettings[K]) => onChange({ ...value, [k]: v });
  const props = value.tblProperties;

  return (
    <>
      <span className="exd-section">Include</span>
      <div className="exd-switches">
        <SwitchRow disabled={disabled} on={value.includeViews} onClick={() => set('includeViews', !value.includeViews)} label="Views" hint={viewsHint ?? 'Modeled views'} />
        <SwitchRow disabled={disabled} on={value.includeKeys} onClick={() => set('includeKeys', !value.includeKeys)} label="Primary & foreign keys" hint="PK / FK / NOT NULL" />
        <SwitchRow disabled={disabled} on={value.includeComments} onClick={() => set('includeComments', !value.includeComments)} label="Comments" hint="Functional definitions" />
        <SwitchRow disabled={disabled} on={value.includePartitions} onClick={() => set('includePartitions', !value.includePartitions)} label="Partitions" hint="PARTITIONED BY" />
        <SwitchRow disabled={disabled} on={value.includeIndexes} onClick={() => set('includeIndexes', !value.includeIndexes)} label="Indexes" hint="Hint ZORDER" />
      </div>

      <span className="exd-section">Identifier casing</span>
      <Seg label="Identifier casing" disabled={disabled} value={value.identifierCase} options={CASES} onPick={(v) => set('identifierCase', v)} />

      <span className="exd-section">Quote identifiers</span>
      <Seg label="Quote identifiers" disabled={disabled} value={value.quoteIdentifiers} onPick={(v) => set('quoteIdentifiers', v)}
        options={[['when-needed', 'When needed', 'Backticks only for names with spaces, special characters or reserved words'],
                  ['always', 'Always', 'Backticks on every identifier']]} />

      <span className="exd-section">Data types</span>
      <Seg label="Data types" disabled={disabled} value={value.typeCase} onPick={(v) => set('typeCase', v)}
        options={[['lower', 'lower', 'varchar(128), string, decimal(21,4)'], ['upper', 'UPPER', 'VARCHAR(128), STRING, DECIMAL(21,4)']]} />

      <span className="exd-section">CREATE TABLE</span>
      <Seg label="CREATE TABLE" disabled={disabled} value={value.createTable} onPick={(v) => set('createTable', v)}
        options={[['or-replace', 'OR REPLACE', 'CREATE OR REPLACE TABLE … (LOCATION makes it external)'],
                  ['if-not-exists', 'IF NOT EXISTS', 'CREATE [EXTERNAL] TABLE IF NOT EXISTS …']]} />

      <span className="exd-section">Tags on views</span>
      <Seg label="Tags on views" disabled={disabled} value={value.viewTagsAs} onPick={(v) => set('viewTagsAs', v)}
        options={[['table', 'ALTER TABLE', 'ALTER TABLE <view> SET TAGS … (as the reference macro)'],
                  ['view', 'ALTER VIEW', 'ALTER VIEW <view> SET TAGS …']]} />

      <span className="exd-section">Table format · USING</span>
      <div className="exd-chips">
        {FORMATS.map((fmt) => (
          <button key={fmt} type="button" disabled={disabled} className={`exd-chip${value.tableFormat === fmt ? ' is-on' : ''}`}
            onClick={() => set('tableFormat', fmt)} aria-pressed={value.tableFormat === fmt}>{fmtLabel(fmt)}</button>
        ))}
      </div>

      <SwitchRow disabled={disabled} on={value.unityCatalog} onClick={() => set('unityCatalog', !value.unityCatalog)} label="Unity Catalog" hint="catalog.schema.table" />
      <div className="exd-row2">
        <div className="exd-field">
          <span className="exd-sublbl">Catalog</span>
          <input className="rd-input exd-input" value={value.catalog} disabled={disabled || !value.unityCatalog} onChange={(e) => set('catalog', e.target.value)} placeholder="main" />
        </div>
        <div className="exd-field">
          <span className="exd-sublbl">Default schema</span>
          <SchemaSelect className="rd-input exd-input" value={value.defaultSchema} disabled={disabled} onChange={(v) => set('defaultSchema', v)} />
        </div>
      </div>

      <SwitchRow disabled={disabled} on={value.external} onClick={() => set('external', !value.external)} label="External table" hint="LOCATION '<path>'" />
      {value.external && (
        <div className="exd-field">
          <span className="exd-sublbl">Location (ADLS / S3)</span>
          <input className="rd-input exd-input" value={value.location} disabled={disabled} onChange={(e) => set('location', e.target.value)} placeholder="abfss://<container_name>@<storage_account_name>.dfs.core.windows.net/<path>" />
          <span className="exd-sublbl">Folder name · LOCATION &apos;&lt;base&gt;/&lt;table&gt;&apos;</span>
          <Seg label="Location folder casing" disabled={disabled} value={value.locationFolderCase ?? 'upper'} options={CASES} onPick={(v) => set('locationFolderCase', v)} />
        </div>
      )}

      <div className="exd-tblprops-head">
        <span className="exd-section">TBLPROPERTIES</span>
        {!disabled && <button type="button" className="exd-add" onClick={() => set('tblProperties', [...props, { key: '', value: '' }])}><Plus size={13} strokeWidth={2} />Add</button>}
      </div>
      {props.length === 0
        ? <span className="exd-empty">No properties.</span>
        : props.map((p, i) => (
          <div key={i} className="exd-prop">
            <input className="rd-input exd-input exd-mono" value={p.key} disabled={disabled} placeholder="delta.appendOnly"
              onChange={(e) => set('tblProperties', props.map((q, j) => (j === i ? { ...q, key: e.target.value } : q)))} />
            <input className="rd-input exd-input exd-mono" value={p.value} disabled={disabled} placeholder="true"
              onChange={(e) => set('tblProperties', props.map((q, j) => (j === i ? { ...q, value: e.target.value } : q)))} />
            {!disabled && <button type="button" className="exd-iconbtn" aria-label="Remove" onClick={() => set('tblProperties', props.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
          </div>
        ))}

      <FileNamesFields value={value} onChange={onChange} disabled={disabled} />
    </>
  );
}
