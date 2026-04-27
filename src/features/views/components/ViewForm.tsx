'use client';

import React, { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { TableModel, ViewModel, ViewColumnTransform, ViewType } from '@/types/model';

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_TYPE_OPTIONS: { value: ViewType; label: string; desc: string }[] = [
  { value: 'technical', label: 'Técnica',   desc: 'Uso interno / ETL / auditoría' },
  { value: 'user',      label: 'De usuario', desc: 'Nombres limpios para usuarios finales' },
  { value: 'business',  label: 'De negocio', desc: 'KPIs y transformaciones para analistas' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface ViewFormProps {
  /** Existing view to edit. Null = create new. */
  view?: ViewModel | null;
  /** All physical tables available as source. */
  tables: TableModel[];
  onSave: (view: ViewModel) => void;
  onCancel: () => void;
  onDelete?: (id: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ViewForm({ view, tables, onSave, onCancel, onDelete }: ViewFormProps) {
  // ── Basic fields ──────────────────────────────────────────────────────
  const [name, setName]               = useState(view?.name ?? '');
  const [logicalName, setLogicalName] = useState(view?.logicalName ?? '');
  const [schema, setSchema]           = useState(view?.schema ?? '');
  const [viewType, setViewType]       = useState<ViewType>(view?.viewType ?? 'technical');
  const [funcDef, setFuncDef]         = useState(view?.functionalDefinition ?? '');
  const [sourceTableId, setSourceTableId] = useState(view?.sourceTableId ?? '');

  // ── Column configuration ──────────────────────────────────────────────
  const [columns, setColumns] = useState<ViewColumnTransform[]>(view?.columns ?? []);

  // ── Filters & SQL ─────────────────────────────────────────────────────
  const [whereClause, setWhereClause]   = useState(view?.whereClause ?? '');
  const [useCustomSql, setUseCustomSql] = useState(view?.useCustomSql ?? false);
  const [customSql, setCustomSql]       = useState(view?.customSql ?? '');

  // ── UI state ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'info' | 'columns' | 'filters'>('info');
  const [error, setError] = useState('');

  // Build initial columns from source table when source changes
  const sourceTable = tables.find((t) => t.id === sourceTableId) ?? null;

  useEffect(() => {
    if (!sourceTableId || view) return; // only auto-init for new views
    const table = tables.find((t) => t.id === sourceTableId);
    if (!table) return;
    setColumns(table.columns.map((c) => ({
      sourceColumn: c.name,
      alias: undefined,
      expression: undefined,
      include: true,
    })));
    if (!schema && table.schema) setSchema(table.schema);
  }, [sourceTableId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Column helpers ────────────────────────────────────────────────────

  const toggleInclude = (idx: number) =>
    setColumns((prev) => prev.map((c, i) => i === idx ? { ...c, include: !c.include } : c));

  const updateCol = (idx: number, patch: Partial<ViewColumnTransform>) =>
    setColumns((prev) => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));

  const includeAll  = () => setColumns((prev) => prev.map((c) => ({ ...c, include: true })));
  const excludeAll  = () => setColumns((prev) => prev.map((c) => ({ ...c, include: false })));

  // ── Submit ────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (!name.trim())          { setError('El nombre de la vista es requerido.'); setTab('info'); return; }
    if (!sourceTableId)        { setError('Debés seleccionar una tabla origen.'); setTab('info'); return; }
    if (!useCustomSql && !columns.some((c) => c.include)) {
      setError('Al menos una columna debe estar incluida.'); setTab('columns'); return;
    }
    if (useCustomSql && !customSql.trim()) {
      setError('El query SQL personalizado es requerido.'); setTab('filters'); return;
    }

    const result: ViewModel = {
      id: view?.id ?? uuidv4(),
      name: name.trim(),
      logicalName: logicalName.trim() || undefined,
      schema: schema.trim() || undefined,
      sourceTableId,
      viewType,
      columns: useCustomSql ? [] : columns,
      whereClause: (!useCustomSql && whereClause.trim()) ? whereClause.trim() : undefined,
      useCustomSql,
      customSql: useCustomSql ? customSql.trim() : undefined,
      functionalDefinition: funcDef.trim() || undefined,
      color: view?.color,
    };

    onSave(result);
  };

  const includedCount = columns.filter((c) => c.include).length;
  const exprCount     = columns.filter((c) => c.include && c.expression).length;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleSave(); }}
      style={{ display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}
    >
      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="tf-tabs" role="tablist">
        {(['info', 'columns', 'filters'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tf-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'info' && 'General'}
            {t === 'columns' && <>Columnas <span className="tf-tab-count">{includedCount}</span>{exprCount > 0 && <span className="tf-tab-count" style={{ background: 'rgba(79,70,229,0.12)', color: 'var(--color-indigo-primary)' }}>fx {exprCount}</span>}</>}
            {t === 'filters' && <>Filtros{(whereClause || useCustomSql) ? ' ●' : ''}</>}
          </button>
        ))}
      </div>

      <div className="modal-body" style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div className="tf-error" role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {/* ── INFO TAB ──────────────────────────────────────────────── */}
        {tab === 'info' && (
          <>
            {/* Source table */}
            <div className="form-group">
              <label className="input-label">Tabla física origen <span className="tf-required">*</span></label>
              <select
                className="input"
                value={sourceTableId}
                onChange={(e) => { setSourceTableId(e.target.value); setError(''); }}
                autoFocus
              >
                <option value="">— Seleccioná la tabla base —</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.schema ? `${t.schema}.` : ''}{t.name}
                    {t.logicalName ? ` (${t.logicalName})` : ''}
                  </option>
                ))}
              </select>
              <small className="tf-help">La vista se derivará de esta tabla. Podés cambiar nombres de columnas, aplicar expresiones y filtros.</small>
            </div>

            {/* View type */}
            <div className="form-group">
              <label className="input-label">Tipo de vista</label>
              <div className="vf-type-grid">
                {VIEW_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`vf-type-btn ${viewType === opt.value ? 'active' : ''}`}
                    onClick={() => setViewType(opt.value)}
                  >
                    <span className="vf-type-label">{opt.label}</span>
                    <span className="vf-type-desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Names */}
            <div className="form-row">
              <div className="form-group" style={{ flex: '0 0 35%' }}>
                <label className="input-label">Schema</label>
                <input className="input" placeholder="e.g. bcp_ddv_crm" value={schema} onChange={(e) => setSchema(e.target.value)} spellCheck={false} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="input-label">Nombre de vista (físico) <span className="tf-required">*</span></label>
                <input className="input" placeholder="e.g. VW_CLIENTE_ACTIVO" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} spellCheck={false} />
              </div>
            </div>

            <div className="form-group">
              <label className="input-label">Nombre lógico / de negocio</label>
              <input className="input" placeholder="e.g. Clientes Activos" value={logicalName} onChange={(e) => setLogicalName(e.target.value)} />
              <small className="tf-help">Mostrado en el canvas como etiqueta del nodo.</small>
            </div>

            <div className="form-group">
              <label className="input-label">Definición funcional</label>
              <textarea className="input" placeholder="Describí el propósito de esta vista…" value={funcDef} onChange={(e) => setFuncDef(e.target.value)} rows={3} />
            </div>
          </>
        )}

        {/* ── COLUMNS TAB ───────────────────────────────────────────── */}
        {tab === 'columns' && (
          <>
            {!sourceTable ? (
              <div className="dm-editor-empty">
                <p>Seleccioná una tabla origen en la pestaña General primero.</p>
              </div>
            ) : useCustomSql ? (
              <div className="vf-custom-note">
                En modo query personalizado, las columnas se definen directamente en el SQL. Desactivá "Query personalizado" en la pestaña Filtros para configurarlas acá.
              </div>
            ) : (
              <>
                <div className="vf-col-toolbar">
                  <span className="vf-col-hint">
                    {includedCount} de {columns.length} columnas incluidas
                    {exprCount > 0 && ` · ${exprCount} con expresiones SQL`}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={includeAll}>Todas</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={excludeAll}>Ninguna</button>
                </div>

                <div className="vf-col-list">
                  {columns.map((col, idx) => {
                    const srcCol = sourceTable.columns.find((c) => c.name === col.sourceColumn);
                    return (
                      <div key={idx} className={`vf-col-row ${!col.include ? 'excluded' : ''}`}>
                        {/* Include toggle */}
                        <input
                          type="checkbox"
                          checked={col.include}
                          onChange={() => toggleInclude(idx)}
                          className="vf-col-check"
                          title={col.include ? 'Excluir columna' : 'Incluir columna'}
                        />

                        {/* Source column info */}
                        <div className="vf-col-source-info">
                          <span className="vf-col-src-name">{col.sourceColumn}</span>
                          {srcCol && <span className="vf-col-src-type">{srcCol.dataType}</span>}
                        </div>

                        {col.include && (
                          <>
                            {/* Arrow */}
                            <span className="vf-col-arrow">→</span>

                            {/* Alias */}
                            <div className="vf-col-field">
                              <span className="vf-col-field-label">Alias</span>
                              <input
                                className="tf-field-input"
                                placeholder="mismo nombre"
                                value={col.alias ?? ''}
                                onChange={(e) => updateCol(idx, { alias: e.target.value || undefined })}
                                spellCheck={false}
                              />
                            </div>

                            {/* Expression */}
                            <div className="vf-col-field vf-col-field--expr">
                              <span className="vf-col-field-label">
                                <span className="vf-fx-badge">fx</span> Expresión SQL
                              </span>
                              <input
                                className="tf-field-input vf-expr-input"
                                placeholder={`e.g. CAST(${col.sourceColumn} AS VARCHAR(50))`}
                                value={col.expression ?? ''}
                                onChange={(e) => updateCol(idx, { expression: e.target.value || undefined })}
                                spellCheck={false}
                                title="Expresión SQL aplicada a esta columna (CAST, CASE WHEN, COALESCE, etc.)"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ── FILTERS TAB ───────────────────────────────────────────── */}
        {tab === 'filters' && (
          <>
            {/* Custom SQL toggle */}
            <div className="vf-custom-toggle">
              <label className="vf-toggle-label">
                <input
                  type="checkbox"
                  checked={useCustomSql}
                  onChange={(e) => setUseCustomSql(e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                Query personalizado (SQL completo)
              </label>
              <small className="tf-help">
                Activá cuando necesitás JOINs con otras tablas, subqueries o lógica que va más allá de filtrar y transformar columnas de una sola tabla.
              </small>
            </div>

            {useCustomSql ? (
              <div className="form-group">
                <label className="input-label">SQL de la vista <span className="tf-required">*</span></label>
                <textarea
                  className="input vf-sql-textarea"
                  placeholder={`CREATE OR REPLACE VIEW ${schema || 'schema'}.${name || 'VW_NOMBRE'} AS\nSELECT\n  col1,\n  CAST(col2 AS VARCHAR(50)) AS col2_cast\nFROM tabla_origen\nWHERE condicion = 1`}
                  value={customSql}
                  onChange={(e) => setCustomSql(e.target.value)}
                  rows={14}
                  spellCheck={false}
                />
                <small className="tf-help">Sintaxis del engine configurado en el modelo. El app no valida el SQL.</small>
              </div>
            ) : (
              <div className="form-group">
                <label className="input-label">Cláusula WHERE</label>
                <textarea
                  className="input vf-sql-textarea"
                  placeholder={`e.g. flg_eliminado = 0 AND estado = 'ACTIVO' AND fec_rutina >= '2023-01-01'`}
                  value={whereClause}
                  onChange={(e) => setWhereClause(e.target.value)}
                  rows={5}
                  spellCheck={false}
                />
                <small className="tf-help">
                  Solo la condición, sin el keyword WHERE. Sintaxis del engine del modelo.
                  <br />
                  Ej: <code>fec_rutina &gt;= CURRENT_DATE - 30</code> · <code>tipo IN ('A','B')</code>
                </small>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {view && onDelete && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (confirm('¿Eliminar esta vista?')) onDelete(view.id);
              }}
            >
              Eliminar
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="btn btn-primary">
            {view ? 'Guardar cambios' : 'Crear vista'}
          </button>
        </div>
      </div>
    </form>
  );
}
