'use client';

import React, { useState, useRef } from 'react';
import { parseExcelFile, sheetsToTables } from '@/features/excel-import/utils/excelParser';
import type { ParsedSheet } from '@/features/excel-import/utils/excelParser';
import type { TableModel } from '@/types/model';
import { COLUMN_DATA_TYPES } from '@/types/model';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (tables: TableModel[]) => void;
}

const ExcelImportModal: React.FC<ExcelImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const processFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result as ArrayBuffer;
      const result = parseExcelFile(data);
      setSheets(result.sheets);
      setErrors(result.errors);
      setActiveTab(0);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      processFile(file);
    } else {
      setErrors(['Please upload a valid Excel file (.xlsx)']);
    }
  };

  const updateSheetColumn = (sheetIdx: number, colIdx: number, field: string, value: string) => {
    setSheets((prev) => prev.map((sheet, i) => {
      if (i !== sheetIdx) return sheet;
      return {
        ...sheet,
        columns: sheet.columns.map((col, j) => {
          if (j !== colIdx) return col;
          return { ...col, [field]: value };
        }),
      };
    }));
  };

  const handleConfirm = () => {
    const tables = sheetsToTables(sheets);
    onImport(tables);
    handleReset();
  };

  const handleReset = () => {
    setSheets([]);
    setErrors([]);
    setFileName('');
    setActiveTab(0);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleReset}>
      <div className="modal-content modal-large animate-scaleIn" onClick={(e) => e.stopPropagation()}>
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
          {sheets.length === 0 ? (
            <>
              {/* Upload Zone */}
              <div
                className={`excel-dropzone ${isDragging ? 'dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileInput} hidden />
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
                  Drop your Excel file here
                </h4>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  or click to browse. Supports .xlsx files.
                </p>
                <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 1.8 }}>
                  <strong>Expected format per sheet:</strong><br />
                  Column A = Column Names | Column B = Data Types | Column C = Definitions<br />
                  Each sheet/tab name becomes a table name.
                </div>
              </div>

              {errors.length > 0 && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  {errors.map((err, i) => (
                    <p key={i} style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>{err}</p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* File info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <div className="chat-attachment-icon">XLS</div>
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{fileName}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {sheets.length} table{sheets.length !== 1 ? 's' : ''} detected
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setSheets([]); setFileName(''); }}>
                  Change file
                </button>
              </div>

              {/* Tab navigation */}
              <div className="tab-list" style={{ marginBottom: 'var(--space-4)' }}>
                {sheets.map((sheet, idx) => (
                  <button
                    key={idx}
                    className={`tab-item ${activeTab === idx ? 'active' : ''}`}
                    onClick={() => setActiveTab(idx)}
                  >
                    {sheet.sheetName}
                  </button>
                ))}
              </div>

              {/* Sheet preview */}
              {sheets[activeTab] && (
                <div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '30px' }}>#</th>
                        <th>Column Name</th>
                        <th>Data Type</th>
                        <th>Functional Definition</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheets[activeTab].columns.map((col, idx) => (
                        <tr key={idx}>
                          <td style={{ color: 'var(--color-text-muted)' }}>{idx + 1}</td>
                          <td>
                            <input
                              className="input"
                              style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
                              value={col.name}
                              onChange={(e) => updateSheetColumn(activeTab, idx, 'name', e.target.value)}
                            />
                          </td>
                          <td>
                            <select
                              className="input"
                              style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
                              value={COLUMN_DATA_TYPES.includes(col.dataType as typeof COLUMN_DATA_TYPES[number]) ? col.dataType : 'varchar'}
                              onChange={(e) => updateSheetColumn(activeTab, idx, 'dataType', e.target.value)}
                            >
                              {COLUMN_DATA_TYPES.map((dt) => (
                                <option key={dt} value={dt}>{dt}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="input"
                              style={{ padding: '2px 6px', fontSize: 'var(--text-xs)' }}
                              value={col.functionalDefinition || ''}
                              onChange={(e) => updateSheetColumn(activeTab, idx, 'functionalDefinition', e.target.value)}
                              placeholder="Optional..."
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {errors.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  {errors.map((err, i) => (
                    <p key={i} style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>{err}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {sheets.length > 0 && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={handleReset}>Cancel</button>
            <button className="btn btn-primary" onClick={handleConfirm}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Import {sheets.length} Table{sheets.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExcelImportModal;
