'use client';

import React, { useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import AppLayout from '@/components/layout/AppLayout';
import ChatPanel from '@/features/chat-agent/components/ChatPanel';
import EngineBadge from '@/features/engines/components/EngineBadge';
import DBMLEditorPanel, { type DBMLEditorGroup } from '@/features/table-editor/components/DBMLEditorPanel';
import { useModelStore } from '@/store/useModelStore';
import { useUIStore } from '@/store/useUIStore';
import type { Project, DataModel, TableModel, Relationship, DatabaseEngine } from '@/types/model';
import { layoutLeftRight } from '@/features/diagram/utils/layoutAlgorithms';
import type { NamespaceInfo } from '@/features/diagram/components/DiagramCanvas';

const DiagramCanvas = dynamic(
  () => import('@/features/diagram/components/DiagramCanvas'),
  { ssr: false }
);

const NODE_W = 260;
const ROW_H = 28;
const HEADER_H = 36;
const FOOTER_H = 28;
const PAD_X = 40;
const PAD_TOP = 56;
const PAD_BOTTOM = 40;
const NS_GAP = 64;

interface PageProps {
  params: Promise<{ projectId: string }>;
}

interface AggregatedData {
  tables: TableModel[];
  relationships: Relationship[];
  namespaces: NamespaceInfo[];
  tablePositions: Record<string, { x: number; y: number }>;
  engines: DatabaseEngine[];
  tableModelMap: Map<string, { modelId: string; modelName: string }>;
}

/**
 * Compute per-model namespace rectangles + table positions for a "global" canvas view.
 * Each model gets its own background panel. Models are stacked vertically.
 */
function aggregate(models: DataModel[]): AggregatedData {
  const namespaces: NamespaceInfo[] = [];
  const tablePositions: Record<string, { x: number; y: number }> = {};
  const allTables: TableModel[] = [];
  const allRels: Relationship[] = [];
  const tableModelMap = new Map<string, { modelId: string; modelName: string }>();
  const engineSet = new Set<DatabaseEngine>();

  let cursorY = 40;

  models.forEach((model, idx) => {
    if (model.tables.length === 0) return;
    const positions = layoutLeftRight(model.tables, model.relationships);

    // Bounding box of this model's tables in layout space
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    model.tables.forEach((t) => {
      const p = positions[t.id] ?? { x: 0, y: 0 };
      const h = HEADER_H + t.columns.length * ROW_H + (t.functionalDefinition ? FOOTER_H : 0);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + h);
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = NODE_W; maxY = 120; }

    const nsX = 40;
    const nsY = cursorY;
    const offsetX = nsX + PAD_X - minX;
    const offsetY = nsY + PAD_TOP - minY;

    // Shift each table by the namespace origin
    model.tables.forEach((t) => {
      const p = positions[t.id] ?? { x: 0, y: 0 };
      tablePositions[t.id] = { x: p.x + offsetX, y: p.y + offsetY };
    });

    const nsWidth = (maxX - minX) + PAD_X * 2;
    const nsHeight = (maxY - minY) + PAD_TOP + PAD_BOTTOM;

    namespaces.push({
      id: model.id,
      label: model.name,
      engine: model.engine,
      tableIds: model.tables.map((t) => t.id),
      position: { x: nsX, y: nsY },
      width: nsWidth,
      height: nsHeight,
      tintIndex: idx,
    });

    cursorY = nsY + nsHeight + NS_GAP;

    // Aggregate tables + rels
    model.tables.forEach((t) => {
      allTables.push(t);
      tableModelMap.set(t.id, { modelId: model.id, modelName: model.name });
    });
    model.relationships.forEach((r) => allRels.push(r));
    if (model.engine) engineSet.add(model.engine);
  });

  return {
    tables: allTables,
    relationships: allRels,
    namespaces,
    tablePositions,
    engines: Array.from(engineSet),
    tableModelMap,
  };
}

export default function ProjectGlobalCanvasPage({ params }: PageProps) {
  const { projectId } = use(params);
  const router = useRouter();

  const { loadModels } = useModelStore();
  const { selectedTableId, setSelectedTable, chatPanelOpen, setChatPanelOpen } = useUIStore();

  const [project, setProject] = useState<Project | null>(null);
  const [models, setModels] = useState<DataModel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [leftTab, setLeftTab] = useState<'visual' | 'code'>('visual');

  useEffect(() => {
    async function load() {
      try {
        const projRes = await fetch(`/api/projects/${projectId}`);
        const projJson = await projRes.json();
        if (!projJson.success) {
          router.push('/');
          return;
        }
        setProject(projJson.data);

        const loadedModels = await loadModels(projectId);
        setModels(loadedModels);
        setLoaded(true);
      } catch {
        router.push('/');
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Clear selection on unmount
  useEffect(() => () => setSelectedTable(null), [setSelectedTable]);

  const aggregated = useMemo(() => aggregate(models), [models]);

  // Build per-model groups for the read-only DBML Code tab
  const dbmlGroups: DBMLEditorGroup[] = useMemo(() => {
    const src = modelFilter === 'all' ? models : models.filter((m) => m.id === modelFilter);
    return src.map((m) => ({
      name: m.name,
      engine: m.engine,
      tables: m.tables,
      relationships: m.relationships,
    }));
  }, [models, modelFilter]);

  // Filter view when user picks a single model
  const visible = useMemo(() => {
    if (modelFilter === 'all') return aggregated;
    const selected = models.find((m) => m.id === modelFilter);
    if (!selected) return aggregated;
    return aggregate([selected]);
  }, [aggregated, modelFilter, models]);

  const selectedTable = visible.tables.find((t) => t.id === selectedTableId);
  const selectedTableModel = selectedTable ? visible.tableModelMap.get(selectedTable.id) : undefined;

  if (!loaded) {
    return (
      <AppLayout>
        <div className="flex-center" style={{ height: '100vh' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="skeleton" style={{ width: '200px', height: '20px', marginBottom: 'var(--space-3)', margin: '0 auto' }} />
            <div className="skeleton" style={{ width: '150px', height: '14px', margin: '0 auto' }} />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {/* Header — global canvas view */}
      <header className="editor-header">
        <div className="editor-header-breadcrumb">
          <button
            className="editor-back-btn"
            onClick={() => router.push(`/projects/${projectId}`)}
            title="Back to project"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="editor-header-crumbs">
            <span className="editor-crumb-muted">{project?.name ?? 'Project'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="editor-crumb-sep">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="editor-crumb-current editor-crumb-global">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Global Canvas
            </span>
            <span className="editor-save-badge saved" style={{ background: 'rgba(79, 70, 229, 0.08)', color: '#4f46e5', borderColor: 'rgba(79, 70, 229, 0.25)' }}>
              View only
            </span>
          </div>

          {/* Aggregated engines */}
          {aggregated.engines.length > 0 && (
            <div className="editor-header-engines">
              {aggregated.engines.map((e) => (
                <EngineBadge key={e} engine={e} compact />
              ))}
            </div>
          )}
        </div>

        <div className="editor-header-actions">
          <button
            className={`btn btn-sm editor-ai-toggle ${chatPanelOpen ? 'active' : ''}`}
            onClick={() => setChatPanelOpen(!chatPanelOpen)}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L14.39 8.25 21 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.61-1.02L12 2z" />
            </svg>
            AI Agent
          </button>
        </div>
      </header>

      <div className="editor-workspace">
        {/* Left Panel: model filter + all entities grouped */}
        <aside className="editor-left-panel">
          <div className="editor-left-tabs">
            <button
              type="button"
              className={`editor-tab ${leftTab === 'visual' ? 'active' : ''}`}
              onClick={() => setLeftTab('visual')}
            >
              Visual
            </button>
            <button
              type="button"
              className={`editor-tab ${leftTab === 'code' ? 'active' : ''}`}
              onClick={() => setLeftTab('code')}
            >
              Code
            </button>
          </div>

          {leftTab === 'code' ? (
            <div className="editor-left-content">
              <DBMLEditorPanel groups={dbmlGroups} readOnly />
            </div>
          ) : (
          <>
          <div className="editor-left-section">
            <div className="editor-left-section-title">Models</div>
            <div className="model-filter-list">
              <button
                type="button"
                className={`model-filter-item ${modelFilter === 'all' ? 'active' : ''}`}
                onClick={() => setModelFilter('all')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
                <span style={{ flex: 1 }}>All models</span>
                <span className="table-list-item-count">{models.length}</span>
              </button>
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`model-filter-item ${modelFilter === m.id ? 'active' : ''}`}
                  onClick={() => setModelFilter(m.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                    {m.engine && (
                      <div style={{ marginTop: 2 }}>
                        <EngineBadge engine={m.engine} compact />
                      </div>
                    )}
                  </div>
                  <span className="table-list-item-count">{m.tables.length}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="editor-entities" style={{ borderTop: 'var(--border-subtle)' }}>
            <div className="editor-entities-header">
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                Tables ({visible.tables.length})
              </span>
            </div>
            <div className="editor-entities-list">
              {visible.tables.length === 0 ? (
                <div className="editor-entities-empty">
                  <p>No tables in this view.</p>
                </div>
              ) : (
                visible.tables.map((t) => {
                  const ownerModel = visible.tableModelMap.get(t.id);
                  return (
                    <div
                      key={t.id}
                      className={`table-list-item ${selectedTableId === t.id ? 'active' : ''}`}
                      onClick={() => setSelectedTable(t.id)}
                    >
                      <div className="table-list-item-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <line x1="3" y1="9" x2="21" y2="9" />
                          <line x1="9" y1="21" x2="9" y2="9" />
                        </svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                        {ownerModel && (
                          <div className="table-list-item-sub">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <line x1="3" y1="9" x2="21" y2="9" />
                            </svg>
                            {ownerModel.modelName}
                          </div>
                        )}
                      </div>
                      <span className="table-list-item-count">{t.columns.length}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          </>
          )}
        </aside>

        <DiagramCanvas
          tables={visible.tables}
          relationships={visible.relationships}
          selectedTableId={selectedTableId}
          onSelectTable={setSelectedTable}
          namespaces={visible.namespaces}
          tablePositions={visible.tablePositions}
        />

        {/* Right Panel */}
        {chatPanelOpen ? (
          <ChatPanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />
        ) : selectedTable && selectedTableModel ? (
          <div className="right-panel">
            <div className="right-panel-header">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <h4 style={{ fontSize: 'var(--text-base)' }}>{selectedTable.name}</h4>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  in {selectedTableModel.modelName}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => router.push(`/projects/${projectId}/models/${selectedTableModel.modelId}`)}
                  title="Open in model editor"
                >
                  Open model
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedTable(null)} title="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="right-panel-content">
              {selectedTable.functionalDefinition && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label className="input-label">Description</label>
                  <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                    {selectedTable.functionalDefinition}
                  </p>
                </div>
              )}

              <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>
                Columns ({selectedTable.columns.length})
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {selectedTable.columns.map((col, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: idx % 2 === 0 ? 'transparent' : 'var(--color-bg-surface)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    {col.isPrimaryKey && <span className="badge badge-warning" style={{ fontSize: '0.55rem', padding: '0 4px' }}>PK</span>}
                    {col.isForeignKey && <span className="badge badge-primary" style={{ fontSize: '0.55rem', padding: '0 4px' }}>FK</span>}
                    {col.isSurrogateKey && <span className="badge badge-neutral" style={{ fontSize: '0.55rem', padding: '0 4px' }}>SK</span>}
                    <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 500 }}>{col.name}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {col.dataType}
                    </span>
                  </div>
                ))}
              </div>

              {/* Cross-model relationships from this table */}
              {visible.relationships.filter((r) =>
                r.sourceTable === selectedTable.name || r.targetTable === selectedTable.name ||
                r.sourceTable === selectedTable.id || r.targetTable === selectedTable.id
              ).length > 0 && (
                <div style={{ marginTop: 'var(--space-6)' }}>
                  <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Relationships</label>
                  {visible.relationships
                    .filter((r) =>
                      r.sourceTable === selectedTable.name || r.targetTable === selectedTable.name ||
                      r.sourceTable === selectedTable.id || r.targetTable === selectedTable.id
                    )
                    .map((rel) => (
                      <div key={rel.id} style={{
                        padding: 'var(--space-2) var(--space-3)',
                        background: 'rgba(119, 172, 162, 0.08)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)',
                        marginBottom: 'var(--space-2)',
                        border: '1px solid rgba(119, 172, 162, 0.15)',
                      }}>
                        <span style={{ color: 'var(--color-accent-secondary)' }}>{rel.sourceTable}.{rel.sourceColumn}</span>
                        <span style={{ color: 'var(--color-text-muted)', margin: '0 var(--space-2)' }}>
                          {rel.type === 'one-to-one' ? '1:1' : rel.type === 'one-to-many' ? '1:N' : 'N:M'}
                        </span>
                        <span style={{ color: 'var(--color-accent-secondary)' }}>{rel.targetTable}.{rel.targetColumn}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}
