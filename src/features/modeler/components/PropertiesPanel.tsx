import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { sanitizeLogicalName } from '@/lib/logicalName';
import { ArrowDownUp, Eye, Pencil, Plus, Table2, Trash2, Unlink } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import { confirmDialog } from '@/components/ui/dialogs';
import { failureText, fieldsStep, inObjectOrder, useModelerStore } from '@/store/useModelerStore';
import { historyAction, pushUndo } from '@/store/useUndoStore';
import AuditHistory from './AuditHistory';
import UdpAssign from './UdpAssign';
import RelationshipPhraseLine from './RelationshipPhraseLine';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import { countFacetUdpValues, FACET_CAPTION, FACET_SWITCH_HINT, facetNoun, facetNouns } from '@/lib/facets';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/services/governance.service';
import { apiErrorMessage } from '@/services/http';
import { matchesColumn } from '../lib/columnSearch';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { isPkFirst, orderColumns } from '../lib/columnOrder';
import { alignSourcesToPhysical } from '../lib/viewSync';
import { ColumnRow } from './ColumnEditor';
import { tableNamePlan } from '../lib/nameSync';
import { facetEditable } from '../lib/facetEditable';
import SchemaSelect from './SchemaSelect';
import ColorField from './ColorField';
import ViewEditor from './ViewEditor';
import * as viewsSvc from '@/services/views.service';
import type { TableViewRow, View } from '@/services/views.service';
import { splitByCanvas } from '../lib/canvasViews';
import { confirmDeleteView } from './deleteConfirm';
import { askDeleteTable, askRemoveFromCanvas } from './deleteFlows';

// Los UDPs tienen pestaña propia (paridad con el panel de columna); Metadata
// reúne el resto y suma History.
type Tab = 'definition' | 'columns' | 'views' | 'links' | 'udps' | 'metadata';
const TABS: { id: Tab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'views', label: 'Views' },
  { id: 'links', label: 'Links' },
  { id: 'udps', label: 'UDPs' },
  { id: 'metadata', label: 'Metadata' },
];

// Etiqueta compacta por extremo (p. ej. "1 : N · identifying").
const CARD_LBL: Record<gov.Cardinality, string> = {
  one: '1', 'one-only': '1', 'zero-one': '0..1', many: 'N', 'one-many': '1..N', 'zero-many': '0..N',
};

/**
 * Panel lateral de propiedades: header con glyph navy + "schema X · table",
 * pestañas subrayadas (underline, no pill) con contador en Columns/Views, y
 * cuerpo scrolleable. En read-only (sin changeset activo) el panel abre igual
 * pero como reader: inputs deshabilitados y sin acciones.
 */
export default function PropertiesPanel({ pushToast, onResize }: { pushToast: (m: string, k?: 'err') => void; onResize?: (width: number) => void }) {
  // Selectores individuales (no el store entero): el panel vive junto al canvas
  // y suscribirse a todo el store lo re-renderizaría en cada hover/drag/dirty.
  const diagram = useModelerStore((s) => s.diagram);
  const selectedTableId = useModelerStore((s) => s.selectedTableId);
  const setSelectedTable = useModelerStore((s) => s.setSelectedTable);
  const reload = useModelerStore((s) => s.reload);
  const setObjectColor = useModelerStore((s) => s.setObjectColor);
  const reorderColumns = useModelerStore((s) => s.reorderColumns);
  // El clic en una fila abre el Properties de esa columna (sidebar propio);
  // este panel no edita columnas en línea.
  const setSelectedColumn = useModelerStore((s) => s.setSelectedColumn);
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  const removeTableFromArea = useModelerStore((s) => s.removeTableFromArea);
  const deleteTable = useModelerStore((s) => s.deleteTable);
  // Membresía de vistas en este canvas (tab Views).
  const addViewsToCanvas = useModelerStore((s) => s.addViewsToCanvas);
  const removeViewFromCanvas = useModelerStore((s) => s.removeViewFromCanvas);
  const deleteView = useModelerStore((s) => s.deleteView);
  // En modo visor puede haber changeset activo (viendo un request desde Review):
  // el panel abre como reader igual que sin changeset.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  // La faceta activa la da el switch Logical/Physical del canvas: los UDPs (y
  // los rótulos entity/table) siguen ese modo.
  const viewMode = useModelerStore((s) => s.viewMode);
  const nouns = facetNouns(viewMode);   // Entity/Attribute o Table/Column
  const [udpDefs, setUdpDefs] = useState<UdpDefinition[]>([]);
  useEffect(() => {
    let alive = true;
    getUdpDefs(sessionProjectId()).then((d) => { if (alive) setUdpDefs(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const table = diagram?.tables.find((t) => t.id === selectedTableId) ?? null;
  // La lista sigue el único orden de display (bloque PK primero + resto por
  // `ordinal`), el mismo que dibuja el canvas. El drag&drop reordena dentro de
  // cada bloque (ver handleDrop).
  const cols = useMemo(
    () => orderColumns((diagram?.columns ?? []).filter((c) => c.tableId === selectedTableId)),
    [diagram, selectedTableId],
  );
  const links = useMemo(
    () => (diagram?.relationships ?? []).filter((r) => r.parentTableId === selectedTableId || r.childTableId === selectedTableId),
    [diagram, selectedTableId],
  );

  const [tab, setTab] = useState<Tab>('definition');
  // La pestaña Views solo existe en el modelo físico; Columns se rotula
  // Attributes en lógico (facetNouns).
  const tabs = TABS.filter((t) => t.id !== 'views' || viewMode === 'physical')
    .map((t) => (t.id === 'columns' ? { ...t, label: nouns.Members } : t));
  useEffect(() => { if (tab === 'views' && viewMode !== 'physical') setTab('definition'); }, [tab, viewMode]);

  // ── Definition: form local de la tabla ──
  const [form, setForm] = useState({ logicalName: '', physicalName: '', schema: '', description: '' });
  // Intención sobre el físico en esta sesión de edición: true (lo escribió),
  // false (lo vació / botón derive), null (no lo tocó → manda el flag
  // persistido de la tabla). Ver tableNamePlan.
  const [physTouched, setPhysTouched] = useState<boolean | null>(null);
  const [savingDef, setSavingDef] = useState(false);
  useEffect(() => {
    if (table) setForm({ logicalName: table.logicalName, physicalName: table.physicalName, schema: table.schema ?? '', description: table.description ?? '' });
    setPhysTouched(null);
    setColQuery('');   // el buscador de columnas no arrastra el filtro a otra tabla
    // Se re-siembra solo al cambiar de tabla: con deps por identidad, cualquier
    // reload del diagrama (guardar un UDP, blur de la definición) pisaría lo que
    // el usuario tiene a medio escribir en este form.
  }, [table?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── DnD reorder (HTML5 nativo) ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [after, setAfter] = useState(false);

  // Reorden persistiéndose en background (la lista ya se movió de forma optimista).
  const [reordering, setReordering] = useState(false);
  // Quitar del canvas / borrar la tabla: mientras corre, spinner en el botón y
  // ambos deshabilitados (el borrado tarda; evita clics repetidos).
  const [delBusy, setDelBusy] = useState<'remove' | 'delete' | null>(null);
  // Drag del handle para ensanchar el panel (solo-vista; nombres largos).
  const [resizing, setResizing] = useState(false);

  // ── Views: vistas globales de la tabla con sus canvases; se cargan al
  // seleccionar la tabla (contador del tab) y se refrescan con el diagrama
  // (agregar/quitar una vista aquí la mueve entre secciones). ──
  const [views, setViews] = useState<TableViewRow[]>([]);
  const [viewEditor, setViewEditor] = useState<{ view?: View; readOnly?: boolean } | null>(null);
  const reloadViews = () => { if (selectedTableId) viewsSvc.tableViews(selectedTableId).then((r) => setViews(r.views)).catch(() => {}); };
  useEffect(() => {
    if (!selectedTableId) { setViews([]); return undefined; }
    let alive = true;
    viewsSvc.tableViews(selectedTableId)
      .then((r) => { if (alive) setViews(r.views); })
      .catch(() => { if (alive) setViews([]); });
    return () => { alive = false; };
  }, [selectedTableId, diagram]);

  // Buscador de columnas: «contiene» sin distinguir mayúsculas sobre
  // lógico/físico. Con filtro activo el drag&drop se desactiva (ver comentario
  // en el render).
  const [colQuery, setColQuery] = useState('');
  const colFiltering = colQuery.trim() !== '';
  const visibleCols = useMemo(
    () => (colFiltering ? cols.filter((c) => matchesColumn(c, colQuery)) : cols),
    [cols, colQuery, colFiltering],
  );
  const [aligningId, setAligningId] = useState<string | null>(null);
  // Deep-link al listado: pestaña Columns con la fila a la vista (scroll, sin
  // expandir; la edición vive en el panel de columna). Lo produce el botón Back
  // del ColumnPropertiesPanel. Se limpia el buscador (podría ocultarla) y el
  // foco se consume (una sola navegación; después el usuario recupera el
  // control).
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
  // ── Metadata: dónde se usa la tabla (proyecto › carpeta › canvas) ──
  const [usage, setUsage] = useState<gov.TableUsageRow[] | null>(null);
  useEffect(() => {
    setUsage(null);
    if (selectedTableId) gov.tableUsage(selectedTableId).then((u) => setUsage(u.usage)).catch(() => setUsage([]));
  }, [selectedTableId]);
  // ── Links: relaciones globales de la tabla (es canónica: las de otros
  // canvases no están en el diagrama actual; llegan con nombres resueltos).
  // Se refresca también al cambiar el diagrama: dibujar/borrar un wire aquí
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
  const counts: Partial<Record<Tab, number>> = {
    columns: cols.length, views: views.length,
    udps: countFacetUdpValues(table.udpValues, udpDefs, 'table', viewMode),   // solo la faceta activa
  };
  // parents = relaciones donde esta tabla es hija (la otra es su padre).
  const parents = links.filter((r) => r.childTableId === table.id).length;
  const children = links.length - parents;

  // Pre-imagen por valor de la tabla para el Undo, común a los tres caminos de
  // guardado de abajo (Save, blur de la definición, UDP).
  const tablePre = (t: gov.CanonicalTable = table) => ({ ...t, ...(t.udpValues ? { udpValues: { ...t.udpValues } } : {}) });
  // Los guardados de la tabla van en fila con el color (`inObjectOrder`) y cada
  // uno parte del documento vigente de la working copy: si cada uno mandara la
  // tabla de su render, el segundo revertiría al primero (definición al salir
  // del campo + color enseguida). Si la tabla fue borrada, avisa en vez de
  // recrearla.
  const latestTable = async (): Promise<gov.CanonicalTable> => {
    const cur = await gov.currentTable(table.id);
    if (!cur) throw new Error(`This ${nouns.one} is no longer in the working copy.`);
    return cur;
  };

  // El fallo de cada escritura de este panel espera la revalidación y calla si
  // la sesión cambia (`reportWriteError`: el aviso lo da la revalidación). Se
  // crea al pedir la escritura, así que toma esa sesión. Su inversa se apila
  // solo en la sesión donde empezó (`pinSession`).
  const saveDef = () => historyAction(async () => {
    setSavingDef(true);
    const pin = pinSession();
    // Propaga el motivo real (p. ej. 409: la versión dejó de estar en borrador)
    // en vez de un "Couldn't save" genérico que esconde por qué no se guardó.
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'));
    const tid = table.id;
    try { await inObjectOrder(tid, async () => {
      pin.check();
      const table = await latestTable();
      pin.check();
      const pre = tablePre(table);
      const logical = form.logicalName.trim();
      // La decisión (re-derivar vs conservar el custom + flag de override) vive
      // en tableNamePlan: un físico con override no se re-deriva al renombrar
      // el lógico; vaciarlo re-enciende el auto.
      const plan = tableNamePlan({ logical, physical: form.physicalName.trim(), prev: table, sessionOverride: physTouched });
      let physical = plan.physical;
      if (plan.derive) {
        try { physical = (await gov.physicalize(logical, 'table')).physical; } catch { /* mantener el actual */ }
      }
      // `updateTable` solo cubre name/schema; un único upsert changeset-aware (merge
      // sobre la tabla actual) cubre además `description`, y luego reload.
      pin.check();   // el físico pudo derivarse con un await
      const saved = { logicalName: logical, physicalName: physical, physicalNameOverridden: plan.overridden, schema: form.schema.trim() || undefined, description: form.description.trim() || undefined };
      await gov.createTable({ ...table, ...saved });
      // Deshacer y rehacer escriben solo lo que este Save modificó (sobre lo vigente).
      pushUndo(`Edit table ${pre.physicalName}`, fieldsStep('table', tid, {
        logicalName: pre.logicalName, physicalName: pre.physicalName, physicalNameOverridden: pre.physicalNameOverridden,
        schema: pre.schema, description: pre.description,
      }, saved, reload), pin);
      // El form no se re-siembra en cada reload (solo al cambiar de tabla): se
      // refleja aquí el físico derivado para que el input no quede stale, si
      // sigue abierta esta tabla (el guardado pudo esperar su turno en la fila).
      if (useModelerStore.getState().selectedTableId === tid) {
        setForm((f) => ({ ...f, logicalName: logical, physicalName: physical }));
        setPhysTouched(null);
      }
      await reload();
      pushToast(`${nouns.One} updated`);
    }); } catch (e) { await onError(e); }
    finally { setSavingDef(false); }
  });
  const derivePhysical = async () => {
    try {
      const p = (await gov.physicalize(form.logicalName.trim(), 'table')).physical;
      setForm((f) => ({ ...f, physicalName: p }));
      setPhysTouched(false);  // derivar = renunciar al override
    } catch { pushToast("Couldn't derive the physical name", 'err'); }
  };
  // Definición funcional: auto-guardado al salir del campo, mismo paradigma que
  // la definición de columna (cerrar el panel sin Save no la pierde). Los
  // nombres y el schema siguen detrás del botón Save: un rename es
  // transaccional (re-deriva el físico, re-apunta vistas, valida unicidad) y no
  // debe dispararse a medio escribir. `...table` usa los nombres del server: un
  // nombre a medio editar en el form no viaja con este blur.
  const saveDescriptionOnBlur = () => historyAction(async () => {
    if (!canEdit || !table) return;
    const next = form.description.trim() || undefined;
    // «Sin cambio» se decide contra el documento vigente, en la fila (el
    // diagrama en pantalla puede no reflejar aún el guardado anterior).
    const pin = pinSession();
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'));
    try {
      await inObjectOrder(table.id, async () => {
        pin.check();
        const cur = await latestTable();
        pin.check();
        if ((cur.description ?? undefined) === next) return;
        await gov.createTable({ ...cur, description: next });
        pushUndo(`Edit table ${cur.physicalName}`, fieldsStep('table', cur.id, { description: cur.description }, { description: next }, reload), pin);
        await reload();
      });
    } catch (e) { await onError(e); }
  });
  const saveTableUdp = (next: Record<string, string>) => historyAction(async () => {
    if (!table) return;
    const pin = pinSession();
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save UDP", 'err'));
    try {
      await inObjectOrder(table.id, async () => {
        pin.check();
        const cur = await latestTable();
        pin.check();
        const pre = tablePre(cur);
        await gov.createTable({ ...cur, udpValues: next });
        pushUndo(`Edit table ${pre.physicalName}`, fieldsStep('table', cur.id, { udpValues: pre.udpValues }, { udpValues: next }, reload), pin);
        await reload();
      });
    } catch (e) { await onError(e); }
  });

  // ── "Match physical order": reordena los sources de la vista según el orden
  // único de cada tabla fuente (PK primero, así una PK recién marcada sube a su
  // bloque). Función propia (Erwin no la ofrece). Las columnas no resolubles
  // (expresiones) conservan su orden relativo al final de su grupo.
  const alignView = async (v: View) => {
    // El pin y el aviso del error se toman al pedirlo, antes de abrir el confirm: si
    // mientras estaba abierto la revalidación bajó la versión a solo lectura,
    // no se escribe ni se avisa encima de ella.
    const pin = pinSession();   // lee las columnas y después escribe
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't reorder the view", 'err'));
    // Confirmación previa: reordenar reescribe la definición de la vista →
    // popup Aceptar/Cancelar antes de ejecutar.
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
        colsByTable.set(tid, orderColumns(list));
      }
      pin.check();
      await viewsSvc.updateView(v.id, { ...v, sources: alignSourcesToPhysical(v, colsByTable) });
      reloadViews();
      void reload();
      pushToast('View reordered to match the physical order of its table(s)');
    } catch (e) { await onError(e); }
    finally { setAligningId(null); }
  };
  // DnD: al pasar por encima decide si el drop va arriba o abajo según la mitad de la fila.
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
    // Con filtro activo no se reordena: el splice de abajo trabaja sobre la
    // lista completa y un drop calculado sobre el subconjunto visible
    // insertaría en una posición equivocada. El grip viene deshabilitado; este
    // guard cubre el caso de un drag iniciado antes de filtrar.
    if (!src || src === targetId || reordering || colFiltering) return;
    // Un solo orden: las PK se arrastran como cualquier columna, pero dentro de
    // su bloque; una PK nunca queda debajo de una no-PK (ni una no-PK arriba de
    // una PK). Un drop que cruza la frontera se rechaza.
    const ids = cols.map((c) => c.id).filter((x) => x !== src);
    let idx = ids.indexOf(targetId);
    if (idx < 0) return;
    if (wasAfter) idx += 1;
    ids.splice(idx, 0, src);
    if (!isPkFirst(cols, ids)) {
      pushToast("A primary key column can't go below a column that isn't part of the key.", 'err');
      return;
    }
    setReordering(true);
    const onError = reportWriteError(() => pushToast("Couldn't reorder", 'err'));
    try { await reorderColumns(table.id, ids); }
    catch (e) { await onError(e); }
    finally { setReordering(false); }
  };

  // ── Quitar del canvas / borrar la tabla (versionado + popup de impacto) ──
  // Los flujos son los mismos del menú del canvas; acá, además, el spinner del
  // botón mientras corren (el conteo del impacto va antes del diálogo).
  const removeFromCanvas = async () => {
    if (delBusy) return;
    setDelBusy('remove');
    try { await askRemoveFromCanvas({ table, nouns, pushToast, remove: removeTableFromArea }); }
    finally { setDelBusy(null); }
  };
  const onDeleteTable = async () => {
    if (delBusy) return;
    setDelBusy('delete');
    try { await askDeleteTable({ table, nouns, pushToast, deleteTable }); }
    finally { setDelBusy(null); }
  };

  // ── Resize del panel (drag del borde izquierdo). El ancho lo fija/clampa/
  // persiste WorkspaceScreen; aquí solo se emite el ancho = viewport − X. ──
  const startResize = (e: ReactPointerEvent) => {
    if (!onResize) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setResizing(true);
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => onResize(window.innerWidth - ev.clientX);
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* se ignora */ }
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
      {/* ── Header fijo: glyph + nombre + schema · table + close ── */}
      <div className="wk-props-top">
        <div className="wk-props-head">
          <div className="wk-props-glyph" aria-hidden><Table2 size={17} strokeWidth={1.6} /></div>
          <div className="wk-props-id">
            {/* En Lógico el objeto es la entidad (nombre lógico); en Físico, la tabla. */}
            <div className="wk-props-title">{viewMode === 'logical' ? (table.logicalName || table.physicalName) : (table.physicalName || table.logicalName)}</div>
            <div className="wk-props-sub">
              schema <span className="rd-mono">{table.schema || '—'}</span> · {facetNoun('table', viewMode)}
              {!canEdit && <span className="wk-props-ro">Read-only</span>}
            </div>
          </div>
          <button className="wk-props-close" title="Close" onClick={() => setSelectedTable(null)}><Icon name="x" size={14} /></button>
        </div>

        <div className="wk-pp-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="wk-props-body">
        {/* ── Definition ── */}
        {tab === 'definition' && (
          <>
            {/* Cada faceta edita sus campos; los de la otra quedan en solo lectura con el hint. */}
            <p className="wk-pp-cap" style={{ marginTop: 0 }}>
              <b>{viewMode === 'logical' ? 'Logical facet' : 'Physical facet'}</b> — fields of the other facet are read-only here. {FACET_SWITCH_HINT[viewMode]}
            </p>
            <div className="wk-props-field"><label>Logical name</label>
              <input className="rd-input" disabled={!canEdit || !facetEditable('table', 'logicalName', viewMode)} title={facetEditable('table', 'logicalName', viewMode) ? undefined : FACET_SWITCH_HINT[viewMode]} value={form.logicalName} onChange={(e) => setForm({ ...form, logicalName: sanitizeLogicalName(e.target.value) })} />
            </div>
            <div className="wk-props-field"><label>Physical name</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="rd-input rd-mono" disabled={!canEdit || !facetEditable('table', 'physicalName', viewMode)} title={facetEditable('table', 'physicalName', viewMode) ? undefined : FACET_SWITCH_HINT[viewMode]} value={form.physicalName} onChange={(e) => { setForm({ ...form, physicalName: e.target.value }); setPhysTouched(e.target.value.trim() !== ''); }} style={{ flex: 1, minWidth: 0 }} />
                {canEdit && facetEditable('table', 'physicalName', viewMode) && <button className="rd-btn rd-btn-ghost rd-btn-sm" title="Derive from logical (glossary)" onClick={derivePhysical}><Icon name="bolt" size={12} /></button>}
              </div>
            </div>
            <div className="wk-props-field"><label>Schema</label>
              {/* Combo de esquemas de tablas: se crean desde Structure · Schemas o con «+ Create schema…» del propio combo. */}
              <SchemaSelect kind="tables" value={form.schema} onChange={(v) => setForm({ ...form, schema: v })} disabled={!canEdit || !facetEditable('table', 'schema', viewMode)} />
            </div>
            <div className="wk-props-field"><label>Functional definition</label>
              <textarea className="wk-pp-textarea" disabled={!canEdit} placeholder="What this entity represents…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => void saveDescriptionOnBlur()} />
            </div>
            {canEdit && (
              <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%' }} disabled={savingDef} onClick={saveDef}>
                {savingDef && <span className="rd-spin" aria-hidden />}{savingDef ? 'Saving…' : 'Save'}
              </button>
            )}
            {/* Color propio de la tabla (todos sus canvases). Se aplica al
                elegirlo; va aparte del formulario de arriba, que se guarda con Save. */}
            <div className="wk-pp-section">
              <ColorField id={table.id} own={table.color} canEdit={canEdit} noun={nouns.one}
                onPick={(ref) => {
                  const onError = reportWriteError((e) => pushToast(failureText("Couldn't change the color", e), 'err'));
                  void setObjectColor(table.id, ref).catch(onError);
                }} />
            </div>
            {canEdit && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} disabled={delBusy !== null} onClick={removeFromCanvas}>
                  {delBusy === 'remove' ? <span className="rd-spin" aria-hidden /> : <Table2 size={12} />} Remove from this canvas
                </button>
                <button className="rd-btn rd-btn-danger rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} disabled={delBusy !== null} onClick={onDeleteTable}>
                  {delBusy === 'delete' ? <span className="rd-spin" aria-hidden /> : <Trash2 size={12} />} Delete {nouns.one}…
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
                {nouns.One} {nouns.members}
                {reordering && <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden />}
              </span>
              {canEdit && <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={() => setColumnTarget(table.id)}><Icon name="plus" size={12} sw={2.6} /> Add {nouns.member}</button>}
            </div>
            <p className="wk-pp-cap">{canEdit ? `Drag the handle to reorder · click ${nouns.aMember} to edit.` : `Click ${nouns.aMember} to view its details.`}</p>
            {cols.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>No {nouns.members} yet.{canEdit ? ` Use “Add ${nouns.member}”.` : ''}</div>}
            {/* Buscador de columnas: «contiene», sin distinguir mayúsculas, sobre
                lógico o físico. Con filtro activo el drag&drop se desactiva: el
                drop se resuelve contra la lista completa y reordenar viendo un
                subconjunto corrompería el orden. */}
            {canEdit && cols.length > 1 && (
              <p className="wk-pp-cap" style={{ marginTop: 0 }}>Drag a row to reorder the {nouns.members}.</p>
            )}
            {cols.length > 0 && (
              <div className="wk-pp-colfind">
                <Icon name="search" size={12} className="wk-pp-colfind-ico" />
                <input
                  className="rd-input"
                  placeholder={`Find ${nouns.aMember} (contains…)`}
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
                <ColumnRow facet={viewMode}
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

        {/* ── Views ── */}
        {tab === 'views' && (() => {
          // Paridad con Links: la tabla es canónica y sus vistas viven en
          // canvases concretos. «This canvas» = miembros dibujados aquí
          // (editables); «Other canvases» = las demás (solo lectura + «Add to
          // this canvas»). El contador del tab muestra el total.
          const onCanvas = new Set((diagram?.views ?? []).map((v) => v.id));
          const { here, elsewhere } = splitByCanvas(views, onCanvas);
          // Las vistas están ligadas a la tabla física: en el modelo lógico se
          // listan como referencia, sin acciones.
          const physicalMode = viewMode === 'physical';
          const canAct = canEdit && physicalMode;
          const srcInfo = (v: View) => {
            // Fuentes canónicas (`sourceTableIds`; si faltan, `tableId`).
            // Compartida = 2+ fuentes ⇒ tinte violeta + badge con las otras fuentes.
            const srcIds = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
            return {
              shared: srcIds.length > 1,
              others: srcIds.filter((id) => id !== table.id).map((id) => diagram?.tables.find((t) => t.id === id)?.physicalName ?? 'another table'),
            };
          };
          const iconBtn = 'rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm';
          const viewCard = (v: TableViewRow, other: boolean) => {
            const { shared, others } = srcInfo(v);
            const canvasNames = v.canvases.filter((c) => c.id !== diagram?.subjectArea.id).map((c) => c.name);
            return (
              <div className={`wk-pp-link${shared ? ' shared' : ''}${other ? ' other' : ''}`} key={v.id}>
                <div className="wk-pp-link-head">
                  <Eye size={13} style={{ color: 'var(--purple)', flex: 'none' }} />
                  <span className="rd-mono">{v.schema ? `${v.schema}.` : ''}{v.name}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 2, flex: 'none' }}>
                    {/* Ícono Eye: abre la vista en solo lectura; sirve en canvas
                        productivo sin crear versión. Siempre visible. */}
                    <button className={iconBtn} title="View definition (read-only)" onClick={() => setViewEditor({ view: v, readOnly: true })}><Eye size={12} /></button>
                    {canAct && !other && (
                      <>
                        <button className={iconBtn} title="Match the table's physical order" disabled={aligningId === v.id} onClick={() => alignView(v)}>
                          {aligningId === v.id ? <span className="rd-spin" aria-hidden /> : <ArrowDownUp size={12} />}
                        </button>
                        <button className={iconBtn} title="Edit" onClick={() => setViewEditor({ view: v })}><Pencil size={12} /></button>
                        <button className={iconBtn} title="Remove from this canvas (the view stays in the model)"
                          onClick={() => void removeViewFromCanvas(v.id).then(() => pushToast('View removed from canvas'))
                            .catch(reportWriteError((e) => pushToast(failureText("Couldn't remove the view from this canvas", e), 'err')))}>
                          <Unlink size={12} />
                        </button>
                        {/* La misma acción del store que el Object Inspector, con
                            Undo que la repone en su sitio. */}
                        <button className={iconBtn} title="Delete from the model" onClick={async () => {
                          const onError = reportWriteError((e) => pushToast(apiErrorMessage(e, "Couldn't delete"), 'err'));
                          try {
                            const ok = await confirmDeleteView({
                              name: v.name,
                              action: async () => { await deleteView(v, { canvasIds: v.canvases.map((c) => c.id) }); reloadViews(); void reload(); },
                            });
                            if (ok) pushToast('View deleted');
                          } catch (e) { await onError(e); }
                        }}><Trash2 size={12} /></button>
                      </>
                    )}
                    {canAct && other && (
                      <button className="rd-btn rd-btn-secondary rd-btn-sm" title="Add this view to the current canvas"
                        onClick={() => void addViewsToCanvas([v.id]).then(() => pushToast('View added to canvas'))
                          .catch(reportWriteError((e) => pushToast(failureText("Couldn't add the view to this canvas", e), 'err')))}>
                        <Plus size={12} /> Add to this canvas
                      </button>
                    )}
                  </span>
                </div>
                {shared && (
                  <div className="wk-pp-link-card">
                    <span className="wk-pp-shared">Shared with {others.join(' · ')}</span>
                  </div>
                )}
                {other && (
                  <div className="wk-pp-link-card">
                    <span className="rd-small" style={{ color: 'var(--muted)' }}>
                      {canvasNames.length > 0 ? `in ${canvasNames.join(' · ')}` : 'not on any canvas yet'}
                    </span>
                  </div>
                )}
              </div>
            );
          };
          return (
            <>
              {!physicalMode && (
                <p className="wk-pp-cap" style={{ marginTop: 0 }}>
                  Views belong to the <b>physical table</b>. Switch to the Physical model to add, edit or remove them.
                </p>
              )}
              <div className="wk-props-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: physicalMode ? 0 : undefined }}>
                <span>This canvas · {here.length} view{here.length === 1 ? '' : 's'}</span>
                {canAct && <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={() => setViewEditor({})}><Icon name="plus" size={12} sw={2.6} /> New view</button>}
              </div>
              {here.length === 0 && (
                <div className="rd-small" style={{ color: 'var(--muted)' }}>
                  {views.length === 0 ? `No views for this table${canAct ? '. Use “New view”.' : '.'}` : 'This table has no views on this canvas.'}
                </div>
              )}
              {here.map((v) => viewCard(v, false))}
              {elsewhere.length > 0 && (
                <>
                  <div className="wk-props-sec">Other canvases · {elsewhere.length} view{elsewhere.length === 1 ? '' : 's'}</div>
                  {elsewhere.map((v) => viewCard(v, true))}
                </>
              )}
            </>
          );
        })()}

        {/* ── Links (cards PARENT/CHILD): this canvas + other canvases ── */}
        {tab === 'links' && (
          <>
            <div className="wk-props-sec" style={{ marginTop: 0 }}>This canvas · {links.length} link{links.length === 1 ? '' : 's'}</div>
            {links.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>This table has no relationships on this canvas.</div>}
            {links.map((r) => {
              const isParentHere = r.parentTableId === table.id;
              // Rol de la otra tabla respecto de la actual.
              const role = isParentHere ? 'child' : 'parent';
              // Columnas propias de la unión (todas las de los pares: PK compuesta).
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
                        onClick={async () => {
                          const onError = reportWriteError(() => pushToast("Couldn't delete", 'err'));
                          try { const ok = await confirmDialog({ title: 'Delete relationship', message: 'This relationship will be removed from the model.', confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger', action: () => deleteRelationship(r.id) }); if (ok) pushToast('Relationship deleted'); } catch (e) { await onError(e); }
                        }}
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
                  <RelationshipPhraseLine rel={r} />
                </div>
              );
            })}
            {/* Relaciones visibles solo en otros canvases (la tabla es la misma
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
                        <RelationshipPhraseLine rel={l} />
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

        {/* ── UDPs (pestaña propia) ── */}
        {tab === 'udps' && (
          <>
            <p className="wk-pp-cap" style={{ marginTop: 0 }}>
              <b>{FACET_CAPTION.table[viewMode]}</b> — governance tags of this facet. {FACET_SWITCH_HINT[viewMode]}
            </p>
            {/* key por tabla+faceta: cambiar de selección o de modo
                remonta el asignador (borradores/pendientes internos). */}
            <UdpAssign key={`${table.id}:${viewMode}`} level="table" view={viewMode} values={table.udpValues ?? {}} disabled={!canEdit} onChange={saveTableUdp} />
          </>
        )}

        {/* ── Metadata (solo lectura) ── */}
        {tab === 'metadata' && (
          <>
            <dl className="wk-pp-meta">
              <dt>Physical name</dt><dd className="rd-mono">{table.physicalName}</dd>
              <dt>Logical name</dt><dd>{table.logicalName}</dd>
              <dt>Schema</dt><dd className="rd-mono">{table.schema || '—'}</dd>
              <dt>{nouns.Members}</dt><dd>{cols.length}</dd>
              <dt>Relationships</dt><dd>{links.length === 0 ? '—' : `${links.length} link${links.length === 1 ? '' : 's'} · ${parents} parent${parents === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'}`}</dd>
              <dt>Definition</dt><dd>{table.description || '—'}</dd>
              <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{table.id}</dd>
            </dl>
            {/* Dónde se usa la tabla: proyecto › carpeta › canvas (efectivo:
                con changeset activo incluye lo pendiente). */}
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
            {/* Historial de auditoría: acciones publicadas sobre la tabla
                (quién / qué / cuándo / qué versión), detalle bajo demanda. */}
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
          onSaved={(v, created) => {
            // Una vista recién creada con «Show on this canvas» entra a la
            // membresía de este canvas; editar no cambia membresía. Si no entra,
            // se dice por qué y qué falló; con la versión recién transferida,
            // calla (el aviso lo da la revalidación).
            if (created && v.showOnCanvas !== false) {
              void addViewsToCanvas([v.id])
                .catch(reportWriteError((e) => pushToast(failureText("Couldn't add the view to this canvas", e), 'err')));
            }
            reloadViews(); void reload();
          }}
          pushToast={pushToast}
        />
      )}
    </aside>
  );
}
