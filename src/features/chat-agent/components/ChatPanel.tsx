'use client';

import React, { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useAgentConversation } from '../hooks/useAgentConversation';
import GuidelinesUploader from './GuidelinesUploader';
import ModelResultBlock from './ModelResultBlock';
import { AgentDogState } from './AgentDogState';
import type { ModelingResponse } from '../lib/types';
import type { DatabaseEngine } from '@/types/model';

export interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Project that scopes the conversation (one session per project). */
  projectId: string | null;
  engine: DatabaseEngine | null | undefined;
  /** Fires when the user applies a result — the parent shows the placement dialog. */
  onApplyModel: (result: ModelingResponse) => void;
  /**
   * When true the panel renders read-only: no sending, attaching, uploading
   * guidelines, resetting the session, or applying to the canvas.
   */
  readOnly?: boolean;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen,
  onClose,
  projectId,
  engine,
  onApplyModel,
  readOnly = false,
}) => {
  const conv = useAgentConversation({ projectId, engine });

  const [input, setInput] = useState('');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [resetting, setResetting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    return () => clearTimeout(t);
  }, [conv.messages.length, isOpen]);

  useEffect(() => {
    if (isOpen && projectId) {
      const t = setTimeout(() => textareaRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const canSend = !readOnly && !!projectId && !conv.sending && (input.trim().length > 0 || excelFile !== null);
  const hasContent = conv.messages.length > 0;

  // The dog mascot goes "error" when the last assistant turn failed or returned
  // zero tables; both also block the apply-to-canvas action.
  const lastAssistantMsg = [...conv.messages].reverse().find((m) => m.role === 'assistant');
  const lastResultIsEmpty = lastAssistantMsg?.result != null && lastAssistantMsg.result.tables.length === 0;
  const hasError = !!lastAssistantMsg?.error || lastResultIsEmpty;

  const handleSend = async () => {
    if (!canSend) return;
    const text = input.trim();
    const file = excelFile;
    setInput('');
    setExcelFile(null);
    await conv.sendTurn({ text, excelFile: file });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = async () => {
    setResetting(true);
    try {
      await conv.reset();
    } finally {
      setResetting(false);
    }
  };

  const handleExcelPick = () => excelInputRef.current?.click();

  const handleExcelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    setExcelFile(file);
  };

  return (
    <aside className="chat-panel" role="complementary" aria-label="Asistente de modelado IA">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="chat-head">
        <div className="chat-head-id">
          <span className="chat-avatar" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dog.png" alt="" width="22" height="22" style={{ objectFit: 'contain' }} />
          </span>
          <div className="chat-head-meta">
            <div className="chat-title">AI Modeler</div>
            {conv.conversationId && (
              <div className="chat-session" title={`Session ID: ${conv.conversationId}`}>
                sesión #{conv.conversationId.slice(0, 8)}
              </div>
            )}
          </div>
        </div>
        <div className="chat-head-actions">
          <button
            className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm"
            onClick={handleNewSession}
            disabled={readOnly || resetting || conv.sending}
            title={readOnly ? 'Solo lectura' : 'Nueva sesión — limpia el chat'}
            type="button"
          >
            <Icon name="refresh" size={15} className={resetting ? 'chat-spin' : undefined} />
          </button>
          <button
            className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm"
            onClick={onClose}
            title="Cerrar panel"
            type="button"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      </header>

      {/* ── Guidelines strip ─────────────────────────────────────────── */}
      <GuidelinesUploader
        current={conv.guidelines}
        uploading={conv.uploadingGuidelines}
        onUpload={conv.uploadGuidelinesFile}
        disabled={readOnly || !projectId}
      />

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div className="chat-body">
        {!hasContent && (
          <div className="chat-welcome">
            <span className="chat-welcome-ico" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-dog.png" alt="" width="34" height="34" style={{ objectFit: 'contain' }} />
            </span>
            <p className="chat-welcome-title">Modelado asistido por IA</p>
            <p className="chat-welcome-body">
              Describí el modelo que querés generar, o adjuntá un Excel con tablas y columnas.
              Si tu equipo tiene <em>guidelines</em>, subílas arriba para que el agente las aplique en cada turno.
            </p>
            <div className="chat-tips">
              <span className="chat-tip"><Icon name="sparkles" size={12} />Texto libre</span>
              <span className="chat-tip"><Icon name="table" size={12} />Excel .xlsx</span>
              <span className="chat-tip"><Icon name="file" size={12} />Guidelines</span>
            </div>
          </div>
        )}

        {conv.messages.map((msg) => {
          if (msg.role === 'system') {
            return (
              <div key={msg.id} className={`chat-msg system${msg.error ? ' error' : ''}`}>
                <Icon name={msg.error ? 'warning' : 'info'} size={13} />
                <span>{msg.content}</span>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`chat-msg ${msg.role === 'user' ? 'user' : 'agent'}${msg.error ? ' error' : ''}`}>
              {msg.attachment && msg.role === 'user' && (
                <div className="chat-attach-chip">
                  <span className="chat-attach-ico">{msg.attachment.kind === 'excel' ? 'XLS' : 'DOC'}</span>
                  <div className="chat-attach-meta">
                    <div className="nm">{msg.attachment.name}</div>
                    <div className="sz">{formatBytes(msg.attachment.sizeBytes)}</div>
                  </div>
                </div>
              )}
              {msg.content && <div className="chat-msg-text">{msg.content}</div>}
              {msg.role === 'assistant' && msg.result && msg.result.tables.length === 0 && (
                <div className="chat-empty-result">
                  <Icon name="warning" size={14} />
                  <span>El agente no generó tablas. Agregá más detalle o revisá el Excel enviado. El canvas no se modificó.</span>
                </div>
              )}
              {msg.role === 'assistant' && msg.result && msg.result.tables.length > 0 && (
                <ModelResultBlock result={msg.result} onApply={onApplyModel} applyDisabled={readOnly} />
              )}
            </div>
          );
        })}

        <AgentDogState sending={conv.sending} hasError={hasError} />
        <div ref={messagesEndRef} />
      </div>

      {/* ── Composer ─────────────────────────────────────────────────── */}
      <div className="chat-foot">
        {excelFile && (
          <div className="chat-attach-chip pending">
            <span className="chat-attach-ico">XLS</span>
            <div className="chat-attach-meta" style={{ flex: 1 }}>
              <div className="nm">{excelFile.name}</div>
              <div className="sz">{formatBytes(excelFile.size)}</div>
            </div>
            <button className="rd-btn rd-btn-ghost rd-btn-icon rd-btn-sm" onClick={() => setExcelFile(null)} title="Quitar archivo" type="button">
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
        <input ref={excelInputRef} type="file" accept=".xlsx" hidden onChange={handleExcelChange} />
        <div className="chat-compose">
          <button
            className="chat-attach-btn"
            onClick={handleExcelPick}
            disabled={readOnly || conv.sending}
            title={readOnly ? 'Solo lectura' : 'Adjuntar Excel (.xlsx)'}
            type="button"
          >
            <Icon name="paperclip" size={16} />
          </button>
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={
              readOnly
                ? 'Solo lectura — no se pueden enviar mensajes al agente'
                : projectId
                  ? 'Describí el modelo o ajustá el existente… (Enter para enviar)'
                  : 'Abrí un proyecto para usar el agente'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={readOnly || conv.sending || !projectId}
            rows={2}
          />
          <button className="chat-send" onClick={handleSend} disabled={!canSend} title="Enviar (Enter)" type="button">
            <Icon name="send" size={16} />
          </button>
        </div>
        <div className="chat-hint">Enter para enviar · Shift+Enter nueva línea</div>
      </div>
    </aside>
  );
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default ChatPanel;
