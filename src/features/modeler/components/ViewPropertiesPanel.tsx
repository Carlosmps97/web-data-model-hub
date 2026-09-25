import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Eye, GripVertical, Pencil, Trash2, Unlink } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import { pushUndo } from '@/store/useUndoStore';
import { DEFAULT_DATABRICKS_OPTS, viewDDL, type DdlView } from '@/features/ddl';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import * as viewsSvc from '@/services/views.service';
import type { View, ViewInput } from '@/services/views.service';
import { viewSourceIds } from '../lib/viewGraph';
import { allSourceColumns } from '../lib/viewEditorLogic';
import { VIEW_TYPE_NAME, moveSource, syncViewTypeUdp } from '../lib/viewPanelLogic';
import { confirmDeleteView } from './deleteConfirm';
import AuditHistory from './AuditHistory';
import SchemaSelect from './SchemaSelect';
import UdpAssign from './UdpAssign';
import ViewEditor from './ViewEditor';
import { orderColumns } from '../lib/columnOrder';

type VTab = 'definition' | 'columns' | 'sources' | 'sql' | 'udps' | 'metadata';
const TABS: { id: VTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'sources', label: 'Sources' },
  { id: 'sql', label: 'Query SQL' },
  { id: 'udps', label: 'UDP' },
  { id: 'metadata', label: 'Metadata' },
];

/** Nombre EXACTO (CI) del UDP gestionado que refleja el modo — "Tipo de
 *  Vista", del catálogo fijo del kit (doc 61 r2; la DATA va en español). */

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5,
  background: '#F7F8FA', border: '1px solid #EAEDF2', borderRadius: 8,
  padding: '10px 12px', whiteSpace: 'pre', overflowX: 'auto', color: '#1A2B4A',
};

/**
 * Panel lateral de propiedades de una VISTA (doc 61, doc 91) — paridad con el
 * panel de tabla: click al bloque 'view' del canvas lo abre (selectedViewId).
 * Seis pestañas: Definition · Columns (reorden drag&drop + detalle por columna)
 * · Sources (fuentes + editor completo) · Query SQL (User-Defined SQL, modo
 * Personalizada) · UDP · Metadata (+ historial doc 51).
 *
 * Modo: `customSql` NO vacío = "Personalizada" (la sentencia gobierna el DDL,
 * verbatim y sin validar — doc 91 D6; `sources` lista todas las columnas de
 * las fuentes, D7; reorden/edición por columna quedan inactivos) — la verdad
 * técnica es el campo, el UDP "View Type" se sincroniza como dato reportable
 * (§2.3). Todas las escrituras van por viewsSvc.updateView (changeset-aware,
 * doc completo) con pre-imagen en el Undo (doc 50).
 */
export default function ViewPropertiesPanel({ pushToast, onResize }: {
  pushToast: (m: string, k?: 'err') => void;
  onResize?: (width: number) => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const selectedViewId = useModelerStore((s) => s.selectedViewId);
  const setSelectedView = useModelerStore((s) => s.setSelectedView);
  const reload = useModelerStore((s) => s.reload);
  // Doc 70: la visibilidad es por CANVAS (membresía), no un flag global.
  const removeViewFromCanvas = useModelerStore((s) => s.removeViewFromCanvas);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;

  const view = diagram?.views.find((v) => v.id === selectedViewId) ?? null;
  const isCustom = !!(view?.customSql ?? '').trim();

  const [tab, setTab] = useState<VTab>('definition');
  const [form, setForm] = useState({ name: '', schema: '', description: '' });
  const [savingDef, setSavingDef] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // User-Defined SQL (doc 61 §2.4 → doc 91 D6): borrador, sin validación.
  const [sqlDraft, setSqlDraft] = useState('');
  const [customEditing, setCustomEditing] = useState(false);
  const [sqlBusy, setSqlBusy] = useState(false);
  const [viewTypeDef, setViewTypeDef] = useState<UdpDefinition | null>(null);
  const [resizing, setResizing] = useState(false);
  // DnD del reorden de columnas (HTML5 nativo — patrón PropertiesPanel).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [after, setAfter] = useState(false);
  const [reordering, setReordering] = useState(false);

  // Selección zombi (vista borrada / fuera del canvas): cerrar el panel.
  useEffect(() => {
    if (diagram && selectedViewId && !diagram.views.some((v) => v.id === selectedViewId)) {
      setSelectedView(null);
    }
  }, [diagram, selectedViewId, setSelectedView]);

  // Re-sembrar el estado local al cambiar de vista (o tras reload con rename).
  useEffect(() => {
    if (!view) return;
    setForm({ name: view.name, schema: view.schema ?? '', description: view.description ?? '' });
    setSqlDraft((view.customSql ?? '').trim());
    setCustomEditing(false); setFocusedIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id]);

  // Doc 70: canvases donde la vista es miembro (Metadata) — vía el listado
  // global de su primera fuente (mismo endpoint del tab Views de la tabla).
  const [canvasNames, setCanvasNames] = useState<string[] | null>(null);
  useEffect(() => {
    const first = view ? viewSourceIds(view)[0] : undefined;
    if (!view || !first) { setCanvasNames([]); return undefined; }
    let alive = true;
    setCanvasNames(null);
    viewsSvc.tableViews(first)
      .then((r) => { if (alive) setCanvasNames((r.views.find((x) => x.id === view.id)?.canvases ?? []).map((c) => c.name)); })
      .catch(() => { if (alive) setCanvasNames([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, diagram]);

  // Def "View Type" (seed doc 61): gestionado — se cambia desde Query SQL.
  useEffect(() => {
    let alive = true;
    getUdpDefs(sessionProjectId())
      .then((d) => { if (alive) setViewTypeDef(d.find((x) => x.level === 'view' && x.name.trim().toLowerCase() === VIEW_TYPE_NAME) ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const tables = useMemo(() => diagram?.tables ?? [], [diagram]);
  const columns = useMemo(() => diagram?.columns ?? [], [diagram]);
  const srcIds = view ? viewSourceIds(view) : [];
  const tableName = (id: string) => tables.find((t) => t.id === id)?.physicalName ?? id;
  // Columnas por tabla (orden único, doc 94: PK primero) — doc 91 D7: al pasar
  // a User-Defined SQL `sources` pasa a ser TODAS las columnas de las fuentes.
  const colsByTable = useMemo(() => {
    const m = new Map<string, typeof columns>();
    for (const c of columns) { const a = m.get(c.tableId) ?? []; a.push(c); m.set(c.tableId, a); }
    for (const [k, a] of m) m.set(k, orderColumns(a));
    return m;
  }, [columns]);

  // DDL efectivo con el MISMO generador del Export (una sola fuente de verdad;
  // viewDDL ya resuelve el modo: customSql gana a sources; doc 91 D5: con 2+
  // fuentes `FROM t1, t2`).
  const effectiveDdl = useMemo(() => {
    if (!view) return '';
    const dv: DdlView = {
      id: view.id, name: view.name, schema: view.schema,
      tableId: view.tableId, sourceTableIds: view.sourceTableIds,
      sources: view.sources, sql: view.sql,
      customSql: view.customSql, description: view.description,
    };
    return viewDDL(dv, { ...DEFAULT_DATABRICKS_OPTS, includeComments: false },
      new Map(tables.map((t) => [t.id, t]))).trim();
  }, [view, tables]);

  // ── Resize (mismo contrato que los otros paneles) ──
  const startResize = (e: ReactPointerEvent) => {
    if (!onResize) return;
    e.preventDefault(); setResizing(true);
    const move = (ev: PointerEvent) => onResize(window.innerWidth - ev.clientX);
    const up = () => { setResizing(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  if (!view) return null;

  // Pre-imagen POR VALOR para el Undo (doc 50) — el payload es el doc completo.
  const viewPre = (): View => ({
    ...view,
    sources: view.sources?.map((s) => ({ ...s })),
    sourceTableIds: view.sourceTableIds ? [...view.sourceTableIds] : undefined,
    udpValues: view.udpValues ? { ...view.udpValues } : undefined,
  });

  /** Único camino de guardado del panel: updateView (changeset-aware) con el
   *  doc completo + inversa en el Undo + reload. */
  const saveView = async (patch: Partial<ViewInput>, label: string, toastMsg?: string) => {
    const pre = viewPre();
    await viewsSvc.updateView(view.id, { ...view, ...patch } as ViewInput);
    pushUndo(label, async () => { await viewsSvc.updateView(pre.id, pre as ViewInput); await reload(); });
    await reload();
    if (toastMsg) pushToast(toastMsg);
  };
  const saveErr = (e: unknown) =>
    pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err');

  const saveDef = async () => {
    setSavingDef(true);
    try {
      await saveView({
        name: form.name.trim() || view.name,
        schema: form.schema.trim() || undefined,
        description: form.description.trim() || undefined,
      }, `Edit view ${view.name}`, 'View updated');
    } catch (e) { saveErr(e); } finally { setSavingDef(false); }
  };
  const saveDescriptionOnBlur = async () => {
    if (!canEdit) return;
    const next = form.description.trim() || undefined;
    if ((view.description ?? undefined) === next) return;
    try { await saveView({ description: next }, `Edit view ${view.name}`); } catch (e) { saveErr(e); }
  };
  const askDelete = async () => {
    try {
      // Diálogo compartido con Properties › Views y el Object Inspector (doc 89 §3.5).
      const ok = await confirmDeleteView({
        name: view.name,
        action: async () => { await viewsSvc.deleteView(view.id); setSelectedView(null); await reload(); },
      });
      if (ok) pushToast('View deleted');
    } catch { pushToast("Couldn't delete", 'err'); }
  };

  // ── Columns: filas visibles — SIEMPRE desde `sources` (doc 91 D7: en modo
  // User-Defined SQL son todas las columnas de las fuentes) ──
  const entries = (view.sources ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (s.column ?? '').trim() || (s.expression ?? '').trim());
  const colTypeOf = (tableId: string | undefined, column: string | undefined) =>
    columns.find((c) => c.tableId === (tableId ?? srcIds[0]) && c.physicalName === column);
  const rows = entries.map(({ s, i }) => ({
    key: `s${i}`, idx: i,
    name: (s.outputAlias ?? '').trim() || s.column || s.expression || '',
    type: (s.castType ?? '').trim() || colTypeOf(s.tableId, s.column)?.dataType || '',
    fx: !!((s.expression ?? '').trim() || (s.castType ?? '').trim()),
  }));
  const canDrag = canEdit && !isCustom;

  const handleDrop = async (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx || !view.sources) return;
    let to = targetIdx + (after ? 1 : 0);
    if (dragIdx < to) to -= 1;
    setReordering(true);
    try {
      await saveView({ sources: moveSource(view.sources, dragIdx, to) }, `Reorder view ${view.name}`);
    } catch (e) { saveErr(e); } finally { setReordering(false); }
  };

  const saveSourcePatch = async (idx: number, patch: Partial<viewsSvc.ViewSource>) => {
    const next = (view.sources ?? []).map((s, i) => (i === idx ? { ...s, ...patch } : { ...s }));
    try { await saveView({ sources: next }, `Edit view column`); } catch (e) { saveErr(e); }
  };

  // ── Query SQL (User-Defined SQL, doc 91 D6/D7): se guarda VERBATIM, sin
  // validar; `sources` = todas las columnas de las fuentes (lo que pinta el canvas). ──
  const saveCustom = async () => {
    setSqlBusy(true);
    try {
      await saveView({
        customSql: sqlDraft.trim(),
        sources: allSourceColumns(srcIds, colsByTable, view.sources ?? []),
        udpValues: syncViewTypeUdp(view.udpValues, viewTypeDef?.id, true),
      }, `Edit view SQL ${view.name}`, 'Saved — the view is now Personalizada');
      setCustomEditing(false);
    } catch (e) { saveErr(e); } finally { setSqlBusy(false); }
  };
  const revertToRegular = async () => {
    const ok = await confirmDialog({
      title: 'Back to Regular',
      message: <>The User-Defined SQL will be <strong>discarded</strong> and the view will be generated from its Sources again (every column of the source tables — prune them in the View Editor).</>,
      confirmLabel: 'Discard SQL', cancelLabel: 'Cancel', variant: 'danger',
      action: async () => {
        await saveView({
          customSql: undefined,
          udpValues: syncViewTypeUdp(view.udpValues, viewTypeDef?.id, false),
        }, `Edit view SQL ${view.name}`, 'The view is Regular again');
        setSqlDraft(''); setCustomEditing(false);
      },
    }).catch(() => false);
    return ok;
  };

  const saveViewUdp = async (next: Record<string, string>) => {
    // "View Type" es gestionado (§2.3): preserva el valor actual pase lo que pase.
    const guarded = viewTypeDef
      ? syncViewTypeUdp(next, viewTypeDef.id, isCustom) ?? next
      : next;
    try { await saveView({ udpValues: guarded }, `Edit view ${view.name}`); } catch (e) { saveErr(e); }
  };

  const udpCount = Object.keys(view.udpValues ?? {}).length;
  const counts: Partial<Record<VTab, number>> = { columns: rows.length, udps: udpCount || undefined };
  const focused = focusedIdx !== null ? (view.sources ?? [])[focusedIdx] : null;
  const editingSql = customEditing || isCustom;

  return (
    <aside className="wk-props">
      {onResize && (
        <div className={`wk-props-resizer${resizing ? ' dragging' : ''}`}
          onPointerDown={startResize} title="Drag to resize" />
      )}
      {/* ── Header: glyph + nombre + "schema · view" + close ── */}
      <div className="wk-props-top">
        <div className="wk-props-head">
          <div className="wk-props-glyph" aria-hidden style={{ color: 'var(--purple)' }}><Eye size={17} strokeWidth={1.6} /></div>
          <div className="wk-props-id">
            <div className="wk-props-title">{view.name}</div>
            <div className="wk-props-sub">
              schema <span className="rd-mono">{view.schema || '—'}</span> · view · {isCustom ? 'Personalizada' : 'Regular'}
              {!canEdit && <span className="wk-props-ro">Read-only</span>}
            </div>
          </div>
          <button className="wk-props-close" title="Close" onClick={() => setSelectedView(null)}><Icon name="x" size={14} /></button>
        </div>
        <div className="wk-pp-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => { setTab(t.id); setFocusedIdx(null); }}>
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
            <div className="wk-props-field"><label>Name</label>
              <input className="rd-input rd-mono" disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="wk-props-field"><label>Schema</label>
              <SchemaSelect kind="views" value={form.schema} onChange={(v) => setForm({ ...form, schema: v })} disabled={!canEdit} />
            </div>
            <div className="wk-props-field"><label>Functional definition</label>
              <textarea className="wk-pp-textarea" disabled={!canEdit} placeholder="What this view represents…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => void saveDescriptionOnBlur()} />
            </div>
            {/* Doc 70: quitarla de ESTE canvas no la borra del modelo ni de
                otros canvases (antes: checkbox «Show on canvas», flag global). */}
            {canEdit && (
              <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', marginBottom: 8 }}
                title="Remove this view from the current canvas (it stays in the model and in other canvases)"
                onClick={() => void removeViewFromCanvas(view.id).then(() => pushToast('View removed from canvas')).catch(saveErr)}>
                <Unlink size={12} /> Remove from this canvas
              </button>
            )}
            {canEdit && (
              <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%' }} disabled={savingDef} onClick={saveDef}>
                {savingDef && <span className="rd-spin" aria-hidden />}{savingDef ? 'Saving…' : 'Save'}
              </button>
            )}
            {canEdit && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5' }}>
                <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--error, #C4314B)' }} onClick={askDelete}>
                  <Trash2 size={12} /> Delete view…
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Columns ── */}
        {tab === 'columns' && focusedIdx === null && (
          <>
            <div className="wk-props-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                View columns
                {reordering && <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden />}
              </span>
            </div>
            {isCustom && (
              <p className="wk-pp-cap" style={{ margin: '0 0 6px' }}>
                Personalizada — the User-Defined SQL governs the DDL; the canvas lists every column of the source tables. Reordering and per-column edits are disabled.
              </p>
            )}
            {rows.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>No columns yet.</div>}
            <div className="wk-pp-collist">
              {rows.map((r, listIdx) => (
                <div key={r.key}
                  className={`wk-pp-colrow${dragIdx === r.idx && canDrag ? ' dragging' : ''}${overIdx === r.idx && canDrag ? (after ? ' dropafter' : ' dropbefore') : ''}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, cursor: 'pointer' }}
                  onClick={() => setFocusedIdx(r.idx)}
                  onDragOver={(e) => {
                    if (!canDrag || dragIdx === null) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setOverIdx(r.idx); setAfter(e.clientY > rect.top + rect.height / 2);
                  }}
                  onDrop={() => { if (canDrag) { void handleDrop(r.idx); setDragIdx(null); setOverIdx(null); } }}>
                  {canDrag && (
                    <span draggable className="wk-pp-grip" title="Drag to reorder"
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={() => setDragIdx(r.idx)}
                      onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}>
                      <GripVertical size={12} />
                    </span>
                  )}
                  <span className="rd-mono" style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  {r.fx && <span title="Expression / cast" style={{ fontSize: 10, color: 'var(--purple)', fontWeight: 700 }}>fx</span>}
                  <span className="rd-mono" style={{ fontSize: 10.5, color: '#6B7486' }}>{r.type}</span>
                  <span style={{ color: '#9AA3B2', fontSize: 10 }} aria-hidden>#{listIdx + 1}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Columns · detalle de UNA columna de la vista ── */}
        {tab === 'columns' && focusedIdx !== null && (
          <>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginBottom: 10 }} onClick={() => setFocusedIdx(null)}>
              <ArrowLeft size={12} /> All columns
            </button>
            {focused && (() => {
              const phys = colTypeOf(focused.tableId, focused.column);
              return (
                <ColumnDetail key={`${view.id}:${focusedIdx}`} src={focused} idx={focusedIdx}
                  sourceTable={tableName(focused.tableId ?? srcIds[0] ?? '')}
                  inheritedType={phys?.dataType ?? ''} inheritedDef={phys?.description ?? ''}
                  canEdit={canEdit && !isCustom} onSave={saveSourcePatch} />
              );
            })()}
          </>
        )}

        {/* ── Sources ── */}
        {tab === 'sources' && (
          <>
            {isCustom && (
              <p className="wk-pp-cap" style={{ marginTop: 0 }}>
                Personalizada — the User-Defined SQL governs this view; the sources below only feed the canvas until you revert to Regular (Query SQL tab).
              </p>
            )}
            <div className="wk-props-sec" style={{ marginTop: 0 }}>Source tables</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {srcIds.length === 0 && <span className="rd-small" style={{ color: 'var(--muted)' }}>No sources.</span>}
              {srcIds.map((id, i) => (
                <span key={id} className="rd-mono" style={{ fontSize: 11.5, border: '1px solid #DCE1EA', borderRadius: 999, padding: '3px 10px', opacity: isCustom ? 0.55 : 1 }}>
                  t{i + 1} · {tableName(id)}
                </span>
              ))}
            </div>
            {/* Doc 91 D2/D5: sin Join/Where — con 2+ fuentes el DDL las lista
                `FROM t1, t2` (Erwin); un join o un WHERE viven en el User-Defined SQL. */}
            {srcIds.length > 1 && !isCustom && (
              <p className="wk-pp-cap">The DDL lists the sources as <span className="rd-mono">FROM t1, t2…</span> with no JOIN (Erwin default). Need a join or a WHERE? Use User-Defined SQL (Query SQL tab).</p>
            )}
            <p className="wk-pp-cap">Column participation, aliases and expressions are edited per column (Columns tab) or in the full editor.</p>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} disabled={isCustom && canEdit} onClick={() => setEditorOpen(true)}>
              {canEdit ? <Pencil size={12} /> : <Eye size={12} />} Open in View Editor
            </button>
          </>
        )}

        {/* ── Query SQL (sandbox doc 61 §2.4) ── */}
        {tab === 'sql' && (
          <>
            <p className="wk-pp-cap" style={{ marginTop: 0 }}>
              Body of <span className="rd-mono">CREATE OR REPLACE VIEW {view.schema ? `${view.schema}.` : ''}{view.name}</span>.
              Mode: <strong>{isCustom ? 'Personalizada' : 'Regular'}</strong>{isCustom ? ' (User-Defined SQL, emitted verbatim)' : ' (generated from Sources)'}.
            </p>
            {!editingSql && (
              <>
                <pre style={mono}>{effectiveDdl}</pre>
                {canEdit && (
                  <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%', marginTop: 10 }}
                    onClick={() => { setSqlDraft(effectiveDdl); setCustomEditing(true); }}>
                    User-Defined SQL (switch to Personalizada)
                  </button>
                )}
              </>
            )}
            {editingSql && (
              <>
                <textarea className="wk-pp-textarea rd-mono" spellCheck={false} disabled={!canEdit}
                  style={{ minHeight: 220, fontSize: 11.5, whiteSpace: 'pre', lineHeight: 1.45 }}
                  value={sqlDraft} placeholder={'CREATE OR REPLACE VIEW schema.view_name AS\nSELECT t1.col1, t2.col2\nFROM schema.tabla1 t1\n  INNER JOIN schema.tabla2 t2 ON t1.k = t2.k'}
                  onChange={(e) => setSqlDraft(e.target.value)} />
                <p className="wk-pp-cap" style={{ margin: '6px 0' }}>
                  The full <span className="rd-mono">CREATE VIEW</span> statement (Databricks SQL), saved exactly as written and emitted verbatim in the DDL export — never validated, as in Erwin. On the canvas the view lists every column of its source tables.
                </p>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={sqlBusy || !sqlDraft.trim()} onClick={() => void saveCustom()}>
                      {sqlBusy && <span className="rd-spin" aria-hidden />} Save as Personalizada
                    </button>
                    {isCustom
                      ? <button className="rd-btn rd-btn-ghost rd-btn-sm" disabled={sqlBusy} onClick={() => void revertToRegular()}>Back to Regular…</button>
                      : <button className="rd-btn rd-btn-ghost rd-btn-sm" disabled={sqlBusy} onClick={() => setCustomEditing(false)}>Cancel</button>}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── UDP ── */}
        {tab === 'udps' && (
          <>
            <p className="wk-pp-cap" style={{ marginTop: 0 }}>User Defined Properties — governance tags for this view.</p>
            <UdpAssign key={view.id} level="view" values={view.udpValues ?? {}} disabled={!canEdit}
              locked={viewTypeDef ? { [viewTypeDef.id]: 'Managed — the view mode is set from the Query SQL tab.' } : undefined}
              onChange={saveViewUdp} />
          </>
        )}

        {/* ── Metadata ── */}
        {tab === 'metadata' && (
          <>
            <dl className="wk-pp-meta">
              <dt>Name</dt><dd className="rd-mono">{view.name}</dd>
              <dt>Schema</dt><dd className="rd-mono">{view.schema || '—'}</dd>
              <dt>Mode</dt><dd>{isCustom ? 'Personalizada (User-Defined SQL)' : 'Regular (generated from sources)'}</dd>
              <dt>Canvases</dt><dd>{canvasNames === null ? '…' : canvasNames.length ? canvasNames.join(' · ') : '—'}</dd>
              <dt>Sources</dt><dd>{srcIds.length === 0 ? '—' : srcIds.map(tableName).join(' · ')}</dd>
              <dt>Columns</dt><dd>{rows.length}</dd>
              <dt>Definition</dt><dd>{view.description || '—'}</dd>
              <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{view.id}</dd>
            </dl>
            {/* Historial de auditoría (doc 51 extendido a vistas en doc 61). */}
            <AuditHistory kind="view" entityId={view.id} />
          </>
        )}
      </div>

      {editorOpen && (
        <ViewEditor view={view} readOnly={!canEdit}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { void reload(); }}
          pushToast={pushToast} />
      )}
    </aside>
  );
}

/** Detalle editable de UNA columna de vista (modo Regular): alias, expresión,
 *  cast y definición propia (placeholder = la HEREDADA de la física, doc 22). */
function ColumnDetail({ src, idx, sourceTable, inheritedType, inheritedDef, canEdit, onSave }: {
  src: viewsSvc.ViewSource; idx: number; sourceTable: string;
  inheritedType: string; inheritedDef: string; canEdit: boolean;
  onSave: (idx: number, patch: Partial<viewsSvc.ViewSource>) => Promise<void>;
}) {
  const [f, setF] = useState({
    output: src.outputAlias ?? '', expression: src.expression ?? '',
    castType: src.castType ?? '', description: src.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave(idx, {
        outputAlias: f.output.trim() && f.output.trim() !== (src.column ?? '') ? f.output.trim() : undefined,
        expression: f.expression.trim() || undefined,
        castType: f.castType.trim() || undefined,
        description: f.description.trim() || undefined,
      });
    } finally { setBusy(false); }
  };
  return (
    <>
      <dl className="wk-pp-meta" style={{ marginBottom: 10 }}>
        <dt>Source</dt><dd className="rd-mono">{src.column ? `${sourceTable}.${src.column}` : '— (expression)'}</dd>
        <dt>Type</dt><dd className="rd-mono">{src.castType?.trim() || inheritedType || '—'}{src.castType?.trim() ? ' (cast)' : ''}</dd>
      </dl>
      <div className="wk-props-field"><label>Output name (alias)</label>
        <input className="rd-input rd-mono" disabled={!canEdit} value={f.output} placeholder={src.column ?? ''} onChange={(e) => setF({ ...f, output: e.target.value })} />
      </div>
      <div className="wk-props-field"><label>Expression (SQL)</label>
        <input className="rd-input rd-mono" disabled={!canEdit} value={f.expression} placeholder="UPPER(col) · hash(col) · …" onChange={(e) => setF({ ...f, expression: e.target.value })} />
      </div>
      <div className="wk-props-field"><label>Cast type</label>
        <input className="rd-input rd-mono" disabled={!canEdit} value={f.castType} placeholder="STRING · DECIMAL(18,2) · …" onChange={(e) => setF({ ...f, castType: e.target.value })} />
      </div>
      <div className="wk-props-field"><label>Definition</label>
        <textarea className="wk-pp-textarea" disabled={!canEdit} value={f.description} placeholder={inheritedDef ? `${inheritedDef} (inherited)` : 'Inherits the physical column definition…'} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      {canEdit && (
        <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%' }} disabled={busy} onClick={() => void save()}>
          {busy && <span className="rd-spin" aria-hidden />}{busy ? 'Saving…' : 'Save column'}
        </button>
      )}
    </>
  );
}
