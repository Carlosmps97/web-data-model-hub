'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { TableModel, TableColumn, PartitionSpec, PartitionStrategy, DatabaseEngine, DomainDefinition, Tag } from '@/types/model';
import { COLUMN_DATA_TYPES } from '@/types/model';
import { getEngine } from '@/features/engines/engines';
import { mergeTagLists, tagId } from '@/lib/tags';

interface TableFormProps {
  table?: TableModel | null;
  existingTables: TableModel[];
  /** Engine of the parent model, used to derive defaults and partition options. */
  engine?: DatabaseEngine | null;
  /** Domain catalog from the model — enables catalog-backed domain/subdomain selectors. */
  domainCatalog?: DomainDefinition[];
  onSave: (table: TableModel) => void;
  onCancel: () => void;
}

const emptyColumn = (): TableColumn => ({
  // Every column carries a stable id from birth — freshly added rows
  // get a fresh UUID so relationships drawn on the canvas (which index
  // by `col.id`) survive subsequent renames.
  id: uuidv4(),
  name: '',
  dataType: 'varchar',
  isPrimaryKey: false,
  isForeignKey: false,
  isNullable: true,
});

const emptyPartition = (): PartitionSpec => ({
  strategy: 'NONE',
  columns: [],
  clusteringColumns: [],
});

type SectionKey = 'general' | 'columns' | 'partition' | 'metadata';

const TableForm: React.FC<TableFormProps> = ({ table, existingTables, engine, domainCatalog = [], onSave, onCancel }) => {
  const engineDef = getEngine(engine);
  const defaultSchema = engineDef?.defaultSchema ?? 'public';

  const [schema, setSchema] = useState(table?.schema || defaultSchema);
  const [name, setName] = useState(table?.name || '');
  const [logicalName, setLogicalName] = useState(table?.logicalName || '');
  const [functionalDef, setFunctionalDef] = useState(table?.functionalDefinition || '');
  const [applicationCode, setApplicationCode] = useState(table?.applicationCode || '');
  // Domain: prefer catalog-based IDs, fall back to free text
  const [domainId, setDomainId] = useState(table?.domainId || '');
  const [subdomainId, setSubdomainId] = useState(table?.subdomainId || '');
  const [domain, setDomain] = useState(table?.domain || '');
  const [subdomain, setSubdomain] = useState(table?.subdomain || '');
  const [tags, setTags] = useState<Tag[]>(table?.tags ?? []);
  const [tagKeyDraft, setTagKeyDraft] = useState('');
  const [tagValueDraft, setTagValueDraft] = useState('');
  const [columns, setColumns] = useState<TableColumn[]>(
    table?.columns?.length ? [...table.columns] : [emptyColumn()]
  );
  const [partition, setPartition] = useState<PartitionSpec>(table?.partition ?? emptyPartition());
  const [section, setSection] = useState<SectionKey>('general');
  const [error, setError] = useState('');

  // Recompute schema default if engine changes while modal is open AND user hasn't set one.
  useEffect(() => {
    if (!table?.schema && engineDef?.defaultSchema) {
      setSchema((prev) => prev || engineDef.defaultSchema);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineDef?.defaultSchema]);

  const addTag = () => {
    const k = tagKeyDraft.trim();
    const v = tagValueDraft.trim();
    if (!k && !v) return;
    const next: Tag = { key: k, value: v };
    if (tags.some((t) => t.key === next.key && t.value === next.value)) {
      setTagKeyDraft('');
      setTagValueDraft('');
      return;
    }
    setTags([...tags, next]);
    setTagKeyDraft('');
    setTagValueDraft('');
  };
  const removeTagAt = (idx: number) => setTags(tags.filter((_, i) => i !== idx));

  const addColumn = () => {
    setColumns([...columns, emptyColumn()]);
  };

  const removeColumn = (idx: number) => {
    setColumns(columns.filter((_, i) => i !== idx));
  };

  const updateColumn = (idx: number, updates: Partial<TableColumn>) => {
    setColumns(columns.map((c, i) => (i === idx ? { ...c, ...updates } : c)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSchema = schema.trim();
    if (!cleanSchema) {
      setError('Schema is required (e.g. ' + defaultSchema + ')');
      setSection('general');
      return;
    }
    if (!name.trim()) {
      setError('Table name is required');
      setSection('general');
      return;
    }
    if (columns.length === 0 || !columns.some((c) => c.name.trim())) {
      setError('At least one column is required');
      setSection('columns');
      return;
    }

    const validColumns = columns.filter((c) => c.name.trim());

    // Sanitize partition spec: drop columns that no longer exist.
    const validColNames = new Set(validColumns.map((c) => c.name));
    const sanitizedPartCols = partition.columns.filter((c) => validColNames.has(c));
    const sanitizedClusterCols = (partition.clusteringColumns ?? []).filter((c) => validColNames.has(c));
    const finalPartition: PartitionSpec | undefined =
      partition.strategy === 'NONE' && sanitizedClusterCols.length === 0
        ? undefined
        : {
            strategy: partition.strategy,
            columns: sanitizedPartCols,
            buckets: partition.buckets,
            granularity: partition.granularity,
            clusteringColumns: sanitizedClusterCols.length > 0 ? sanitizedClusterCols : undefined,
          };

    // Resolve domain/subdomain names from catalog if IDs are set
    const resolvedDomain = domainCatalog.find((d) => d.id === domainId);
    const resolvedSub = resolvedDomain?.subdomains.find((s) => s.id === subdomainId);
    const finalDomain = resolvedDomain?.name || domain.trim() || undefined;
    const finalSubdomain = resolvedSub?.name || subdomain.trim() || undefined;

    const result: TableModel = {
      id: table?.id || uuidv4(),
      schema: cleanSchema,
      name: name.trim(),
      logicalName: logicalName.trim() || undefined,
      columns: validColumns,
      functionalDefinition: functionalDef.trim() || undefined,
      color: table?.color,
      applicationCode: applicationCode.trim() || undefined,
      domain: finalDomain,
      subdomain: finalSubdomain,
      domainId: domainId || undefined,
      subdomainId: subdomainId || undefined,
      tags: tags.length > 0 ? tags : undefined,
      partition: finalPartition,
    };

    onSave(result);
  };

  // ────────────────────────────────────────────────────────────────────────
  // Helpers / derived state for the partition section
  // ────────────────────────────────────────────────────────────────────────
  const allowedStrategies: PartitionStrategy[] = engineDef?.partitionStrategies ?? ['NONE'];
  const supportsClustering = engineDef?.supportsClustering ?? false;
  const partitionableColumns = columns.filter((c) => c.name.trim().length > 0);

  const togglePartitionColumn = (colName: string) => {
    setPartition((prev) => {
      const has = prev.columns.includes(colName);
      return { ...prev, columns: has ? prev.columns.filter((c) => c !== colName) : [...prev.columns, colName] };
    });
  };

  const toggleClusteringColumn = (colName: string) => {
    setPartition((prev) => {
      const list = prev.clusteringColumns ?? [];
      const has = list.includes(colName);
      const next = has ? list.filter((c) => c !== colName) : [...list, colName];
      return { ...prev, clusteringColumns: next };
    });
  };

  const fqPreview = useMemo(() => {
    const s = schema.trim() || defaultSchema;
    return `${s}.${name.trim() || 'table_name'}`;
  }, [schema, name, defaultSchema]);

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', maxHeight: '78vh' }}>
      {/* ── Section tabs ─────────────────────────────────────────────── */}
      <div className="tf-tabs" role="tablist" aria-label="Table form sections">
        {(['general', 'columns', 'partition', 'metadata'] as SectionKey[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={`tf-tab ${section === key ? 'active' : ''}`}
            onClick={() => setSection(key)}
          >
            {key === 'general'   && <>General</>}
            {key === 'columns'   && <>Columns <span className="tf-tab-count">{columns.length}</span></>}
            {key === 'partition' && <>Partitioning</>}
            {key === 'metadata'  && <>Metadata</>}
          </button>
        ))}
      </div>

      <div className="modal-body" style={{ flex: 1, overflow: 'auto' }}>
        {error && (
          <div className="tf-error" role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* ───────────── GENERAL SECTION ───────────── */}
        {section === 'general' && (
          <>
            {/* Vista lógica vs física */}
            <div className="tf-view-banner">
              <div className="tf-view-col">
                <span className="tf-view-label tf-view-label--logical">Vista Lógica</span>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Nombre de Entidad</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Cliente, Orden de Compra"
                    value={logicalName}
                    onChange={(e) => setLogicalName(e.target.value)}
                    spellCheck={false}
                  />
                  <small className="tf-help">Nombre de negocio visible en vista lógica del diagrama</small>
                </div>
              </div>
              <div className="tf-view-divider">→</div>
              <div className="tf-view-col">
                <span className="tf-view-label tf-view-label--physical">Vista Física</span>
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <div className="form-group" style={{ flex: '0 0 38%', marginBottom: 0 }}>
                    <label className="input-label">Schema <span className="tf-required">*</span></label>
                    <input
                      className="input"
                      type="text"
                      placeholder={defaultSchema}
                      value={schema}
                      onChange={(e) => { setSchema(e.target.value); setError(''); }}
                      autoFocus
                      spellCheck={false}
                    />
                    <small className="tf-help">{engineDef ? `Default: ${engineDef.defaultSchema}` : 'Requerido'}</small>
                  </div>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="input-label">Nombre de Tabla <span className="tf-required">*</span></label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. HD_CLIENTE"
                      value={name}
                      onChange={(e) => { setName(e.target.value); setError(''); }}
                      spellCheck={false}
                    />
                    <small className="tf-help">→ <code>{fqPreview}</code></small>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="input-label">Definición Funcional</label>
              <textarea
                className="input"
                placeholder="Describí el propósito de esta tabla en términos de negocio…"
                value={functionalDef}
                onChange={(e) => setFunctionalDef(e.target.value)}
                rows={3}
              />
            </div>

            {/* Dominio / Subdominio con herencia del catálogo */}
            <DomainSelector
              domainCatalog={domainCatalog}
              domainId={domainId}
              subdomainId={subdomainId}
              freeDomain={domain}
              freeSubdomain={subdomain}
              onDomainChange={(did, dName) => {
                setDomainId(did);
                setSubdomainId('');
                setDomain(dName);
                setSubdomain('');
                // Hereda schema si el dominio tiene default y el schema es el del engine
                const def = domainCatalog.find((d) => d.id === did);
                if (def?.defaults?.schema && schema === defaultSchema) setSchema(def.defaults.schema);
                if (def?.defaults?.tags) setTags((prev) => mergeTagLists(prev, def.defaults?.tags));
              }}
              onSubdomainChange={(sid, sName) => {
                setSubdomainId(sid);
                setSubdomain(sName);
                const dom = domainCatalog.find((d) => d.id === domainId);
                const sub = dom?.subdomains.find((s) => s.id === sid);
                if (sub?.defaults?.schema) setSchema(sub.defaults.schema);
                if (sub?.defaults?.tags) setTags((prev) => mergeTagLists(prev, sub.defaults?.tags));
              }}
              onFreeDomainChange={setDomain}
              onFreeSubdomainChange={setSubdomain}
            />
          </>
        )}

        {/* ───────────── COLUMNS SECTION ───────────── */}
        {section === 'columns' && (
          <>
            <div className="tf-section-header">
              <div>
                <strong style={{ fontSize: 'var(--text-base)' }}>Columns</strong>
                <div className="tf-help" style={{ marginTop: 2 }}>
                  Click the chips below each name to toggle constraints.
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={addColumn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Column
              </button>
            </div>

            <div className="tf-col-cards">
              {columns.map((col, idx) => {
                const showLength = supportsLength(col.dataType);
                const showScale = supportsScale(col.dataType);
                const fkTable = existingTables.find((t) => t.name === col.foreignKeyRef?.table);
                const isNotNull = col.isNullable === false;
                return (
                  <article key={idx} className="tf-col-card">
                    {/* Card top: index + name + type + delete */}
                    <div className="tf-col-card-top">
                      <span className="tf-col-index" aria-hidden="true">{idx + 1}</span>
                      <input
                        className="tf-col-name"
                        placeholder="column_name"
                        value={col.name}
                        onChange={(e) => updateColumn(idx, { name: e.target.value })}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <select
                        className="tf-col-type"
                        value={col.dataType}
                        onChange={(e) => updateColumn(idx, { dataType: e.target.value })}
                      >
                        {/* If the current value isn't one of the canonical
                            lowercase options (e.g. the LLM/Excel produced
                            `VARCHAR`, `INT`, `NUMBER(10,2)`, `STRING`…),
                            render it as a custom option so the `<select>`
                            shows the real value instead of silently
                            defaulting to the first option (`integer`). */}
                        {col.dataType &&
                          !COLUMN_DATA_TYPES.includes(
                            col.dataType as (typeof COLUMN_DATA_TYPES)[number],
                          ) && (
                            <option key="__custom" value={col.dataType}>
                              {col.dataType}
                            </option>
                          )}
                        {COLUMN_DATA_TYPES.map((dt) => <option key={dt} value={dt}>{dt}</option>)}
                      </select>
                      <button
                        type="button"
                        className="tf-col-delete"
                        onClick={() => removeColumn(idx)}
                        title="Remove column"
                        aria-label="Remove column"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>

                    {/* Constraint chips (semantic colors) */}
                    <div className="tf-chip-row">
                      <KeyChip
                        kind="pk"
                        label="Primary key"
                        active={!!col.isPrimaryKey}
                        onToggle={() => updateColumn(idx, {
                          isPrimaryKey: !col.isPrimaryKey,
                          // PKs are implicitly NOT NULL
                          isNullable: !col.isPrimaryKey ? false : col.isNullable,
                        })}
                      />
                      <KeyChip
                        kind="fk"
                        label="Foreign key"
                        active={!!col.isForeignKey}
                        onToggle={() => updateColumn(idx, { isForeignKey: !col.isForeignKey })}
                      />
                      <KeyChip
                        kind="sk"
                        label="Surrogate key"
                        active={!!col.isSurrogateKey}
                        onToggle={() => updateColumn(idx, { isSurrogateKey: !col.isSurrogateKey })}
                      />
                      <KeyChip
                        kind="uq"
                        label="Unique"
                        active={!!col.isUnique}
                        onToggle={() => updateColumn(idx, { isUnique: !col.isUnique })}
                      />
                      <KeyChip
                        kind="nn"
                        label="Not null"
                        active={isNotNull}
                        onToggle={() => updateColumn(idx, { isNullable: isNotNull ? true : false })}
                      />
                    </div>

                    {/* Inline parameters: length / scale / default / description */}
                    <div className="tf-col-fields">
                      {showLength && (
                        <label className="tf-field">
                          <span className="tf-field-label">Length</span>
                          <input
                            className="tf-field-input"
                            type="number"
                            min={0}
                            placeholder="—"
                            value={col.length ?? ''}
                            onChange={(e) => updateColumn(idx, { length: e.target.value === '' ? undefined : Number(e.target.value) })}
                          />
                        </label>
                      )}
                      {showScale && (
                        <label className="tf-field">
                          <span className="tf-field-label">Scale</span>
                          <input
                            className="tf-field-input"
                            type="number"
                            min={0}
                            placeholder="—"
                            value={col.scale ?? ''}
                            onChange={(e) => updateColumn(idx, { scale: e.target.value === '' ? undefined : Number(e.target.value) })}
                          />
                        </label>
                      )}
                      <label className="tf-field tf-field-grow">
                        <span className="tf-field-label">Nombre lógico</span>
                        <input
                          className="tf-field-input"
                          placeholder="e.g. Código de Cliente"
                          value={col.logicalName ?? ''}
                          onChange={(e) => updateColumn(idx, { logicalName: e.target.value || undefined })}
                        />
                      </label>
                      <label className="tf-field tf-field-grow">
                        <span className="tf-field-label">Default</span>
                        <input
                          className="tf-field-input"
                          placeholder="e.g. 0, 'pending', CURRENT_TIMESTAMP"
                          value={col.defaultValue ?? ''}
                          onChange={(e) => updateColumn(idx, { defaultValue: e.target.value || undefined })}
                        />
                      </label>
                      <label className="tf-field tf-field-grow">
                        <span className="tf-field-label">Definición</span>
                        <input
                          className="tf-field-input"
                          placeholder="Descripción funcional (DDL comment)"
                          value={col.functionalDefinition ?? ''}
                          onChange={(e) => updateColumn(idx, { functionalDefinition: e.target.value || undefined })}
                        />
                      </label>
                    </div>

                    {/* Foreign-key reference row (only when FK is on) */}
                    {col.isForeignKey && (
                      <div className="tf-fk-banner">
                        <span className="tf-fk-banner-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        </span>
                        <span className="tf-fk-banner-text">references</span>
                        <select
                          className="tf-field-input tf-fk-select"
                          value={col.foreignKeyRef?.table ?? ''}
                          onChange={(e) => updateColumn(idx, { foreignKeyRef: { table: e.target.value, column: col.foreignKeyRef?.column ?? '' } })}
                        >
                          <option value="">Select table…</option>
                          {existingTables.filter((t) => t.name !== name).map((t) => (
                            <option key={t.id} value={t.name}>{t.schema ? `${t.schema}.` : ''}{t.name}</option>
                          ))}
                        </select>
                        <span className="tf-fk-banner-dot">.</span>
                        <select
                          className="tf-field-input tf-fk-select"
                          value={col.foreignKeyRef?.column ?? ''}
                          onChange={(e) => updateColumn(idx, { foreignKeyRef: { table: col.foreignKeyRef?.table ?? '', column: e.target.value } })}
                          disabled={!fkTable}
                        >
                          <option value="">Select column…</option>
                          {fkTable?.columns.map((c) => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}

        {/* ───────────── PARTITIONING SECTION ───────────── */}
        {section === 'partition' && (
          <>
            <div className="tf-section-header">
              <div>
                <strong>Partitioning &amp; Clustering</strong>
                <div className="tf-help" style={{ marginTop: 2 }}>
                  {engineDef
                    ? <>Engine: <code>{engineDef.label}</code> — {engineDef.partitionHint}</>
                    : 'Pick an engine on the model to unlock partitioning options.'}
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: '0 0 220px' }}>
                <label className="input-label">Strategy</label>
                <select
                  className="input"
                  value={partition.strategy}
                  onChange={(e) => setPartition({ ...partition, strategy: e.target.value as PartitionStrategy })}
                >
                  {allowedStrategies.map((s) => <option key={s} value={s}>{s === 'NONE' ? 'None (no partitioning)' : s}</option>)}
                </select>
              </div>

              {(partition.strategy === 'HASH' || partition.strategy === 'BUCKET') && (
                <div className="form-group" style={{ flex: '0 0 140px' }}>
                  <label className="input-label">Buckets</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    placeholder="e.g. 16"
                    value={partition.buckets ?? ''}
                    onChange={(e) => setPartition({ ...partition, buckets: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </div>
              )}

              {partition.strategy === 'DATE' && (
                <div className="form-group" style={{ flex: '0 0 160px' }}>
                  <label className="input-label">Granularity</label>
                  <select
                    className="input"
                    value={partition.granularity ?? 'DAY'}
                    onChange={(e) => setPartition({ ...partition, granularity: e.target.value as PartitionSpec['granularity'] })}
                  >
                    <option value="HOUR">HOUR</option>
                    <option value="DAY">DAY</option>
                    <option value="MONTH">MONTH</option>
                    <option value="YEAR">YEAR</option>
                  </select>
                </div>
              )}
            </div>

            {partition.strategy !== 'NONE' && (
              <div className="form-group">
                <label className="input-label">Partition Columns</label>
                {partitionableColumns.length === 0 ? (
                  <div className="tf-empty">Add at least one column first.</div>
                ) : (
                  <div className="tf-chip-grid">
                    {partitionableColumns.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        className={`tf-chip ${partition.columns.includes(c.name) ? 'active' : ''}`}
                        onClick={() => togglePartitionColumn(c.name)}
                      >
                        {c.name}
                        <span className="tf-chip-type">{c.dataType}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {supportsClustering && (
              <div className="form-group">
                <label className="input-label">
                  Clustering / Z-ORDER Columns
                  <span className="tf-help" style={{ marginLeft: 8, fontWeight: 400 }}>
                    Improves query performance on these columns.
                  </span>
                </label>
                {partitionableColumns.length === 0 ? (
                  <div className="tf-empty">Add at least one column first.</div>
                ) : (
                  <div className="tf-chip-grid">
                    {partitionableColumns.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        className={`tf-chip ${(partition.clusteringColumns ?? []).includes(c.name) ? 'active' : ''}`}
                        onClick={() => toggleClusteringColumn(c.name)}
                      >
                        {c.name}
                        <span className="tf-chip-type">{c.dataType}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ───────────── METADATA SECTION ───────────── */}
        {section === 'metadata' && (
          <>
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="input-label">Application Code</label>
                <input className="input" placeholder="e.g. CRM, ERP-01" value={applicationCode} onChange={(e) => setApplicationCode(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="input-label">Domain</label>
                <input className="input" placeholder="e.g. Sales" value={domain} onChange={(e) => setDomain(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="input-label">Subdomain</label>
                <input className="input" placeholder="e.g. Orders" value={subdomain} onChange={(e) => setSubdomain(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="input-label">Tags</label>
              <small className="tf-help" style={{ display: 'block', marginBottom: 6 }}>
                Key-value metadata (e.g. <code>owner: data-platform</code>, <code>pii: high</code>).
              </small>

              {tags.length > 0 && (
                <div className="tag-kv-list">
                  {tags.map((t, idx) => (
                    <span key={`${tagId(t)}-${idx}`} className="tag-chip tag-chip--kv">
                      {t.key && <span className="tag-chip-key">{t.key}</span>}
                      {t.key && t.value && <span className="tag-chip-sep">:</span>}
                      {t.value && <span className="tag-chip-value">{t.value}</span>}
                      <button
                        type="button"
                        className="tag-chip-remove"
                        onClick={() => removeTagAt(idx)}
                        aria-label={`Remove tag ${t.key || ''} ${t.value || ''}`.trim()}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="tag-kv-row">
                <input
                  className="input tag-kv-input tag-kv-input--key"
                  type="text"
                  placeholder="key (e.g. owner)"
                  value={tagKeyDraft}
                  onChange={(e) => setTagKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                  }}
                />
                <span className="tag-kv-sep">=</span>
                <input
                  className="input tag-kv-input tag-kv-input--value"
                  type="text"
                  placeholder="value (e.g. data-platform)"
                  value={tagValueDraft}
                  onChange={(e) => setTagValueDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={addTag}
                  disabled={!tagKeyDraft.trim() && !tagValueDraft.trim()}
                >
                  Add tag
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
        <span className="tf-fq-preview" title="Fully-qualified name">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <code>{fqPreview}</code>
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary">
            {table ? 'Update Table' : 'Create Table'}
          </button>
        </div>
      </div>
    </form>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers for the redesigned Columns section
// ─────────────────────────────────────────────────────────────────────────

type KeyKind = 'pk' | 'fk' | 'sk' | 'uq' | 'nn';

const KEY_CHIP_META: Record<KeyKind, { short: string; tone: string }> = {
  pk: { short: 'PK',       tone: 'tf-chip-pk' },
  fk: { short: 'FK',       tone: 'tf-chip-fk' },
  sk: { short: 'SK',       tone: 'tf-chip-sk' },
  uq: { short: 'UNIQUE',   tone: 'tf-chip-uq' },
  nn: { short: 'NOT NULL', tone: 'tf-chip-nn' },
};

/** Toggleable, semantically-colored constraint chip used in the Columns section. */
function KeyChip({
  kind, label, active, onToggle,
}: { kind: KeyKind; label: string; active: boolean; onToggle: () => void }) {
  const meta = KEY_CHIP_META[kind];
  return (
    <button
      type="button"
      className={`tf-key-chip ${meta.tone} ${active ? 'active' : ''}`}
      onClick={onToggle}
      aria-pressed={active}
      title={label}
    >
      <span className="tf-key-chip-dot" aria-hidden="true" />
      <span className="tf-key-chip-text">{meta.short}</span>
    </button>
  );
}

const LENGTH_TYPES = new Set(['varchar', 'char', 'nvarchar', 'decimal', 'numeric']);
const SCALE_TYPES  = new Set(['decimal', 'numeric']);

function supportsLength(dataType: string): boolean {
  return LENGTH_TYPES.has((dataType || '').toLowerCase());
}
function supportsScale(dataType: string): boolean {
  return SCALE_TYPES.has((dataType || '').toLowerCase());
}

export default TableForm;

// ─────────────────────────────────────────────────────────────────────────
// DomainSelector — selector de dominio/subdominio respaldado por catálogo
// ─────────────────────────────────────────────────────────────────────────

interface DomainSelectorProps {
  domainCatalog: DomainDefinition[];
  domainId: string;
  subdomainId: string;
  freeDomain: string;
  freeSubdomain: string;
  onDomainChange: (id: string, name: string) => void;
  onSubdomainChange: (id: string, name: string) => void;
  onFreeDomainChange: (v: string) => void;
  onFreeSubdomainChange: (v: string) => void;
}

function DomainSelector({
  domainCatalog, domainId, subdomainId, freeDomain, freeSubdomain,
  onDomainChange, onSubdomainChange, onFreeDomainChange, onFreeSubdomainChange,
}: DomainSelectorProps) {
  const hasCatalog = domainCatalog.length > 0;
  const selectedDomain = domainCatalog.find((d) => d.id === domainId);

  return (
    <div className="tf-domain-row">
      <div className="form-group" style={{ flex: 1 }}>
        <label className="input-label">
          Dominio
          {hasCatalog && selectedDomain && (
            <span className="tf-domain-badge" style={{ background: selectedDomain.color ?? '#cbd5e1' }}>
              {selectedDomain.code ?? selectedDomain.name}
            </span>
          )}
        </label>
        {hasCatalog ? (
          <select
            className="input"
            value={domainId}
            onChange={(e) => {
              const d = domainCatalog.find((x) => x.id === e.target.value);
              onDomainChange(e.target.value, d?.name ?? '');
            }}
          >
            <option value="">— Sin dominio —</option>
            {domainCatalog.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>
            ))}
          </select>
        ) : (
          <input className="input" placeholder="e.g. Campañas CRM" value={freeDomain} onChange={(e) => onFreeDomainChange(e.target.value)} />
        )}
      </div>

      <div className="form-group" style={{ flex: 1 }}>
        <label className="input-label">Subdominio</label>
        {hasCatalog && selectedDomain ? (
          <select
            className="input"
            value={subdomainId}
            onChange={(e) => {
              const s = selectedDomain.subdomains.find((x) => x.id === e.target.value);
              onSubdomainChange(e.target.value, s?.name ?? '');
            }}
            disabled={!selectedDomain}
          >
            <option value="">— Sin subdominio —</option>
            {selectedDomain.subdomains.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>
            ))}
          </select>
        ) : (
          <input className="input" placeholder="e.g. Ofertas" value={freeSubdomain} onChange={(e) => onFreeSubdomainChange(e.target.value)} />
        )}
      </div>

      {hasCatalog && (selectedDomain?.defaults?.schema || selectedDomain?.subdomains.find(s => s.id === subdomainId)?.defaults?.schema) && (
        <div className="tf-domain-hint">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Defaults aplicados automáticamente al seleccionar
        </div>
      )}
    </div>
  );
}
