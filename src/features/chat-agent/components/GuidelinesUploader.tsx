'use client';

// ─────────────────────────────────────────────────────────────────────────
//  Strip compacto arriba del cuerpo del ChatPanel: sube / reemplaza las
//  guidelines de la conversación. La carga es por sesión (el backend cachea
//  el contenido procesado en memoria asociado al `conversation_id`).
// ─────────────────────────────────────────────────────────────────────────

import React, { useRef } from 'react';
import Icon from '@/components/ui/Icon';
import type { GuidelinesUploadResponse } from '../lib/types';

const ACCEPT = '.pdf,.docx,.md,.json,.xlsx,.txt';

export interface GuidelinesUploaderProps {
  current: GuidelinesUploadResponse | null;
  uploading: boolean;
  onUpload: (file: File) => Promise<unknown>;
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
    e.target.value = '';
    if (!file) return;
    await onUpload(file);
  };

  return (
    <div className="chat-gl" role="region" aria-label="Guidelines del proyecto">
      <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={handleChange} />
      <span className="chat-gl-ico" aria-hidden><Icon name="file" size={14} /></span>
      <div className="chat-gl-info">
        <span className="chat-gl-label">Guidelines</span>
        <span className="chat-gl-detail">
          {uploading
            ? 'Procesando archivo…'
            : current
              ? `${current.file_name} · ${current.file_format.toUpperCase()}`
              : 'Sin archivo (el agente usará reglas por defecto).'}
        </span>
      </div>
      <button
        type="button"
        className="rd-btn rd-btn-ghost rd-btn-sm"
        onClick={handlePick}
        disabled={disabled || uploading}
        title={current ? 'Reemplazar guidelines' : 'Subir guidelines'}
      >
        <Icon name="upload" size={13} />
        {current ? 'Reemplazar' : 'Subir'}
      </button>
    </div>
  );
};

export default GuidelinesUploader;
