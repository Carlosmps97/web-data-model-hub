'use client';

// ─────────────────────────────────────────────────────────────────────────
//  Strip compacto que vive arriba del input del ChatPanel y permite
//  al usuario subir / reemplazar las guidelines de la conversación.
//
//  La carga es por sesión: el backend cachea el contenido procesado en
//  memoria asociado al `conversation_id` (ContextVar). Si se sube un
//  archivo nuevo, reemplaza al anterior. NO se persiste en disco.
// ─────────────────────────────────────────────────────────────────────────

import React, { useRef } from 'react';
import type { GuidelinesUploadResponse } from '../lib/types';

const ACCEPT = '.pdf,.docx,.md,.json,.xlsx,.txt';

export interface GuidelinesUploaderProps {
  /** Resultado de la última carga (para mostrar el estado actual). */
  current: GuidelinesUploadResponse | null;
  /** Si hay una carga en vuelo. */
  uploading: boolean;
  /** Callback. Devuelve `null` si falló (el hook ya se encarga del mensaje). */
  onUpload: (file: File) => Promise<unknown>;
  /** El chat está deshabilitado por completo (ej. modelId aún sin resolver). */
  disabled?: boolean;
}

const GuidelinesUploader: React.FC<GuidelinesUploaderProps> = ({
  current,
  uploading,
  onUpload,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePick = () => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset el input para que el usuario pueda subir el mismo archivo otra vez.
    e.target.value = '';
    if (!file) return;
    await onUpload(file);
  };

  return (
    <div className="chat-guidelines-strip" role="region" aria-label="Guidelines del modelo">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={handleChange}
      />
      <span className="chat-guidelines-icon" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </span>
      <div className="chat-guidelines-info">
        <span className="chat-guidelines-label">Guidelines</span>
        <span className="chat-guidelines-detail">
          {uploading
            ? 'Procesando archivo…'
            : current
              ? `${current.file_name} · ${current.file_format.toUpperCase()}`
              : 'Sin archivo (el agente usará reglas por defecto).'}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm chat-guidelines-action"
        onClick={handlePick}
        disabled={disabled || uploading}
        title={current ? 'Reemplazar guidelines' : 'Subir guidelines'}
      >
        {current ? 'Reemplazar' : 'Subir'}
      </button>
    </div>
  );
};

export default GuidelinesUploader;
