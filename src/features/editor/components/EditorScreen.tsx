'use client';

import React from 'react';
import { Toaster } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import Icon from '@/components/ui/Icon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { ScopeControl, ERCanvas, Inspector } from '@/features/diagram';
import { TablesListView, TableForm, CreateFromSqlModal, DBMLModal } from '@/features/table-editor';
import { ExcelImportModal } from '@/features/excel-import';
import { ViewForm } from '@/features/views';
import { DDLPreviewModal } from '@/features/ddl';
import { useEditorController, pushToast } from '../hooks/useEditorController';
import EditorListView from './EditorListView';

export interface EditorScreenProps {
  projectId: string;
}

/** The project editor: scope-driven single canvas + rail + inspector + modals. */
export default function EditorScreen({ projectId }: EditorScreenProps) {
  const c = useEditorController(projectId);
  const {
    currentProject, loading, layers, domains, engineDef, scope, setScope,
    scopedTables, scopedRels, scopedModel, scopeText, isInScope, tables, relationships,
    selectedId, selected, handleSelect, mainView, setMainView,
    inspectorOpen, setInspectorOpen, saved, canEdit,
    modal, setModal,
    onMove, onArrange, onCreateRel, onDeleteRel, onGear,
    saveTable, createFromSQL, applyDBML, importExcel, onCreate,
    saveView, removeView,
  } = c;

  if (!currentProject && loading) {
    return <AppLayout><div className="dmh-main"><Header crumbs={[{ label: 'Projects', href: '/projects' }, { label: '…' }]} /><div className="dmh-page"><div className="rd-small">Cargando editor…</div></div></div></AppLayout>;
  }
  if (!currentProject) {
    return <AppLayout><div className="dmh-main"><Header crumbs={[{ label: 'Projects', href: '/projects' }, { label: 'No encontrado' }]} /><div className="dmh-page"><div className="dmh-empty">Proyecto no encontrado.</div></div></div></AppLayout>;
  }

  const engine = currentProject.engines[0];

  return (
    <AppLayout>
      <div className="dmh-main">
        <Header crumbs={[{ label: currentProject.name, href: `/projects/${projectId}` }, { label: scopeText }]}>
          {engineDef && <span className="rd-engine" style={{ marginLeft: 6 }}><span className="dot" style={{ background: engineDef.color }} />{engineDef.shortLabel}</span>}
          <ScopeControl layers={layers} domains={domains} scope={scope} setScope={setScope} />
          <div style={{ flex: 1 }} />
          <div className="rd-seg">
            <button className={mainView === 'list' ? 'active' : ''} onClick={() => setMainView('list')}><Icon name="list" size={14} />List</button>
            <button className={mainView === 'canvas' ? 'active' : ''} onClick={() => setMainView('canvas')}><Icon name="columns" size={14} />Canvas</button>
          </div>
          <span className="dmh-sep" />
          <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={() => setModal({ type: 'ddl' })}><Icon name="download" size={14} />Export</button>
          <span className="dmh-sep" />
          <span className="rd-badge" style={{ background: 'transparent', color: saved ? 'var(--success)' : 'var(--muted)', gap: 5 }}>{saved ? <><Icon name="check" size={13} sw={2.5} />Saved</> : <><Icon name="save" size={13} />Saving…</>}</span>
        </Header>

        <div className="ed">
          <TablesListView
            scopedTables={scopedTables}
            scopedRels={scopedRels}
            layers={layers}
            domains={domains}
            selectedId={selectedId}
            onSelect={handleSelect}
            onEditTable={(t) => setModal({ type: 'table', table: t })}
            onCreate={onCreate}
            canEdit={canEdit}
          />

          {mainView === 'canvas' ? (
            <ERCanvas
              model={scopedModel}
              selectedId={selectedId}
              onSelect={handleSelect}
              onMove={onMove}
              onCreateRel={onCreateRel}
              onDeleteRel={onDeleteRel}
              onArrange={onArrange}
              onGear={onGear}
              pushToast={pushToast}
            />
          ) : (
            <EditorListView scopedTables={scopedTables} layers={layers} onEditTable={(t) => setModal({ type: 'table', table: t })} />
          )}

          {inspectorOpen && selected && (
            <Inspector
              table={selected}
              tables={tables}
              relationships={relationships}
              layers={layers}
              domains={domains}
              engineShort={engineDef?.shortLabel}
              onClose={() => setInspectorOpen(false)}
              onEditTable={(t) => setModal({ type: 'table', table: t })}
              onNewView={(t) => setModal({ type: 'view', table: t, view: null })}
              onEditView={(t, v) => setModal({ type: 'view', table: t, view: v })}
              onDeleteView={(t, v) => setModal({ type: 'confirm', title: '¿Eliminar vista?', message: `Se eliminará la vista ${v.name}. No se puede deshacer.`, onConfirm: () => { removeView(t.id, v.id); pushToast('Vista eliminada'); } })}
              onDeleteRel={onDeleteRel}
              onExportDDL={() => setModal({ type: 'ddl' })}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {modal?.type === 'table' && <TableForm table={modal.table} layers={layers} domains={domains} tables={tables} onClose={() => setModal(null)} onSave={saveTable} />}
      {modal?.type === 'fromsql' && <CreateFromSqlModal tables={tables} scope={scope} isInScope={isInScope} layers={layers} domains={domains} onClose={() => setModal(null)} onCreate={createFromSQL} pushToast={pushToast} />}
      {modal?.type === 'dbml' && <DBMLModal tables={tables} onClose={() => setModal(null)} onApply={applyDBML} pushToast={pushToast} />}
      {modal?.type === 'excel' && <ExcelImportModal meta={{ layer: scope.layers.length === 1 ? scope.layers[0] : layers[0]?.id, domain: scope.domains.length === 1 ? scope.domains[0] : undefined, color: domains.find((d) => d.id === (scope.domains.length === 1 ? scope.domains[0] : ''))?.color }} onClose={() => setModal(null)} onImport={importExcel} pushToast={pushToast} />}
      {modal?.type === 'view' && <ViewForm table={modal.table} view={modal.view} onClose={() => setModal(null)} onSave={(v, isNew) => { saveView(modal.table.id, v); setModal(null); pushToast(isNew ? 'Vista creada' : 'Vista guardada'); }} />}
      {modal?.type === 'ddl' && <DDLPreviewModal scopedTables={scopedTables} allTables={tables} scopeLabel={scopeText} engineLabel={engineDef?.label ?? ''} engine={engine} modelName={currentProject.name} onClose={() => setModal(null)} pushToast={pushToast} />}

      <ConfirmDialog
        open={modal?.type === 'confirm'}
        title={modal?.type === 'confirm' ? modal.title : ''}
        message={modal?.type === 'confirm' ? modal.message : ''}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (modal?.type === 'confirm') modal.onConfirm(); setModal(null); }}
        onCancel={() => setModal(null)}
      />

      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </AppLayout>
  );
}
