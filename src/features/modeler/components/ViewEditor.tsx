import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Eye, Lock, Plus, Search, X } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { COLUMN_DATA_TYPES } from '@/types/model';
import { useModelerStore } from '@/store/useModelerStore';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';
import { DEFAULT_DATABRICKS_OPTS, viewDDL, type DdlView } from '@/features/ddl';
import { colKey, duplicateOutputNames, splitColKey, serializeSources, viewSaveBody, type ColCfg } from '../lib/viewEditorLogic';
import SchemaSelect from './SchemaSelect';
import SearchSelect from './SearchSelect';
import SchemaCreateDialog from './SchemaCreateDialog';
import { viewSchemaOnCreate } from '../lib/schemaPick';
import { orderColumns } from '../lib/columnOrder';
import { pinSession, reportWriteError } from '../lib/sessionGuard';

const PURPLE = '#8B5CF6', PURPLE_DK = '#6D3FC4', BLUE = '#2E5BFF', NAVY = '#1A2B4A', MUTED = '#9AA3B2';
const MONO = "var(--mono, 'Geist Mono', monospace)";
const lbl: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 };
const idField: React.CSSProperties = { width: '100%', height: 42, padding: '0 13px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 10, fontFamily: MONO, fontSize: 13.5, color: NAVY, outline: 'none', boxSizing: 'border-box' };
const cellInput: React.CSSProperties = { width: '100%', height: 32, padding: '0 10px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 7, fontFamily: MONO, fontSize: 11.5, color: NAVY, outline: 'none', boxSizing: 'border-box' };
const updn = (dis: boolean): React.CSSProperties => ({ height: 13, border: 'none', background: 'transparent', cursor: dis ? 'default' : 'pointer', color: dis ? '#D6DCE6' : '#8A93A5', padding: 0, lineHeight: 0 });

/**
 * Editor de vistas multi-fuente. Una vista nace de 1..N tablas del canvas:
 * combobox de fuentes con filtro «contiene» y lista vertical de las elegidas
 * (los nombres largos envuelven, nunca se cortan), grilla de columnas agrupada
 * por tabla origen (incluir, alias de salida, expresión SQL, castType con
 * combobox de tipos o texto libre) y switch "Show on this canvas" al crear
 * (membresía del canvas actual; la membresía decide qué vistas exporta el
 * Export DDL de ese canvas, y el valor queda en la vista como `showOnCanvas`,
 * que con Export rules marca la vista de negocio). Con 2+ fuentes el DDL las
 * lista `FROM t1, t2` sin JOIN, como Erwin; un join o un WHERE se documentan en
 * la pestaña «User-Defined SQL», texto informativo que se guarda con la vista
 * sin validar: el DDL sale siempre de las columnas.
 * El preview usa el mismo generador que el Export DDL (`viewDDL`).
 */
export default function ViewEditor({
  lockedTableId, view, onClose, onSaved, pushToast, readOnly,
}: {
  /** Tabla pre-amarrada (abierto desde Properties→Views): fuente fija, no removible. */
  lockedTableId?: string;
  /** Vista existente ⇒ modo edición; ausente ⇒ creación. */
  view?: View;
  onClose: () => void;
  /** Entrega el doc guardado y si fue una creación; el llamador
   *  decide la membresía del canvas (`addViewsToCanvas`) según el switch
   *  «Show on this canvas» (viaja como `saved.showOnCanvas`). */
  onSaved: (saved: View, created: boolean) => void;
  pushToast: (m: string, k?: 'err') => void;
  /** Modo visor: abre la vista en solo lectura desde un canvas productivo
   *  (sin changeset); muestra definiciones sin necesidad de crear versión. */
  readOnly?: boolean;
}) {
  const editing = !!view;
  const ro = !!readOnly;
  const diagram = useModelerStore((s) => s.diagram);
  const tables = useMemo(() => diagram?.tables ?? [], [diagram]);
  const allColumns = useMemo(() => diagram?.columns ?? [], [diagram]);
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const canvasTables = useMemo(() => new Set(tables.map((t) => t.id)), [tables]);
  const colsByTable = useMemo(() => {
    const m = new Map<string, typeof allColumns>();
    for (const c of allColumns) { const a = m.get(c.tableId) ?? []; a.push(c); m.set(c.tableId, a); }
    // Orden único de cada fuente: PK primero y cada bloque por ordinal.
    for (const [k, a] of m) m.set(k, orderColumns(a));
    return m;
  }, [allColumns]);

  // Fuentes iniciales: las canónicas de la vista (si no las trae, su `tableId`)
  // o la tabla pre-amarrada. Constante de montaje para los inicializadores.
  const initialSourceIds = view?.sourceTableIds?.length
    ? view.sourceTableIds
    : view?.tableId ? [view.tableId]
      : lockedTableId ? [lockedTableId] : [];
  const firstTable = tableById.get(initialSourceIds[0] ?? '');

  const [sourceIds, setSourceIds] = useState<string[]>(initialSourceIds);
  // Valores por defecto al crear: nombre = el físico de la tabla origen tal cual
  // (M_CLIENTE → M_CLIENTE). El esquema arranca vacío y lo resuelve el efecto de
  // abajo.
  const [name, setName] = useState(view?.name ?? (firstTable ? firstTable.physicalName : ''));
  const [schema, setSchema] = useState(view?.schema ?? '');
  // Convención `_VU`, solo al crear: cuando el catálogo llega, si existe
  // `<esquemaTabla>_VU` (sin distinguir mayúsculas, kind vistas) se autoselecciona
  // una sola vez, y solo si el usuario no tocó el campo. Si no existe, el campo
  // queda vacío y se ofrece crearlo: el esquema de la tabla no sirve de respaldo,
  // porque la vista nacería en un esquema de tablas que ni siquiera figura en su
  // propio combo (`kind="views"`).
  const storeSchemas = useModelerStore((s) => s.schemas);
  // Esquema de la fuente actual (no la de montaje): "New view" desde el toolbar
  // arranca sin fuentes y la primera se elige adentro.
  const firstSourceSchema = tableById.get(sourceIds[0] ?? '')?.schema;
  const schemaAutoRef = useRef<string | null>(view ? null : '');
  useEffect(() => {
    if (schemaAutoRef.current === null || ro) return;
    const { schema: hit } = viewSchemaOnCreate(firstSourceSchema, storeSchemas);
    if (!hit) return;                       // aún sin `_VU`: se ofrece crearlo
    schemaAutoRef.current = null;
    setSchema((cur) => (cur === '' ? hit : cur));
  }, [storeSchemas, ro, firstSourceSchema]);
  // El `<ESQUEMA>_VU` que falta, derivado (no estado): con estado, cualquier
  // recarga del catálogo con la fuente aún sin resolver lo dejaría en blanco y
  // el aviso desaparecería sin que nada hubiera cambiado.
  const suggestVU = useMemo(
    () => (view || ro ? null : viewSchemaOnCreate(firstSourceSchema, storeSchemas).suggest),
    [view, ro, firstSourceSchema, storeSchemas],
  );

  // Alta del `_VU` desde acá: el mismo popup del combo, por el camino normal
  // (changeset activo), nunca escritura directa; al crear queda seleccionado.
  const [schemaModal, setSchemaModal] = useState(false);
  // "Show on this canvas" arranca encendido al crear; al editar una existente se
  // respeta lo persistido (un `?? true` directo encendería las vistas guardadas
  // sin el campo).
  const [showOnCanvas, setShowOnCanvas] = useState(view ? (view.showOnCanvas ?? false) : true);
  // Definición funcional de la vista (nivel vista). Editable en el panel izquierdo.
  const [description, setDescription] = useState(view?.description ?? '');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // ── La User-Defined SQL es texto informativo de la vista: se guarda con ella,
  // sin validar, pero el DDL sale siempre de las columnas. `sqlMode` es solo la
  // pestaña visible de la sección 2 (Columns | User-Defined SQL): no es un modo
  // de la vista. ──
  const [sqlMode, setSqlMode] = useState(false);
  const [sqlDraft, setSqlDraft] = useState(() => (view?.customSql ?? '').trim());

  // ── Ancho de "Source column" redimensionable (arrastre del header; persiste
  // por navegador: los nombres largos se leen sin agrandar todo). ──
  const [srcW, setSrcWRaw] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('dmh:veSrcW')); return v >= 140 && v <= 480 ? v : 200; } catch { return 200; }
  });
  const setSrcW = (w: number) => {
    const clamped = Math.round(Math.max(140, Math.min(480, w)));
    setSrcWRaw(clamped);
    try { localStorage.setItem('dmh:veSrcW', String(clamped)); } catch { /* se ignora */ }
  };
  const startSrcResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = srcW;
    const move = (ev: PointerEvent) => setSrcW(start + (ev.clientX - startX));
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* se ignora */ }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const grid = `20px 24px ${srcW}px 0.72fr 1fr 0.62fr 1.15fr`;

  // ── Grilla: orden global + config por `${tableId}::${column}` ──
  const [{ order, cfg }, setGrid] = useState(() => {
    const srcItems = (view?.sources ?? []).filter((s) => s.column);
    const hasProjection = srcItems.length > 0;
    const order: string[] = [];
    const cfg: Record<string, ColCfg> = {};
    // 1) columnas proyectadas en su orden (ítems sin tableId ⇒ 1.ª fuente)
    for (const s of srcItems) {
      const k = colKey(s.tableId ?? initialSourceIds[0] ?? '', s.column!);
      if (cfg[k]) continue;
      order.push(k);
      cfg[k] = { included: true, output: s.outputAlias ?? s.column!, expression: s.expression ?? '', castType: s.castType ?? '', description: s.description ?? '' };
    }
    // 2) resto de columnas de cada fuente: excluidas si ya hay proyección;
    //    todas incluidas al crear la vista.
    for (const tid of initialSourceIds) {
      for (const c of colsByTable.get(tid) ?? []) {
        const k = colKey(tid, c.physicalName);
        if (cfg[k]) continue;
        order.push(k);
        cfg[k] = { included: !hasProjection, output: c.physicalName, expression: '', castType: '', description: '' };
      }
    }
    return { order, cfg };
  });

  // Metadata por clave de las fuentes actuales (nombre + tipo de la columna).
  const colMeta = useMemo(() => {
    const m = new Map<string, { name: string; dataType: string; description: string }>();
    for (const tid of sourceIds) {
      for (const c of colsByTable.get(tid) ?? []) m.set(colKey(tid, c.physicalName), { name: c.physicalName, dataType: c.dataType, description: c.description ?? '' });
    }
    return m;
  }, [sourceIds, colsByTable]);
  // Claves persistibles: las verificadas contra el canvas + las de fuentes
  // fuera de este canvas (vista compartida abierta desde otro canvas): esas
  // columnas no se pueden verificar acá y se preservan para no perderlas.
  const validKeys = useMemo(() => {
    const s = new Set(colMeta.keys());
    for (const k of order) if (!canvasTables.has(splitColKey(k).tableId)) s.add(k);
    return s;
  }, [colMeta, order, canvasTables]);

  const patch = (k: string, p: Partial<ColCfg>) => setGrid((g) => ({ ...g, cfg: { ...g.cfg, [k]: { ...g.cfg[k], ...p } } }));
  const setAll = (included: boolean) => setGrid((g) => {
    const next = { ...g.cfg };
    for (const k of g.order) if (validKeys.has(k)) next[k] = { ...next[k], included };
    return { ...g, cfg: next };
  });
  // Reordena dentro del grupo de su tabla (la grilla se renderiza agrupada).
  const move = (k: string, dir: -1 | 1) => setGrid((g) => {
    const tid = splitColKey(k).tableId;
    const idxs: number[] = [];
    g.order.forEach((key, i) => { if (splitColKey(key).tableId === tid) idxs.push(i); });
    const pos = idxs.findIndex((i) => g.order[i] === k);
    const j = pos + dir;
    if (pos < 0 || j < 0 || j >= idxs.length) return g;
    const order = [...g.order];
    [order[idxs[pos]], order[idxs[j]]] = [order[idxs[j]], order[idxs[pos]]];
    return { ...g, order };
  });

  const addSource = (tid: string) => {
    if (!tid || sourceIds.includes(tid)) return;
    // "New view" desde el toolbar arranca sin fuentes y por eso sin nombre: al
    // agregar la primera fuente, el nombre se precarga como en el flujo
    // pre-amarrado (físico tal cual). El esquema no se toca acá: lo resuelve el
    // efecto de arriba sobre la fuente actual (con `_VU` lo selecciona; sin
    // `_VU` queda vacío y se ofrece crearlo).
    if (sourceIds.length === 0) {
      const t = tableById.get(tid);
      if (t && !name.trim()) setName(t.physicalName);
    }
    setSourceIds((s) => [...s, tid]);
    setGrid((g) => {
      const order = [...g.order];
      const cfg = { ...g.cfg };
      for (const c of colsByTable.get(tid) ?? []) {
        const k = colKey(tid, c.physicalName);
        if (cfg[k]) continue;
        order.push(k);
        // Fuente agregada a una proyección existente ⇒ columnas excluidas por
        // defecto (el usuario elige); al crear la vista se incluye todo.
        cfg[k] = { included: !editing, output: c.physicalName, expression: '', castType: '', description: '' };
      }
      return { order, cfg };
    });
  };
  const removeSource = (tid: string) => {
    if (tid === lockedTableId) return; // pre-amarrada: no removible
    setSourceIds((s) => s.filter((x) => x !== tid));
    setGrid((g) => ({
      order: g.order.filter((k) => splitColKey(k).tableId !== tid),
      cfg: Object.fromEntries(Object.entries(g.cfg).filter(([k]) => splitColKey(k).tableId !== tid)),
    }));
  };

  // Combobox de fuentes: todas las tablas del canvas que no están elegidas
  // (`schema.físico` + lógico a la derecha); el filtro «contiene» del
  // SearchSelect mira ambos (`matchDetail`).
  const sourceOptions = useMemo(() => tables
    .filter((t) => !sourceIds.includes(t.id))
    .map((t) => ({ value: t.id, label: `${t.schema ? `${t.schema}.` : ''}${t.physicalName}`, detail: t.logicalName }))
    .sort((a, b) => a.label.localeCompare(b.label)), [tables, sourceIds]);

  const includedCount = useMemo(
    () => order.filter((k) => validKeys.has(k) && cfg[k]?.included).length,
    [order, cfg, validKeys],
  );
  // Nombres de salida repetidos harían inválido el DDL.
  const dupNames = useMemo(() => duplicateOutputNames(serializeSources(order, cfg, validKeys)), [order, cfg, validKeys]);
  // La vista siempre necesita columnas (el DDL sale de ellas); la
  // User-Defined SQL es opcional e informativa.
  const canSave = !!name.trim() && sourceIds.length > 0 && !busy && includedCount > 0 && dupNames.length === 0;
  // Motivo visible del bloqueo.
  const disabledReason = busy ? undefined
    : !name.trim() ? 'Give the view a name (section 1)'
      : sourceIds.length === 0 ? 'Add at least one source table'
        : includedCount === 0 ? 'Select at least one column'
          : dupNames.length ? `Output name ${dupNames[0]} is repeated — rename one (the DDL would be invalid)` : undefined;

  // Preview con el mismo generador del Export DDL, una sola fuente de verdad:
  // sale de las columnas, nunca de la User-Defined SQL.
  const preview = useMemo(() => {
    if (includedCount === 0) return '-- Select at least one column for the view.';
    const dv: DdlView = {
      id: view?.id ?? 'new',
      name: name.trim() || 'view',
      schema: schema.trim() || undefined,
      tableId: sourceIds[0],
      sourceTableIds: sourceIds,
      sources: serializeSources(order, cfg, validKeys),
    };
    return viewDDL(dv, { ...DEFAULT_DATABRICKS_OPTS, includeComments: false },
      new Map(tables.map((t) => [t.id, t]))).trim();
  }, [includedCount, view, name, schema, sourceIds, order, cfg, validKeys, tables]);

  const save = async () => {
    if (!canSave || ro) return;
    setBusy(true);
    // La vista se graba en la sesión donde se pidió y un fallo espera la
    // revalidación. Propaga el motivo real (p. ej. el 409 del backend: vista sin
    // fuentes).
    const pin = pinSession();
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save the view", 'err'));
    try {
      // Las columnas del builder son la verdad (el DDL sale de ahí); la
      // User-Defined SQL viaja como texto informativo. El payload del changeset
      // es el doc completo: los UDP de la vista se conservan.
      const body = viewSaveBody({
        name, schema, sourceIds, sources: serializeSources(order, cfg, validKeys), showOnCanvas,
        sql: preview, description, sqlText: sqlDraft, udpValues: view?.udpValues, color: view?.color,
      });
      const saved = editing && view
        ? await viewsSvc.updateView(view.id, body)
        : await viewsSvc.createView(body);
      // Lo que sigue (el llamador la suma al canvas) es otra escritura: si
      // mientras se guardaba se abrió otra versión, no se ejecuta.
      if (!pin.holds()) { onClose(); return; }
      pushToast(editing ? 'View updated' : 'View created');
      onSaved(saved, !editing);
      onClose();
    } catch (e) {
      await onError(e);
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const searching = !!q;

  return (
    <Dialog
      open
      title={ro ? `View · ${view?.name}` : editing ? `Edit view · ${view?.name}` : 'New view'}
      subtitle={ro ? 'Read-only — definitions and structure as stored (create a version to edit)' : 'Define a view over one or more source tables — columns, aliases and CAST. The DDL is generated from these columns; the User-Defined SQL is informational.'}
      icon={Eye}
      backdrop="canvas"
      canvasTop={136}
      width={1460}
      onClose={onClose}
      footer={
        ro ? (
          <>
            <span style={{ flex: 1, fontSize: 11.5, color: '#56607A' }}>Read-only — productive version. Create a version to edit this view.</span>
            <button className="rd-btn rd-btn-sm" onClick={onClose} style={{ background: PURPLE, color: '#fff', border: 'none' }}>Close</button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 11.5, color: disabledReason ? '#B45309' : '#56607A', fontWeight: disabledReason ? 600 : 400 }}>
              {disabledReason
                ? <>To {editing ? 'save' : 'create'} the view: {disabledReason}.</>
                : <>A view never copies data — it derives from {sourceIds.length === 1 ? 'its source table' : `its ${sourceIds.length} source tables`}.</>}
            </span>
            <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onClose}>Cancel</button>
            <button className="rd-btn rd-btn-sm" disabled={!canSave} onClick={save}
              title={disabledReason}
              style={{ background: canSave ? PURPLE : '#CBD2DE', color: '#fff', border: 'none' }}>
              {editing ? 'Save changes' : 'Create view'}
            </button>
          </>
        )
      }
    >
      <datalist id="view-cast-types">
        {COLUMN_DATA_TYPES.map((t) => <option key={t} value={t} />)}
      </datalist>
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: '-4px -4px 0', minWidth: 0, display: 'flex', gap: 0, height: 560, minHeight: 0 }}>
        {/* ── Izquierda · identidad + fuentes ── */}
        <div style={{ width: 400, flex: 'none', borderRight: '1px solid #EAEDF2', background: '#FAFBFC', display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: '10px 0 0 10px' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #EAEDF2', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: '#F3EEFF', color: PURPLE, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: NAVY }}>View identity &amp; sources</h2>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={lbl}>View name</label>
              <input style={idField} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="view name" />
            </div>
            <div>
              <label style={lbl}>Schema</label>
              {/* Combobox de esquemas con buscador, solo esquemas de
                  vistas; «+ Create schema…» los crea desde el mismo combo. */}
              <SchemaSelect kind="views" value={schema} onChange={setSchema} className="" inputStyle={idField} />
              {/* Sin `<ESQUEMA>_VU` el campo queda vacío y se ofrece
                  crearlo por el camino versionado (popup de Esquemas). */}
              {!ro && !schema && suggestVU && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11.5, color: '#B45309', fontWeight: 600 }}>
                    No <span className="rd-mono">{suggestVU}</span> schema yet — pick one, or create it.
                  </span>
                  <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm"
                    onClick={() => setSchemaModal(true)}>
                    <Plus size={13} /> Create {suggestVU}
                  </button>
                </div>
              )}
            </div>
            {/* Definición funcional de la vista (nivel vista, no de columna). */}
            <div>
              <label style={lbl}>Functional definition</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What this view represents (business definition)…"
                style={{ width: '100%', minHeight: 66, padding: '10px 13px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 10, fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.55, color: NAVY, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {/* ── Fuentes: lista vertical de las elegidas + combobox
                con filtro «contiene» sobre todas las tablas del canvas. ── */}
            <div>
              <label style={lbl}>Source tables</label>
              {sourceIds.length === 0 && <div style={{ fontSize: 12, color: '#C0392B', fontWeight: 600, marginBottom: 8 }}>Add at least one source table.</div>}
              {sourceIds.length > 0 && (
                <div className="wk-ve-srcs" style={{ marginBottom: 8 }}>
                  {sourceIds.map((tid, i) => {
                    const t = tableById.get(tid);
                    const locked = tid === lockedTableId;
                    const fullName = t ? `${t.schema ? `${t.schema}.` : ''}${t.physicalName}` : tid;
                    return (
                      <div key={tid} className={`wk-ve-src${i === 0 ? ' first' : ''}`} title={fullName}>
                        <span className="wk-ve-src-alias">t{i + 1}</span>
                        <span className="wk-ve-src-name">
                          {t?.schema && <span className="wk-ve-src-schema">{t.schema}.</span>}
                          <span className="wk-ve-src-table">{t ? t.physicalName : tid}</span>
                          {t?.logicalName && <span className="wk-ve-src-sub">{t.logicalName}</span>}
                          {!t && <span className="wk-ve-src-sub">outside this canvas — columns preserved</span>}
                        </span>
                        {locked
                          ? <Lock size={11} className="wk-ve-src-lock" aria-label="Fixed source (opened from this table)" />
                          : (
                            <button type="button" className="wk-ve-src-x" title="Remove source" onClick={() => removeSource(tid)}>
                              <X size={12} />
                            </button>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
              <SearchSelect mono matchDetail options={sourceOptions} valueLabel=""
                placeholder={sourceOptions.length ? 'Add source table (from this canvas)…' : 'Every table of this canvas is already a source'}
                disabled={ro || sourceOptions.length === 0} onPick={addSource} />
              <div style={{ marginTop: 6, fontSize: 11, color: MUTED }}>Type to filter by schema, table or logical name (contains).</div>
            </div>
            {/* ── Al crear, la vista se suma a la membresía de este
                canvas (el llamador la agrega con addViewsToCanvas). Al editar
                no se muestra: la membresía se maneja desde Properties → Views
                («Add to this canvas» / «Remove from canvas»). ── */}
            {!editing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" role="switch" aria-checked={showOnCanvas} onClick={() => setShowOnCanvas((v) => !v)}
                  style={{ width: 34, height: 19, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: showOnCanvas ? PURPLE : '#CBD2DE', transition: 'background .12s', flex: 'none' }}>
                  <span style={{ position: 'absolute', top: 2, left: showOnCanvas ? 17 : 2, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left .12s' }} />
                </button>
                <span style={{ fontSize: 12.5, color: NAVY, fontWeight: 600 }}>Show on this canvas</span>
                <span style={{ fontSize: 10.5, color: MUTED }}>adds the new view to the current canvas — and to its DDL export</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Derecha · columnas por fuente + preview ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid #EEF1F5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: '#F3EEFF', color: PURPLE, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: NAVY }}>
                {sqlMode ? 'User-Defined SQL — informational' : <>Columns — include, rename, express &amp; cast</>}
              </h2>
              {/* Dos pestañas de la misma vista: las columnas (de ahí sale
                  el DDL) y la User-Defined SQL informativa. */}
              <div className="rd-seg" style={{ marginLeft: 'auto' }}>
                <button type="button" className={!sqlMode ? 'active' : ''} onClick={() => setSqlMode(false)}>Columns</button>
                <button type="button" className={sqlMode ? 'active' : ''} onClick={() => setSqlMode(true)}>User-Defined SQL</button>
              </div>
              {!sqlMode && (
                <span style={{ fontSize: 11.5, color: includedCount === 0 ? '#C0392B' : MUTED, fontWeight: includedCount === 0 ? 700 : 400 }}>{includedCount}/{validKeys.size} included</span>
              )}
            </div>
            {!sqlMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: MUTED }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search column…"
                  style={{ width: '100%', height: 32, padding: '0 10px 0 30px', border: '1px solid #DDE2EC', borderRadius: 8, fontSize: 12.5, color: NAVY, outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
              </div>
              <span style={{ flex: 1 }} />
              <button type="button" className="rd-btn rd-btn-secondary rd-btn-xs" onClick={() => setAll(true)}>Select all</button>
              <button type="button" className="rd-btn rd-btn-secondary rd-btn-xs" onClick={() => setAll(false)}>Clear</button>
            </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', minHeight: 0 }}>
            {/* Dos cuerpos: builder de columnas o User-Defined SQL. */}
            {!sqlMode && (<>
            {/* grilla de columnas agrupada por tabla fuente */}
            <div style={{ border: '1px solid #EAEDF2', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 10, padding: '9px 13px', background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED }}>
                <span /><span />
                {/* Columna redimensionable (arrastre del borde derecho). */}
                <span style={{ position: 'relative', paddingRight: 12 }}>Source column
                  <span title="Drag to resize this column" onPointerDown={startSrcResize}
                    style={{ position: 'absolute', right: 2, top: -9, bottom: -9, width: 9, cursor: 'col-resize', borderRight: '2px solid #D9DFEA' }} />
                </span>
                <span>Output name</span><span>Expression · free SQL</span><span>Cast · type</span><span>Definition</span>
              </div>
              {sourceIds.length === 0 && <div style={{ padding: '14px 13px', fontSize: 12.5, color: MUTED }}>Add a source table to pick columns.</div>}
              {sourceIds.map((tid) => {
                const t = tableById.get(tid);
                const keys = order.filter((k) => splitColKey(k).tableId === tid && validKeys.has(k)
                  && (!q || splitColKey(k).column.toLowerCase().includes(q)));
                return (
                  <div key={tid}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', background: '#F3F5FA', borderTop: '1px solid #EAEDF2', borderBottom: '1px solid #EAEDF2', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: '#56607A', minWidth: 0 }}>
                      <span style={{ color: PURPLE_DK, flex: 'none' }}>t{sourceIds.indexOf(tid) + 1}</span>
                      <span style={{ minWidth: 0, wordBreak: 'break-all' }}>{t ? `${t.schema ? `${t.schema}.` : ''}${t.physicalName}` : `${tid} (outside this canvas — columns preserved)`}</span>
                    </div>
                    {keys.length === 0 && <div style={{ padding: '10px 13px', fontSize: 12, color: MUTED }}>{q ? 'No column matches the search.' : 'The table has no columns.'}</div>}
                    {keys.map((k) => {
                      const meta = colMeta.get(k) ?? { name: splitColKey(k).column, dataType: '', description: '' };
                      const cc = cfg[k] ?? { included: false, output: meta.name, expression: '', castType: '' };
                      return (
                        <div key={k} style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 10, padding: '7px 13px', borderBottom: '1px solid #F2F4F8' }}>
                          <button type="button" onClick={() => patch(k, { included: !cc.included })} aria-pressed={cc.included} title={cc.included ? 'Incluida' : 'Excluida'}
                            style={{ width: 18, height: 18, borderRadius: 5, border: cc.included ? 'none' : '1.5px solid #CBD2DE', background: cc.included ? BLUE : '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                            {cc.included && <Check size={11} strokeWidth={2.6} color="#fff" />}
                          </button>
                          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
                            <button type="button" onClick={() => move(k, -1)} disabled={searching} title="Subir" style={updn(searching)}><ChevronUp size={13} /></button>
                            <button type="button" onClick={() => move(k, 1)} disabled={searching} title="Bajar" style={updn(searching)}><ChevronDown size={13} /></button>
                          </span>
                          {/* title = nombre completo · tipo (lectura
                              inmediata de nombres largos sin redimensionar). */}
                          <span title={`${meta.name}${meta.dataType ? ` · ${meta.dataType}` : ''}`}
                            style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: cc.included ? NAVY : '#A9B1BE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {meta.name}<span style={{ fontWeight: 400, color: MUTED, fontSize: 11 }}>  {meta.dataType}</span>
                          </span>
                          <input style={{ ...cellInput, opacity: cc.included ? 1 : 0.5 }} value={cc.output} disabled={!cc.included}
                            onChange={(e) => patch(k, { output: e.target.value })} placeholder={meta.name} />
                          <input style={{ ...cellInput, opacity: cc.included ? 1 : 0.5, borderColor: cc.expression.trim() ? '#E1D4FB' : '#DDE2EC', color: cc.expression.trim() ? PURPLE_DK : NAVY }}
                            value={cc.expression} disabled={!cc.included}
                            onChange={(e) => patch(k, { expression: e.target.value })} placeholder="expression… e.g. UPPER(col)" />
                          <input style={{ ...cellInput, opacity: cc.included ? 1 : 0.5, borderColor: cc.castType.trim() ? '#E1D4FB' : '#DDE2EC', color: cc.castType.trim() ? PURPLE_DK : NAVY }}
                            value={cc.castType} disabled={!cc.included} list="view-cast-types"
                            onChange={(e) => patch(k, { castType: e.target.value })} placeholder="cast a tipo…" />
                          {/* Definición propia de la columna de vista. Placeholder =
                              la definición heredada de la columna física (vacío ⇒ hereda). */}
                          <input style={{ ...cellInput, opacity: cc.included ? 1 : 0.5, borderColor: cc.description.trim() ? '#E1D4FB' : '#DDE2EC' }}
                            value={cc.description} disabled={!cc.included}
                            onChange={(e) => patch(k, { description: e.target.value })}
                            title={meta.description ? `Inherits from physical column: ${meta.description}` : undefined}
                            placeholder={meta.description || 'definition…'} />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {searching && <div style={{ marginTop: 7, fontSize: 11, color: MUTED }}>Clear the search to reorder columns.</div>}
            {/* Con 2+ fuentes el DDL las lista `FROM t1, t2` (como
                Erwin), sin JOIN. */}
            {sourceIds.length >= 2 && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: '#56607A', background: '#F7F9FC', border: '1px solid #EAEDF2', borderRadius: 8, padding: '7px 10px' }}>
                {sourceIds.length} sources — the DDL lists them as <span className="rd-mono">FROM t1, t2…</span> with no JOIN (Erwin default). A join or a WHERE can be noted in the <strong>User-Defined SQL</strong> (informational).
              </div>
            )}
            </>)}

            {/* ── User-Defined SQL: texto informativo, sin validar, no se exporta ── */}
            {sqlMode && (
              <div style={{ border: '1px solid #E1D4FB', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#F8F5FF', borderBottom: '1px solid #EEE7FB', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: PURPLE }}>
                  User-Defined SQL · Databricks SQL
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, textTransform: 'none', fontWeight: 600, color: MUTED }}>
                    Informational — stored with the view as text, never validated, not exported
                  </span>
                </div>
                <textarea
                  value={sqlDraft}
                  spellCheck={false}
                  onChange={(e) => setSqlDraft(e.target.value)}
                  placeholder={'CREATE OR REPLACE VIEW schema.view_name AS\nSELECT t1.col1, t2.col2\nFROM schema.tabla1 t1\n  INNER JOIN schema.tabla2 t2 ON t1.k = t2.k\nWHERE …'}
                  style={{ display: 'block', width: '100%', minHeight: 240, padding: '12px 14px', border: 'none', fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, color: NAVY, resize: 'vertical', outline: 'none', boxSizing: 'border-box', whiteSpace: 'pre' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: '1px solid #EEE7FB', background: '#FCFBFF', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: MUTED }}>
                    Saved exactly as written. The DDL is always generated from the columns (Columns tab).
                  </span>
                </div>
              </div>
            )}
            {/* preview DDL — mismo generador que el Export DDL */}
            <div style={{ marginTop: 14, border: '1px solid #E1D4FB', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#F8F5FF', borderBottom: '1px solid #EEE7FB', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: PURPLE }}>
                Resulting DDL · preview
              </div>
              <pre style={{ margin: 0, padding: '13px 15px', fontFamily: MONO, fontSize: 12, lineHeight: 1.7, color: includedCount === 0 ? '#C0392B' : '#3A4658', background: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview}</pre>
            </div>
          </div>
        </div>
      </fieldset>
      {/* Popup de alta montado encima de este diálogo (el mismo
          que usa el combo); ESC lo consume solo este popup. */}
      {schemaModal && (
        <SchemaCreateDialog kind="views" initialName={suggestVU ?? ''}
          onCreated={(n) => setSchema(n)} onClose={() => setSchemaModal(false)} />
      )}
    </Dialog>
  );
}
