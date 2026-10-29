import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Eye, GripVertical, Pencil, Trash2, Unlink } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import { failureText, fieldsStep, inObjectOrder, useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { historyAction, pushUndo } from '@/store/useUndoStore';
import * as viewsSvc from '@/services/views.service';
import type { View, ViewInput } from '@/services/views.service';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { viewSourceIds } from '../lib/viewGraph';
import { moveSource, reseedDraft } from '../lib/viewPanelLogic';
import { generatedViewDdl } from '../lib/viewDdl';
import { confirmDeleteView } from './deleteConfirm';
import AuditHistory from './AuditHistory';
import SchemaSelect from './SchemaSelect';
import { useModelForm } from './useModelForm';
import ColorField from './ColorField';
import UdpAssign from './UdpAssign';
import ViewEditor from './ViewEditor';

type VTab = 'definition' | 'columns' | 'sources' | 'sql' | 'udps' | 'metadata';
const TABS: { id: VTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'sources', label: 'Sources' },
  { id: 'sql', label: 'Query SQL' },
  { id: 'udps', label: 'UDP' },
  { id: 'metadata', label: 'Metadata' },
];

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5,
  background: '#F7F8FA', border: '1px solid #EAEDF2', borderRadius: 8,
  padding: '10px 12px', whiteSpace: 'pre', overflowX: 'auto', color: '#1A2B4A',
};

/** El formulario de la definición sin vista (todavía no llegó al canvas). */
const EMPTY_FORM = { name: '', schema: '', description: '' };

/**
 * Panel lateral de propiedades de una vista, con paridad con el panel de tabla:
 * un clic al bloque 'view' del canvas lo abre (selectedViewId).
 * Seis pestañas: Definition · Columns (reorden drag&drop + detalle por columna)
 * · Sources (fuentes + editor completo) · Query SQL (DDL generado + User-Defined
 * SQL informativa) · UDP · Metadata (+ historial de auditoría).
 *
 * La User-Defined SQL (`customSql`) es texto informativo: el DDL sale siempre de
 * las columnas; no hay un modo que bloquee la edición de fuentes o columnas.
 * Todas las escrituras van por viewsSvc.updateView (changeset-aware, doc
 * completo) con pre-imagen en el Undo.
 */
export default function ViewPropertiesPanel({ pushToast, onResize }: {
  pushToast: (m: string, k?: 'err') => void;
  onResize?: (width: number) => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const selectedViewId = useModelerStore((s) => s.selectedViewId);
  const setSelectedView = useModelerStore((s) => s.setSelectedView);
  const reload = useModelerStore((s) => s.reload);
  // La visibilidad es por canvas (membresía), no un flag global.
  const removeViewFromCanvas = useModelerStore((s) => s.removeViewFromCanvas);
  const deleteView = useModelerStore((s) => s.deleteView);
  const setObjectColor = useModelerStore((s) => s.setObjectColor);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;

  const view = diagram?.views.find((v) => v.id === selectedViewId) ?? null;
  const hasSql = !!(view?.customSql ?? '').trim();   // solo informativo

  const [tab, setTab] = useState<VTab>('definition');
  // Se siembra al cambiar de vista; si la vista cambia en la versión (Undo,
  // Redo, el propio guardado), los campos sin cambios locales toman lo vigente
  // y lo que se está escribiendo se conserva (useModelForm).
  const [form, setForm] = useModelForm(view?.id, view ? { name: view.name, schema: view.schema ?? '', description: view.description ?? '' } : null, EMPTY_FORM);
  const [savingDef, setSavingDef] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // User-Defined SQL: texto informativo, sin validación.
  const [sqlDraft, setSqlDraft] = useState('');
  const [sqlBusy, setSqlBusy] = useState(false);
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

  // Re-sembrar la SQL y el foco al cambiar de vista. `storedSql` = la SQL
  // guardada que conoce el borrador.
  const storedSql = useRef('');
  useEffect(() => {
    if (!view) return;
    storedSql.current = (view.customSql ?? '').trim();
    setSqlDraft(storedSql.current);
    setFocusedIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id]);
  // Si la SQL guardada cambia por fuera (p. ej. en el View Editor), el borrador
  // la toma, salvo que tenga cambios locales sin guardar.
  useEffect(() => {
    const next = (view?.customSql ?? '').trim();
    if (next === storedSql.current) return;
    const prev = storedSql.current;
    storedSql.current = next;
    setSqlDraft((d) => reseedDraft(d, prev, next));
  }, [view?.customSql]);

  // Canvases donde la vista es miembro (Metadata), vía el listado global de su
  // primera fuente (mismo endpoint de la pestaña Views de la tabla).
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

  const tables = useMemo(() => diagram?.tables ?? [], [diagram]);
  const columns = useMemo(() => diagram?.columns ?? [], [diagram]);
  const srcIds = view ? viewSourceIds(view) : [];
  const tableName = (id: string) => tables.find((t) => t.id === id)?.physicalName ?? id;

  // DDL efectivo con el mismo generador del Export (sale de las columnas; la
  // User-Defined SQL es informativa): el mismo armado que el Inspector y el
  // export HTML.
  const effectiveDdl = useMemo(() => (view ? generatedViewDdl(view, tables) : ''), [view, tables]);

  // ── Resize (mismo contrato que los otros paneles) ──
  const startResize = (e: ReactPointerEvent) => {
    if (!onResize) return;
    e.preventDefault(); setResizing(true);
    const move = (ev: PointerEvent) => onResize(window.innerWidth - ev.clientX);
    const up = () => { setResizing(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  if (!view) return null;

  // Pre-imagen por valor para el Undo: el payload es el doc completo.
  const viewPre = (v: View): View => ({
    ...v,
    sources: v.sources?.map((s) => ({ ...s })),
    sourceTableIds: v.sourceTableIds ? [...v.sourceTableIds] : undefined,
    udpValues: v.udpValues ? { ...v.udpValues } : undefined,
  });

  /** Único camino de guardado del panel: updateView (changeset-aware) con el
   *  doc completo + inversa en el Undo + reload. Va en fila con el color de la
   *  vista (`inObjectOrder`) y parte del documento vigente de la working copy
   *  (así un segundo guardado no revierte el primero); si la vista no está en
   *  la working copy, avisa en vez de recrearla. */
  const saveView = (patch: Partial<ViewInput>, label: string, toastMsg?: string) => historyAction(async () => {
    const pin = pinSession();   // su inversa se apila solo en su sesión
    const id = view.id;
    const wrote = await inObjectOrder(id, async () => {
      pin.check();
      const cur = await viewsSvc.currentView(id);
      pin.check();
      if (!cur) throw new Error('This view is no longer in the working copy.');
      // Sin cambio respecto de lo vigente: nada que grabar.
      const keys = Object.keys(patch) as (keyof ViewInput)[];
      const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      if (keys.every((k) => same((cur as ViewInput)[k], patch[k]))) return false;
      const pre = viewPre(cur) as unknown as Record<string, unknown>;
      await viewsSvc.updateView(id, { ...cur, ...patch } as ViewInput);
      // La inversa restaura solo los campos que este guardado modifica (sobre lo vigente).
      pushUndo(label, fieldsStep('view', id, Object.fromEntries(keys.map((k) => [k, pre[k]])), { ...patch }, reload), pin);
      await reload();
      return true;
    });
    if (wrote && toastMsg) pushToast(toastMsg);
  });
  /** El `.catch` de un guardado, tomado al pedirlo: con la versión recién
   *  transferida calla (la revalidación ya avisó). */
  const saveErr = () => reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'));

  const saveDef = async () => {
    setSavingDef(true);
    const onError = saveErr();
    try {
      await saveView({
        name: form.name.trim() || view.name,
        schema: form.schema.trim() || undefined,
        description: form.description.trim() || undefined,
      }, `Edit view ${view.name}`, 'View updated');
    } catch (e) { await onError(e); } finally { setSavingDef(false); }
  };
  const saveDescriptionOnBlur = async () => {
    if (!canEdit) return;
    const next = form.description.trim() || undefined;
    const onError = saveErr();      // «sin cambio» lo decide `saveView` contra lo vigente
    try { await saveView({ description: next }, `Edit view ${view.name}`); } catch (e) { await onError(e); }
  };
  const askDelete = async () => {
    // Con la versión recién transferida el borrado termina con el error
    // original; la revalidación ya avisó, así que acá se calla.
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't delete", 'err'));
    try {
      // Diálogo compartido con Properties › Views y el Object Inspector, y la
      // misma acción del store: con Undo, que la repone en su sitio en cada
      // canvas que la listaba.
      const ok = await confirmDeleteView({
        name: view.name,
        action: async () => { await deleteView(view); setSelectedView(null); await reload(); },
      });
      if (ok) pushToast('View deleted');
    } catch (e) { await onError(e); }
  };

  // ── Columns: filas visibles, siempre desde `sources` ──
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
  const canDrag = canEdit;

  const handleDrop = async (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx || !view.sources) return;
    let to = targetIdx + (after ? 1 : 0);
    if (dragIdx < to) to -= 1;
    setReordering(true);
    const onError = saveErr();
    try {
      await saveView({ sources: moveSource(view.sources, dragIdx, to) }, `Reorder view ${view.name}`);
    } catch (e) { await onError(e); } finally { setReordering(false); }
  };

  const saveSourcePatch = async (idx: number, patch: Partial<viewsSvc.ViewSource>) => {
    const next = (view.sources ?? []).map((s, i) => (i === idx ? { ...s, ...patch } : { ...s }));
    const onError = saveErr();
    try { await saveView({ sources: next }, `Edit view column`); } catch (e) { await onError(e); }
  };

  // ── Query SQL: la User-Defined SQL se guarda como texto informativo
  // ('' ⇒ se quita); no toca las columnas ni el DDL. ──
  const saveSql = async () => {
    setSqlBusy(true);
    const onError = saveErr();
    try {
      await saveView({ customSql: sqlDraft.trim() || undefined }, `Edit view SQL ${view.name}`,
        sqlDraft.trim() ? 'User-Defined SQL saved (informational)' : 'User-Defined SQL removed');
    } catch (e) { await onError(e); } finally { setSqlBusy(false); }
  };

  const saveViewUdp = async (next: Record<string, string>) => {
    const onError = saveErr();
    try { await saveView({ udpValues: next }, `Edit view ${view.name}`); } catch (e) { await onError(e); }
  };

  const udpCount = Object.keys(view.udpValues ?? {}).length;
  const counts: Partial<Record<VTab, number>> = { columns: rows.length, udps: udpCount || undefined };
  const focused = focusedIdx !== null ? (view.sources ?? [])[focusedIdx] : null;

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
              schema <span className="rd-mono">{view.schema || '—'}</span> · view{hasSql ? ' · User-Defined SQL (info)' : ''}
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
            {/* Quitarla de este canvas no la borra del modelo ni de
                otros canvases. */}
            {canEdit && (
              <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" style={{ width: '100%', marginBottom: 8 }}
                title="Remove this view from the current canvas (it stays in the model and in other canvases)"
                onClick={() => void removeViewFromCanvas(view.id).then(() => pushToast('View removed from canvas'))
                  .catch(reportWriteError((e) => pushToast(failureText("Couldn't remove the view from this canvas", e), 'err')))}>
                <Unlink size={12} /> Remove from this canvas
              </button>
            )}
            {canEdit && (
              <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%' }} disabled={savingDef} onClick={saveDef}>
                {savingDef && <span className="rd-spin" aria-hidden />}{savingDef ? 'Saving…' : 'Save'}
              </button>
            )}
            {/* Color propio de la vista (el de todos sus canvases), como en las tablas. */}
            <div className="wk-pp-section">
              <ColorField id={view.id} own={view.color} canEdit={canEdit} noun="view"
                onPick={(ref) => {
                  const onError = reportWriteError((e) => pushToast(failureText("Couldn't change the color", e), 'err'));
                  void setObjectColor(view.id, ref).catch(onError);
                }} />
            </div>
            {canEdit && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5' }}>
                <button className="rd-btn rd-btn-danger rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={askDelete}>
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

        {/* ── Columns · detalle de una columna de la vista ── */}
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
                  canEdit={canEdit} onSave={saveSourcePatch} />
              );
            })()}
          </>
        )}

        {/* ── Sources ── */}
        {tab === 'sources' && (
          <>
            <div className="wk-props-sec" style={{ marginTop: 0 }}>Source tables</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {srcIds.length === 0 && <span className="rd-small" style={{ color: 'var(--muted)' }}>No sources.</span>}
              {srcIds.map((id, i) => (
                <span key={id} className="rd-mono" style={{ fontSize: 11.5, border: '1px solid #DCE1EA', borderRadius: 999, padding: '3px 10px' }}>
                  t{i + 1} · {tableName(id)}
                </span>
              ))}
            </div>
            {/* Con 2+ fuentes el DDL las lista `FROM t1, t2` sin JOIN
                (como Erwin); un join o un WHERE se anotan en la User-Defined SQL. */}
            {srcIds.length > 1 && (
              <p className="wk-pp-cap">The DDL lists the sources as <span className="rd-mono">FROM t1, t2…</span> with no JOIN (Erwin default). A join or a WHERE can be noted in the User-Defined SQL (Query SQL tab, informational).</p>
            )}
            <p className="wk-pp-cap">Column participation, aliases and expressions are edited per column (Columns tab) or in the full editor.</p>
            <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setEditorOpen(true)}>
              {canEdit ? <Pencil size={12} /> : <Eye size={12} />} Open in View Editor
            </button>
          </>
        )}

        {/* ── Query SQL: DDL generado de las columnas + User-Defined SQL informativa ── */}
        {tab === 'sql' && (
          <>
            <p className="wk-pp-cap" style={{ marginTop: 0 }}>
              Generated DDL of <span className="rd-mono">{view.schema ? `${view.schema}.` : ''}{view.name}</span> — always from the columns (Columns tab).
            </p>
            <pre style={mono}>{effectiveDdl}</pre>
            <div className="wk-props-sec">User-Defined SQL · informational</div>
            <textarea className="wk-pp-textarea rd-mono" spellCheck={false} disabled={!canEdit}
              style={{ minHeight: 160, fontSize: 11.5, whiteSpace: 'pre', lineHeight: 1.45 }}
              value={sqlDraft} placeholder={'Optional — e.g. the original CREATE VIEW, or the JOIN / WHERE of this view'}
              onChange={(e) => setSqlDraft(e.target.value)} />
            <p className="wk-pp-cap" style={{ margin: '6px 0' }}>
              Stored with the view exactly as written — never validated and not exported: the DDL is generated from the columns.
            </p>
            {canEdit && (
              <button className="rd-btn rd-btn-primary rd-btn-sm"
                disabled={sqlBusy || sqlDraft.trim() === (view.customSql ?? '').trim()} onClick={() => void saveSql()}>
                {sqlBusy && <span className="rd-spin" aria-hidden />} Save User-Defined SQL
              </button>
            )}
          </>
        )}

        {/* ── UDP ── */}
        {tab === 'udps' && (
          <>
            <p className="wk-pp-cap" style={{ marginTop: 0 }}>User Defined Properties — governance tags for this view.</p>
            <UdpAssign key={view.id} level="view" values={view.udpValues ?? {}} disabled={!canEdit}
              onChange={saveViewUdp} />
          </>
        )}

        {/* ── Metadata ── */}
        {tab === 'metadata' && (
          <>
            <dl className="wk-pp-meta">
              <dt>Name</dt><dd className="rd-mono">{view.name}</dd>
              <dt>Schema</dt><dd className="rd-mono">{view.schema || '—'}</dd>
              <dt>User-Defined SQL</dt><dd>{hasSql ? 'Informational — not exported (the DDL is generated from the columns)' : '—'}</dd>
              <dt>Canvases</dt><dd>{canvasNames === null ? '…' : canvasNames.length ? canvasNames.join(' · ') : '—'}</dd>
              <dt>Sources</dt><dd>{srcIds.length === 0 ? '—' : srcIds.map(tableName).join(' · ')}</dd>
              <dt>Columns</dt><dd>{rows.length}</dd>
              <dt>Definition</dt><dd>{view.description || '—'}</dd>
              <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{view.id}</dd>
            </dl>
            {/* Historial de auditoría de la vista. */}
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

/** Detalle editable de una columna de vista: alias, expresión, cast y
 *  definición propia (placeholder = la heredada de la física). */
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
