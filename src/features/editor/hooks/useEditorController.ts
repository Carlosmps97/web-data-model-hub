'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { layoutByLayer, layoutCompact, arrange, type Positions, type ArrangeKind } from '@/features/diagram';
import type { CreateKind } from '@/features/table-editor';
import { isTableInScope, layerName, scopeLabel as buildScopeLabel } from '@/lib/hierarchy';
import { getEngine } from '@/features/engines';
import { useProjectStore } from '@/store/useProjectStore';
import type { Table, Relationship, View } from '@/types/model';

export type ModalState =
  | { type: 'table'; table: Table | null }
  | { type: 'view'; table: Table; view: View | null }
  | { type: 'fromsql' }
  | { type: 'dbml' }
  | { type: 'excel' }
  | { type: 'ddl' }
  | { type: 'confirm'; title: string; message: string; onConfirm: () => void }
  | null;

export const pushToast = (msg: string, kind?: 'err') => (kind === 'err' ? toast.error(msg) : toast.success(msg));

/**
 * The editor's controller: owns canvas/scope/modal state, the debounced
 * autosave, and every mutation handler for a single project's canvas. The
 * `EditorScreen` is a pure consumer of this hook — keeping orchestration logic
 * separate from layout.
 */
export function useEditorController(projectId: string) {
  const [searchParams] = useSearchParams();

  const {
    currentProject, tables, relationships, scope, loading,
    loadProject, setScope, persistCanvas,
    addTable, updateTable, removeTable, setTables,
    addRelationship, removeRelationship, setRelationships, saveView, removeView,
  } = useProjectStore();
  // MVP abierto: edición sin permisos (la matriz de permisos vuelve al final).
  const canEdit = true;

  const [positions, setPositions] = useState<Positions>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<'canvas' | 'list'>('canvas');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [saved, setSaved] = useState(true);

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

  const onCreate = (kind: CreateKind) => {
    if (kind === 'table') setModal({ type: 'table', table: null });
    else setModal({ type: kind });
  };

  const scopedModel = { tables: scopedTables, relationships: scopedRels, positions, layers, domains };
  const scopeText = buildScopeLabel({ layers, domains }, scope);

  return {
    // project / scope
    projectId, currentProject, loading, layers, domains, engineDef, scope, setScope,
    scopedTables, scopedRels, scopedModel, scopeText, isInScope,
    tables, relationships,
    // selection / layout state
    selectedId, selected, handleSelect, mainView, setMainView,
    inspectorOpen, setInspectorOpen, saved, canEdit,
    // modal state machine
    modal, setModal,
    // handlers
    onMove, onArrange, onCreateRel, onDeleteRel, onGear,
    saveTable, createFromSQL, applyDBML, importExcel, onCreate,
    saveView, removeView,
  };
}
