'use client';

import React, { useState } from 'react';
import { toast, Toaster } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import Icon from '@/components/ui/Icon';
import { CATS, ARTICLES, catOf, ArticleBody, useHelpSearch, type Article } from './HelpContent';

type Route = { v: 'home' } | { v: 'category'; cat: string } | { v: 'article'; a: Article };

export default function HelpCenterScreen() {
  const [route, setRoute] = useState<Route>({ v: 'home' });
  const { q, setQ, results } = useHelpSearch();
  const [focus, setFocus] = useState(false);
  const popular = ['a_scope', 'a_fromsql', 'a_views', 'a_hier'].map((id) => ARTICLES.find((a) => a.id === id)!).filter(Boolean);

  const openArticle = (a: Article) => { setRoute({ v: 'article', a }); setQ(''); setFocus(false); };

  if (route.v === 'article') {
    const a = route.a;
    const c = catOf(a.cat);
    return (
      <AppLayout>
        <div className="dmh-main">
          <Header crumbs={[{ label: 'Centro de ayuda', onClick: () => setRoute({ v: 'home' }) }, { label: c.title, onClick: () => setRoute({ v: 'category', cat: c.id }) }, { label: a.title }]} />
          <div className="doc-page">
            <div className="doc-article-head">
              <span className="doc-cat-chip" style={{ background: c.color + '1a', color: c.color }}><Icon name={c.icon} size={13} />{c.title}</span>
              <h1 className="doc-title">{a.title}</h1>
              <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="activity" size={13} />{a.read} min de lectura</div>
            </div>
            <ArticleBody a={a} />
            <div className="doc-feedback">¿Te resultó útil este artículo?
              <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={() => toast.success('¡Gracias por tu feedback!')}><Icon name="check" size={13} />Sí</button>
              <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => toast('Gracias, lo mejoraremos')}>No</button>
            </div>
          </div>
        </div>
        <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
      </AppLayout>
    );
  }

  if (route.v === 'category') {
    const c = catOf(route.cat);
    const list = ARTICLES.filter((a) => a.cat === route.cat);
    return (
      <AppLayout>
        <div className="dmh-main">
          <Header crumbs={[{ label: 'Centro de ayuda', onClick: () => setRoute({ v: 'home' }) }, { label: c.title }]} />
          <div className="doc-page">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '28px 36px' }}>
              <span className="doc-cat-ico" style={{ background: c.color + '1a', color: c.color }}><Icon name={c.icon} size={24} /></span>
              <div><h1 className="doc-title" style={{ marginBottom: 2 }}>{c.title}</h1><div className="rd-body">{c.desc}</div></div>
            </div>
            <div className="doc-artlist">
              {list.map((a) => (
                <button key={a.id} className="doc-artrow" onClick={() => openArticle(a)}>
                  <Icon name="book" size={16} style={{ color: c.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{a.title}</div><div className="rd-small">{a.summary}</div></div>
                  <span className="rd-small" style={{ whiteSpace: 'nowrap' }}>{a.read} min</span>
                  <Icon name="chevR" size={15} style={{ color: 'var(--subtle)' }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="dmh-main">
        <Header crumbs={[{ label: 'Centro de ayuda' }]} />
        <div className="doc-page">
          <div className="doc-hero">
            <div className="doc-hero-eyebrow">CENTRO DE AYUDA</div>
            <h1 className="doc-hero-title">¿En qué te podemos ayudar hoy?</h1>
            <div className="doc-hero-search">
              <Icon name="search" size={20} />
              <input className="rd-input" placeholder="Busca: conectar tablas, crear vistas, scope, dominios…" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
              {focus && results.length > 0 && (
                <div className="doc-search-pop">
                  {results.map((a) => { const c = catOf(a.cat); return (
                    <button key={a.id} className="doc-search-item" onMouseDown={() => openArticle(a)}>
                      <span style={{ width: 26, height: 26, borderRadius: 7, background: c.color + '1a', color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={c.icon} size={13} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{a.title}</div><div className="rd-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.summary}</div></div>
                      <span className="rd-small">{c.title}</span>
                    </button>
                  ); })}
                </div>
              )}
            </div>
            <div className="doc-hero-pop">
              <span className="rd-small" style={{ fontWeight: 700 }}>Popular:</span>
              {popular.map((a) => <button key={a.id} className="doc-pop-chip" onClick={() => openArticle(a)}>{a.title}</button>)}
            </div>
          </div>

          <div className="doc-cat-grid">
            {CATS.map((c) => {
              const n = ARTICLES.filter((a) => a.cat === c.id).length;
              return (
                <button key={c.id} className="doc-cat-card" onClick={() => setRoute({ v: 'category', cat: c.id })}>
                  <span className="doc-cat-ico" style={{ background: c.color + '1a', color: c.color }}><Icon name={c.icon} size={22} /></span>
                  <div className="doc-cat-title">{c.title}</div>
                  <div className="doc-cat-desc">{c.desc}</div>
                  <div className="doc-cat-count">{n} artículo{n !== 1 ? 's' : ''} <Icon name="chevR" size={13} /></div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
