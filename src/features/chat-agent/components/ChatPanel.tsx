'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAgentConversation } from '@/features/chat-agent/hooks/useAgentConversation';
import GuidelinesUploader from './GuidelinesUploader';
import ModelResultBlock from './ModelResultBlock';
import { AgentDogState } from './AgentDogState';
import type { ModelingResponse } from '@/lib/agent/types';
import type { DatabaseEngine } from '@/types/model';

export interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  modelId: string | null;
  engine: DatabaseEngine | null | undefined;
  onApplyModel: (result: ModelingResponse) => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen,
  onClose,
  modelId,
  engine,
  onApplyModel,
}) => {
  const conv = useAgentConversation({ modelId, engine });

  const [input, setInput] = useState('');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [resetting, setResetting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [conv.messages.length, isOpen]);

  // Auto-focus textarea when panel opens
  useEffect(() => {
    if (isOpen && modelId) {
      setTimeout(() => textareaRef.current?.focus(), 200);
    }
  }, [isOpen, modelId]);

  if (!isOpen) return null;

  const canSend = !!modelId && !conv.sending && (input.trim().length > 0 || excelFile !== null);
  const hasContent = conv.messages.length > 0;

  // Detecta si el último mensaje del asistente fue un error o devolvió tablas vacías.
  // Ambos casos activan el perrito de error y bloquean el "Aplicar al canvas".
  const lastAssistantMsg = [...conv.messages].reverse().find(m => m.role === 'assistant');
  const lastResultIsEmpty = lastAssistantMsg?.result != null && lastAssistantMsg.result.tables.length === 0;
  const hasError = !!(lastAssistantMsg?.error) || lastResultIsEmpty;

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
    <div className="chat-panel">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="chat-panel-header">
        <div className="chat-panel-header-identity">
          <div className="chat-panel-avatar" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dog.png" alt="" width="22" height="22" style={{ objectFit: 'contain' }} />
          </div>
          <div>
            <div className="chat-panel-title">AI Modeler</div>
            {conv.conversationId && (
              <div className="chat-panel-session-id" title={`Session ID: ${conv.conversationId}`}>
                sesión #{conv.conversationId.slice(0, 8)}
              </div>
            )}
          </div>
        </div>

        <div className="chat-panel-header-actions">
          <button
            className="chat-panel-icon-btn"
            onClick={handleNewSession}
            disabled={resetting || conv.sending}
            title="Nueva sesión — limpia el chat y el canvas"
            type="button"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: resetting ? 'rotate(360deg)' : 'none',
                transition: resetting ? 'transform 0.6s linear' : 'none',
              }}
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            className="chat-panel-icon-btn"
            onClick={onClose}
            title="Cerrar panel"
            type="button"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Guidelines strip ─────────────────────────────────────────── */}
      <GuidelinesUploader
        current={conv.guidelines}
        uploading={conv.uploadingGuidelines}
        onUpload={conv.uploadGuidelinesFile}
        disabled={!modelId}
      />

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div className="chat-messages">
        {!hasContent && (
          <div className="chat-welcome">
            <div className="chat-welcome-icon" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-dog.png" alt="" width="32" height="32" style={{ objectFit: 'contain' }} />
            </div>
            <p className="chat-welcome-title">Modelado asistido por IA</p>
            <p className="chat-welcome-body">
              Describí el modelo que querés generar, o adjuntá un Excel con tablas y columnas.
              Si tu equipo tiene <em>guidelines</em>, subílas arriba para que el agente las aplique en cada turno.
            </p>
            <div className="chat-welcome-tips">
              <span className="chat-welcome-tip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Texto libre
              </span>
              <span className="chat-welcome-tip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                Excel .xlsx
              </span>
              <span className="chat-welcome-tip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                Guidelines
              </span>
            </div>
          </div>
        )}

        {conv.messages.map((msg) => {
          if (msg.role === 'system') {
            return (
              <div key={msg.id} className={`chat-message system ${msg.error ? 'error' : ''}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{msg.content}</span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`chat-message ${msg.role === 'user' ? 'user' : 'agent'} ${msg.error ? 'error' : ''}`}
            >
              {msg.attachment && msg.role === 'user' && (
                <div className="chat-attachment" style={{ marginBottom: 'var(--space-2)' }}>
                  <div className="chat-attachment-icon">
                    {msg.attachment.kind === 'excel' ? 'XLS' : 'DOC'}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{msg.attachment.name}</div>
                    <div style={{ color: 'var(--color-text-muted)' }}>{formatBytes(msg.attachment.sizeBytes)}</div>
                  </div>
                </div>
              )}
              {msg.content && <div className="chat-message-text">{msg.content}</div>}
              {msg.role === 'assistant' && msg.result && msg.result.tables.length === 0 && (
                <div className="chat-empty-result">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <span>El agente no generó tablas. Agregá más detalle o revisá el Excel enviado. El canvas no se modificó.</span>
                </div>
              )}
              {msg.role === 'assistant' && msg.result && msg.result.tables.length > 0 && (
                <ModelResultBlock result={msg.result} onApply={onApplyModel} />
              )}
            </div>
          );
        })}

        <AgentDogState sending={conv.sending} hasError={hasError} />
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────────────── */}
      <div className="chat-input-wrapper">
        {excelFile && (
          <div className="chat-attachment">
            <div className="chat-attachment-icon">XLS</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{excelFile.name}</div>
              <div style={{ color: 'var(--color-text-muted)' }}>{formatBytes(excelFile.size)}</div>
            </div>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setExcelFile(null)}
              title="Quitar archivo"
              type="button"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <input ref={excelInputRef} type="file" accept=".xlsx" hidden onChange={handleExcelChange} />
        <div className="chat-input-area">
          <button
            className="chat-attach-btn"
            onClick={handleExcelPick}
            disabled={conv.sending}
            title="Adjuntar Excel (.xlsx)"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            className="chat-input-textarea"
            placeholder={
              modelId
                ? 'Describí el modelo o ajustá el existente… (Enter para enviar)'
                : 'Abrí un modelo para usar el agente'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={conv.sending || !modelId}
            rows={2}
          />
          <button
            className="chat-send-btn btn btn-icon"
            onClick={handleSend}
            disabled={!canSend}
            title="Enviar (Enter)"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="chat-input-hint">
          <span>⏎ Enter para enviar · Shift+Enter nueva línea</span>
        </div>
      </div>
    </div>
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
