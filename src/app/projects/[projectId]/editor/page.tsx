'use client';

import React, { useEffect, useMemo, useRef, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Toaster, toast } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import Icon from '@/components/ui/Icon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ScopeControl from '@/features/diagram/components/ScopeControl';
import ERCanvas from '@/features/diagram/components/ERCanvas';
import Inspector from '@/features/diagram/components/Inspector';
import TablesListView, { type CreateKind } from '@/features/table-editor/components/TablesListView';
import TableForm from '@/features/table-editor/components/TableForm';
import CreateFromSqlModal from '@/features/table-editor/components/CreateFromSqlModal';
import DBMLModal from '@/features/table-editor/components/DBMLModal';
import ExcelImportModal from '@/features/excel-import/components/ExcelImportModal';
import ViewForm from '@/features/views/components/ViewForm';
import DDLPreviewModal from '@/features/ddl/components/DDLPreviewModal';
import { ChatPanel, ApplyToCanvasDialog, modelingResponseToCanvas, type TablePlacement, type ModelingResponse } from '@/features/chat-agent';
import { layoutByLayer, layoutCompact, arrange, type Positions, type ArrangeKind } from '@/features/diagram/layout/layouts';
import { isTableInScope, layerName, scopeLabel as buildScopeLabel } from '@/lib/hierarchy';
import { getEngine } from '@/features/engines/engines';
import { useProjectStore } from '@/store/useProjectStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { Table, Relationship, View } from '@/types/model';

interface PageProps { params: Promise<{ projectId: string }> }

type ModalState =
  | { type: 'table'; table: Table | null }
  | { type: 'view'; table: Table; view: View | null }
  | { type: 'fromsql' }
  | { type: 'dbml' }
  | { type: 'excel' }
  | { type: 'ddl' }
  | { type: 'applyAgent'; result: ModelingResponse }
  | { type: 'confirm'; title: string; message: string; onConfirm: () => void }
  | null;

const pushToast = (msg: string, kind?: 'err') => (kind === 'err' ? toast.error(msg) : toast.success(msg));

export default function EditorPage({ params }: PageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    currentProject, tables, relationships, scope, loading,
    loadProject, setScope, persistCanvas,
    addTable, updateTable, removeTable, setTables,
    addRelationship, removeRelationship, setRelationships, saveView, removeView,
  } = useProjectStore();
  const canEdit = useAuthStore((s) => s.canEditProject(projectId));

  const [positions, setPositions] = useState<Positions>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<'canvas' | 'list'>('canvas');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [saved, setSaved] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  const initRef = useRef(false);
  const saveSkip = useRef(true);

  const layers = currentProject?.layers ?? [];
  const domains = currentProject?.domains ?? [];
  const engineDef = getEngine(currentProject?.engines[0]);

  useEffect(() => { loadProject(projectId); }, [projectId, loadProject]);

  // Seed positions + initial scope once the project is loaded.
  useEffect(() => {
    if (!currentProject || initRef.current) return;
    initRef.current = true;
    const base = layoutByLayer(tables, currentProject.layers);
    const next: Positions = {};
    tables.forEach((t) => { next[t.id] = t.position ?? base[t.id] ?? { x: 100, y: 100 }; });
    setPositions(next);

    const allL = currentProject.layers.map((l) => l.id);
    const allD = currentProject.domains.map((d) => d.id);
    const layerParam = searchParams.get('layer');
    const domainParam = searchParams.get('domain');
    if (layerParam) setScope({ layers: [layerParam], domains: allD });
    else if (domainParam) setScope({ layers: allL, domains: [domainParam] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject]);

  // Debounced autosave of the canvas (tables + relationships).
  useEffect(() => {
    if (saveSkip.current) { saveSkip.current = false; return; }
    setSaved(false);
    const t = setTimeout(async () => { await persistCanvas(); setSaved(true); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, relationships]);

  const allLayerCount = layers.length;
  const allDomainCount = domains.length;
  const isInScope = (t: Table) => isTableInScope(t, scope, allLayerCount, allDomainCount);
  const scopedTables = useMemo(() => tables.filter(isInScope), [tables, scope, allLayerCount, allDomainCount]);
  const scopedIds = useMemo(() => new Set(scopedTables.map((t) => t.id)), [scopedTables]);
  const scopedRels = useMemo(() => relationships.filter((r) => scopedIds.has(r.source.table) && scopedIds.has(r.target.table)), [relationships, scopedIds]);

  const selected = selectedId && scopedIds.has(selectedId) ? tables.find((t) => t.id === selectedId) ?? null : null;

  // ── handlers ──
  const handleSelect = (id: string | null) => { setSelectedId(id); if (id) setInspectorOpen(true); };

  const onMove = (id: string, p: { x: number; y: number }) => setPositions((prev) => ({ ...prev, [id]: p }));

  const onArrange = (kind: ArrangeKind) => {
    const p = arrange(kind, scopedTables, layers, relationships);
    setPositions((prev) => ({ ...prev, ...p }));
  };

  const onCreateRel = (rel: Relationship) => {
    const sT = tables.find((t) => t.id === rel.source.table);
    const tT = tables.find((t) => t.id === rel.target.table);
    if (!sT || !tT) return;
    const gap = (() => { // layerGap inline via scopeLabel helper not needed; compute
      const order: Record<string, number> = {}; layers.forEach((l, i) => { order[l.id] = l.order ?? i; });
      const x = sT.layer ? order[sT.layer] : undefined; const y = tT.layer ? order[tT.layer] : undefined;
      return x == null || y == null ? 0 : Math.abs(x - y);
    })();
    const tcol = tT.columns.find((c) => c.id === rel.target.column);
    // Safe autoset (Feature 4): the SOURCE column references the target, so it
    // becomes the FK. We never rebuild the target's PK (it may be composite) —
    // we only validate it and warn. `...c` preserves any manual FK pin.
    updateTable(sT.id, { columns: sT.columns.map((c) => (c.id === rel.source.column ? { ...c, isForeignKey: true, foreignKeyRef: { table: tT.id, column: tcol?.name ?? '' } } : c)) });
    addRelationship({ ...rel, crossLayer: gap > 0, skip: gap > 1 });
    if (gap > 1) pushToast(`Relación cruza modelos no adyacentes (${layerName(layers, sT.layer)} → ${layerName(layers, tT.layer)}) — revisar`, 'err');
    else if (gap === 1) pushToast(`Relación cross-layer ${layerName(layers, sT.layer)} → ${layerName(layers, tT.layer)} creada`);
    else pushToast('Relación creada');
    // The referenced (target) column should be a PK or unique key; warn if not.
    if (!(tcol && (tcol.isPrimaryKey || tcol.isUnique)))
      pushToast(`El destino ${tT.name}.${tcol?.name ?? '—'} no es PK ni clave única — revisá la dirección`, 'err');
  };

  const doDeleteRel = (rel: Relationship) => {
    removeRelationship(rel.id);
    // Clear the FK flag on the source column unless another relationship still uses it,
    // so the column (and the generated DDL) stays consistent with the canvas.
    const stillUsed = relationships.some(
      (r) => r.id !== rel.id && r.source.table === rel.source.table && r.source.column === rel.source.column,
    );
    if (!stillUsed) {
      const sT = tables.find((t) => t.id === rel.source.table);
      const col = sT?.columns.find((c) => c.id === rel.source.column);
      // Only clear an auto-set FK — never one the user pinned by hand (fkManual).
      if (sT && col && !col.fkManual) updateTable(sT.id, { columns: sT.columns.map((c) => (c.id === rel.source.column ? { ...c, isForeignKey: false, foreignKeyRef: undefined } : c)) });
    }
    pushToast('Relación eliminada');
  };

  const onDeleteRel = (rel: Relationship) => {
    const sT = tables.find((t) => t.id === rel.source.table);
    const tT = tables.find((t) => t.id === rel.target.table);
    const what = sT && tT ? `${sT.name} → ${tT.name} (${rel.cardinality})` : 'esta relación';
    setModal({ type: 'confirm', title: '¿Eliminar relación?', message: `Se eliminará la relación ${what}. No se puede deshacer.`, onConfirm: () => doDeleteRel(rel) });
  };

  const onGear = (id: string, action: 'edit' | 'color' | 'delete', payload?: string) => {
    const t = tables.find((x) => x.id === id);
    if (!t) return;
    if (action === 'edit') setModal({ type: 'table', table: t });
    else if (action === 'color') updateTable(id, { color: payload });
    else if (action === 'delete') setModal({ type: 'confirm', title: `¿Eliminar ${t.name}?`, message: 'Quita la tabla y sus relaciones. No se puede deshacer.', onConfirm: () => { removeTable(id); setPositions((p) => { const n = { ...p }; delete n[id]; return n; }); if (selectedId === id) setSelectedId(null); } });
  };

  const saveTable = (table: Table, isNew: boolean) => {
    if (isNew) {
      addTable(table);
      setPositions((p) => ({ ...p, [table.id]: p[table.id] ?? { x: 160 + Math.random() * 120, y: 140 + Math.random() * 80 } }));
      pushToast('Tabla creada');
    } else {
      updateTable(table.id, table);
      pushToast('Tabla guardada');
    }
    setModal(null);
  };

  const createFromSQL = (built: { table: Table; rels: Relationship[] }) => {
    addTable(built.table);
    built.rels.forEach(addRelationship);
    setPositions((p) => ({ ...p, [built.table.id]: { x: 180, y: 160 } }));
    setSelectedId(built.table.id);
    setInspectorOpen(true);
    setModal(null);
    pushToast(`Creada ${built.table.name} · ${built.table.columns.length} columnas`);
  };

  const applyDBML = (parsed: { tables: Table[]; relationships: Relationship[] }) => {
    setTables(parsed.tables);
    setRelationships(parsed.relationships);
    setPositions(layoutCompact(parsed.tables));
    setModal(null);
    pushToast(`Aplicadas ${parsed.tables.length} tablas desde DBML`);
  };

  const importExcel = (newTables: Table[]) => {
    const all = [...tables, ...newTables];
    setTables(all);
    setPositions(layoutByLayer(all, layers));
    setModal(null);
    pushToast(`Importadas ${newTables.length} tablas`);
  };

  // Merge the AI agent's result into the project at the chosen placement.
  // Tables matching by name are updated in place; new ones are added. FK
  // relationships are derived and de-duped against the existing graph.
  const applyAgentModel = (result: ModelingResponse, placement: TablePlacement) => {
    const { tables: finalTables, relationships: derived } = modelingResponseToCanvas(result, placement, tables);
    const relKey = (r: Relationship) => `${r.source.table}:${r.source.column}->${r.target.table}:${r.target.column}`;
    const existingKeys = new Set(relationships.map(relKey));
    const newRels = derived.filter((r) => !existingKeys.has(relKey(r)));
    setTables(finalTables);
    if (newRels.length) setRelationships([...relationships, ...newRels]);
    setPositions((prev) => {
      const base = layoutByLayer(finalTables, layers);
      const next = { ...prev };
      finalTables.forEach((t) => { if (!next[t.id]) next[t.id] = t.position ?? base[t.id] ?? { x: 140, y: 140 }; });
      return next;
    });
    const n = result.tables.length;
    const domNm = domains.find((d) => d.id === placement.domain)?.name;
    pushToast(`Aplicadas ${n} tabla${n === 1 ? '' : 's'}${domNm ? ` en ${domNm}` : ''}`);
    setModal(null);
  };

  const onCreate = (kind: CreateKind) => {
    if (kind === 'table') setModal({ type: 'table', table: null });
    else setModal({ type: kind });
  };

  if (!currentProject && loading) {
    return <AppLayout><div className="dmh-main"><Header crumbs={[{ label: 'Projects', href: '/projects' }, { label: '…' }]} /><div className="dmh-page"><div className="rd-small">Cargando editor…</div></div></div></AppLayout>;
  }
  if (!currentProject) {
    return <AppLayout><div className="dmh-main"><Header crumbs={[{ label: 'Projects', href: '/projects' }, { label: 'No encontrado' }]} /><div className="dmh-page"><div className="dmh-empty">Proyecto no encontrado.</div></div></div></AppLayout>;
  }

  const scopedModel = { tables: scopedTables, relationships: scopedRels, positions, layers, domains };
  const scopeText = buildScopeLabel({ layers, domains }, scope);

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
          <button className="rd-btn rd-btn-sm" style={{ background: 'var(--accent2)', color: '#fff' }} onClick={() => setChatOpen((o) => !o)} aria-pressed={chatOpen}><Icon name="sparkles" size={14} />AI Agent</button>
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
            <div className="lv">
              <div className="lv-grid">
                {scopedTables.map((t) => (
                  <div className="lv-card" key={t.id} onClick={() => setModal({ type: 'table', table: t })}>
                    <div className="lv-card-head">
                      <span className="lv-card-ico" style={{ background: (t.color ?? '#4f46e5') + '1a', color: t.color }}><Icon name="table" size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800 }}>{t.schema}.{t.name}</div>
                        <div className="rd-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.functionalDefinition || '—'}</div>
                      </div>
                      {t.layer && <span className="ed-layer-pill" style={{ color: layers.find((l) => l.id === t.layer)?.color, borderColor: layers.find((l) => l.id === t.layer)?.color }}>{layerName(layers, t.layer)}</span>}
                    </div>
                    {t.columns.slice(0, 5).map((c) => {
                      const k = c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : c.isSurrogateKey ? 'SK' : c.isPartitionKey ? 'PT' : '';
                      return (
                        <div className="lv-col" key={c.id}>
                          {k ? <span className={`rd-key ${k.toLowerCase()}`} style={{ minWidth: 19, height: 16, fontSize: 8.5 }}>{k}</span> : <span className="rd-key none"><span className="d" /></span>}
                          <span className="nm">{c.name}</span><span className="ty">{c.dataType}</span>
                        </div>
                      );
                    })}
                    {t.columns.length > 5 && <div className="lv-col" style={{ color: 'var(--subtle)', fontWeight: 600 }}>+{t.columns.length - 5} más</div>}
                  </div>
                ))}
              </div>
            </div>
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
      {modal?.type === 'ddl' && <DDLPreviewModal scopedTables={scopedTables} allTables={tables} scopeLabel={scopeText} engineLabel={engineDef?.label ?? ''} engine={currentProject.engines[0]} modelName={currentProject.name} onClose={() => setModal(null)} pushToast={pushToast} />}
      {modal?.type === 'applyAgent' && <ApplyToCanvasDialog result={modal.result} layers={layers} domains={domains} scope={scope} onClose={() => setModal(null)} onApply={(placement) => applyAgentModel(modal.result, placement)} />}

      {/* AI modeler chat — right-side drawer (decoupled agent service :8001) */}
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        projectId={projectId}
        engine={currentProject.engines[0]}
        onApplyModel={(result) => setModal({ type: 'applyAgent', result })}
        readOnly={!canEdit}
      />

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
