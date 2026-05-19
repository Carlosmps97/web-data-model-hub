'use client';

/**
 * Modal de import por Excel.
 *
 * El parseo y normalización de tipos vive en el backend
 * (`POST /api/excel-import/preview`). Este componente solo:
 * - sube el archivo al backend,
 * - muestra el preview ya normalizado (esquema, descripción, tipos canónicos),
 * - permite al usuario corregir antes de confirmar,
 * - convierte el preview confirmado en `TableModel[]` y lo entrega al callback.
 */

import React, { useMemo, useRef, useState } from 'react';
import { COLUMN_DATA_TYPES, type TableModel } from '@/types/model';
import { ApiError } from '@/services/http';
import {
  previewExcelImport,
  type ExcelPreview,
  type PreviewColumn,
  type PreviewTable,
  type TypeMatchKind,
} from '@/features/excel-import/services/excelImport.service';
import { previewToTables } from '@/features/excel-import/utils/previewToTables';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (tables: TableModel[]) => void;
}

type TableField = 'name' | 'schema' | 'description';

const MATCH_LABEL: Record<TypeMatchKind, { label: string; tone: 'ok' | 'warn' | 'info' }> = {
  exact: { label: 'exact', tone: 'ok' },
  alias: { label: 'alias', tone: 'ok' },
  fuzzy: { label: 'fuzzy', tone: 'warn' },
  unknown: { label: 'unknown', tone: 'warn' },
  empty: { label: 'empty', tone: 'info' },
};

const ExcelImportModal: React.FC<ExcelImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const [preview, setPreview] = useState<ExcelPreview | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The dropdown is the union of the canonical set and any datatype we
  // actually got back from the backend — that way even unknown/fuzzy
  // tokens like a misspelled `decximam` show up as a valid option that
  // the user can keep or replace.
  // Hook order must stay stable across renders, so this lives *before*
  // the `!isOpen` early return.
  const typeOptions = useMemo(() => {
    const fromPreview = preview?.tables.flatMap((t) => t.columns.map((c) => c.dataType)) ?? [];
    return Array.from(new Set([...COLUMN_DATA_TYPES, ...fromPreview]));
  }, [preview]);

  if (!isOpen) return null;

  const processFile = async (file: File) => {
    setFileName(file.name);
    setIsUploading(true);
    setErrorMessage(null);
    try {
      const result = await previewExcelImport(file);
      setPreview(result);
      setActiveTab(0);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to parse Excel file.';
      setErrorMessage(msg);
      setPreview(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && /\.xlsx?$/i.test(file.name)) {
      void processFile(file);
    } else {
      setErrorMessage('Please upload a valid Excel file (.xlsx).');
    }
  };

  const updateTableField = (tableIdx: number, field: TableField, value: string) => {
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tables: prev.tables.map((t, i) => {
          if (i !== tableIdx) return t;
          if (field === 'schema') return { ...t, schema: value.trim() || null };
          if (field === 'description') return { ...t, description: value || null };
          return { ...t, name: value };
        }),
      };
    });
  };

  const updateColumn = (
    tableIdx: number,
    colIdx: number,
    patch: Partial<PreviewColumn>,
  ) => {
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tables: prev.tables.map((t, i) => {
          if (i !== tableIdx) return t;
          return {
            ...t,
            columns: t.columns.map((c, j) => (j === colIdx ? { ...c, ...patch } : c)),
          };
        }),
      };
    });
  };

  const handleConfirm = () => {
    if (!preview) return;
    onImport(previewToTables(preview.tables));
    handleReset();
  };

  const handleReset = () => {
    setPreview(null);
    setErrorMessage(null);
    setFileName('');
    setActiveTab(0);
    onClose();
  };

  const handleChangeFile = () => {
    setPreview(null);
    setFileName('');
    setErrorMessage(null);
  };

  const tables = preview?.tables ?? [];
  const activeTable: PreviewTable | undefined = tables[activeTab];

  return (
    <div className="modal-backdrop" onClick={handleReset}>
      <div
        className="modal-content modal-large animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Import from Excel</h3>
          <button className="btn btn-ghost btn-icon" onClick={handleReset} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '65vh', overflow: 'auto' }}>
          {!preview ? (
            <UploadZone
              isDragging={isDragging}
              isUploading={isUploading}
              errorMessage={errorMessage}
              fileInputRef={fileInputRef}
              onFileInput={handleFileInput}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            />
          ) : (
            <>
              <FileInfoBar
                fileName={fileName}
                tableCount={tables.length}
                descriptionsFound={preview.tableDescriptionsFound}
                onChangeFile={handleChangeFile}
              />

              {/* Tab navigation */}
              <div className="tab-list" style={{ marginBottom: 'var(--space-4)' }}>
                {tables.map((t, idx) => (
                  <button
                    key={`${t.sheetName}-${idx}`}
                    className={`tab-item ${activeTab === idx ? 'active' : ''}`}
                    onClick={() => setActiveTab(idx)}
                  >
                    {t.schema ? `${t.schema}.${t.name}` : t.name}
                  </button>
                ))}
              </div>

              {activeTable && (
                <TablePreview
                  table={activeTable}
                  typeOptions={typeOptions}
                  onTableFieldChange={(field, value) => updateTableField(activeTab, field, value)}
                  onColumnChange={(colIdx, patch) => updateColumn(activeTab, colIdx, patch)}
                />
              )}

              {preview.warnings.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  {preview.warnings.map((w, i) => (
                    <p key={i} style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {preview && tables.length > 0 && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={handleReset}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleConfirm}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Import {tables.length} Table{tables.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExcelImportModal;

// ─── Subcomponentes ────────────────────────────────────────────────

interface UploadZoneProps {
  isDragging: boolean;
  isUploading: boolean;
  errorMessage: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

const UploadZone: React.FC<UploadZoneProps> = ({
  isDragging,
  isUploading,
  errorMessage,
  fileInputRef,
  onFileInput,
  onDragOver,
  onDragLeave,
  onDrop,
}) => (
  <>
    <div
      className={`excel-dropzone ${isDragging ? 'dragging' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm" onChange={onFileInput} hidden />
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="12" y2="12" />
          <line x1="15" y1="15" x2="12" y2="12" />
        </svg>
      </div>
      <h4 style={{ marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
        {isUploading ? 'Parsing workbook…' : 'Drop your Excel file here'}
      </h4>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
        {isUploading ? 'Hang tight while the server normalises types…' : 'or click to browse. Supports .xlsx files.'}
      </p>
      <div
        style={{
          marginTop: 'var(--space-4)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.8,
        }}
      >
        <strong>Expected format</strong>
        <br />
        Each sheet = one table. Name your sheet <code>schema.table_name</code> (or just <code>table_name</code>).
        <br />
        Row 1 is the header. From row 2: <code>A</code> column name · <code>B</code> data type · <code>C</code> functional definition.
        <br />
        Optional sheet <code>TablesDescriptions</code> with columns <code>TableName</code>, <code>TableDescription</code>.
      </div>
    </div>

    {errorMessage && (
      <p style={{ marginTop: 'var(--space-4)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>
        {errorMessage}
      </p>
    )}
  </>
);

interface FileInfoBarProps {
  fileName: string;
  tableCount: number;
  descriptionsFound: boolean;
  onChangeFile: () => void;
}

const FileInfoBar: React.FC<FileInfoBarProps> = ({ fileName, tableCount, descriptionsFound, onChangeFile }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
    <div className="chat-attachment-icon">XLS</div>
    <div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{fileName}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
        {tableCount} table{tableCount !== 1 ? 's' : ''} detected
        {descriptionsFound ? ' · TablesDescriptions applied' : ''}
      </div>
    </div>
    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onChangeFile}>
      Change file
    </button>
  </div>
);

interface TablePreviewProps {
  table: PreviewTable;
  typeOptions: string[];
  onTableFieldChange: (field: TableField, value: string) => void;
  onColumnChange: (colIdx: number, patch: Partial<PreviewColumn>) => void;
}

const TablePreview: React.FC<TablePreviewProps> = ({
  table,
  typeOptions,
  onTableFieldChange,
  onColumnChange,
}) => (
  <div>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 'var(--space-2) var(--space-3)',
        marginBottom: 'var(--space-4)',
        alignItems: 'center',
      }}
    >
      <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Schema</label>
      <input
        className="input"
        style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
        value={table.schema ?? ''}
        placeholder="(no schema)"
        onChange={(e) => onTableFieldChange('schema', e.target.value)}
      />

      <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Table name</label>
      <input
        className="input"
        style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
        value={table.name}
        onChange={(e) => onTableFieldChange('name', e.target.value)}
      />

      <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Description</label>
      <input
        className="input"
        style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
        value={table.description ?? ''}
        placeholder="(from TablesDescriptions, if provided)"
        onChange={(e) => onTableFieldChange('description', e.target.value)}
      />
    </div>

    <table className="data-table">
      <thead>
        <tr>
          <th style={{ width: '30px' }}>#</th>
          <th>Column Name</th>
          <th>Data Type</th>
          <th style={{ width: '70px' }}>Length</th>
          <th style={{ width: '70px' }}>Scale</th>
          <th>Functional Definition</th>
        </tr>
      </thead>
      <tbody>
        {table.columns.map((col, idx) => (
          <ColumnRow
            key={idx}
            index={idx}
            column={col}
            typeOptions={typeOptions}
            onChange={(patch) => onColumnChange(idx, patch)}
          />
        ))}
      </tbody>
    </table>
  </div>
);

interface ColumnRowProps {
  index: number;
  column: PreviewColumn;
  typeOptions: string[];
  onChange: (patch: Partial<PreviewColumn>) => void;
}

const ColumnRow: React.FC<ColumnRowProps> = ({ index, column, typeOptions, onChange }) => {
  const match = MATCH_LABEL[column.typeMatchedVia];
  const showRaw =
    column.rawDataType &&
    column.rawDataType.trim().toLowerCase() !== column.dataType.trim().toLowerCase();

  return (
    <tr>
      <td style={{ color: 'var(--color-text-muted)' }}>{index + 1}</td>
      <td>
        <input
          className="input"
          style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
          value={column.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <select
            className="input"
            style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
            value={column.dataType}
            onChange={(e) => onChange({ dataType: e.target.value })}
          >
            {typeOptions.map((dt) => (
              <option key={dt} value={dt}>
                {dt}
              </option>
            ))}
          </select>
          {(showRaw || column.typeMatchedVia !== 'exact') && (
            <span
              title={showRaw ? `From: "${column.rawDataType}"` : undefined}
              style={{
                fontSize: '10px',
                color:
                  match.tone === 'warn'
                    ? 'var(--color-warning)'
                    : match.tone === 'info'
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-muted)',
              }}
            >
              {match.label}
              {showRaw ? ` · "${column.rawDataType}"` : ''}
              {column.typeMatchedVia === 'fuzzy'
                ? ` · ${Math.round(column.typeConfidence)}%`
                : ''}
            </span>
          )}
        </div>
      </td>
      <td>
        <input
          type="number"
          className="input"
          style={{ padding: '2px 6px', fontSize: 'var(--text-xs)', width: '100%' }}
          value={column.length ?? ''}
          onChange={(e) => onChange({ length: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </td>
      <td>
        <input
          type="number"
          className="input"
          style={{ padding: '2px 6px', fontSize: 'var(--text-xs)', width: '100%' }}
          value={column.scale ?? ''}
          onChange={(e) => onChange({ scale: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </td>
      <td>
        <input
          className="input"
          style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
          value={column.functionalDefinition ?? ''}
          onChange={(e) => onChange({ functionalDefinition: e.target.value || null })}
          placeholder="Optional..."
        />
      </td>
    </tr>
  );
};
