import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react';

/** Ruta pública de la plantilla (public/templates; la sirve Vite en dev y
 *  server.mjs en Databricks Apps). Doc 78: `Plantilla.xlsx` verbatim. */
export const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/Plantilla.xlsx`;
const TEMPLATE_NAME = 'Plantilla.xlsx';
const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface DropzoneFile { name: string; size: number; }
/** Hoja del perfil vista desde el archivo cargado (solo informativo; la verdad la dice el reporte). */
export interface DropzoneSheet { name: string; found: boolean; rows: number; }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Selector del workbook: zona de arrastre + botón de archivo (teclado: Enter /
 * Space). Con archivo cargado muestra la tarjeta (nombre, tamaño, hojas del
 * perfil halladas o no) y permite reemplazarlo; la plantilla siempre está a
 * un click.
 */
export default function UploadDropzone({ file, sheets, disabled, onFile }: {
  file: DropzoneFile | null;
  sheets: DropzoneSheet[] | null;
  disabled?: boolean;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const open = () => { if (!disabled) inputRef.current?.click(); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  const input = (
    <input
      ref={inputRef} type="file" accept={ACCEPT} hidden
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
    />
  );

  if (file) {
    return (
      <div className="up-file">
        {input}
        <span className="up-file-ico"><FileSpreadsheet size={18} strokeWidth={1.6} aria-hidden /></span>
        <div className="up-file-main">
          <span className="up-file-name" title={file.name}>{file.name}</span>
          <span className="up-file-meta">
            <span>{fmtSize(file.size)}</span>
            {sheets?.map((s) => (
              <code className={`up-loc${s.found ? '' : ' is-missing'}`} key={s.name}>
                {s.name} · {s.found ? `${s.rows} row${s.rows === 1 ? '' : 's'}` : 'missing'}
              </code>
            ))}
          </span>
        </div>
        <button type="button" className="up-file-replace" onClick={open} disabled={disabled}>Replace file</button>
      </div>
    );
  }

  return (
    <>
      <div
        className={`up-drop${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
        role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
        onClick={open} onKeyDown={onKey}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {input}
        <span className="up-drop-ico"><UploadCloud size={20} strokeWidth={1.6} aria-hidden /></span>
        <span className="up-drop-title">Drop your workbook here or <u>browse</u></span>
        <span className="up-drop-sub">Excel file (.xlsx) laid out as the selected upload profile expects</span>
      </div>
      <span className="up-template">
        Need the template?
        <a href={TEMPLATE_URL} download={TEMPLATE_NAME}><Download size={13} strokeWidth={1.8} aria-hidden />Download {TEMPLATE_NAME}</a>
      </span>
    </>
  );
}
