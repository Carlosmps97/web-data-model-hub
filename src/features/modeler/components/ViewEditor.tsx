import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Eye, Lock, Plus, Search, X } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import TagEditor from '@/components/ui/TagEditor';
import type { Tag } from '@/types/model';
import { COLUMN_DATA_TYPES } from '@/types/model';
import { useModelerStore } from '@/store/useModelerStore';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';
import { DEFAULT_DATABRICKS_OPTS, inferJoin, viewDDL, type DdlView } from '@/features/ddl';
import { colKey, splitColKey, serializeSources, resolveJoinOverride, type ColCfg } from '../lib/viewEditorLogic';
import { defaultViewSchema } from '../lib/schemaPick';
import SchemaSelect from './SchemaSelect';

const PURPLE = '#8B5CF6', PURPLE_DK = '#6D3FC4', BLUE = '#2E5BFF', NAVY = '#1A2B4A', MUTED = '#9AA3B2';
const MONO = "var(--mono, 'Geist Mono', monospace)";
const lbl: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 };
const idField: React.CSSProperties = { width: '100%', height: 42, padding: '0 13px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 10, fontFamily: MONO, fontSize: 13.5, color: NAVY, outline: 'none', boxSizing: 'border-box' };
const cellInput: React.CSSProperties = { width: '100%', height: 32, padding: '0 10px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 7, fontFamily: MONO, fontSize: 11.5, color: NAVY, outline: 'none', boxSizing: 'border-box' };
const link: React.CSSProperties = { border: 'none', background: 'transparent', color: BLUE, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const updn = (dis: boolean): React.CSSProperties => ({ height: 13, border: 'none', background: 'transparent', cursor: dis ? 'default' : 'pointer', color: dis ? '#D6DCE6' : '#8A93A5', padding: 0, lineHeight: 0 });
const GRID = '20px 24px 0.9fr 0.72fr 1fr 0.62fr 1.15fr';

/**
 * ViewEditor multi-fuente (F3, spec §3-5). Una vista nace de 1..N tablas del
 * canvas: chips de fuentes (buscador sobre las tablas del canvas), grilla de
 * columnas AGRUPADA por tabla origen (incluir, alias de salida, expresión SQL,
 * castType con combobox de tipos + libre), switch global "Mostrar en canvas"
 * (D3 — NO afecta el export DDL) y sección JOIN (con 2+ fuentes) precargada
 * con la condición inferida de las relaciones del modelo (D2), editable →
 * joinOverride. Sin relación ni condición manual, el guardado se bloquea.
 * El preview usa el MISMO generador que el Export DDL (`viewDDL`).
 */
export default function ViewEditor({
  lockedTableId, view, onClose, onSaved, pushToast, readOnly,
}: {
  /** Tabla pre-amarrada (abierto desde Properties→Views): fuente fija, no removible. */
  lockedTableId?: string;
  /** Vista existente ⇒ modo edición; ausente ⇒ creación. */
  view?: View;
  onClose: () => void;
  onSaved: () => void;
  pushToast: (m: string, k?: 'err') => void;
  /** Modo VISOR (F5): abre la vista solo-lectura desde un canvas productivo
   *  (sin changeset) — muestra definiciones sin necesidad de crear versión. */
  readOnly?: boolean;
}) {
  const editing = !!view;
  const ro = !!readOnly;
  const diagram = useModelerStore((s) => s.diagram);
  const tables = useMemo(() => diagram?.tables ?? [], [diagram]);
  const allColumns = useMemo(() => diagram?.columns ?? [], [diagram]);
  const relationships = useMemo(() => diagram?.relationships ?? [], [diagram]);
  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const canvasTables = useMemo(() => new Set(tables.map((t) => t.id)), [tables]);
  const colsByTable = useMemo(() => {
    const m = new Map<string, typeof allColumns>();
    for (const c of allColumns) { const a = m.get(c.tableId) ?? []; a.push(c); m.set(c.tableId, a); }
    for (const a of m.values()) a.sort((x, y) => x.ordinal - y.ordinal);
    return m;
  }, [allColumns]);

  // Fuentes iniciales: canónicas de la vista (fallback tableId legacy) o la
  // tabla pre-amarrada. Constante de montaje para los inicializadores.
  const initialSourceIds = view?.sourceTableIds?.length
    ? view.sourceTableIds
    : view?.tableId ? [view.tableId]
      : lockedTableId ? [lockedTableId] : [];
  const firstTable = tableById.get(initialSourceIds[0] ?? '');

  const [sourceIds, setSourceIds] = useState<string[]>(initialSourceIds);
  // Defaults de creación (doc 52 §4): nombre = el FÍSICO de la tabla origen
  // tal cual (M_CLIENTE → M_CLIENTE; antes `v_<físico>`); esquema = el de la
  // tabla como fallback, que el efecto de abajo upgradea a `<esquema>_VU` si
  // esa convención existe en el catálogo de vistas.
  const [name, setName] = useState(view?.name ?? (firstTable ? firstTable.physicalName : ''));
  const [schema, setSchema] = useState(view?.schema ?? firstTable?.schema ?? '');
  // Convención `_VU` (doc 52 §4), solo al CREAR: cuando el catálogo llega, si
  // existe `<esquemaTabla>_VU` (CI, kind vistas) se auto-selecciona UNA sola
  // vez — y solo si el usuario no tocó el campo (se compara contra el fallback
  // inicial; un valor editado no se pisa). Si no existe, queda el fallback.
  const storeSchemas = useModelerStore((s) => s.schemas);
  const schemaAutoRef = useRef<string | null>(view ? null : (firstTable?.schema ?? ''));
  useEffect(() => {
    const initial = schemaAutoRef.current;
    if (initial === null || ro) return;
    const hit = defaultViewSchema(firstTable?.schema, storeSchemas);
    if (!hit) return;
    schemaAutoRef.current = null;
    setSchema((cur) => (cur === initial ? hit : cur));
  }, [storeSchemas, ro, firstTable?.schema]);
  const [tags, setTags] = useState<Tag[]>(view?.tags ?? []);
  const [filter, setFilter] = useState(view?.filter ?? '');
  // "Show on this canvas" arranca ON al CREAR (doc 50 §5 — pedido del equipo);
  // al editar una existente se respeta lo persistido (un `?? true` pelado
  // habría "encendido" vistas legacy sin el campo).
  const [showOnCanvas, setShowOnCanvas] = useState(view ? (view.showOnCanvas ?? false) : true);
  // F5: definición funcional de la vista (nivel vista). Editable en el panel izq.
  const [description, setDescription] = useState(view?.description ?? '');
  const [search, setSearch] = useState('');
  const [srcSearch, setSrcSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Grilla: orden global + config por `${tableId}::${column}` ──
  const [{ order, cfg }, setGrid] = useState(() => {
    const srcItems = (view?.sources ?? []).filter((s) => s.column);
    const hasProjection = srcItems.length > 0;
    const order: string[] = [];
    const cfg: Record<string, ColCfg> = {};
    // 1) columnas proyectadas EN SU ORDEN (ítems legacy sin tableId ⇒ 1ª fuente)
    for (const s of srcItems) {
      const k = colKey(s.tableId ?? initialSourceIds[0] ?? '', s.column!);
      if (cfg[k]) continue;
      order.push(k);
      cfg[k] = { included: true, output: s.outputAlias ?? s.column!, expression: s.expression ?? '', castType: s.castType ?? '', description: s.description ?? '' };
    }
    // 2) resto de columnas de cada fuente: excluidas si ya hay proyección;
    //    TODAS incluidas en una vista nueva (comportamiento 07b-2).
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

  // Metadata por clave de las fuentes ACTUALES (nombre + tipo de la columna).
  const colMeta = useMemo(() => {
    const m = new Map<string, { name: string; dataType: string; description: string }>();
    for (const tid of sourceIds) {
      for (const c of colsByTable.get(tid) ?? []) m.set(colKey(tid, c.physicalName), { name: c.physicalName, dataType: c.dataType, description: c.description ?? '' });
    }
    return m;
  }, [sourceIds, colsByTable]);
  // Claves persistibles: las verificadas contra el canvas + las de fuentes
  // FUERA de este canvas (vista compartida abierta desde otro canvas): esas
  // columnas no se pueden verificar acá y se PRESERVAN para no perderlas.
  const validKeys = useMemo(() => {
    const s = new Set(colMeta.keys());
    for (const k of order) if (!canvasTables.has(splitColKey(k).tableId)) s.add(k);
    return s;
  }, [colMeta, order, canvasTables]);

  // ── JOIN (D2): inferido de las relaciones del canvas; editable ──
  const inferred = useMemo(() => inferJoin(sourceIds, relationships, allColumns), [sourceIds, relationships, allColumns]);
  const [joinText, setJoinText] = useState(view?.joinOverride ?? '');
  const [joinDirty, setJoinDirty] = useState(!!view?.joinOverride);
  // Precarga y re-sincroniza la condición inferida mientras el usuario no tocó
  // el textarea (agregar/quitar fuentes re-infiere).
  useEffect(() => { if (!joinDirty) setJoinText(inferred); }, [inferred, joinDirty]);

  const patch = (k: string, p: Partial<ColCfg>) => setGrid((g) => ({ ...g, cfg: { ...g.cfg, [k]: { ...g.cfg[k], ...p } } }));
  const setAll = (included: boolean) => setGrid((g) => {
    const next = { ...g.cfg };
    for (const k of g.order) if (validKeys.has(k)) next[k] = { ...next[k], included };
    return { ...g, cfg: next };
  });
  // Reordena DENTRO del grupo de su tabla (la grilla se renderiza agrupada).
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
    if (sourceIds.includes(tid)) return;
    setSourceIds((s) => [...s, tid]);
    setGrid((g) => {
      const order = [...g.order];
      const cfg = { ...g.cfg };
      for (const c of colsByTable.get(tid) ?? []) {
        const k = colKey(tid, c.physicalName);
        if (cfg[k]) continue;
        order.push(k);
        // Fuente agregada a una proyección existente ⇒ columnas EXCLUIDAS por
        // default (el usuario elige); en una vista nueva se incluye todo.
        cfg[k] = { included: !editing, output: c.physicalName, expression: '', castType: '', description: '' };
      }
      return { order, cfg };
    });
    setSrcSearch('');
  };
  const removeSource = (tid: string) => {
    if (tid === lockedTableId) return; // pre-amarrada: no removible
    setSourceIds((s) => s.filter((x) => x !== tid));
    setGrid((g) => ({
      order: g.order.filter((k) => splitColKey(k).tableId !== tid),
      cfg: Object.fromEntries(Object.entries(g.cfg).filter(([k]) => splitColKey(k).tableId !== tid)),
    }));
  };

  const candidates = useMemo(() => {
    const q = srcSearch.trim().toLowerCase();
    if (!q) return [];
    // Matchea nombre físico/lógico, ESQUEMA y el naming completo "esquema.tabla":
    // sin el esquema, escribir "bcp_ddv_…" devolvía 0 resultados aunque todas
    // las tablas del canvas colgaran de ese esquema.
    return tables
      .filter((t) => !sourceIds.includes(t.id) && (
        t.physicalName.toLowerCase().includes(q)
        || t.logicalName.toLowerCase().includes(q)
        || (t.schema ?? '').toLowerCase().includes(q)
        || `${t.schema ?? ''}.${t.physicalName}`.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [tables, sourceIds, srcSearch]);

  const includedCount = useMemo(
    () => order.filter((k) => validKeys.has(k) && cfg[k]?.included).length,
    [order, cfg, validKeys],
  );
  // Conectividad POR FUENTE: `inferred !== ''` NO alcanza — con 3+ fuentes una
  // intermedia sin relación aporta '' al AND y desaparece en silencio (producto
  // cartesiano). Cada fuente no-primera debe conectar con alguna ANTERIOR
  // (mismo predicado que inferJoin) o el usuario debe escribir un override.
  const allConnected = useMemo(() => sourceIds.every((tid, i) => {
    if (i === 0) return true;
    const prev = new Set(sourceIds.slice(0, i));
    return relationships.some((r) => (r.childTableId === tid && prev.has(r.parentTableId))
      || (r.parentTableId === tid && prev.has(r.childTableId)));
  }), [sourceIds, relationships]);
  const needsJoin = sourceIds.length >= 2;
  // Guardable si TODAS las fuentes conectan (JOIN derivado vivo) O hay override
  // manual (texto ≠ inferido ⇒ se emite verbatim y cubre lo que falte).
  const joinOk = !needsJoin || !!resolveJoinOverride(joinText, inferred) || (allConnected && !!joinText.trim());
  const canSave = !!name.trim() && sourceIds.length > 0 && includedCount > 0 && joinOk && !busy;

  // Preview con el MISMO generador del Export DDL — una sola fuente de verdad.
  const preview = useMemo(() => {
    if (includedCount === 0) return '-- Select at least one column for the view.';
    const dv: DdlView = {
      id: view?.id ?? 'new',
      name: name.trim() || 'view',
      schema: schema.trim() || undefined,
      filter: filter.trim() || undefined,
      tableId: sourceIds[0],
      sourceTableIds: sourceIds,
      joinOverride: resolveJoinOverride(joinText, inferred),
      sources: serializeSources(order, cfg, validKeys),
    };
    return viewDDL(dv, { ...DEFAULT_DATABRICKS_OPTS, includeComments: false },
      new Map(tables.map((t) => [t.id, t])), relationships, allColumns).trim();
  }, [includedCount, view, name, schema, filter, sourceIds, joinText, inferred, order, cfg, validKeys, tables, relationships, allColumns]);

  const save = async () => {
    if (!canSave || ro) return;
    setBusy(true);
    try {
      const body: viewsSvc.ViewInput = {
        name: name.trim(),
        schema: schema.trim() || undefined,
        tags: tags.length ? tags : undefined,
        filter: filter.trim() || undefined,
        sources: serializeSources(order, cfg, validKeys),
        sourceTableIds: sourceIds,
        tableId: sourceIds[0],            // compat legacy = primera fuente
        showOnCanvas,
        joinOverride: resolveJoinOverride(joinText, inferred),
        sql: preview,
        // F5: definición funcional de la vista, ahora EDITABLE (panel izq).
        // Vacío ⇒ undefined (no persistimos cadena vacía).
        description: description.trim() || undefined,
      };
      if (editing && view) await viewsSvc.updateView(view.id, body);
      else await viewsSvc.createView(body);
      pushToast(editing ? 'Vista actualizada' : 'Vista creada');
      onSaved();
      onClose();
    } catch (e) {
      // Propaga el motivo real (p.ej. el 409 del backend F3a: vista sin fuentes).
      pushToast(e instanceof Error && e.message ? e.message : "Couldn't save the view", 'err');
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
      subtitle={ro ? 'Read-only — definitions and structure as stored (create a version to edit)' : 'Define a view over one or more source tables — columns, aliases, CAST and JOIN'}
      icon={Eye}
      backdrop="canvas"
      canvasTop={136}
      width={1320}
      onClose={onClose}
      footer={
        ro ? (
          <>
            <span style={{ flex: 1, fontSize: 11.5, color: '#56607A' }}>Read-only — productive version. Create a version to edit this view.</span>
            <button className="rd-btn rd-btn-sm" onClick={onClose} style={{ background: PURPLE, color: '#fff', border: 'none' }}>Close</button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 11.5, color: '#56607A' }}>
              A view never copies data — it derives from {sourceIds.length === 1 ? 'its source table' : `its ${sourceIds.length} source tables`}.
            </span>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
            <button className="rd-btn rd-btn-sm" disabled={!canSave} onClick={save}
              title={!joinOk ? 'Define the JOIN condition between the sources' : includedCount === 0 ? 'Select at least one column' : undefined}
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
        {/* ── LEFT · identity + fuentes ── */}
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
              {/* Combobox de esquemas con buscador (docs 18/52) — solo esquemas
                  de VISTAS; se crean desde Structure · Esquemas. */}
              <SchemaSelect kind="views" value={schema} onChange={setSchema} className="" inputStyle={idField} />
            </div>
            {/* F5: definición funcional de la VISTA (nivel vista, no de columna). */}
            <div>
              <label style={lbl}>Functional definition</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What this view represents (business definition)…"
                style={{ width: '100%', minHeight: 66, padding: '10px 13px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 10, fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.55, color: NAVY, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {/* ── Fuentes: chips + buscador de tablas del canvas ── */}
            <div>
              <label style={lbl}>Source tables</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sourceIds.length === 0 && <span style={{ fontSize: 12, color: '#C0392B', fontWeight: 600 }}>Add at least one source table.</span>}
                {sourceIds.map((tid, i) => {
                  const t = tableById.get(tid);
                  const locked = tid === lockedTableId;
                  return (
                    <span key={tid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 8, background: i === 0 ? '#EFE7FD' : '#EEF2FB', border: `1px solid ${i === 0 ? '#E1D4FB' : '#DDE2EC'}`, fontFamily: MONO, fontSize: 11.5, color: NAVY }}>
                      <span style={{ color: PURPLE_DK, fontWeight: 700 }}>t{i + 1}</span>
                      {t ? `${t.schema ? `${t.schema}.` : ''}${t.physicalName}` : tid}
                      {locked
                        ? <Lock size={10} style={{ color: MUTED }} aria-label="Fixed source (opened from this table)" />
                        : (
                          <button type="button" title="Remove source" onClick={() => removeSource(tid)}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex', color: MUTED }}>
                            <X size={11} />
                          </button>
                        )}
                    </span>
                  );
                })}
              </div>
              <div style={{ position: 'relative', marginTop: 8 }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: MUTED }} />
                <input value={srcSearch} onChange={(e) => setSrcSearch(e.target.value)} placeholder="Add source table (from the canvas)…"
                  style={{ width: '100%', height: 32, padding: '0 10px 0 30px', border: '1px solid #DDE2EC', borderRadius: 8, fontSize: 12, color: NAVY, outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
                {srcSearch.trim() && (
                  <div style={{ position: 'absolute', top: 34, left: 0, right: 0, zIndex: 5, background: '#fff', border: '1px solid #DDE2EC', borderRadius: 8, boxShadow: '0 8px 22px rgba(20,30,60,.12)', maxHeight: 180, overflowY: 'auto' }}>
                    {candidates.length === 0 && <div style={{ padding: '8px 12px', fontSize: 12, color: MUTED }}>No matches on this canvas.</div>}
                    {candidates.map((t) => (
                      <button key={t.id} type="button" onClick={() => addSource(t.id)}
                        style={{ display: 'flex', width: '100%', gap: 8, alignItems: 'center', padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: MONO, fontSize: 12, color: NAVY }}>
                        <Plus size={12} style={{ color: BLUE }} />{t.schema ? `${t.schema}.` : ''}{t.physicalName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* ── Mostrar en canvas (D3: flag GLOBAL; NO afecta el export DDL) ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" role="switch" aria-checked={showOnCanvas} onClick={() => setShowOnCanvas((v) => !v)}
                style={{ width: 34, height: 19, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: showOnCanvas ? PURPLE : '#CBD2DE', transition: 'background .12s', flex: 'none' }}>
                <span style={{ position: 'absolute', top: 2, left: showOnCanvas ? 17 : 2, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left .12s' }} />
              </button>
              <span style={{ fontSize: 12.5, color: NAVY, fontWeight: 600 }}>Mostrar en canvas</span>
              <span style={{ fontSize: 10.5, color: MUTED }}>global · doesn't affect the DDL export</span>
            </div>
            <div>
              <label style={lbl}>Labels / tags</label>
              <TagEditor compact value={tags} onChange={setTags} keyPlaceholder="clave" valuePlaceholder="valor" />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 110 }}>
              <label style={lbl}>Filter · free SQL (WHERE)</label>
              <textarea value={filter} onChange={(e) => setFilter(e.target.value)}
                placeholder="estado = 'ACTIVA' AND saldo > 0"
                style={{ flex: 1, minHeight: 90, padding: '11px 13px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 10, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, color: NAVY, resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
              <div style={{ marginTop: 7, fontSize: 11, color: MUTED }}>Any boolean SQL expression — without the WHERE keyword.</div>
            </div>
          </div>
        </div>

        {/* ── RIGHT · columnas por fuente + JOIN + preview ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid #EEF1F5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: '#F3EEFF', color: PURPLE, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: NAVY }}>Columns — include, rename, express &amp; cast</h2>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: includedCount === 0 ? '#C0392B' : MUTED, fontWeight: includedCount === 0 ? 700 : 400 }}>{includedCount}/{validKeys.size} included</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: MUTED }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search column…"
                  style={{ width: '100%', height: 32, padding: '0 10px 0 30px', border: '1px solid #DDE2EC', borderRadius: 8, fontSize: 12.5, color: NAVY, outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
              </div>
              <span style={{ flex: 1 }} />
              <button type="button" style={link} onClick={() => setAll(true)}>Select all</button>
              <span style={{ color: '#D6DCE6' }}>·</span>
              <button type="button" style={{ ...link, color: MUTED }} onClick={() => setAll(false)}>Clear</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', minHeight: 0 }}>
            {/* grilla de columnas AGRUPADA por tabla fuente */}
            <div style={{ border: '1px solid #EAEDF2', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, padding: '9px 13px', background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED }}>
                <span /><span /><span>Source column</span><span>Output name</span><span>Expression · free SQL</span><span>Cast · type</span><span>Definition</span>
              </div>
              {sourceIds.length === 0 && <div style={{ padding: '14px 13px', fontSize: 12.5, color: MUTED }}>Add a source table to pick columns.</div>}
              {sourceIds.map((tid) => {
                const t = tableById.get(tid);
                const keys = order.filter((k) => splitColKey(k).tableId === tid && validKeys.has(k)
                  && (!q || splitColKey(k).column.toLowerCase().includes(q)));
                return (
                  <div key={tid}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', background: '#F3F5FA', borderTop: '1px solid #EAEDF2', borderBottom: '1px solid #EAEDF2', fontFamily: MONO, fontSize: 11, fontWeight: 700, color: '#56607A' }}>
                      <span style={{ color: PURPLE_DK }}>t{sourceIds.indexOf(tid) + 1}</span>
                      {t ? `${t.schema ? `${t.schema}.` : ''}${t.physicalName}` : `${tid} (outside this canvas — columns preserved)`}
                    </div>
                    {keys.length === 0 && <div style={{ padding: '10px 13px', fontSize: 12, color: MUTED }}>{q ? 'No column matches the search.' : 'The table has no columns.'}</div>}
                    {keys.map((k) => {
                      const meta = colMeta.get(k) ?? { name: splitColKey(k).column, dataType: '', description: '' };
                      const cc = cfg[k] ?? { included: false, output: meta.name, expression: '', castType: '' };
                      return (
                        <div key={k} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 10, padding: '7px 13px', borderBottom: '1px solid #F2F4F8' }}>
                          <button type="button" onClick={() => patch(k, { included: !cc.included })} aria-pressed={cc.included} title={cc.included ? 'Incluida' : 'Excluida'}
                            style={{ width: 18, height: 18, borderRadius: 5, border: cc.included ? 'none' : '1.5px solid #CBD2DE', background: cc.included ? BLUE : '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                            {cc.included && <Check size={11} strokeWidth={2.6} color="#fff" />}
                          </button>
                          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
                            <button type="button" onClick={() => move(k, -1)} disabled={searching} title="Subir" style={updn(searching)}><ChevronUp size={13} /></button>
                            <button type="button" onClick={() => move(k, 1)} disabled={searching} title="Bajar" style={updn(searching)}><ChevronDown size={13} /></button>
                          </span>
                          <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: cc.included ? NAVY : '#A9B1BE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                          {/* F5: definición propia de la columna-de-vista. Placeholder =
                              la definición HEREDADA de la columna física (vacío ⇒ hereda). */}
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

            {/* ── JOIN (2+ fuentes): inferido de relaciones (D2), editable ── */}
            {needsJoin && (
              <div style={{ marginTop: 14, border: `1px solid ${joinOk ? '#DDE2EC' : '#F3C1B8'}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED }}>
                  JOIN · condition between sources
                  {allConnected
                    ? <span style={{ marginLeft: 'auto', fontSize: 10.5, textTransform: 'none', fontWeight: 600, color: '#1E7F4F' }}>inferred from the model relationships</span>
                    : <span style={{ marginLeft: 'auto', fontSize: 10.5, textTransform: 'none', fontWeight: 600, color: '#C0392B' }}>{inferred ? 'some sources have no modeled relationship — complete the condition' : 'no modeled relationship — write it manually'}</span>}
                </div>
                <textarea
                  value={joinText}
                  onChange={(e) => { setJoinText(e.target.value); setJoinDirty(true); }}
                  placeholder="t1.column = t2.column"
                  style={{ display: 'block', width: '100%', minHeight: 64, padding: '11px 13px', border: 'none', fontFamily: MONO, fontSize: 12, lineHeight: 1.6, color: NAVY, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
                {!joinOk && (
                  <div style={{ padding: '0 14px 10px', fontSize: 11.5, color: '#C0392B', fontWeight: 600 }}>
                    {joinText.trim()
                      ? 'Some sources have no modeled relationship: edit the JOIN condition to cover them before saving.'
                      : 'Define the JOIN condition to save: there is no modeled relationship between the sources.'}
                  </div>
                )}
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
    </Dialog>
  );
}
