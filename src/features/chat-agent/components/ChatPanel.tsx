'use client';

import React, { useState, useRef } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  attachment?: { name: string; size: string };
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ isOpen, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      content: 'Welcome to the AI Model Assistant. You can describe your data model in natural language or upload an Excel file for analysis. Note: The AI backend is not yet connected - this is a preview of the interface.',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const scrollToBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleSend = async () => {
    if (!input.trim() && !attachment) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
      attachment: attachment
        ? { name: attachment.name, size: `${(attachment.size / 1024).toFixed(1)} KB` }
        : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setAttachment(null);
    setSending(true);
    scrollToBottom();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input.trim(),
          attachments: attachment ? [{ name: attachment.name, type: attachment.type }] : undefined,
        }),
      });
      const json = await res.json();

      const agentMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: json.data?.message || 'Something went wrong. Please try again.',
        timestamp: json.data?.timestamp || new Date().toISOString(),
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'agent',
          content: 'Failed to connect to the server. Please check your connection.',
          timestamp: new Date().toISOString(),
        },
      ]);
    }

    setSending(false);
    scrollToBottom();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      {/* Header */}
      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: 'var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: 'var(--color-warning)',
            boxShadow: '0 0 6px rgba(240, 198, 116, 0.5)',
          }} />
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>AI Assistant</span>
          <span className="badge badge-warning" style={{ fontSize: '0.6rem' }}>Preview</span>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            {msg.attachment && (
              <div className="chat-attachment" style={{ marginBottom: 'var(--space-2)' }}>
                <div className="chat-attachment-icon">XLS</div>
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{msg.attachment.name}</div>
                  <div style={{ color: 'var(--color-text-muted)' }}>{msg.attachment.size}</div>
                </div>
              </div>
            )}
            {msg.content}
          </div>
        ))}
        {sending && (
          <div className="chat-message agent" style={{ opacity: 0.6 }}>
            <span style={{ animation: 'pulse 1.5s ease infinite' }}>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-wrapper">
        {attachment && (
          <div className="chat-attachment">
            <div className="chat-attachment-icon">XLS</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{attachment.name}</div>
              <div style={{ color: 'var(--color-text-muted)' }}>{(attachment.size / 1024).toFixed(1)} KB</div>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setAttachment(null)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div className="chat-input-area">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => {
            if (e.target.files?.[0]) setAttachment(e.target.files[0]);
          }} />
          <button className="btn btn-ghost btn-icon" onClick={() => fileInputRef.current?.click()} title="Attach Excel file">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Describe your data model..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button className="btn btn-primary btn-icon" onClick={handleSend} disabled={sending || (!input.trim() && !attachment)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
