// ─────────────────────────────────────────────────────────────────────────────
// Docs rendering primitives.
//
// All visual building blocks for the documentation page live here so each
// `_sections/<Topic>Section.tsx` file stays focused on content. These
// components are intentionally style-self-contained (inline styles) — the
// docs page does not depend on any external design tokens beyond the global
// CSS variables of the app.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import type { SectionId } from './nav';

// ── Inline code ────────────────────────────────────────────────────────────
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        background: '#eef2ff',
        color: '#4338ca',
        padding: '1px 6px',
        borderRadius: 4,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.8em',
      }}
    >
      {children}
    </code>
  );
}

// ── Multi-line code block ──────────────────────────────────────────────────
export function CodeBlock({ children, lang = '' }: { children: string; lang?: string }) {
  return (
    <pre
      data-lang={lang || undefined}
      style={{
        background: '#0f172a',
        color: '#94a3b8',
        borderRadius: 8,
        padding: '16px 20px',
        fontSize: '0.76rem',
        fontFamily: 'JetBrains Mono, monospace',
        overflowX: 'auto',
        lineHeight: 1.75,
        margin: '12px 0',
      }}
    >
      <code>{children.trim()}</code>
    </pre>
  );
}

// ── Table ──────────────────────────────────────────────────────────────────
export function DocTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  borderBottom: '2px solid #e2e8f0',
                  fontWeight: 600,
                  color: '#1e293b',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              style={{
                borderBottom: '1px solid #f1f5f9',
                background: i % 2 === 0 ? 'transparent' : '#f8fafc',
              }}
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{ padding: '7px 12px', color: '#475569', verticalAlign: 'top' }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Callout (info / tip / warning) ─────────────────────────────────────────
type CalloutType = 'info' | 'tip' | 'warning';
export function Callout({
  children,
  type = 'info',
}: {
  children: React.ReactNode;
  type?: CalloutType;
}) {
  const cfg = {
    info: { bg: '#eef2ff', border: '#6366f1', icon: 'ℹ', color: '#4338ca' },
    tip: { bg: '#f0fdf4', border: '#22c55e', icon: '✓', color: '#15803d' },
    warning: { bg: '#fffbeb', border: '#f59e0b', icon: '⚠', color: '#b45309' },
  }[type];
  return (
    <div
      style={{
        background: cfg.bg,
        borderLeft: `3px solid ${cfg.border}`,
        borderRadius: '0 8px 8px 0',
        padding: '10px 16px',
        margin: '12px 0',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: '0.82rem',
          color: cfg.color,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {cfg.icon}
      </span>
      <div style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

// ── Headings ───────────────────────────────────────────────────────────────
//
// `SectionTitle` is the anchor target observed by the sidebar's scroll-spy.
// Each section file owns its `<SectionTitle id={…}>` so the id stays
// co-located with its content.
export function SectionTitle({
  id,
  children,
}: {
  id: SectionId;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      style={{
        fontSize: '1.2rem',
        fontWeight: 700,
        color: '#1e293b',
        marginBottom: 14,
        paddingTop: 16,
        borderBottom: '2px solid #e2e8f0',
        paddingBottom: 10,
        scrollMarginTop: 80,
      }}
    >
      {children}
    </h2>
  );
}

export function Sub({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: '0.95rem',
        fontWeight: 600,
        color: '#4f46e5',
        marginTop: 20,
        marginBottom: 6,
      }}
    >
      {children}
    </h3>
  );
}

// ── Paragraph + lists ──────────────────────────────────────────────────────
export function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.75, marginBottom: 10 }}>
      {children}
    </p>
  );
}

export function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul
      style={{
        paddingLeft: 20,
        margin: '6px 0 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      {items.map((it, i) => (
        <li key={i} style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.65 }}>
          {it}
        </li>
      ))}
    </ul>
  );
}

export function Ol({ items }: { items: React.ReactNode[] }) {
  return (
    <ol
      style={{
        paddingLeft: 20,
        margin: '6px 0 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
      }}
    >
      {items.map((it, i) => (
        <li key={i} style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.65 }}>
          {it}
        </li>
      ))}
    </ol>
  );
}

// ── Decorative flow diagram (icon → icon → icon) ───────────────────────────
export function FlowDiagram({
  steps,
}: {
  steps: { icon: string; title: string; desc: string }[];
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0,
        margin: '14px 0',
        overflowX: 'auto',
        paddingBottom: 4,
      }}
    >
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: 100,
              maxWidth: 130,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: '#eef2ff',
                border: '2px solid #c7d2fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
                marginBottom: 6,
              }}
            >
              {s.icon}
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>
              {s.title}
            </span>
            <span style={{ fontSize: '0.65rem', color: '#64748b', marginTop: 2, lineHeight: 1.3 }}>
              {s.desc}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                flexShrink: 0,
                paddingTop: 12,
                color: '#94a3b8',
                fontSize: '1.2rem',
                margin: '0 4px',
              }}
            >
              →
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
