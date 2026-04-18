'use client';

import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { v4 as uuidv4 } from 'uuid';
import AppLayout from '@/components/layout/AppLayout';
import TableForm from '@/features/table-editor/components/TableForm';
import ExcelImportModal from '@/features/excel-import/components/ExcelImportModal';
import DBMLEditorPanel from '@/features/table-editor/components/DBMLEditorPanel';
import ChatPanel from '@/features/chat-agent/components/ChatPanel';
import EngineSelect from '@/features/engines/components/EngineSelect';
import { useModelStore } from '@/store/useModelStore';
import { useUIStore } from '@/store/useUIStore';
import type { TableModel, Relationship, DatabaseEngine } from '@/types/model';

const DiagramCanvas = dynamic(
  () => import('@/features/diagram/components/DiagramCanvas'),
  { ssr: false }
);

type LeftTab = 'visual' | 'code';

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
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<TableModel | null>(null);
  const [showExcelImport, setShowExcelImport] = useState(false);

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

  // DBML Code tab applies a full replacement of the model
  const handleDBMLApply = (dbmlTables: TableModel[], dbmlRels: Relationship[]) => {
    setTables(dbmlTables);
    setRelationships(dbmlRels);
  };

  const handleEditTable = (id: string) => {
    const table = tables.find((t) => t.id === id);
    if (table) {
      setEditingTable(table);
      setShowTableForm(true);
    }
  };

  const handleDeleteTable = (id: string) => {
    removeTable(id);
    if (selectedTableId === id) setSelectedTable(null);
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

  const selectedTable = tables.find((t) => t.id === selectedTableId);

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
      {/* Editor Header (document-level actions only) */}
      <header className="editor-header">
        <div className="editor-header-breadcrumb">
          <button
            className="editor-back-btn"
            onClick={() => router.push(`/projects/${projectId}`)}
            title="Back to models"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="editor-header-crumbs">
            <span className="editor-crumb-muted">{currentProject?.name ?? 'Project'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="editor-crumb-sep">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="editor-crumb-current">{currentModel?.name ?? 'Model'}</span>
            <span className={`editor-save-badge ${saving ? 'saving' : 'saved'}`}>
              {saving ? 'Saving…' : 'Saved'}
            </span>
          </div>

          <div className="editor-header-engines">
            <EngineSelect
              value={currentModel?.engine ?? null}
              onChange={handleUpdateEngine}
              size="sm"
            />
          </div>
        </div>

        <div className="editor-header-actions">
          <div className="editor-toolbar-group">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowExcelImport(true)}
              title="Import from Excel"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import Excel
            </button>
          </div>

          <div className="editor-header-divider" />

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

      {/* Editor Workspace */}
      <div className="editor-workspace">
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

        {/* Right-side panels (mutually exclusive: AI has priority) */}
        {chatPanelOpen ? (
          <ChatPanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />
        ) : selectedTable ? (
          <div className="right-panel">
            <div className="right-panel-header">
              <h4 style={{ fontSize: 'var(--text-base)' }}>{selectedTable.name}</h4>
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleEditTable(selectedTable.id)} title="Edit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDeleteTable(selectedTable.id)} title="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
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

              {/* Relationships */}
              {relationships.filter((r) =>
                r.sourceTable === selectedTable.name || r.targetTable === selectedTable.name ||
                r.sourceTable === selectedTable.id || r.targetTable === selectedTable.id
              ).length > 0 && (
                <div style={{ marginTop: 'var(--space-6)' }}>
                  <label className="input-label" style={{ marginBottom: 'var(--space-3)' }}>Relationships</label>
                  {relationships
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
    </AppLayout>
  );
}
