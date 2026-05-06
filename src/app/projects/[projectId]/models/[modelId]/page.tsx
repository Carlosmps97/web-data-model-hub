'use client';

import React, { useEffect, useRef, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { v4 as uuidv4 } from 'uuid';
import AppLayout from '@/components/layout/AppLayout';
import TableForm from '@/features/table-editor/components/TableForm';
import DomainManager from '@/features/domains/components/DomainManager';
import ViewForm from '@/features/views/components/ViewForm';
import ExcelImportModal from '@/features/excel-import/components/ExcelImportModal';
import CreateFromSqlModal from '@/features/table-editor/components/CreateFromSqlModal';
import DBMLEditorPanel from '@/features/table-editor/components/DBMLEditorPanel';
import TablesListView from '@/features/table-editor/components/TablesListView';
import ChatPanel from '@/features/chat-agent/components/ChatPanel';
import LeftPanelResizer from '@/components/layout/LeftPanelResizer';
import EngineSelect from '@/features/engines/components/EngineSelect';
import DDLPreviewModal, { type DDLScope } from '@/features/ddl/components/DDLPreviewModal';
import ConfirmDialog, { shouldSkipConfirm } from '@/components/ui/ConfirmDialog';
import { projectsService, modelsService } from '@/services';
import { useAuthStore } from '@/store/useAuthStore';
import { useModelStore } from '@/store/useModelStore';
import { useUIStore } from '@/store/useUIStore';
import { modelingResponseToCanvas, fromAgentEngine } from '@/lib/agent/mapping';
import { findColumnId } from '@/lib/columnRef';
import type { ModelingResponse } from '@/lib/agent/types';
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
    views,
    domainCatalog,
    addTable,
    updateTable,
    removeTable,
    setTables,
    addRelationship,
    removeRelationship,
    setRelationships,
    addView,
    updateView,
    removeView,
    loadModel,
    saveModel,
    saving,
  } = useModelStore();

  const { selectedTableId, setSelectedTable, chatPanelOpen, setChatPanelOpen, leftPanelWidth } = useUIStore();

  // Read-only flag: the auth store resolves the user's effective
  // access level for THIS specific model. Viewers get the full UI but
  // all mutation controls are either hidden or disabled with a tooltip.
  const canEdit = useAuthStore((s) => s.canEditModel(modelId, projectId));
  const readOnly = !canEdit;

  const [loaded, setLoaded] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showDomainManager, setShowDomainManager] = useState(false);
  const [showViewForm, setShowViewForm] = useState(false);
  const [editingView, setEditingView] = useState<import('@/types/model').ViewModel | null>(null);
  // Ref para ignorar el primer disparo del efecto dirty (carga inicial).
  // React 18 batchea loadModel (Zustand) + setLoaded(true) en un solo render,
  // por lo que el efecto ve loaded=true + tablas nuevas simultáneamente.
  const skipDirtyRef = useRef(true);
  const [leftTab, setLeftTab] = useState<LeftTab>('visual');
  const [mainView, setMainView] = useState<MainView>('list');
  const [showTableForm, setShowTableForm] = useState(false);
  const [editingTable, setEditingTable] = useState<TableModel | null>(null);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [showSqlCreate, setShowSqlCreate] = useState(false);
  const [ddlScope, setDdlScope] = useState<DDLScope | null>(null);
  const [pendingTableDelete, setPendingTableDelete] = useState<{ id: string; name: string } | null>(null);

  // ── Load project + model ──
  useEffect(() => {
    async function load() {
      try {
        const proj = await projectsService.getProject(projectId);
        setCurrentProject(proj);

        await loadModel(modelId);
        setLoaded(true);
      } catch {
        router.push(`/projects/${projectId}`);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, modelId]);

  // ── Marcar dirty cuando el usuario hace cambios reales ──
  // Salta el primer disparo (carga inicial) para evitar el falso dirty
  // causado por React 18 batching de loadModel + setLoaded en un render.
  useEffect(() => {
    if (!loaded) return;
    if (skipDirtyRef.current) { skipDirtyRef.current = false; return; }
    setIsDirty(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, relationships]);

  // ── Marcar como guardado cuando el save completa ──
  useEffect(() => {
    if (!saving) setIsDirty(false);
  }, [saving]);

  // ── Clear selected table when switching models ──
  useEffect(() => {
    return () => setSelectedTable(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──
  const handleAddTable = (table: TableModel) => {
    if (editingTable) {
      // Editing path.
      //
      // The previous implementation nuked every relationship where the
      // edited table was the source and rebuilt them only from the
      // form's `isForeignKey` columns. That silently dropped every
      // relationship the user had drawn manually in the canvas (those
      // edges live in `relationships` but don't set `isForeignKey` on
      // the column itself), so any edit — even a tag change — erased
      // the whole relational schema for that table.
      //
      // Conservative strategy used here:
      //   1. Preserve every existing relationship.
      //   2. If the table was renamed, cascade the new name into every
      //      relationship that referenced the old name (as source or
      //      target), so they keep pointing to the same table.
      //   3. Add FK-derived relationships declared in the form only
      //      when an equivalent relationship doesn't already exist.
      //   4. Column renames are NOT auto-cascaded because without
      //      stable per-column IDs we cannot reliably tell renames
      //      apart from add+delete. If the user renames a column that
      //      participates in a relationship, the relationship survives
      //      pointing at the old column name — the canvas will warn
      //      on the orphaned handle, making the inconsistency visible
      //      instead of silently wiping the edge.
      const oldName = editingTable.name;
      const newName = table.name;
      const renamed = oldName !== newName;

      updateTable(editingTable.id, table);

      const cascaded = renamed
        ? relationships.map((r) => {
            let next = r;
            if (r.sourceTable === oldName || r.sourceTable === editingTable.id) {
              next = { ...next, sourceTable: newName };
            }
            if (r.targetTable === oldName || r.targetTable === editingTable.id) {
              next = { ...next, targetTable: newName };
            }
            return next;
          })
        : relationships;

      // Resolve every FK declared in the form to column *ids*. The
      // `foreignKeyRef` on the column still stores NAMES (that's the
      // contract users enter in the form), so we look up the id in the
      // target table via `findColumnId`. If the target column doesn't
      // exist we skip the relationship silently rather than creating
      // an orphan pointing at nothing.
      const nextTables = tables.map((t) => (t.id === editingTable.id ? table : t));
      const toAdd: Relationship[] = [];
      table.columns.forEach((col) => {
        if (!col.isForeignKey || !col.foreignKeyRef?.table || !col.foreignKeyRef?.column) return;
        const targetColId = findColumnId(
          nextTables,
          col.foreignKeyRef.table,
          col.foreignKeyRef.column,
        );
        if (!targetColId) return;
        const alreadyExists = cascaded.some(
          (r) =>
            r.sourceTable === newName &&
            r.sourceColumn === col.id &&
            r.targetTable === col.foreignKeyRef!.table &&
            r.targetColumn === targetColId,
        );
        if (!alreadyExists) {
          toAdd.push({
            id: uuidv4(),
            sourceTable: newName,
            sourceColumn: col.id,
            targetTable: col.foreignKeyRef.table,
            targetColumn: targetColId,
            type: 'one-to-many',
          });
        }
      });

      setRelationships(toAdd.length > 0 ? [...cascaded, ...toAdd] : cascaded);
    } else {
      addTable(table);
      const nextTables = [...tables, table];
      table.columns.forEach((col) => {
        if (!col.isForeignKey || !col.foreignKeyRef?.table || !col.foreignKeyRef?.column) return;
        const targetColId = findColumnId(
          nextTables,
          col.foreignKeyRef.table,
          col.foreignKeyRef.column,
        );
        if (!targetColId) return;
        addRelationship({
          id: uuidv4(),
          sourceTable: table.name,
          sourceColumn: col.id,
          targetTable: col.foreignKeyRef.table,
          targetColumn: targetColId,
          type: 'one-to-many',
        });
      });
    }
    setShowTableForm(false);
    setEditingTable(null);
  };

  const handleImportExcel = (importedTables: TableModel[]) => {
    importedTables.forEach((t) => addTable(t));
    setShowExcelImport(false);
  };

  // Bridge from the SQL-to-Table modal. Persists the newly inferred
  // table plus whatever JOIN-derived relationships the user confirmed
  // (we skip duplicates of relationships that already exist, comparing
  // by both id-match and composite (src, src_col, tgt, tgt_col) key).
  const handleCreateFromSql = (payload: { table: TableModel; relationships: Relationship[] }) => {
    addTable(payload.table);
    const existingKeys = new Set(
      relationships.map((r) =>
        `${r.sourceTable}.${r.sourceColumn}->${r.targetTable}.${r.targetColumn}`.toLowerCase(),
      ),
    );
    payload.relationships.forEach((rel) => {
      const key = `${rel.sourceTable}.${rel.sourceColumn}->${rel.targetTable}.${rel.targetColumn}`.toLowerCase();
      if (!existingKeys.has(key)) addRelationship(rel);
    });
    setShowSqlCreate(false);
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

  const performTableDelete = (id: string) => {
    removeTable(id);
    if (selectedTableId === id) setSelectedTable(null);
  };

  const handleDeleteTable = (id: string) => {
    if (shouldSkipConfirm('model-editor:delete-table')) {
      performTableDelete(id);
      return;
    }
    const t = tables.find((x) => x.id === id);
    setPendingTableDelete({ id, name: t?.name ?? 'this table' });
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
      await modelsService.updateModel(currentModel.id, { engine: engine ?? undefined });
    } catch (err) {
      console.error('Failed to update engine:', err);
    }
  };

  // ── View handlers ──
  const handleSaveView = (view: import('@/types/model').ViewModel) => {
    if (editingView) {
      updateView(view.id, view);
    } else {
      addView(view);
    }
    setShowViewForm(false);
    setEditingView(null);
  };

  const handleEditView = (id: string) => {
    const v = views.find((x) => x.id === id);
    if (v) { setEditingView(v); setShowViewForm(true); }
  };

  const handleDeleteView = (id: string) => {
    removeView(id);
    setShowViewForm(false);
    setEditingView(null);
  };

  // Aplica un modelo generado por el agente al canvas. Por consigna del
  // usuario, el primer release REEMPLAZA tablas y relaciones (no hace
  // merge incremental). Si el engine devuelto por el backend difiere del
  // configurado en el modelo, lo persistimos también.
  const handleApplyAgentModel = (response: ModelingResponse) => {
    const { tables: newTables, relationships: newRels } = modelingResponseToCanvas(response);
    setTables(newTables);
    setRelationships(newRels);
    const responseEngine = fromAgentEngine(response.engine);
    if (responseEngine !== currentModel?.engine) {
      handleUpdateEngine(responseEngine);
    }
  };



  // ── Loading state ──
  if (!loaded) {
    return (
      <AppLayout fixedViewport>
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
    <AppLayout fixedViewport>
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

          <div className="ed-spacer" />

          <div className="ed-engine-wrap">
            <span className="ed-engine-label">Engine</span>
            <EngineSelect
              value={currentModel?.engine ?? null}
              onChange={handleUpdateEngine}
              size="md"
              disabled={readOnly}
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
            onClick={() => setShowDomainManager(true)}
            type="button"
            title={readOnly ? 'Solo lectura — no se puede editar el catálogo de dominios' : 'Gestionar dominios y subdominios del modelo'}
            disabled={readOnly}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <circle cx="12" cy="4" r="2"/>
              <circle cx="20" cy="16" r="2"/>
              <circle cx="4" cy="16" r="2"/>
              <line x1="12" y1="6" x2="12" y2="9"/>
              <line x1="18.5" y1="15" x2="14" y2="13"/>
              <line x1="5.5" y1="15" x2="10" y2="13"/>
            </svg>
            Dominios
            {domainCatalog.length > 0 && (
              <span className="badge badge-primary" style={{ fontSize: '0.6rem', padding: '1px 5px' }}>{domainCatalog.length}</span>
            )}
          </button>

          <button
            className="ed-action-btn"
            onClick={() => { setEditingView(null); setShowViewForm(true); }}
            type="button"
            title={readOnly ? 'Solo lectura — no se puede crear vistas' : 'Crear una vista SQL derivada de una tabla física'}
            disabled={readOnly || tables.length === 0}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="12" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            Nueva Vista
            {views.length > 0 && (
              <span className="badge badge-neutral" style={{ fontSize: '0.6rem', padding: '1px 5px' }}>{views.length}</span>
            )}
          </button>

          <button
            className="ed-action-btn"
            onClick={() => setShowExcelImport(true)}
            type="button"
            title={readOnly ? 'Solo lectura — no se puede importar' : 'Importar tablas desde un Excel'}
            disabled={readOnly}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import Excel
          </button>

          <button
            className="ed-action-btn"
            onClick={() => setShowSqlCreate(true)}
            type="button"
            title={readOnly ? 'Solo lectura — no se puede crear tablas' : 'Crear una tabla a partir de una consulta SQL, heredando columnas de tablas existentes'}
            disabled={readOnly}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14a9 3 0 0 0 18 0V5" />
              <path d="M3 12a9 3 0 0 0 18 0" />
            </svg>
            From SQL
          </button>

          <button
            className={`ed-action-btn ed-save-btn ${isDirty ? 'dirty' : saving ? 'saving' : 'saved'}`}
            onClick={() => saveModel()}
            type="button"
            disabled={readOnly || saving || tables.length === 0}
            title={readOnly ? 'Solo lectura — no se puede guardar' : isDirty ? 'Hay cambios sin guardar' : 'Todo guardado'}
          >
            {saving ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Guardando…
              </>
            ) : isDirty ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                Guardar
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Guardado
              </>
            )}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dog.png" alt="" width="18" height="18" style={{ objectFit: 'contain', flexShrink: 0 }} />
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
              readOnly={readOnly}
            />
            {chatPanelOpen && (
              <ChatPanel
                isOpen={chatPanelOpen}
                onClose={() => setChatPanelOpen(false)}
                modelId={modelId}
                engine={currentModel?.engine ?? null}
                onApplyModel={handleApplyAgentModel}
                readOnly={readOnly}
              />
            )}
          </>
        ) : (
        <>
        {/* Left Panel — Construction Tools */}
        <aside className="editor-left-panel" style={{ width: leftPanelWidth }}>
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
                  {!readOnly && (
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
                  )}
                </div>
                <div className="editor-entities-list">
                  {tables.length === 0 ? (
                    <div className="editor-entities-empty">
                      <p>No tables yet.</p>
                      <p style={{ marginTop: 'var(--space-2)' }}>
                        Click the <strong>+</strong> button to add one, switch to the <strong>Code</strong> tab to write DBML, or use <strong>Import Excel</strong> / <strong>From SQL</strong> from the toolbar.
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
                readOnly={readOnly}
              />
            )}
          </div>
        </aside>

        {/* Drag handle to resize the left panel */}
        <LeftPanelResizer />

        {/* Canvas */}
        <DiagramCanvas
          tables={tables}
          relationships={relationships}
          views={views}
          selectedTableId={selectedTableId}
          onSelectTable={setSelectedTable}
          onEditTable={handleEditTable}
          onDeleteTable={handleDeleteTable}
          onEditView={handleEditView}
          onAddRelationship={addRelationship}
          onRemoveRelationship={removeRelationship}
        />

        {/* AI assistant side panel (only opens when explicitly toggled) */}
        {chatPanelOpen && (
          <ChatPanel
            isOpen={chatPanelOpen}
            onClose={() => setChatPanelOpen(false)}
            modelId={modelId}
            engine={currentModel?.engine ?? null}
            onApplyModel={handleApplyAgentModel}
            readOnly={readOnly}
          />
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
              domainCatalog={domainCatalog}
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

      {/* Create-from-SQL Modal */}
      <CreateFromSqlModal
        isOpen={showSqlCreate}
        existingTables={tables}
        onCreate={handleCreateFromSql}
        onCancel={() => setShowSqlCreate(false)}
      />

      {/* View Form Modal */}
      {showViewForm && (
        <div className="modal-backdrop" onClick={() => { setShowViewForm(false); setEditingView(null); }}>
          <div className="modal-content modal-large animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{editingView ? 'Editar Vista' : 'Nueva Vista SQL'}</h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Vistas derivadas de tablas físicas — con alias, expresiones SQL y filtros WHERE
                </p>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => { setShowViewForm(false); setEditingView(null); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <ViewForm
              view={editingView}
              tables={tables}
              onSave={handleSaveView}
              onCancel={() => { setShowViewForm(false); setEditingView(null); }}
              onDelete={editingView ? handleDeleteView : undefined}
            />
          </div>
        </div>
      )}

      {/* Domain Manager Modal */}
      {showDomainManager && (
        <DomainManager onClose={() => setShowDomainManager(false)} />
      )}

      {/* DDL Preview / Download Modal */}
      <DDLPreviewModal
        open={ddlScope !== null}
        onClose={() => setDdlScope(null)}
        tables={tables}
        relationships={relationships}
        defaultEngine={currentModel?.engine ?? null}
        scope={ddlScope ?? { kind: 'all' }}
      />

      <ConfirmDialog
        open={pendingTableDelete !== null}
        title="Delete table"
        message={
          pendingTableDelete ? (
            <>
              Delete <strong>{pendingTableDelete.name}</strong>? Its relationships
              will also be removed. This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        variant="danger"
        dontAskKey="model-editor:delete-table"
        onConfirm={() => {
          if (!pendingTableDelete) return;
          performTableDelete(pendingTableDelete.id);
          setPendingTableDelete(null);
        }}
        onCancel={() => setPendingTableDelete(null)}
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
