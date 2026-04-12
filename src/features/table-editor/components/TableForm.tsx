'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { TableModel, TableColumn } from '@/types/model';
import { COLUMN_DATA_TYPES } from '@/types/model';

interface TableFormProps {
  table?: TableModel | null;
  existingTables: TableModel[];
  onSave: (table: TableModel) => void;
  onCancel: () => void;
}

const emptyColumn = (): TableColumn => ({
  name: '',
  dataType: 'varchar',
  isPrimaryKey: false,
  isForeignKey: false,
  isNullable: true,
});

const TableForm: React.FC<TableFormProps> = ({ table, existingTables, onSave, onCancel }) => {
  const [name, setName] = useState(table?.name || '');
  const [functionalDef, setFunctionalDef] = useState(table?.functionalDefinition || '');
  const [columns, setColumns] = useState<TableColumn[]>(
    table?.columns?.length ? [...table.columns] : [emptyColumn()]
  );
  const [error, setError] = useState('');

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
    if (!name.trim()) {
      setError('Table name is required');
      return;
    }
    if (columns.length === 0 || !columns.some((c) => c.name.trim())) {
      setError('At least one column is required');
      return;
    }

    const validColumns = columns.filter((c) => c.name.trim());

    const result: TableModel = {
      id: table?.id || uuidv4(),
      name: name.trim(),
      columns: validColumns,
      functionalDefinition: functionalDef.trim() || undefined,
      position: table?.position || { x: 50 + Math.random() * 200, y: 50 + Math.random() * 200 },
    };

    onSave(result);
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxHeight: '75vh', overflow: 'auto' }}>
      <div className="modal-body">
        {error && (
          <div style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'rgba(224, 108, 117, 0.1)',
            border: '1px solid rgba(224, 108, 117, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-4)',
          }}>
            {error}
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="input-label">Table Name</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. users, orders, products"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              autoFocus
            />
          </div>
        </div>

        <div className="form-group">
          <label className="input-label">Functional Definition (optional)</label>
          <textarea
            className="input"
            placeholder="Describe the purpose of this table..."
            value={functionalDef}
            onChange={(e) => setFunctionalDef(e.target.value)}
            rows={2}
          />
        </div>

        <div className="divider" />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
          <label className="input-label" style={{ marginBottom: 0 }}>Columns</label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addColumn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Column
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 120px 50px 50px 50px 50px 30px',
            gap: 'var(--space-2)',
            padding: '0 var(--space-1)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <span>Name</span>
            <span>Type</span>
            <span title="Primary Key" style={{ textAlign: 'center' }}>PK</span>
            <span title="Foreign Key" style={{ textAlign: 'center' }}>FK</span>
            <span title="Surrogate Key" style={{ textAlign: 'center' }}>SK</span>
            <span title="Nullable" style={{ textAlign: 'center' }}>Null</span>
            <span></span>
          </div>

          {columns.map((col, idx) => (
            <div key={idx} style={{ borderRadius: 'var(--radius-sm)', background: idx % 2 === 0 ? 'transparent' : 'rgba(12, 45, 64, 0.3)' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 120px 50px 50px 50px 50px 30px',
                gap: 'var(--space-2)',
                alignItems: 'center',
                padding: 'var(--space-1)',
              }}>
                <input
                  className="input"
                  style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }}
                  placeholder="column_name"
                  value={col.name}
                  onChange={(e) => updateColumn(idx, { name: e.target.value })}
                />
                <select
                  className="input"
                  style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }}
                  value={col.dataType}
                  onChange={(e) => updateColumn(idx, { dataType: e.target.value })}
                >
                  {COLUMN_DATA_TYPES.map((dt) => (
                    <option key={dt} value={dt}>{dt}</option>
                  ))}
                </select>
                <div style={{ textAlign: 'center' }}>
                  <div
                    className={`toggle ${col.isPrimaryKey ? 'active' : ''}`}
                    style={{ width: '28px', height: '16px', margin: '0 auto' }}
                    onClick={() => updateColumn(idx, { isPrimaryKey: !col.isPrimaryKey })}
                  />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div
                    className={`toggle ${col.isForeignKey ? 'active' : ''}`}
                    style={{ width: '28px', height: '16px', margin: '0 auto' }}
                    onClick={() => updateColumn(idx, { isForeignKey: !col.isForeignKey })}
                  />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div
                    className={`toggle ${col.isSurrogateKey ? 'active' : ''}`}
                    style={{ width: '28px', height: '16px', margin: '0 auto' }}
                    onClick={() => updateColumn(idx, { isSurrogateKey: !col.isSurrogateKey })}
                  />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div
                    className={`toggle ${col.isNullable ? 'active' : ''}`}
                    style={{ width: '28px', height: '16px', margin: '0 auto' }}
                    onClick={() => updateColumn(idx, { isNullable: !col.isNullable })}
                  />
                </div>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeColumn(idx)} style={{ padding: '2px' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div style={{ padding: '0 var(--space-1) var(--space-1)' }}>
                <input
                  className="input"
                  style={{
                    padding: 'var(--space-1) var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    width: '100%',
                    color: 'var(--color-text-secondary)',
                    fontStyle: col.functionalDefinition ? 'normal' : 'italic',
                  }}
                  placeholder="Column description (optional)"
                  value={col.functionalDefinition || ''}
                  onChange={(e) => updateColumn(idx, { functionalDefinition: e.target.value || undefined })}
                />
              </div>
            </div>
          ))}
        </div>

        {/* FK Reference section for any FK columns */}
        {columns.some((c) => c.isForeignKey) && (
          <>
            <div className="divider" />
            <label className="input-label">Foreign Key References</label>
            {columns.filter((c) => c.isForeignKey).map((col, idx) => {
              const colIdx = columns.indexOf(col);
              return (
                <div key={idx} className="form-row" style={{ marginBottom: 'var(--space-2)', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-accent-secondary)', minWidth: '100px' }}>
                    {col.name || 'unnamed'}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>references</span>
                  <select
                    className="input"
                    style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }}
                    value={col.foreignKeyRef?.table || ''}
                    onChange={(e) => updateColumn(colIdx, {
                      foreignKeyRef: { table: e.target.value, column: col.foreignKeyRef?.column || '' }
                    })}
                  >
                    <option value="">Select table</option>
                    {existingTables.filter((t) => t.name !== name).map((t) => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>.</span>
                  <select
                    className="input"
                    style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }}
                    value={col.foreignKeyRef?.column || ''}
                    onChange={(e) => updateColumn(colIdx, {
                      foreignKeyRef: { table: col.foreignKeyRef?.table || '', column: e.target.value }
                    })}
                  >
                    <option value="">Select column</option>
                    {existingTables
                      .find((t) => t.name === col.foreignKeyRef?.table)
                      ?.columns.map((c) => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                  </select>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">
          {table ? 'Update Table' : 'Add Table'}
        </button>
      </div>
    </form>
  );
};

export default TableForm;
