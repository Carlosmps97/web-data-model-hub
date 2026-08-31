import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDownUp, Eye, Pencil, Table2, Trash2 } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { pushUndo } from '@/store/useUndoStore';
import AuditHistory from './AuditHistory';
import UdpAssign from './UdpAssign';
import { useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/features/governance/services/governance.service';
import { matchesColumn } from '../lib/columnSearch';
import { pkInKeyOrder, reorderKey } from '../lib/keyOrder';
import { alignSourcesToPhysical } from '../lib/viewSync';
import { ColumnRow } from './ColumnEditor';
import SchemaSelect from './SchemaSelect';
import ViewEditor from './ViewEditor';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';

// Doc 51: los UDPs dejan Metadata y pasan a pestaña propia (paridad con el
// panel de columna del doc 49); Metadata conserva el resto y suma History.
type Tab = 'definition' | 'columns' | 'views' | 'links' | 'udps' | 'metadata';
const TABS: { id: Tab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'views', label: 'Views' },
  { id: 'links', label: 'Links' },
  { id: 'udps', label: 'UDPs' },
  { id: 'metadata', label: 'Metadata' },
];

// Etiqueta compacta por extremo (diseño pp3: "1 : N · identifying").
const CARD_LBL: Record<gov.Cardinality, string> = {
  one: '1', 'one-only': '1', 'zero-one': '0..1', many: 'N', 'one-many': '1..N', 'zero-many': '0..N',
};

/**
 * Panel lateral de propiedades (diseño p8 + pp1–pp4): header con glyph navy +
 * "schema X · table", 5 pestañas SUBRAYADAS (underline, no pill) con contador
 * en Columns/Views, y cuerpo scrolleable. En read-only (sin changeset activo)
 * el panel abre igual pero como reader: inputs deshabilitados y sin acciones.
 */
export default function PropertiesPanel({ pushToast, onResize }: { pushToast: (m: string, k?: 'err') => void; onResize?: (width: number) => void }) {
  // Selectores individuales (no el store entero): el panel vive junto al canvas
  // y suscribirse a TODO el store lo re-renderizaba en cada hover/drag/dirty.
  const diagram = useModelerStore((s) => s.diagram);
  const selectedTableId = useModelerStore((s) => s.selectedTableId);
  const setSelectedTable = useModelerStore((s) => s.setSelectedTable);
  const reload = useModelerStore((s) => s.reload);
  const reorderColumns = useModelerStore((s) => s.reorderColumns);
  // Doc 49: el click en una fila abre el Properties de ESA columna (sidebar
  // propio) — la edición inline (fila expandida) se retiró de este panel.
  const setSelectedColumn = useModelerStore((s) => s.setSelectedColumn);
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  const removeTableFromArea = useModelerStore((s) => s.removeTableFromArea);
  const deleteTable = useModelerStore((s) => s.deleteTable);
  // En modo visor puede haber changeset activo (viendo un request desde Review):
  // el panel abre como reader igual que sin changeset.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  const table = diagram?.tables.find((t) => t.id === selectedTableId) ?? null;
  const cols = useMemo(
    () => (diagram?.columns ?? []).filter((c) => c.tableId === selectedTableId).slice().sort((a, b) => a.ordinal - b.ordinal),
    [diagram, selectedTableId],
  );
  const links = useMemo(
    () => (diagram?.relationships ?? []).filter((r) => r.parentTableId === selectedTableId || r.childTableId === selectedTableId),
    [diagram, selectedTableId],
  );

  const [tab, setTab] = useState<Tab>('definition');

  // ── Definition: form local de la tabla ──
  const [form, setForm] = useState({ logicalName: '', physicalName: '', schema: '', description: '' });
  const [savingDef, setSavingDef] = useState(false);
  useEffect(() => {
    if (table) setForm({ logicalName: table.logicalName, physicalName: table.physicalName, schema: table.schema ?? '', description: table.description ?? '' });
    setColQuery('');   // el buscador de columnas no arrastra el filtro a OTRA tabla
    // Re-sembrar SOLO al cambiar de tabla (doc 40): con deps por identidad,
    // cualquier reload del diagrama (guardar un UDP, blur de la definición)
    // pisaba lo que el usuario tenía a medio tipear en este form.
  }, [table?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── DnD reorder (HTML5 nativo) ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [after, setAfter] = useState(false);

  // Reorden persistiéndose en background (la lista ya se movió de forma optimista).
  const [reordering, setReordering] = useState(false);
  // Quitar del canvas / borrar la tabla: mientras corre, spinner en el botón y
  // ambos deshabilitados (el borrado tarda; evita reclicks — pedido owner).
  const [delBusy, setDelBusy] = useState<'remove' | 'delete' | null>(null);
  // Drag del handle para ensanchar el panel (solo-vista; nombres largos).
  const [resizing, setResizing] = useState(false);

  // ── Views (pp2) — se cargan al seleccionar la tabla para el contador del tab ──
  const [views, setViews] = useState<View[]>([]);
  const [viewEditor, setViewEditor] = useState<{ view?: View; readOnly?: boolean } | null>(null);
  const reloadViews = () => { if (selectedTableId) viewsSvc.listViews(selectedTableId).then(setViews).catch(() => {}); };
  useEffect(() => {
    if (selectedTableId) viewsSvc.listViews(selectedTableId).then(setViews).catch(() => setViews([]));
    else setViews([]);
  }, [selectedTableId]);

  // ── Orden de la LLAVE (pkPosition, doc 19 §12b) + alineado de vistas (V2) ──
  // (hooks ANTES del early-return de abajo — el orden de hooks es fijo)
  const keyPks = useMemo(() => pkInKeyOrder(cols), [cols]);
  const [keyBusy, setKeyBusy] = useState(false);
  // Buscador de columnas (doc 42): contiene CI sobre lógico/físico. Con
  // filtro activo el drag&drop se desactiva (ver comentario en el render).
  const [colQuery, setColQuery] = useState('');
  const colFiltering = colQuery.trim() !== '';
  const visibleCols = useMemo(
    () => (colFiltering ? cols.filter((c) => matchesColumn(c, colQuery)) : cols),
    [cols, colQuery, colFiltering],
  );
  const [aligningId, setAligningId] = useState<string | null>(null);
  // Deep-link al listado (doc 48, ajustado en doc 49): pestaña Columns con la
  // fila A LA VISTA (scroll, ya sin expandir — la edición vive en el panel de
  // columna). Hoy lo produce el botón Back del ColumnPropertiesPanel. Se
  // limpia el buscador (podría ocultarla) y el foco se CONSUME (una sola
  // navegación; después el usuario recupera el control).
  const panelFocusColId = useModelerStore((s) => s.panelFocusColId);
  useEffect(() => {
    if (!panelFocusColId) return;
    setTab('columns');
    setColQuery('');
    const id = panelFocusColId;
    // Doble rAF (patrón focusTable): scroll recién con la card montada y medida.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`[data-colid="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    }));
    useModelerStore.getState().setPanelFocusCol(null);
  }, [panelFocusColId]);
  // ── Metadata (V3): dónde se usa la tabla (proyecto › carpeta › canvas) ──
  const [usage, setUsage] = useState<gov.TableUsageRow[] | null>(null);
  useEffect(() => {
    setUsage(null);
    if (selectedTableId) gov.tableUsage(selectedTableId).then((u) => setUsage(u.usage)).catch(() => setUsage([]));
  }, [selectedTableId]);
  // ── Links: relaciones GLOBALES de la tabla (es canónica — las de otros
  // canvases no están en el diagrama actual; llegan con nombres resueltos).
  // Se refresca también al cambiar el diagrama: dibujar/borrar un wire acá
  // mueve relaciones entre las secciones "this canvas"/"other canvases". ──
  const [allLinks, setAllLinks] = useState<gov.TableLinkRow[] | null>(null);
  useEffect(() => { setAllLinks(null); }, [selectedTableId]);
  useEffect(() => {
    if (!selectedTableId) return;
    let alive = true;
    gov.tableLinks(selectedTableId)
      .then((r) => { if (alive) setAllLinks(r.links); })
      .catch(() => { if (alive) setAllLinks([]); });
    return () => { alive = false; };
  }, [selectedTableId, diagram]);

  if (!table) return null;

  const lookup = (id: string) => diagram?.tables.find((t) => t.id === id);
  const tableName = (id: string) => { const t = lookup(id); return t?.physicalName || t?.logicalName || id; };
  const colName = (id: string) => diagram?.columns.find((c) => c.id === id)?.physicalName ?? id;
  const counts: Partial<Record<Tab, number>> = { columns: cols.length, views: views.length };
  // parents = relaciones donde esta tabla es HIJA (la otra es su padre).
  const parents = links.filter((r) => r.childTableId === table.id).length;
  const children = links.length - parents;

  // Pre-imagen POR VALOR de la tabla para el Undo (doc 50) — común a los tres
  // caminos de guardado de abajo (Save, blur de la definición, UDP).
  const tablePre = () => ({ ...table, ...(table.udpValues ? { udpValues: { ...table.udpValues } } : {}) });

  const saveDef = async () => {
    setSavingDef(true);
    const pre = tablePre();
    try {
      const logical = form.logicalName.trim();
      let physical = form.physicalName.trim();
      // Si cambió el LÓGICO y el físico NO se editó a mano (sigue igual al
      // original), re-derivar el físico del nuevo lógico — consistente con las
      // columnas y el alta de tabla (antes la tabla dejaba el físico obsoleto).
      if (logical && logical !== table.logicalName && physical === table.physicalName) {
        try { physical = (await gov.physicalize(logical, 'table')).physical; } catch { /* mantener el actual */ }
      }
      // `updateTable` sólo cubre name/schema; un único upsert changeset-aware (merge
      // sobre la tabla actual) cubre además `description`, y luego reload.
      await gov.createTable({ ...table, logicalName: logical, physicalName: physical, schema: form.schema.trim() || undefined, description: form.description.trim() || undefined });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await reload(); });
      // El form ya no se re-siembra en cada reload (solo al cambiar de tabla):
      // reflejar acá el físico derivado para que el input no quede stale.
      setForm((f) => ({ ...f, logicalName: logical, physicalName: physical }));
      await reload();
      pushToast('Table updated');
    // Propaga el motivo real (p.ej. 409: la versión ya no está en borrador) en
    // vez de un "Couldn't save" genérico que esconde POR QUÉ no se guardó.
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'); }
    finally { setSavingDef(false); }
  };
  const derivePhysical = async () => {
    try { const p = (await gov.physicalize(form.logicalName.trim(), 'table')).physical; setForm((f) => ({ ...f, physicalName: p })); }
    catch { pushToast("Couldn't derive the physical name", 'err'); }
  };
  // Definición funcional: auto-guardado al salir del campo (doc 40), mismo
  // paradigma que la definición de columna — antes cerrar el panel sin Save la
  // perdía. Los NOMBRES y el schema siguen detrás del botón Save: un rename es
  // transaccional (re-deriva el físico, re-apunta vistas, valida unicidad) y
  // no debe dispararse a medio tipear. `...table` usa los nombres del server:
  // un nombre a medio editar en el form NO viaja con este blur.
  const saveDescriptionOnBlur = async () => {
    if (!canEdit || !table) return;
    const next = form.description.trim() || undefined;
    if ((table.description ?? undefined) === next) return;
    const pre = tablePre();
    try {
      await gov.createTable({ ...table, description: next });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await reload(); });
      await reload();
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'); }
  };
  const saveTableUdp = async (next: Record<string, string>) => {
    if (!table) return;
    const pre = tablePre();
    try {
      await gov.createTable({ ...table, udpValues: next });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await reload(); });
      await reload();
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save UDP", 'err'); }
  };

  // ── Orden de la LLAVE (pkPosition) — mover una PK dentro de la llave ──
  const moveKey = async (id: string, dir: -1 | 1) => {
    const plan = reorderKey(cols, id, dir);
    if (!plan.length) return;
    setKeyBusy(true);
    try {
      const byId = new Map(cols.map((c) => [c.id, c]));
      // Pre-imágenes de las columnas tocadas, para el Undo (doc 50).
      const pres: typeof cols = [];
      for (const step of plan) {
        const col = byId.get(step.id);
        if (col && (col.pkPosition ?? null) !== step.pkPosition) {
          pres.push({ ...col });
          await gov.updateColumn({ ...col, pkPosition: step.pkPosition });
        }
      }
      if (pres.length) {
        pushUndo('Reorder key', async () => {
          for (const c of pres) await gov.updateColumn(c);
          await reload();
        });
      }
      await reload();
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't reorder the key", 'err'); }
    finally { setKeyBusy(false); }
  };

  // ── V2 (doc 19 §12b): "Match physical order" — reordena los sources de la
  // vista según el orden físico (ordinal) de cada tabla fuente. Idea del
  // equipo (Erwin no lo tiene). Las columnas no resolubles (expresiones)
  // conservan su orden relativo al final de su grupo.
  const alignView = async (v: View) => {
    // Confirmación previa (pedido owner): reordenar reescribe la definición de
    // la vista → popup Aceptar/Cancelar antes de ejecutar.
    const ok = await confirmDialog({
      title: 'Reorder view columns',
      message: <>The columns of view <strong>“{v.name}”</strong> will be reordered to match the physical order of its source table(s). This rewrites the view definition.</>,
      confirmLabel: 'Reorder',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    setAligningId(v.id);
    try {
      const srcIds = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : [table.id]);
      const colsByTable = new Map<string, gov.CanonicalColumn[]>();
      for (const tid of srcIds) {
        const list = tid === table.id ? cols : await gov.listColumns(tid);
        colsByTable.set(tid, list.slice().sort((a, b) => a.ordinal - b.ordinal));
      }
      await viewsSvc.updateView(v.id, { ...v, sources: alignSourcesToPhysical(v, colsByTable) });
      reloadViews();
      void reload();
      pushToast('View reordered to match the physical order of its table(s)');
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't reorder the view", 'err'); }
    finally { setAligningId(null); }
  };
  // DnD: al pasar por encima decide si el drop va antes/después según la mitad del row.
  const handleDragOver = (id: string, e: React.DragEvent) => {
    e.preventDefault();
    if (id === dragId) { setOverId(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setOverId(id);
    setAfter(e.clientY > r.top + r.height / 2);
  };
  const handleDrop = async (targetId: string) => {
    const src = dragId; const wasAfter = after;
    setDragId(null); setOverId(null);
    // Con filtro activo NO se reordena (doc 42): el splice de abajo trabaja
    // sobre la lista COMPLETA y un drop calculado sobre el subconjunto visible
    // insertaría en una posición equivocada. El grip ya viene deshabilitado;
    // este guard es el cinturón por si un drag nació antes de filtrar.
    if (!src || src === targetId || reordering || colFiltering) return;
    const ids = cols.map((c) => c.id).filter((x) => x !== src);
    let idx = ids.indexOf(targetId);
    if (idx < 0) return;
    if (wasAfter) idx += 1;
    ids.splice(idx, 0, src);
    setReordering(true);
    try { await reorderColumns(table.id, ids); }
    catch { pushToast("Couldn't reorder", 'err'); }
    finally { setReordering(false); }
  };

  // ── Quitar del canvas / borrar la tabla (versionado + popup de impacto) ──
  const removeFromCanvas = async () => {
    if (delBusy) return;
    setDelBusy('remove');
    try {
      const ok = await confirmDialog({
        title: 'Remove from canvas',
        message: <>Remove <strong>“{table.physicalName || table.logicalName}”</strong> from this canvas? The table and its data stay in the model — you can add it back later.</>,
        confirmLabel: 'Remove', cancelLabel: 'Cancel',
        // El diálogo queda con spinner y bloqueado hasta que termina (no cierra
        // ni deja re-clickear mientras se aplica).
        action: async () => { await removeTableFromArea(table.id); },
      });
      if (ok) pushToast('Table removed from this canvas');
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't remove the table", 'err'); }
    finally { setDelBusy(null); }
  };
  const askDeleteTable = async () => {
    if (delBusy) return;
    setDelBusy('delete');
    try {
      // Impacto: canvases donde aparece, tablas relacionadas (relaciones que se
      // van) y vistas que también se eliminan. Durante este pre-conteo el botón
      // ya muestra el spinner (el diálogo todavía no abre).
      let canvases = 0, related = 0, nViews = 0;
      try {
        const [usage, rels, vs] = await Promise.all([
          gov.tableUsage(table.id).then((u) => u.usage).catch(() => []),
          gov.listRelationships(table.id).catch(() => []),
          viewsSvc.listViews(table.id).catch(() => []),
        ]);
        canvases = usage.length;
        related = new Set(rels.flatMap((r) => [r.parentTableId, r.childTableId]).filter((t) => t !== table.id)).size;
        nViews = vs.length;
      } catch { /* si falla el conteo se muestran ceros */ }
      const ok = await confirmDialog({
        title: 'Delete table',
        variant: 'danger',
        confirmLabel: 'Delete table',
        cancelLabel: 'Cancel',
        message: <>
          Table <strong>“{table.physicalName || table.logicalName}”</strong> will be deleted from the model. This affects:
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
            <li><strong>{canvases}</strong> canvas{canvases === 1 ? '' : 'es'} it appears on</li>
            <li><strong>{related}</strong> related table{related === 1 ? '' : 's'} (their relationships are removed)</li>
            <li><strong>{nViews}</strong> view{nViews === 1 ? '' : 's'} (also deleted)</li>
          </ul>
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>Its columns and relationships go too. This change is part of the current version.</div>
        </>,
        // El borrado (cascada versionada) corre DENTRO del diálogo: queda con
        // spinner y bloqueado hasta terminar (el owner reportó reclicks por el delay).
        action: async () => { await deleteTable(table.id); },
      });
      if (ok) pushToast('Table deleted');
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't delete the table", 'err'); }
    finally { setDelBusy(null); }
  };

  // ── Resize del panel (drag del borde izquierdo). El ancho lo fija/clampa/
  // persiste WorkspaceScreen; acá sólo emitimos el ancho = viewport − X. ──
  const startResize = (e: ReactPointerEvent) => {
    if (!onResize) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setResizing(true);
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => onResize(window.innerWidth - ev.clientX);
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      setResizing(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <aside className="wk-props">
      {/* Handle de resize (solo-vista): ensancha el panel para nombres largos. */}
      {onResize && (
        <div className={`wk-props-resizer${resizing ? ' dragging' : ''}`}
          onPointerDown={startResize} title="Drag to resize" />
      )}
      {/* ── Header fijo: glyph + nombre + schema · table + close (diseño p8) ── */}
      <div className="wk-props-top">
        <div className="wk-props-head">
          <div className="wk-props-glyph" aria-hidden><Table2 size={17} strokeWidth={1.6} /></div>
          <div className="wk-props-id">
            <div className="wk-props-title">{table.physicalName || table.logicalName}</div>
            <div className="wk-props-sub">
              schema <span className="rd-mono">{table.schema || '—'}</span> · table
              {!canEdit && <span className="wk-props-ro">Read-only</span>}
            </div>
          </div>
          <button className="wk-props-close" title="Close" onClick={() => setSelectedTable(null)}><Icon name="x" size={14} /></button>
        </div>

        <div className="wk-pp-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="wk-props-body">
        {/* ── Definition (pp1) ── */}
        {tab === 'definition' && (
          <>
            <div className="wk-props-field"><label>Logical name</label>
              <input className="rd-input" disabled={!canEdit} value={form.logicalName} onChange={(e) => setForm({ ...form, logicalName: e.target.value })} />
            </div>
            <div className="wk-props-field"><label>Physical name</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="rd-input rd-mono" disabled={!canEdit} value={form.physicalName} onChange={(e) => setForm({ ...form, physicalName: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" title="Derive from logical (glossary)" onClick={derivePhysical}><Icon name="bolt" size={12} /></button>}
              </div>
            </div>
            <div className="wk-props-field"><label>Schema</label>
              {/* Dropdown de esquemas (doc 18): se crean desde Structure · Esquemas. */}
              <SchemaSelect kind="tables" value={form.schema} onChange={(v) => setForm({ ...form, schema: v })} disabled={!canEdit} />
            </div>
            <div className="wk-props-field"><label>Functional definition</label>
              <textarea className="wk-pp-textarea" disabled={!canEdit} placeholder="What this entity represents…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => void saveDescriptionOnBlur()} />
            </div>
            {canEdit && (
              <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%' }} disabled={savingDef} onClick={saveDef}>
                {savingDef && <span className="rd-spin" aria-hidden />}{savingDef ? 'Saving…' : 'Save'}
              </button>
            )}
            {canEdit && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} disabled={delBusy !== null} onClick={removeFromCanvas}>
                  {delBusy === 'remove' ? <span className="rd-spin" aria-hidden /> : <Table2 size={12} />} Remove from this canvas
                </button>
                <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--error, #C4314B)' }} disabled={delBusy !== null} onClick={askDeleteTable}>
                  {delBusy === 'delete' ? <span className="rd-spin" aria-hidden /> : <Trash2 size={12} />} Delete table…
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Columns ── */}
        {tab === 'columns' && (
          <>
            <div className="wk-props-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                Table columns
                {reordering && <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden />}
              </span>
              {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setColumnTarget(table.id)}><Icon name="plus" size={12} sw={2.6} /> Add column</button>}
            </div>
            <p className="wk-pp-cap">{canEdit ? 'Drag the handle to reorder · click a column to edit.' : 'Click a column to view its details.'}</p>
            {/* Orden de la LLAVE (independiente del orden físico): manda el
                bloque PK del canvas y el PRIMARY KEY(...) del Export DDL.
                Doc 42: contenedor de ALTO FIJO con scroll y filas apiladas —
                el flujo de chips a la derecha crecía disparejo con la llave. */}
            {keyPks.length >= 2 && (
              <div className="wk-pp-keyorder">
                <div className="wk-pp-cap" style={{ margin: '0 0 4px' }}>
                  Primary key — key order (PK block &amp; DDL constraint)
                  {keyBusy && <span className="rd-spin" style={{ marginLeft: 6, color: 'var(--primary)' }} aria-hidden />}
                </div>
                <div className="wk-pp-keylist">
                  {keyPks.map((c, i) => (
                    <div className="wk-pp-keyrow" key={c.id} title={c.logicalName}>
                      <span className="wk-pp-keyn">{i + 1}</span>
                      <span className="wk-pp-keyname rd-mono">{c.physicalName}</span>
                      {canEdit && (
                        <span className="wk-pp-keymv">
                          <button type="button" disabled={keyBusy || i === 0} title="Move up in the key" onClick={() => moveKey(c.id, -1)}>↑</button>
                          <button type="button" disabled={keyBusy || i === keyPks.length - 1} title="Move down in the key" onClick={() => moveKey(c.id, 1)}>↓</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cols.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>No columns yet.{canEdit ? ' Use “Add column”.' : ''}</div>}
            {/* Buscador de columnas (doc 42): contiene CI sobre lógico o
                físico. Con filtro activo el drag&drop SE DESACTIVA — el drop
                se resuelve contra la lista completa y reordenar viendo un
                subconjunto corrompería el orden físico. */}
            {cols.length > 0 && (
              <div className="wk-pp-colfind">
                <Icon name="search" size={12} className="wk-pp-colfind-ico" />
                <input
                  className="rd-input"
                  placeholder="Find a column (contains…)"
                  value={colQuery}
                  onChange={(e) => setColQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setColQuery(''); } }}
                />
                {colFiltering && (
                  <button type="button" className="wk-pp-colfind-clear" title="Clear search" onClick={() => setColQuery('')}>
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            )}
            {colFiltering && (
              <p className="wk-pp-cap" style={{ margin: '0 0 6px' }}>
                {visibleCols.length} of {cols.length} columns
                {canEdit && visibleCols.length > 0 ? ' · reordering is disabled while filtering' : ''}
              </p>
            )}
            {colFiltering && visibleCols.length === 0 && (
              <div className="rd-small" style={{ color: 'var(--muted)' }}>No columns match “{colQuery.trim()}”.</div>
            )}
            <div className="wk-pp-collist">
              {visibleCols.map((c) => (
                <ColumnRow
                  key={c.id}
                  col={c}
                  canEdit={canEdit}
                  dragDisabled={colFiltering}
                  onOpen={setSelectedColumn}
                  isDragging={dragId === c.id}
                  dropHint={overId === c.id ? (after ? 'after' : 'before') : null}
                  onDragStart={setDragId}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Views (pp2) ── */}
        {tab === 'views' && (
          <>
            <div className="wk-props-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <span>Associated views</span>
              {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setViewEditor({})}><Icon name="plus" size={12} sw={2.6} /> New view</button>}
            </div>
            {views.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>No views for this table{canEdit ? '. Use “New view”.' : '.'}</div>}
            {views.map((v) => {
              // F3: fuentes canónicas (fallback tableId legacy). Compartida =
              // 2+ fuentes ⇒ tinte violeta + badge con las OTRAS fuentes (los
              // nombres se resuelven contra las tablas del canvas actual).
              const srcIds = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
              const shared = srcIds.length > 1;
              const others = srcIds
                .filter((id) => id !== table.id)
                .map((id) => diagram?.tables.find((t) => t.id === id)?.physicalName ?? 'another table');
              return (
                <div className={`wk-pp-link${shared ? ' shared' : ''}`} key={v.id}>
                  <div className="wk-pp-link-head">
                    <Eye size={13} style={{ color: 'var(--purple)', flex: 'none' }} />
                    <span className="rd-mono">{v.schema ? `${v.schema}.` : ''}{v.name}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      {/* Ojo (F5): abre la vista SOLO-LECTURA — sirve en canvas
                          productivo sin crear versión. Siempre visible. */}
                      <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="View definition (read-only)" onClick={() => setViewEditor({ view: v, readOnly: true })}><Eye size={12} /></button>
                      {canEdit && (
                        <>
                          <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Match the table's physical order" disabled={aligningId === v.id} onClick={() => alignView(v)}>
                            {aligningId === v.id ? <span className="rd-spin" aria-hidden /> : <ArrowDownUp size={12} />}
                          </button>
                          <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Edit" onClick={() => setViewEditor({ view: v })}><Pencil size={12} /></button>
                          <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Delete" onClick={async () => { try { const ok = await confirmDialog({ title: 'Delete view', message: <>View <strong>“{v.name}”</strong> will be deleted.</>, confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger', action: async () => { await viewsSvc.deleteView(v.id); reloadViews(); void reload(); } }); if (ok) pushToast('View deleted'); } catch { pushToast("Couldn't delete", 'err'); } }}><Trash2 size={12} /></button>
                        </>
                      )}
                    </span>
                  </div>
                  {shared && (
                    <div className="wk-pp-link-card">
                      <span className="wk-pp-shared">Shared with {others.join(' · ')}</span>
                    </div>
                  )}
                  {v.tags && v.tags.length > 0 && <div className="wk-pp-link-card"><span className="rd-small" style={{ color: 'var(--muted)' }}>{v.tags.length} tag{v.tags.length === 1 ? '' : 's'}</span></div>}
                </div>
              );
            })}
          </>
        )}

        {/* ── Links (pp3: cards PARENT/CHILD) — this canvas + other canvases ── */}
        {tab === 'links' && (
          <>
            <div className="wk-props-sec" style={{ marginTop: 0 }}>This canvas · {links.length} link{links.length === 1 ? '' : 's'}</div>
            {links.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>This table has no relationships on this canvas.</div>}
            {links.map((r) => {
              const isParentHere = r.parentTableId === table.id;
              // Rol de la OTRA tabla respecto de la actual.
              const role = isParentHere ? 'child' : 'parent';
              // Columnas PROPIAS de la unión (todas las de los pares — PK compuesta).
              const ownCols = r.pairs.map((p) => (isParentHere ? p.parentColumnId : p.childColumnId));
              return (
                <div className="wk-pp-link" key={r.id}>
                  <div className="wk-pp-link-head">
                    <span className={`wk-pp-role ${role}`}>{role.toUpperCase()}</span>
                    <span className="rd-mono">{tableName(r.parentTableId)}</span>
                    <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                    <span className="rd-mono">{tableName(r.childTableId)}</span>
                    {canEdit && (
                      <button
                        type="button"
                        className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm"
                        style={{ marginLeft: 'auto' }}
                        title="Delete relationship"
                        onClick={async () => { try { const ok = await confirmDialog({ title: 'Delete relationship', message: 'This relationship will be removed from the model.', confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger', action: () => deleteRelationship(r.id) }); if (ok) pushToast('Relationship deleted'); } catch { pushToast("Couldn't delete", 'err'); } }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div className="wk-pp-link-card">
                    <span className="rd-mono">on {ownCols.map(colName).join(', ')}</span>
                    <span className="wk-pp-card-lbl">
                      {CARD_LBL[r.parentCardinality]} : {CARD_LBL[r.childCardinality]}{r.identifying ? ' · identifying' : ''}{r.pairs.length > 1 ? ` · ${r.pairs.length} pairs` : ''}
                    </span>
                  </div>
                </div>
              );
            })}
            {/* Relaciones visibles sólo en OTROS canvases (la tabla es la misma
                en todos): cards plomo, solo lectura, con el/los canvas(es). */}
            {(() => {
              const others = (allLinks ?? []).filter((l) => !links.some((r) => r.id === l.id));
              if (allLinks === null) {
                return <div className="rd-small" style={{ color: 'var(--muted)', marginTop: 10 }}>Loading other canvases…</div>;
              }
              if (others.length === 0) return null;
              return (
                <>
                  <div className="wk-props-sec">Other canvases · {others.length} link{others.length === 1 ? '' : 's'}</div>
                  {others.map((l) => {
                    const isParentHere = l.parentTableId === table.id;
                    const role = isParentHere ? 'child' : 'parent';
                    const ownCols = l.pairs.map((p) => (isParentHere ? p.parentColumnName : p.childColumnName));
                    return (
                      <div className="wk-pp-link other" key={l.id}>
                        <div className="wk-pp-link-head">
                          <span className={`wk-pp-role ${role}`}>{role.toUpperCase()}</span>
                          <span className="rd-mono">{l.parentTableName}</span>
                          <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                          <span className="rd-mono">{l.childTableName}</span>
                        </div>
                        <div className="wk-pp-link-card">
                          <span className="rd-mono">on {ownCols.join(', ')}</span>
                          <span className="wk-pp-card-lbl">
                            {CARD_LBL[l.parentCardinality]} : {CARD_LBL[l.childCardinality]}{l.identifying ? ' · identifying' : ''}{l.pairs.length > 1 ? ` · ${l.pairs.length} pairs` : ''}
                          </span>
                        </div>
                        <div className="wk-pp-link-card">
                          <span className="rd-small" style={{ color: 'var(--muted)' }}>
                            in {l.canvases.length > 0 ? l.canvases.map((c) => c.name).join(' · ') : 'no shared canvas'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </>
        )}

        {/* ── UDPs (doc 51: pestaña propia — antes vivían dentro de Metadata) ── */}
        {tab === 'udps' && (
          <>
            <p className="wk-pp-cap" style={{ marginTop: 0 }}>User Defined Properties — governance tags for this table.</p>
            {/* key por tabla: al cambiar de selección se resetean borradores
                y pendientes del asignador (estado interno de UdpAssign). */}
            <UdpAssign key={table.id} level="table" values={table.udpValues ?? {}} disabled={!canEdit} onChange={saveTableUdp} />
          </>
        )}

        {/* ── Metadata (pp4, solo lectura) ── */}
        {tab === 'metadata' && (
          <>
            <dl className="wk-pp-meta">
              <dt>Physical name</dt><dd className="rd-mono">{table.physicalName}</dd>
              <dt>Logical name</dt><dd>{table.logicalName}</dd>
              <dt>Schema</dt><dd className="rd-mono">{table.schema || '—'}</dd>
              <dt>Columns</dt><dd>{cols.length}</dd>
              <dt>Relationships</dt><dd>{links.length === 0 ? '—' : `${links.length} link${links.length === 1 ? '' : 's'} · ${parents} parent${parents === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'}`}</dd>
              <dt>Definition</dt><dd>{table.description || '—'}</dd>
              <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{table.id}</dd>
            </dl>
            {/* V3 (doc 19 §12b): dónde se usa la tabla — proyecto › carpeta ›
                canvas (efectivo: con changeset activo incluye lo pendiente). */}
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid #EAEDF2' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2B4A', marginBottom: 8 }}>
                Used in{usage !== null ? ` · ${usage.length} canvas${usage.length === 1 ? '' : 'es'}` : ''}
              </div>
              {usage === null && <div className="rd-small" style={{ color: 'var(--muted)' }}>Loading…</div>}
              {usage !== null && usage.length === 0 && (
                <div className="rd-small" style={{ color: 'var(--muted)' }}>Not referenced on any canvas.</div>
              )}
              {(usage ?? []).map((u) => (
                <div key={u.canvasId} className="wk-pp-usage rd-small">
                  <span>{u.project ?? '—'}</span>
                  <span className="wk-pp-usep">›</span>
                  <span>{u.folder ?? 'root'}</span>
                  <span className="wk-pp-usep">›</span>
                  <span className="rd-mono">{u.canvas}</span>
                </div>
              ))}
            </div>
            {/* Historial de auditoría (doc 51): acciones PUBLICADAS sobre la
                tabla — quién / qué / cuándo / qué versión, detalle bajo demanda. */}
            <AuditHistory kind="table" entityId={table.id} />
          </>
        )}
      </div>

      {viewEditor && (
        <ViewEditor
          lockedTableId={table.id}
          view={viewEditor.view}
          readOnly={viewEditor.readOnly}
          onClose={() => setViewEditor(null)}
          onSaved={() => { reloadViews(); void reload(); }}
          pushToast={pushToast}
        />
      )}
    </aside>
  );
}
