'use client';

import React, { useMemo, useState } from 'react';
import type { TableModel } from '@/types/model';

interface TablesListViewProps {
  tables: TableModel[];
  onAddTable: () => void;
  onEditTable: (id: string) => void;
  onDeleteTable: (id: string) => void;
  /** Triggers a DDL preview/download for a single table. */
  onDownloadTableDDL?: (table: TableModel) => void;
  /** Triggers a DDL preview/download for an entire domain. */
  onDownloadDomainDDL?: (domain: string) => void;
  /** Triggers a DDL preview/download for the whole model. */
  onDownloadModelDDL?: () => void;
}

/**
 * Rich list view for a model's tables. Shows classification badges
 * (application code, domain, subdomain), user tags, column counts, and
 * allows filtering by search text and by clicking a tag.
 */
type GroupBy = 'none' | 'schema' | 'domain';

export default function TablesListView({
  tables,
  onAddTable,
  onEditTable,
  onDeleteTable,
  onDownloadTableDDL,
  onDownloadDomainDDL,
  onDownloadModelDDL,
}: TablesListViewProps) {
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('schema');

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
        t.schema ?? '',
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

  /** Group `filtered` according to the active grouping. Returns ordered groups. */
  const groups: { label: string; key: string; rows: TableModel[]; isDomain: boolean }[] = useMemo(() => {
    if (groupBy === 'none') {
      return [{ label: 'All tables', key: '__all', rows: filtered, isDomain: false }];
    }
    const map = new Map<string, TableModel[]>();
    for (const t of filtered) {
      const k = (groupBy === 'schema' ? t.schema : t.domain) || (groupBy === 'schema' ? '(no schema)' : '(no domain)');
      const arr = map.get(k);
      if (arr) arr.push(t); else map.set(k, [t]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => ({
        key,
        label: key,
        rows,
        isDomain: groupBy === 'domain' && !key.startsWith('('),
      }));
  }, [filtered, groupBy]);

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

          {/* Group-by selector */}
          <div className="tlv-groupby" role="tablist" aria-label="Group tables by">
            {(['schema', 'domain', 'none'] as GroupBy[]).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={groupBy === g}
                className={`tlv-groupby-btn ${groupBy === g ? 'active' : ''}`}
                onClick={() => setGroupBy(g)}
              >
                {g === 'none' ? 'Flat' : g === 'schema' ? 'By schema' : 'By domain'}
              </button>
            ))}
          </div>

          {onDownloadModelDDL && tables.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onDownloadModelDDL}
              title="Generate DDL for the entire model"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export DDL
            </button>
          )}

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
            ? 'No tables yet. Click "New Table" to create your first one.'
            : 'No tables match the current filter.'}
        </div>
      ) : (
        <div className="tlv-groups">
          {groups.map((group) => (
            <section key={group.key} className="tlv-group">
              {groupBy !== 'none' && (
                <header className="tlv-group-head">
                  <span className="tlv-group-icon">
                    {groupBy === 'schema' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3" />
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7h6l2 2h10v11a1 1 0 0 1-1 1H3z" />
                      </svg>
                    )}
                  </span>
                  <span className="tlv-group-title">{group.label}</span>
                  <span className="tlv-group-count">{group.rows.length}</span>
                  {group.isDomain && onDownloadDomainDDL && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm tlv-group-action"
                      onClick={() => onDownloadDomainDDL(group.key)}
                      title={`Generate DDL for domain "${group.label}"`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      DDL
                    </button>
                  )}
                </header>
              )}

              <div className="tables-list-grid">
                {group.rows.map((t) => (
                  <div key={t.id} className="tables-list-card">
                    <div className="tables-list-card-head">
                      <div className="tables-list-card-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <line x1="3" y1="9" x2="21" y2="9" />
                          <line x1="9" y1="21" x2="9" y2="9" />
                        </svg>
                      </div>
                      <span className="tables-list-card-title" title={`${t.schema ?? ''}.${t.name}`}>
                        {t.schema && groupBy !== 'schema' && (
                          <span className="tables-list-card-schema">{t.schema}.</span>
                        )}
                        {t.name}
                      </span>
                      <span className="tables-list-card-count" title={`${t.columns.length} columns`}>
                        {t.columns.length} col{t.columns.length === 1 ? '' : 's'}
                      </span>
                      <div className="tables-list-card-actions">
                        {onDownloadTableDDL && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => onDownloadTableDDL(t)}
                            title="Generate DDL"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                        )}
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

                    {(t.applicationCode || t.domain || t.subdomain || t.partition) && (
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
                        {t.partition && t.partition.strategy !== 'NONE' && t.partition.columns.length > 0 && (
                          <span
                            className="tables-list-meta-badge tables-list-meta-partition"
                            title={`Partitioned by ${t.partition.strategy} on ${t.partition.columns.join(', ')}`}
                          >
                            <span className="meta-key">part</span> {t.partition.strategy}({t.partition.columns.join(', ')})
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
