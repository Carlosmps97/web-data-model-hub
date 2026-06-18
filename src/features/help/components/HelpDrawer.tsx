'use client';

import React, { useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useUIStore } from '@/store/useUIStore';
import { CATS, ARTICLES, catOf, ArticleBody, useHelpSearch, type Article } from './HelpContent';

/** Off-canvas quick-help drawer — opened from the rail "?" button. */
export default function HelpDrawer() {
  const open = useUIStore((s) => s.helpOpen);
  const setHelpOpen = useUIStore((s) => s.setHelpOpen);
  const { q, setQ, results } = useHelpSearch();
  const [article, setArticle] = useState<Article | null>(null);
  const popular = ['a_scope', 'a_connect', 'a_views'].map((id) => ARTICLES.find((a) => a.id === id)!).filter(Boolean);

  if (!open) return null;
  const close = () => setHelpOpen(false);
  const list = q ? results : popular;

  return (
    <>
      <div className="doc-drawer-scrim" onClick={close} />
      <div className="doc-drawer">
        <div className="doc-drawer-head">
          <Icon name="info" size={16} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 800, fontSize: 14, flex: 1 }}>Ayuda rápida</span>
          <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={close}><Icon name="x" size={15} /></button>
        </div>
        {article ? (
          <div className="doc-drawer-body">
            <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginBottom: 10 }} onClick={() => setArticle(null)}><Icon name="chevR" size={13} style={{ transform: 'rotate(180deg)' }} />Volver</button>
            <h2 className="doc-title" style={{ fontSize: 19, marginBottom: 12 }}>{article.title}</h2>
            <ArticleBody a={article} compact />
          </div>
        ) : (
          <div className="doc-drawer-body">
            <div className="rd-search" style={{ marginBottom: 14 }}><Icon name="search" size={15} /><input className="rd-input" autoFocus placeholder="Buscar ayuda…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {q && results.length === 0 && <div className="rd-small" style={{ padding: 10 }}>Sin resultados.</div>}
            {list.map((a) => { const c = catOf(a.cat); return (
              <button key={a.id} className="doc-drawer-item" onClick={() => setArticle(a)}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: c.color + '1a', color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={c.icon} size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{a.title}</div><div className="rd-small">{a.summary}</div></div>
              </button>
            ); })}
            {!q && <div className="rd-small" style={{ fontWeight: 700, margin: '14px 0 6px', color: 'var(--muted)' }}>Categorías</div>}
            {!q && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{CATS.map((c) => <span key={c.id} className="doc-pop-chip" style={{ cursor: 'default' }}>{c.title}</span>)}</div>}
          </div>
        )}
      </div>
    </>
  );
}
