'use client';

import React, { useMemo, useState } from 'react';
import type { TableModel } from '@/types/model';

interface TablesListViewProps {
  tables: TableModel[];
  onAddTable: () => void;
  onEditTable: (id: string) => void;
  onDeleteTable: (id: string) => void;
}

/**
 * Rich list view for a model's tables. Shows classification badges
 * (application code, domain, subdomain), user tags, column counts, and
 * allows filtering by search text and by clicking a tag.
 */
export default function TablesListView({
  tables,
  onAddTable,
  onEditTable,
  onDeleteTable,
}: TablesListViewProps) {
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Collect all unique tags for quick reference in the UI
  const allTags = useMemo(() => {
    const set = new Set<string>();
    tables.forEach((t) => (t.tags ?? []).forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [tables]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter((t) => {
      if (activeTag && !(t.tags ?? []).includes(activeTag)) return false;
      if (!q) return true;
      const hay = [
        t.name,
        t.functionalDefinition ?? '',
        t.applicationCode ?? '',
        t.domain ?? '',
        t.subdomain ?? '',
        ...(t.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tables, search, activeTag]);

  return (
    <div className="tables-list-view">
      <div className="tables-list-toolbar">
        <div className="tables-list-filters">
          <div className="tables-list-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, domain, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {activeTag && (
            <button
              type="button"
              className="tables-list-tag-filter"
              onClick={() => setActiveTag(null)}
              title="Clear tag filter"
            >
              #{activeTag}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {filtered.length} of {tables.length} {tables.length === 1 ? 'table' : 'tables'}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onAddTable}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Table
          </button>
        </div>
      </div>

      {/* All-tag quick filter row */}
      {allTags.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 'var(--space-4)',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px dashed #e2e8f0',
        }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 600, marginRight: 4 }}>
            Tags:
          </span>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tables-list-tag ${activeTag === tag ? 'active' : ''}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="tables-list-empty">
          {tables.length === 0
            ? 'No tables yet. Click “New Table” to create your first one.'
            : 'No tables match the current filter.'}
        </div>
      ) : (
        <div className="tables-list-grid">
          {filtered.map((t) => (
            <div key={t.id} className="tables-list-card">
              <div className="tables-list-card-head">
                <div className="tables-list-card-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </div>
                <span className="tables-list-card-title" title={t.name}>{t.name}</span>
                <span className="tables-list-card-count" title={`${t.columns.length} columns`}>
                  {t.columns.length} col{t.columns.length === 1 ? '' : 's'}
                </span>
                <div className="tables-list-card-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => onEditTable(t.id)}
                    title="Edit table"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => onDeleteTable(t.id)}
                    title="Delete table"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              {t.functionalDefinition && (
                <div className="tables-list-card-desc">{t.functionalDefinition}</div>
              )}

              {(t.applicationCode || t.domain || t.subdomain) && (
                <div className="tables-list-card-meta">
                  {t.applicationCode && (
                    <span className="tables-list-meta-badge tables-list-meta-app" title="Application Code">
                      <span className="meta-key">app</span> {t.applicationCode}
                    </span>
                  )}
                  {t.domain && (
                    <span className="tables-list-meta-badge tables-list-meta-domain" title="Domain">
                      <span className="meta-key">domain</span> {t.domain}
                    </span>
                  )}
                  {t.subdomain && (
                    <span className="tables-list-meta-badge tables-list-meta-sub" title="Subdomain">
                      <span className="meta-key">sub</span> {t.subdomain}
                    </span>
                  )}
                </div>
              )}

              {t.tags && t.tags.length > 0 && (
                <div className="tables-list-card-tags">
                  {t.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`tables-list-tag ${activeTag === tag ? 'active' : ''}`}
                      onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
