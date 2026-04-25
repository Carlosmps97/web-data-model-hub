'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { v4 as uuidv4 } from 'uuid';
import AppLayout from '@/components/layout/AppLayout';
import TableForm from '@/features/table-editor/components/TableForm';
import ExcelImportModal from '@/features/excel-import/components/ExcelImportModal';
import DBMLEditorPanel from '@/features/table-editor/components/DBMLEditorPanel';
import TablesListView from '@/features/table-editor/components/TablesListView';
import ChatPanel from '@/features/chat-agent/components/ChatPanel';
import EngineSelect from '@/features/engines/components/EngineSelect';
import DDLPreviewModal, { type DDLScope } from '@/features/ddl/components/DDLPreviewModal';
import { useModelStore } from '@/store/useModelStore';
import { useUIStore } from '@/store/useUIStore';
import type { TableModel, Relationship, DatabaseEngine } from '@/types/model';

const DiagramCanvas = dynamic(
  () => import('@/features/diagram/components/DiagramCanvas'),
  { ssr: false }
);

type LeftTab = 'visual' | 'code';
type MainView = 'list' | 'canvas';

interface PageProps {
  params: Promise<{ projectId: string; modelId: string }>;
}

export default function ModelEditorPage({ params }: PageProps) {
  const { projectId, modelId } = use(params);
  const router = useRouter();

  const {
    currentProject,
    setCurrentProject,
    currentModel,
    setCurrentModel,
    tables,
    relationships,
    addTable,
    updateTable,
    removeTable,
    setTables,
    addRelationship,
    setRelationships,
    loadModel,
    saveModel,
    saving,
  } = useModelStore();

  const { selectedTableId, setSelectedTable, chatPanelOpen, setChatPanelOpen } = useUIStore();

  const [loaded, setLoaded] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>('visual');
  const [mainView, setMainView] = useState<MainView>('list');
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<TableModel | null>(null);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [ddlScope, setDdlScope] = useState<DDLScope | null>(null);

  // ── Load project + model ──
  useEffect(() => {
    async function load() {
      try {
        const projRes = await fetch(`/api/projects/${projectId}`);
        const projJson = await projRes.json();
        if (!projJson.success) {
          router.push('/');
          return;
        }
        setCurrentProject(projJson.data);

        await loadModel(modelId);
        setLoaded(true);
      } catch {
        router.push(`/projects/${projectId}`);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, modelId]);

  // ── Auto-save on changes (debounced) ──
  useEffect(() => {
    if (!currentModel || !loaded) return;
    const timer = setTimeout(() => {
      saveModel();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, relationships]);

  // ── Clear selected table when switching models ──
  useEffect(() => {
    return () => setSelectedTable(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──
  const handleAddTable = (table: TableModel) => {
    if (editingTable) {
      updateTable(editingTable.id, table);
      const newRels: Relationship[] = [];
      table.columns.forEach((col) => {
        if (col.isForeignKey && col.foreignKeyRef?.table && col.foreignKeyRef?.column) {
          newRels.push({
            id: uuidv4(),
            sourceTable: table.name,
            sourceColumn: col.name,
            targetTable: col.foreignKeyRef.table,
            targetColumn: col.foreignKeyRef.column,
            type: 'one-to-many',
          });
        }
      });
      const filteredRels = relationships.filter(
        (r) => r.sourceTable !== editingTable.name && r.sourceTable !== editingTable.id
      );
      setRelationships([...filteredRels, ...newRels]);
    } else {
      addTable(table);
      table.columns.forEach((col) => {
        if (col.isForeignKey && col.foreignKeyRef?.table && col.foreignKeyRef?.column) {
          addRelationship({
            id: uuidv4(),
            sourceTable: table.name,
            sourceColumn: col.name,
            targetTable: col.foreignKeyRef.table,
            targetColumn: col.foreignKeyRef.column,
            type: 'one-to-many',
          });
        }
      });
    }
    setShowTableForm(false);
    setEditingTable(null);
  };

  const handleImportExcel = (importedTables: TableModel[]) => {
    importedTables.forEach((t) => addTable(t));
    setShowExcelImport(false);
  };

  // DBML Code tab applies a full replacement of the model.
  // If the DBML source declared a Project { database_type: ... } block, we also
  // update the model's engine to match.
  const handleDBMLApply = (
    dbmlTables: TableModel[],
    dbmlRels: Relationship[],
    meta?: { engine?: DatabaseEngine }
  ) => {
    setTables(dbmlTables);
    setRelationships(dbmlRels);
    if (meta?.engine && meta.engine !== currentModel?.engine) {
      handleUpdateEngine(meta.engine);
    }
  };

  const handleEditTable = (id: string) => {
    const table = tables.find((t) => t.id === id);
    if (table) {
      setEditingTable(table);
      setShowTableForm(true);
    }
  };

  const handleDeleteTable = (id: string) => {
    if (!confirm('Delete this table? This cannot be undone.')) return;
    removeTable(id);
    if (selectedTableId === id) setSelectedTable(null);
  };

  const handleNewTable = () => {
    setEditingTable(null);
    setShowTableForm(true);
  };

  const handleUpdateEngine = async (engine: DatabaseEngine | null) => {
    if (!currentModel) return;
    // Optimistic update
    setCurrentModel({ ...currentModel, engine: engine ?? undefined });
    try {
      await fetch(`/api/models/${currentModel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: engine ?? null }),
      });
    } catch (err) {
      console.error('Failed to update engine:', err);
    }
  };


  // ── Loading state ──
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
      {/* ──────────────────────────────────────────────────────────────
          Editor Header — two well-spaced rows:
            Row 1 (identity):  back · clickable breadcrumb · saved · engine
            Row 2 (toolbar):   view toggle · primary actions · AI agent
          ────────────────────────────────────────────────────────────── */}
      <header className="ed-header">
        {/* Row 1: identity & status */}
        <div className="ed-header-row ed-header-identity">
          <button
            className="ed-back"
            onClick={() => router.push(`/projects/${projectId}`)}
            title="Back to models"
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <nav className="ed-breadcrumb" aria-label="Breadcrumb">
            <button
              type="button"
              className="ed-crumb ed-crumb-link"
              onClick={() => router.push('/')}
              title="All projects"
            >
              Projects
            </button>
            <ChevronCrumb />
            <button
              type="button"
              className="ed-crumb ed-crumb-link"
              onClick={() => router.push(`/projects/${projectId}`)}
              title={`Open ${currentProject?.name ?? 'project'}`}
            >
              {currentProject?.name ?? 'Project'}
            </button>
            <ChevronCrumb />
            <span className="ed-crumb ed-crumb-current" title={currentModel?.name}>
              {currentModel?.name ?? 'Model'}
            </span>
          </nav>

          <span className={`ed-save-pill ${saving ? 'saving' : 'saved'}`} role="status">
            <span className="ed-save-dot" />
            {saving ? 'Saving…' : 'Saved'}
          </span>

          <div className="ed-spacer" />

          <div className="ed-engine-wrap">
            <span className="ed-engine-label">Engine</span>
            <EngineSelect
              value={currentModel?.engine ?? null}
              onChange={handleUpdateEngine}
              size="md"
            />
          </div>
        </div>

        {/* Row 2: view + actions toolbar */}
        <div className="ed-header-row ed-header-toolbar">
          <div className="ed-segmented" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={mainView === 'list'}
              className={`ed-segmented-btn ${mainView === 'list' ? 'active' : ''}`}
              onClick={() => setMainView('list')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <circle cx="3" cy="6" r="1" />
                <circle cx="3" cy="12" r="1" />
                <circle cx="3" cy="18" r="1" />
              </svg>
              <span>List</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mainView === 'canvas'}
              className={`ed-segmented-btn ${mainView === 'canvas' ? 'active' : ''}`}
              onClick={() => setMainView('canvas')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span>Canvas</span>
            </button>
          </div>

          <div className="ed-toolbar-spacer" />

          <button
            className="ed-action-btn"
            onClick={() => setShowExcelImport(true)}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import Excel
          </button>

          <button
            className="ed-action-btn ed-action-primary"
            onClick={() => setDdlScope({ kind: 'all' })}
            type="button"
            disabled={tables.length === 0}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export DDL
          </button>

          <div className="ed-toolbar-divider" />

          <button
            className={`ed-action-btn ed-action-ai ${chatPanelOpen ? 'active' : ''}`}
            onClick={() => setChatPanelOpen(!chatPanelOpen)}
            type="button"
            aria-pressed={chatPanelOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L14.39 8.25 21 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.61-1.02L12 2z" />
            </svg>
            AI Agent
          </button>
        </div>
      </header>

      {/* Editor Workspace */}
      <div className="editor-workspace">
        {mainView === 'list' ? (
          <>
            <TablesListView
              tables={tables}
              onAddTable={handleNewTable}
              onEditTable={handleEditTable}
              onDeleteTable={handleDeleteTable}
              onDownloadTableDDL={(t) => setDdlScope({ kind: 'table', table: t })}
              onDownloadDomainDDL={(d) => setDdlScope({ kind: 'domain', domain: d })}
              onDownloadModelDDL={() => setDdlScope({ kind: 'all' })}
            />
            {chatPanelOpen && (
              <ChatPanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />
            )}
          </>
        ) : (
        <>
        {/* Left Panel — Construction Tools */}
        <aside className="editor-left-panel">
          <div className="editor-tabs">
            <button
              className={`editor-tab ${leftTab === 'visual' ? 'active' : ''}`}
              onClick={() => setLeftTab('visual')}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              Visual
            </button>
            <button
              className={`editor-tab ${leftTab === 'code' ? 'active' : ''}`}
              onClick={() => setLeftTab('code')}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              Code
            </button>
          </div>

          <div className="editor-left-content">
            {leftTab === 'visual' ? (
              <div className="editor-entities">
                <div className="editor-entities-header">
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                    Tables ({tables.length})
                  </span>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => { setEditingTable(null); setShowTableForm(true); }}
                    title="Add table"
                    type="button"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                <div className="editor-entities-list">
                  {tables.length === 0 ? (
                    <div className="editor-entities-empty">
                      <p>No tables yet.</p>
                      <p style={{ marginTop: 'var(--space-2)' }}>
                        Click the <strong>+</strong> button to add one, switch to the <strong>Code</strong> tab to write DBML, or use <strong>Import Excel</strong> from the toolbar.
                      </p>
                    </div>
                  ) : (
                    tables.map((table) => (
                      <div
                        key={table.id}
                        className={`table-list-item ${selectedTableId === table.id ? 'active' : ''}`}
                        onClick={() => setSelectedTable(table.id)}
                      >
                        <div className="table-list-item-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="3" y1="9" x2="21" y2="9" />
                            <line x1="9" y1="21" x2="9" y2="9" />
                          </svg>
                        </div>
                        <span style={{ flex: 1 }}>{table.name}</span>
                        <span className="table-list-item-count">{table.columns.length}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <DBMLEditorPanel
                tables={tables}
                relationships={relationships}
                engine={currentModel?.engine}
                modelName={currentModel?.name}
                onApply={handleDBMLApply}
              />
            )}
          </div>
        </aside>

        {/* Canvas */}
        <DiagramCanvas
          tables={tables}
          relationships={relationships}
          selectedTableId={selectedTableId}
          onSelectTable={setSelectedTable}
          onEditTable={handleEditTable}
        />

        {/* AI assistant side panel (only opens when explicitly toggled) */}
        {chatPanelOpen && (
          <ChatPanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />
        )}
        </>
        )}
      </div>

      {/* Table Form Modal */}
      {showTableForm && (
        <div className="modal-backdrop" onClick={() => { setShowTableForm(false); setEditingTable(null); }}>
          <div className="modal-content modal-large animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTable ? 'Edit Table' : 'Add Table'}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => { setShowTableForm(false); setEditingTable(null); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <TableForm
              table={editingTable}
              existingTables={tables}
              engine={currentModel?.engine ?? null}
              onSave={handleAddTable}
              onCancel={() => { setShowTableForm(false); setEditingTable(null); }}
            />
          </div>
        </div>
      )}

      {/* Excel Import Modal */}
      <ExcelImportModal
        isOpen={showExcelImport}
        onClose={() => setShowExcelImport(false)}
        onImport={handleImportExcel}
      />

      {/* DDL Preview / Download Modal */}
      <DDLPreviewModal
        open={ddlScope !== null}
        onClose={() => setDdlScope(null)}
        tables={tables}
        relationships={relationships}
        defaultEngine={currentModel?.engine ?? null}
        scope={ddlScope ?? { kind: 'all' }}
      />
    </AppLayout>
  );
}

// Visual separator used between breadcrumb segments.
function ChevronCrumb() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ed-crumb-sep"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
