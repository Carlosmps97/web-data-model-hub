'use client';

import React, { useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Table } from '@/types/model';
import { previewExcelImport, type ExcelPreview } from '../services/excelImport.service';
import { previewToTables, type PreviewMeta } from '../utils/previewToTables';

interface ExcelImportModalProps {
  meta?: PreviewMeta;
  onClose: () => void;
  onImport: (tables: Table[]) => void;
  pushToast: (msg: string, type?: 'err') => void;
}

/** Upload an .xlsx → backend preview → review sheets → import as tables. */
export default function ExcelImportModal({ meta, onClose, onImport, pushToast }: ExcelImportModalProps) {
  const [preview, setPreview] = useState<ExcelPreview | null>(null);
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setFilename(file.name);
    try {
      const p = await previewExcelImport(file);
      setPreview(p);
      if (p.warnings.length) pushToast(p.warnings[0], 'err');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo leer el archivo', 'err');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    if (!preview) return;
    onImport(previewToTables(preview.tables, meta));
  };

  return (
    <Modal
      title="Importar desde Excel"
      subtitle="Cada hoja se convierte en una tabla"
      icon="upload"
      onClose={onClose}
      footer={
        <>
          {preview && <button className="rd-btn rd-btn-ghost left" onClick={() => { setPreview(null); setFilename(''); }}>Elegir otro archivo</button>}
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" disabled={!preview || busy} onClick={doImport}>
            <Icon name="check" size={14} sw={2.6} />Importar {preview ? `${preview.tables.length} tablas` : ''}
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
      {!preview ? (
        <div className="xl-drop" onClick={() => inputRef.current?.click()}>
          <div style={{ width: 44, height: 44, margin: '0 auto 12px', borderRadius: 12, background: 'var(--success-soft)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="upload" size={20} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{busy ? 'Leyendo…' : 'Suelta un .xlsx aquí'}</div>
          <div className="rd-small">o haz clic para seleccionar un archivo</div>
        </div>
      ) : (
        <div>
          <div className="rd-small" style={{ marginBottom: 10 }}><b style={{ color: 'var(--ink)' }}>{filename}</b> — {preview.tables.length} hojas detectadas. Revisa antes de importar.</div>
          {preview.tables.map((s) => (
            <div className="xl-sheet" key={s.sheetName}>
              <div className="xl-sheet-head"><Icon name="table" size={13} style={{ color: 'var(--primary)' }} />{s.schema ? `${s.schema}.` : ''}{s.name}<span className="rd-small" style={{ marginLeft: 'auto' }}>{s.columns.length} cols</span></div>
              <div style={{ padding: '6px 12px' }}>
                {s.columns.slice(0, 12).map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
                    <span style={{ flex: 1, fontWeight: 600 }}>{c.name}</span>
                    <span className="rd-mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{c.dataType}</span>
                  </div>
                ))}
                {s.columns.length > 12 && <div className="rd-small" style={{ padding: '3px 0' }}>+{s.columns.length - 12} más</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
