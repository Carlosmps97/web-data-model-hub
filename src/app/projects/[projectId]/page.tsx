'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { v4 as uuidv4 } from 'uuid';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import TableForm from '@/features/table-editor/components/TableForm';
import ExcelImportModal from '@/features/excel-import/components/ExcelImportModal';
import DBMLEditorModal from '@/features/table-editor/components/DBMLEditorModal';
import ChatPanel from '@/features/chat-agent/components/ChatPanel';
import { useModelStore } from '@/store/useModelStore';
import { useUIStore } from '@/store/useUIStore';
import type { TableModel, DataModel, Relationship } from '@/types/model';

// Dynamic import for DiagramCanvas (needs DOM access, no SSR)
const DiagramCanvas = dynamic(
  () => import('@/features/diagram/components/DiagramCanvas'),
  { ssr: false }
);

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default function DiagramPage({ params }: PageProps) {
  const { projectId } = use(params);
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
    updateTablePosition,
    loadModel,
    createModel,
    saveModel,
    saving,
    loadModels,
  } = useModelStore();

  const { selectedTableId, setSelectedTable, chatPanelOpen, setChatPanelOpen } = useUIStore();

  const [models, setModels] = useState<DataModel[]>([]);
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<TableModel | null>(null);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [showDBMLEditor, setShowDBMLEditor] = useState(false);
  const [showModelCreate, setShowModelCreate] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Load project and models
  useEffect(() => {
    async function load() {
      try {
        // Load project info
        const projRes = await fetch(`/api/projects/${projectId}`);
        const projJson = await projRes.json();
        if (projJson.success) {
          setCurrentProject(projJson.data);
        } else {
          router.push('/');
          return;
        }

        // Load models for this project
        const loadedModels = await loadModels(projectId);
        setModels(loadedModels);

        // Auto-load or create first model
        if (loadedModels.length > 0) {
          await loadModel(loadedModels[0].id);
        }
        setLoaded(true);
      } catch {
        router.push('/');
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (!currentModel || !loaded) return;
    const timer = setTimeout(() => {
      saveModel();
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, relationships]);

  const handleCreateModel = async () => {
    if (!newModelName.trim()) return;
    const model = await createModel({
      projectId,
      name: newModelName.trim(),
    });
    if (model) {
      setModels((prev) => [...prev, model]);
      setCurrentModel(model);
      setShowModelCreate(false);
      setNewModelName('');
    }
  };

  const handleSwitchModel = async (modelId: string) => {
    await loadModel(modelId);
  };

  const handleAddTable = (table: TableModel) => {
    if (editingTable) {
      updateTable(editingTable.id, table);
      // Also re-add relationships from FK columns
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
      // Remove old relationships from this table and add new ones
      const filteredRels = relationships.filter(
        (r) => r.sourceTable !== editingTable.name && r.sourceTable !== editingTable.id
      );
      setRelationships([...filteredRels, ...newRels]);
    } else {
      addTable(table);
      // Add relationships from FK columns
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

  const handleDBMLApply = (dbmlTables: TableModel[], dbmlRels: Relationship[]) => {
    setTables([...tables, ...dbmlTables]);
    setRelationships([...relationships, ...dbmlRels]);
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

  const selectedTable = tables.find((t) => t.id === selectedTableId);

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
      <Header
        title={currentProject?.name || 'Project'}
        subtitle={currentModel ? `Model: ${currentModel.name}` : 'No model selected'}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {saving && (
              <span className="badge badge-neutral" style={{ animation: 'pulse 1.5s ease infinite' }}>Saving...</span>
            )}

            {/* Model switcher */}
            {models.length > 0 && (
              <select
                className="input"
                style={{ width: '180px', padding: '4px 8px', fontSize: 'var(--text-xs)' }}
                value={currentModel?.id || ''}
                onChange={(e) => handleSwitchModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}

            <button className="btn btn-ghost btn-sm" onClick={() => setShowModelCreate(true)} title="New Model">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Model
            </button>

            <div style={{ width: '1px', height: '24px', background: 'rgba(157, 190, 187, 0.15)' }} />

            <button className="btn btn-secondary btn-sm" onClick={() => router.push('/')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              Projects
            </button>
          </div>
        }
      />

      {!currentModel ? (
        <div className="app-content">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-tertiary)" strokeWidth="1">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <h3>No models yet</h3>
            <p>Create your first data model to start designing ER diagrams.</p>
            <button className="btn btn-primary btn-lg" onClick={() => setShowModelCreate(true)}>
              Create First Model
            </button>
          </div>
        </div>
      ) : (
        <div className="diagram-layout">
          {/* Left Sidebar - Table List */}
          <div className="diagram-sidebar">
            <div className="diagram-sidebar-header">
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Tables</span>
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { setEditingTable(null); setShowTableForm(true); }} title="Add Table">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowExcelImport(true)} title="Import Excel">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="9" y1="15" x2="12" y2="12" />
                    <line x1="15" y1="15" x2="12" y2="12" />
                  </svg>
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowDBMLEditor(true)} title="DBML Editor">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setChatPanelOpen(true)} title="AI Chat">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="diagram-sidebar-content">
              {tables.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                  <p>No tables yet.</p>
                  <p style={{ marginTop: 'var(--space-2)' }}>Use the buttons above to add tables manually, import from Excel, or write DBML.</p>
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

          {/* Canvas */}
          <DiagramCanvas
            tables={tables}
            relationships={relationships}
            selectedTableId={selectedTableId}
            onSelectTable={setSelectedTable}
            onUpdatePosition={updateTablePosition}
          />

          {/* Right Panel - Table Details */}
          {selectedTable && (
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
          )}

          {/* Chat Panel */}
          <ChatPanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />
        </div>
      )}

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

      {/* DBML Editor Modal */}
      <DBMLEditorModal
        isOpen={showDBMLEditor}
        tables={tables}
        relationships={relationships}
        onApply={handleDBMLApply}
        onClose={() => setShowDBMLEditor(false)}
      />

      {/* New Model Modal */}
      {showModelCreate && (
        <div className="modal-backdrop" onClick={() => setShowModelCreate(false)}>
          <div className="modal-content animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Model</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowModelCreate(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="input-label">Model Name</label>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Sales Data Model, User Management Schema"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateModel()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModelCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateModel} disabled={!newModelName.trim()}>
                Create Model
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
