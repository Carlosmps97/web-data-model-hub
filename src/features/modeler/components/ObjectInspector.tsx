import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Crosshair, Eye, KeyRound, Link as LinkIcon, MapPin, Search, Table2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { useModelerStore, type InspectTarget } from '@/store/useModelerStore';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import { pushUndo } from '@/store/useUndoStore';
import * as gov from '@/services/governance.service';
import type { CanonicalColumn, TableUsageRow } from '@/services/governance.service';
import { getSnapshot, type SnapshotDomain, type UdpDefinition } from '@/features/standards/standards.service';
import { isAsOfChangesetId } from '@/services/versioning.service';
import { FACET_CAPTION, facetNoun, facetNouns, type Facet } from '@/lib/facets';
import { inspectTable, inspectView, type InspectTableResult, type InspectViewResult } from '../services/inspector.service';
import { matchesColumn } from '../lib/columnSearch';
import { moveId, orderColumns, persistReorder, reorderPlan } from '../lib/columnOrder';
import {
  cardinalityLabel, facetName, facetOnly, facetType, keyLabel, linkRole, otherFacet, ownColumns,
  positionIn, primaryCanvas, usagePath,
} from '../lib/inspectorModel';
import AuditHistory from './AuditHistory';
import SchemaSelect from './SchemaSelect';
import UdpAssign from './UdpAssign';
import UdpReadonly from './UdpReadonly';

/**
 * Object Inspector (doc 72 §3 · r2) — popup con la metadata completa de una
 * tabla/entidad (con sus columnas/atributos) o de una vista, SIN necesidad de
 * canvas: el estado efectivo de la versión abierta llega en UNA request
 * (`/api/catalog/inspect/…`). Tiene su propio switch Logical/Physical (arranca
 * en la faceta del canvas activo, o física sin canvas) y NO cambia el modo del
 * canvas. Lo que en el sidebar dependía del canvas («this canvas», posición)
 * se reemplaza por «Where used» + «Open in canvas».
 *
 * Edición (r2, decisión D6): con una sesión de EDICIÓN sobre un draft propio,
 * las ediciones "no de canvas" se hacen acá mismo y viajan por el MISMO camino
 * versionado que el sidebar (`gov.createTable` / `gov.updateColumn` = cambios
 * del changeset → diff, revisión, aprobación, historial, Undo): definición
 * funcional y esquema de la tabla, definición / nulabilidad / partición de
 * cada columna, orden de columnas POR FACETA y valores UDP (tabla y columna).
 * Nombres, tipos, dominios y llaves siguen editándose en el canvas: cascadean
 * a glosario, relaciones, vistas y DDL (nameSync / viewSync / keyOrder).
 */
export default function ObjectInspector() {
  const target = useModelerStore((s) => s.inspect);
  const close = useModelerStore((s) => s.closeInspector);
  if (!target) return null;
  return target.kind === 'view'
    ? <ViewInspector key={target.id} target={target} onClose={close} />
    : <TableInspector key={`${target.id}:${target.colId ?? ''}`} target={target} onClose={close} />;
}

interface Standards { udp: UdpDefinition[]; domains: SnapshotDomain[] }

/** Definiciones UDP + dominios (nombres) del snapshot de Data Standards. */
function useStandards(): Standards | null {
  const [std, setStd] = useState<Standards | null>(null);
  useEffect(() => {
    let alive = true;
    getSnapshot(sessionProjectId())
      .then((s) => { if (alive) setStd({ udp: s.udp ?? [], domains: s.domains ?? [] }); })
      .catch(() => { if (alive) setStd({ udp: [], domains: [] }); });
    return () => { alive = false; };
  }, []);
  return std;
}

/** Misma puerta de edición que el sidebar: sesión de edición sobre un draft
 *  (no un snapshot `asof:`). `writableCs()` del service vuelve a comprobarlo. */
function useCanEdit(): boolean {
  const openMode = useSessionStore((s) => s.openMode);
  const activeCs = useSessionStore((s) => s.activeChangesetId);
  return openMode === 'editing' && !!activeCs && !isAsOfChangesetId(activeCs);
}

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const muted = (text: ReactNode) => <div className="rd-small" style={{ color: 'var(--muted)' }}>{text}</div>;

function Footer({ usage, canEdit, onOpen, onClose }: { usage: TableUsageRow[] | null; canEdit: boolean; onOpen: () => void; onClose: () => void }) {
  const n = usage?.length ?? 0;
  const tip = !usage ? 'Loading…' : n === 0 ? 'Not placed on any canvas' : n > 1 ? 'Several canvases — pick one in “Where used”' : 'Open the canvas and center on the object';
  return (
    <>
      <span className="dmh-dialog-foot-left wk-insp-foot-note">
        {canEdit
          ? 'Effective state of the open version. Edits made here join the version like any canvas edit (review, diff, history, undo).'
          : 'Read-only · effective state of the open version. Open the model in edit mode to change definitions, order or UDPs here.'}
      </span>
      <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Close</button>
      <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={!usage || n === 0} title={tip} onClick={onOpen}>
        <Crosshair size={12} /> Open in canvas{n > 1 ? '…' : ''}
      </button>
    </>
  );
}

function FacetSwitch({ facet, onChange }: { facet: Facet; onChange: (f: Facet) => void }) {
  return (
    <div className="rd-seg" role="tablist" aria-label="Facet">
      {(['logical', 'physical'] as Facet[]).map((f) => (
        <button key={f} type="button" role="tab" aria-selected={facet === f} className={facet === f ? 'active' : ''} onClick={() => onChange(f)}>
          {f === 'logical' ? 'Logical' : 'Physical'}
        </button>
      ))}
    </div>
  );
}

function UsageList({ usage, activeSaId, noun, onOpen }: {
  usage: TableUsageRow[]; activeSaId: string | null; noun: string; onOpen: (u: TableUsageRow) => void;
}) {
  if (usage.length === 0) {
    return muted(<>This {noun} is not placed on any canvas — it lives only in the catalog. Draw it with “New table → Import existing” on a canvas.</>);
  }
  return (
    <>
      {usage.map((u) => {
        const here = u.canvasId === activeSaId;
        return (
          <div key={u.canvasId} className="wk-insp-usage">
            <MapPin size={13} style={{ color: here ? 'var(--primary)' : 'var(--text-muted-3)', flex: 'none' }} />
            <span className="path" title={usagePath(u)}>
              {u.project || '—'}<span className="sep">›</span>{u.folder || 'root'}<span className="sep">›</span><b className="rd-mono">{u.canvas}</b>
              {here && <span className="wk-insp-chip accent" style={{ marginLeft: 8 }}>open now</span>}
            </span>
            <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => onOpen(u)}>
              <Crosshair size={12} /> {here ? 'Center' : 'Open'}
            </button>
          </div>
        );
      })}
    </>
  );
}

// ── Tabla / entidad ─────────────────────────────────────────────────────────

type TTab = 'definition' | 'columns' | 'links' | 'views' | 'udps' | 'usage' | 'history';
const T_TABS: { id: TTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'links', label: 'Links' },
  { id: 'views', label: 'Views' },
  { id: 'udps', label: 'UDPs' },
  { id: 'usage', label: 'Where used' },
  { id: 'history', label: 'History' },
];

const CANVAS_ONLY_HINT = 'Names, types, domains and keys are edited on the canvas — they cascade to the glossary, relationships, views and the DDL.';

function TableInspector({ target, onClose }: { target: InspectTarget; onClose: () => void }) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const canvasFacet = useModelerStore((s) => s.viewMode);
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const openInspector = useModelerStore((s) => s.openInspector);
  const reloadDiagram = useModelerStore((s) => s.reload);
  const markDirty = useModelerStore((s) => s.markDirty);
  const onActiveCanvas = useModelerStore((s) => !!s.diagram?.tables.some((t) => t.id === target.id));
  const canEdit = useCanEdit();
  // D5: arranca en la faceta del canvas activo (o física sin canvas); no toca el canvas.
  const [facet, setFacet] = useState<Facet>(activeSaId ? canvasFacet : 'physical');
  const [data, setData] = useState<InspectTableResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TTab>(target.colId ? 'columns' : 'definition');
  const [selCol, setSelCol] = useState<string | null>(target.colId ?? null);
  const [colQ, setColQ] = useState('');
  const [form, setForm] = useState({ schema: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const std = useStandards();

  useEffect(() => {
    let alive = true;
    inspectTable(target.id)
      .then((d) => { if (alive) { setData(d); setForm({ schema: d.table.schema ?? '', description: d.table.description ?? '' }); } })
      .catch((e: unknown) => { if (alive) setError(errMsg(e, "Couldn't load the table")); });
    return () => { alive = false; };
  }, [target.id]);

  const table = data?.table;
  // Doc 81: mismo orden que el canvas y el properties — bloque PK primero +
  // resto por ordinal (antes era puro ordinal y con la carga Excel divergía).
  const cols = useMemo(() => (data ? orderColumns(data.columns) : []), [data]);
  const visible = useMemo(() => cols.filter((c) => matchesColumn(c, colQ)), [cols, colQ]);
  const col = selCol ? (data?.columns.find((c) => c.id === selCol) ?? null) : null;
  const domainName = (id?: string | null) => (id ? (std ? (std.domains.find((d) => d.id === id)?.name ?? id) : '…') : '—');
  const noun = facetNoun('table', facet);
  const nouns = facetNouns(facet);
  // Doc 85 §3.7: Views solo en físico; Columns se rotula Attributes en lógico.
  const tTabs = T_TABS.filter((t) => t.id !== 'views' || facet === 'physical')
    .map((t) => (t.id === 'columns' ? { ...t, label: nouns.Members } : t));
  useEffect(() => { if (tab === 'views' && facet !== 'physical') setTab('definition'); }, [tab, facet]);

  // ── Escritura versionada (r2): mismo camino que el sidebar + refresco ──
  const refresh = async () => { setData(await inspectTable(target.id)); };
  const afterSave = async () => {
    markDirty();
    await refresh();
    if (onActiveCanvas) await reloadDiagram();   // el canvas abierto muestra la tabla: reflejar
  };
  const saveTableDef = async () => {
    if (!data) return;
    const pre = { ...data.table };
    const next = { ...data.table, schema: form.schema.trim() || undefined, description: form.description.trim() || undefined };
    if ((pre.schema ?? '') === (next.schema ?? '') && (pre.description ?? '') === (next.description ?? '')) return;
    setSaving(true);
    try {
      await gov.createTable(next);
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterSave(); });
      await afterSave();
      toast.success(`${nouns.One} updated`);
    } catch (e) { toast.error(errMsg(e, "Couldn't save")); }
    finally { setSaving(false); }
  };
  const saveTableUdp = async (next: Record<string, string>) => {
    if (!data) return;
    const pre = { ...data.table, udpValues: { ...(data.table.udpValues ?? {}) } };
    try {
      await gov.createTable({ ...data.table, udpValues: next });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterSave(); });
      await afterSave();
    } catch (e) { toast.error(errMsg(e, "Couldn't save UDP")); }
  };
  const patchColumn = async (c: CanonicalColumn, fields: Partial<CanonicalColumn>) => {
    const pre = { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) };
    try {
      await gov.updateColumn({ ...c, ...fields });   // upsert por id = update (merge)
      pushUndo(`Edit column ${pre.physicalName}`, async () => { await gov.updateColumn(pre); await afterSave(); });
      await afterSave();
    } catch (e) { toast.error(errMsg(e, "Couldn't save")); }
  };
  /** Doc 74: mueve la columna en el único orden de la tabla (`ordinal`). */
  const move = async (colId: string, delta: number) => {
    if (!data || reordering) return;
    const ids = cols.map((c) => c.id);
    const from = ids.indexOf(colId), to = from + delta;
    // Doc 81: el bloque PK queda fijo (su orden se cambia en el properties);
    // un no-PK no puede cruzar hacia el bloque PK (el display lo re-agruparía).
    if (cols[from]?.isPrimaryKey || cols[to]?.isPrimaryKey) return;
    const nextIds = moveId(ids, colId, delta);
    if (nextIds === ids) return;
    const plan = reorderPlan(data.columns, nextIds);
    if (!plan.length) return;
    setReordering(true);
    // Optimista: el inspector reordena ya; la persistencia corre detrás.
    setData((d) => d && ({ ...d, columns: d.columns.map((c) => { const s = plan.find((p) => p.c.id === c.id); return s ? { ...c, ordinal: s.idx } : c; }) }));
    try {
      await persistReorder(plan, (c, idx) => gov.updateColumn({ ...c, ordinal: idx }));
      pushUndo('Reorder columns',
        async () => { await persistReorder(plan, (c) => gov.updateColumn(c)); await afterSave(); });
      await afterSave();
    } catch (e) { toast.error(errMsg(e, "Couldn't reorder")); await refresh().catch(() => {}); }
    finally { setReordering(false); }
  };

  const goCanvas = (u: TableUsageRow) => {
    onClose();
    const label = col ? `${table?.physicalName ?? ''} · ${col.physicalName}` : (table?.physicalName ?? '');
    openCanvasAndFocus(u.canvasId, u.projectId ?? undefined, target.id, selCol ?? undefined, label)
      .catch(() => toast.error("Couldn't open the canvas"));
  };
  const openPrimary = () => {
    if (!data) return;
    const c = primaryCanvas(data.usage, activeSaId);
    if (c) goCanvas(c); else setTab('usage');
  };
  const counts: Partial<Record<TTab, number>> = data
    ? { columns: data.columns.length, links: data.links.length, views: data.views.length, usage: data.usage.length }
    : {};
  const parents = data ? data.links.filter((l) => linkRole(l, target.id) === 'parent').length : 0;
  const children = data ? data.links.length - parents : 0;
  const canReorder = canEdit && !colQ.trim() && !reordering;

  return (
    <Dialog open title="Object Inspector" icon={Table2} width={960} onClose={onClose}
      subtitle={`${facet === 'logical' ? 'Entity' : 'Table'} metadata — the effective state of the open version, no canvas needed`}
      footer={<Footer usage={data?.usage ?? null} canEdit={canEdit} onOpen={openPrimary} onClose={onClose} />}>
      <div className="wk-insp">
        {error && <div className="wk-findres-empty rd-small" role="alert">{error}</div>}
        {!error && !data && <div className="wk-insp-loading"><span className="rd-spin" aria-hidden /> Loading…</div>}
        {data && table && (
          <>
            <div className="wk-insp-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={`wk-insp-title${facet === 'physical' ? ' rd-mono' : ''}`}>{facetName(table, facet) || '—'}</div>
                <div className="wk-insp-other">
                  {facet === 'logical' ? 'Physical' : 'Logical'}: <span className={facet === 'logical' ? 'rd-mono' : ''}>{facetName(table, otherFacet(facet)) || '—'}</span>
                </div>
                <div className="wk-insp-chips">
                  <span className="wk-insp-chip accent">{noun}</span>
                  <span className="wk-insp-chip rd-mono">schema {table.schema || '—'}</span>
                  {facetOnly(table) && <span className="wk-insp-chip">{facetOnly(table)} only</span>}
                  <span className="wk-insp-chip">{data.columns.length} {data.columns.length === 1 ? nouns.member : nouns.members}</span>
                  <span className="wk-insp-chip">{data.usage.length === 0 ? 'not on any canvas' : `${data.usage.length} canvas${data.usage.length === 1 ? '' : 'es'}`}</span>
                  {canEdit && <span className="wk-insp-chip">editable</span>}
                </div>
              </div>
              <FacetSwitch facet={facet} onChange={setFacet} />
            </div>
            <div className="wk-pp-tabs" role="tablist">
              {tTabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}{counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
                </button>
              ))}
            </div>
            <div className="wk-insp-body">
              {tab === 'definition' && (
                <>
                  {canEdit && <div className="wk-insp-ro">{CANVAS_ONLY_HINT}</div>}
                  <dl className="wk-pp-meta">
                    <dt>Logical name</dt><dd>{table.logicalName || '—'}</dd>
                    <dt>Physical name</dt><dd className="rd-mono">{table.physicalName || '—'}</dd>
                    <dt>Schema</dt>
                    <dd>{canEdit
                      ? <SchemaSelect kind="tables" value={form.schema} onChange={(v) => setForm({ ...form, schema: v })} disabled={saving} />
                      : <span className="rd-mono">{table.schema || '—'}</span>}</dd>
                    <dt>Facets</dt><dd>{facetOnly(table) === 'logical' ? 'Logical only (entity without a physical table)' : facetOnly(table) === 'physical' ? 'Physical only (table without a logical entity)' : 'Logical and physical'}</dd>
                    <dt>Definition</dt>
                    <dd>{canEdit
                      ? <textarea className="wk-pp-textarea" placeholder="What this entity represents…" value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => void saveTableDef()} disabled={saving} />
                      : (table.description || '—')}</dd>
                    <dt>{nouns.Members}</dt><dd>{data.columns.length}</dd>
                    <dt>Relationships</dt><dd>{data.links.length === 0 ? '—' : `${data.links.length} link${data.links.length === 1 ? '' : 's'} · ${parents} parent${parents === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'}`}</dd>
                    <dt>Views</dt><dd>{data.views.length || '—'}</dd>
                    <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{table.id}</dd>
                  </dl>
                  {canEdit && (
                    <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ marginTop: 12 }} disabled={saving} onClick={() => void saveTableDef()}>
                      {saving && <span className="rd-spin" aria-hidden />}{saving ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </>
              )}

              {tab === 'columns' && col && (
                <ColumnDetail col={col} cols={data.columns} facet={facet} std={std} canEdit={canEdit}
                  tableLabel={`${table.schema ? `${table.schema}.` : ''}${table.physicalName}`}
                  domainName={domainName(col.parentDomainId)} onBack={() => setSelCol(null)}
                  onPatch={(fields) => patchColumn(col, fields)} />
              )}
              {tab === 'columns' && !col && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}>
                    Click a row for the full detail (both facets, UDPs, history).
                    {canEdit ? ' Use ↑ ↓ to reorder the columns.' : ''}
                    {reordering && <span className="rd-spin" style={{ marginLeft: 6, color: 'var(--primary)' }} aria-hidden />}
                  </p>
                  {cols.length > 0 && (
                    <div className="wk-insp-find">
                      <Search size={12} aria-hidden />
                      <input className="rd-input" placeholder={`Find ${nouns.aMember} (contains…)`} value={colQ} onChange={(e) => setColQ(e.target.value)} aria-label={`Find ${nouns.aMember}`} />
                    </div>
                  )}
                  {canEdit && colQ.trim() && cols.length > 0 && <p className="wk-pp-cap">Reordering is disabled while filtering.</p>}
                  {visible.length === 0
                    ? muted(cols.length === 0 ? 'No columns.' : `No columns match “${colQ.trim()}”.`)
                    : (
                      <table className="wk-insp-grid">
                        <thead>
                          <tr>
                            <th>#</th>
                            {canReorder && <th />}
                            <th>Key</th>
                            <th>{facet === 'logical' ? 'Attribute' : 'Column'}</th>
                            <th>{facet === 'logical' ? 'Physical' : 'Logical'}</th>
                            <th>Type</th><th>Domain</th><th>Null</th><th>Definition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((c) => {
                            const only = facetOnly(c);
                            const i = cols.indexOf(c);
                            return (
                              <tr key={c.id} onClick={() => setSelCol(c.id)} title="Open the column detail">
                                <td className="n">{i + 1}</td>
                                {canReorder && (
                                  <td className="mv" onClick={(e) => e.stopPropagation()}>
                                    <button type="button" className="wk-insp-mv" title={c.isPrimaryKey ? 'Reorder keys in the table properties' : 'Move up'} disabled={i === 0 || c.isPrimaryKey || !!cols[i - 1]?.isPrimaryKey} onClick={() => void move(c.id, -1)}>↑</button>
                                    <button type="button" className="wk-insp-mv" title={c.isPrimaryKey ? 'Reorder keys in the table properties' : 'Move down'} disabled={i === cols.length - 1 || c.isPrimaryKey} onClick={() => void move(c.id, 1)}>↓</button>
                                  </td>
                                )}
                                <td className="k">{c.isPrimaryKey && <KeyRound size={11} className="pk" />}{c.isForeignKey && <LinkIcon size={11} className="fk" />}</td>
                                <td className={facet === 'physical' ? 'rd-mono' : ''}>{facetName(c, facet)}{only && <span className="wk-insp-only">{only} only</span>}</td>
                                <td className={`muted${facet === 'logical' ? ' rd-mono' : ''}`}>{facetName(c, otherFacet(facet))}</td>
                                <td className="rd-mono">{facetType(c, facet) || '—'}</td>
                                <td>{domainName(c.parentDomainId)}</td>
                                <td>{c.isNullable !== false ? 'Yes' : 'No'}</td>
                                <td className="def" title={c.description ?? undefined}>{c.description || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                </>
              )}

              {tab === 'links' && (
                <>
                  {data.links.length === 0 && muted(`This ${noun} has no relationships.`)}
                  {data.links.map((l) => {
                    const role = linkRole(l, target.id);
                    const otherId = role === 'parent' ? l.parentTableId : l.childTableId;
                    return (
                      <div className="wk-pp-link" key={l.id}>
                        <div className="wk-pp-link-head">
                          <span className={`wk-pp-role ${role}`}>{role.toUpperCase()}</span>
                          <span className="rd-mono">{l.parentTableName}</span>
                          <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                          <span className="rd-mono">{l.childTableName}</span>
                          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }} title="Inspect the other table"
                            onClick={() => openInspector({ kind: 'table', id: otherId })}>
                            <Eye size={12} />
                          </button>
                        </div>
                        <div className="wk-pp-link-card">
                          <span className="rd-mono">on {ownColumns(l, target.id).join(', ')}</span>
                          <span className="wk-pp-card-lbl">{cardinalityLabel(l)}</span>
                        </div>
                        <div className="wk-pp-link-card">
                          <span className="rd-small" style={{ color: 'var(--muted)' }}>
                            visible in {l.canvases.length > 0 ? l.canvases.map((c) => c.name).join(' · ') : 'no shared canvas'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {tab === 'views' && (
                <>
                  {data.views.length === 0 && muted(`No views on this ${noun}.`)}
                  {data.views.map((v) => (
                    <div key={v.id} className="wk-insp-view-row">
                      <Eye size={13} style={{ color: 'var(--purple)', flex: 'none' }} />
                      <span className="rd-mono" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.schema ? `${v.schema}.` : ''}{v.name}
                      </span>
                      {v.customSql?.trim() ? <span className="wk-insp-chip">custom SQL</span> : null}
                      <span className="wk-srch-chips" style={{ marginLeft: 'auto', maxWidth: '45%' }}>
                        {v.canvases.length === 0 && <span className="wk-srch-none">not on any canvas</span>}
                        {v.canvases.slice(0, 4).map((c) => <span key={c.id} className="wk-srch-chip">{c.name}</span>)}
                        {v.canvases.length > 4 && <span className="wk-srch-none">+{v.canvases.length - 4} more</span>}
                      </span>
                      <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" title="Inspect this view" onClick={() => openInspector({ kind: 'view', id: v.id })}>
                        <Eye size={12} /> Inspect
                      </button>
                    </div>
                  ))}
                </>
              )}

              {tab === 'udps' && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}><b>{FACET_CAPTION.table[facet]}</b> — governance tags of this facet{canEdit ? '' : ' (read-only)'}.</p>
                  {canEdit
                    ? <UdpAssign key={`${table.id}:${facet}`} level="table" view={facet} values={table.udpValues ?? {}} onChange={(next) => void saveTableUdp(next)} />
                    : std ? <UdpReadonly defs={std.udp} level="table" facet={facet} values={table.udpValues ?? {}} /> : muted('Loading…')}
                </>
              )}

              {tab === 'usage' && <UsageList usage={data.usage} activeSaId={activeSaId} noun={noun} onOpen={goCanvas} />}

              {tab === 'history' && <AuditHistory kind="table" entityId={target.id} />}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function ColumnDetail({ col, cols, facet, std, canEdit, tableLabel, domainName, onBack, onPatch }: {
  col: CanonicalColumn; cols: CanonicalColumn[]; facet: Facet; std: Standards | null; canEdit: boolean;
  tableLabel: string; domainName: string; onBack: () => void;
  onPatch: (fields: Partial<CanonicalColumn>) => Promise<void>;
}) {
  const position = positionIn(cols, col.id);
  const only = facetOnly(col);
  const nouns = facetNouns(facet);
  const [desc, setDesc] = useState(col.description ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDesc(col.description ?? ''); }, [col.id, col.description]);
  const saveDesc = async () => {
    const next = desc.trim() || undefined;
    if ((col.description ?? undefined) === next) return;
    setBusy(true);
    try { await onPatch({ description: next }); } finally { setBusy(false); }
  };
  const flag = (field: 'isNullable' | 'isPartition', value: boolean) => async () => {
    setBusy(true);
    try { await onPatch({ [field]: value }); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onBack}><ArrowLeft size={12} /> All {nouns.members}</button>
      <div className="wk-insp-colhead">
        {col.isPrimaryKey && <KeyRound size={14} style={{ color: 'var(--k-pk)' }} />}
        {col.isForeignKey && <LinkIcon size={14} style={{ color: 'var(--k-fk)' }} />}
        <span className={facet === 'physical' ? 'rd-mono' : ''}>{facetName(col, facet)}</span>
        <span className="wk-insp-chip accent">{facetNoun('column', facet)}</span>
        {only && <span className="wk-insp-chip">{only} only</span>}
        {busy && <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden />}
      </div>
      {canEdit && <div className="wk-insp-ro">{CANVAS_ONLY_HINT}</div>}
      <dl className="wk-pp-meta">
        <dt>Logical name</dt><dd>{col.logicalName || '—'}</dd>
        <dt>Physical name</dt><dd className="rd-mono">{col.physicalName || '—'}</dd>
        <dt>{nouns.One}</dt><dd className="rd-mono">{tableLabel}</dd>
        <dt>Logical type</dt><dd className="rd-mono">{col.logicalDataType || <span className="wk-insp-default">{col.dataType || '—'} (physical)</span>}</dd>
        <dt>Physical type</dt><dd className="rd-mono">{col.dataType || '—'}</dd>
        <dt>Parent Domain</dt><dd>{domainName}</dd>
        <dt>Keys</dt><dd>{keyLabel(col, cols)}</dd>
        <dt>Nullable</dt>
        <dd>{canEdit
          ? <label className={`wk-pp-flag nl${col.isNullable !== false ? ' on' : ''}`}><input type="checkbox" disabled={busy} checked={col.isNullable !== false} onChange={flag('isNullable', col.isNullable === false)} /> Nullable</label>
          : (col.isNullable !== false ? 'Yes' : 'No')}</dd>
        <dt>Partition</dt>
        <dd>{canEdit
          ? <label className={`wk-pp-flag pt${col.isPartition ? ' on' : ''}`}><input type="checkbox" disabled={busy} checked={!!col.isPartition} onChange={flag('isPartition', !col.isPartition)} /> Partition</label>
          : (col.isPartition ? 'Yes' : 'No')}</dd>
        <dt>Position</dt><dd>#{position.pos} <span className="wk-insp-default">of {position.of}</span></dd>
        <dt>Definition</dt>
        <dd>{canEdit
          ? <textarea className="wk-pp-textarea" placeholder="What this column holds…" value={desc} disabled={busy}
            onChange={(e) => setDesc(e.target.value)} onBlur={() => void saveDesc()} />
          : (col.description || '—')}</dd>
        <dt>Physical comment</dt><dd>{col.physicalDescription || <span className="wk-insp-default">same as the definition</span>}</dd>
        <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{col.id}</dd>
      </dl>
      <div className="wk-props-sec">{FACET_CAPTION.column[facet]}</div>
      {canEdit
        ? <UdpAssign key={`${col.id}:${facet}`} level="column" view={facet} values={col.udpValues ?? {}} onChange={(next) => void onPatch({ udpValues: next })} />
        : std ? <UdpReadonly defs={std.udp} level="column" facet={facet} values={col.udpValues ?? {}} /> : muted('Loading…')}
      <div style={{ marginTop: 14 }}><AuditHistory kind="column" entityId={col.id} /></div>
    </>
  );
}

// ── Vista ───────────────────────────────────────────────────────────────────

type VTab = 'definition' | 'columns' | 'sql' | 'udps' | 'usage' | 'history';
const V_TABS: { id: VTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'sql', label: 'SQL' },
  { id: 'udps', label: 'UDPs' },
  { id: 'usage', label: 'Where used' },
  { id: 'history', label: 'History' },
];

function ViewInspector({ target, onClose }: { target: InspectTarget; onClose: () => void }) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const openInspector = useModelerStore((s) => s.openInspector);
  const [data, setData] = useState<InspectViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<VTab>('definition');
  const std = useStandards();

  useEffect(() => {
    let alive = true;
    inspectView(target.id)
      .then((d) => { if (alive) setData(d); })
      .catch((e: unknown) => { if (alive) setError(errMsg(e, "Couldn't load the view")); });
    return () => { alive = false; };
  }, [target.id]);

  const view = data?.view;
  const custom = !!(view?.customSql && view.customSql.trim());
  const srcName = (id?: string | null) => (id ? (data?.sources.find((s) => s.id === id)?.physicalName ?? id) : '—');
  const goCanvas = (u: TableUsageRow) => {
    onClose();
    openCanvasAndFocus(u.canvasId, u.projectId ?? undefined, target.id, undefined, view?.name).catch(() => toast.error("Couldn't open the canvas"));
  };
  const openPrimary = () => {
    if (!data) return;
    const c = primaryCanvas(data.usage, activeSaId);
    if (c) goCanvas(c); else setTab('usage');
  };
  const nCols = view ? (custom ? (view.customColumns ?? []).length : (view.sources ?? []).length) : 0;
  const counts: Partial<Record<VTab, number>> = data ? { columns: nCols, usage: data.usage.length } : {};

  return (
    <Dialog open title="Object Inspector" icon={Eye} width={960} onClose={onClose}
      subtitle="View metadata — the effective state of the open version, no canvas needed (views are edited in the View Editor)"
      footer={<Footer usage={data?.usage ?? null} canEdit={false} onOpen={openPrimary} onClose={onClose} />}>
      <div className="wk-insp">
        {error && <div className="wk-findres-empty rd-small" role="alert">{error}</div>}
        {!error && !data && <div className="wk-insp-loading"><span className="rd-spin" aria-hidden /> Loading…</div>}
        {data && view && (
          <>
            <div className="wk-insp-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wk-insp-title rd-mono">{view.name}</div>
                <div className="wk-insp-other">{view.description || 'No functional definition yet.'}</div>
                <div className="wk-insp-chips">
                  <span className="wk-insp-chip accent">view</span>
                  <span className="wk-insp-chip rd-mono">schema {view.schema || '—'}</span>
                  <span className="wk-insp-chip">{custom ? 'Custom SQL' : 'Regular (generated from sources)'}</span>
                  <span className="wk-insp-chip">{data.sources.length} source{data.sources.length === 1 ? '' : 's'}</span>
                  <span className="wk-insp-chip">{data.usage.length === 0 ? 'not on any canvas' : `${data.usage.length} canvas${data.usage.length === 1 ? '' : 'es'}`}</span>
                </div>
              </div>
            </div>
            <div className="wk-pp-tabs" role="tablist">
              {V_TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}{counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
                </button>
              ))}
            </div>
            <div className="wk-insp-body">
              {tab === 'definition' && (
                <>
                  <dl className="wk-pp-meta">
                    <dt>Name</dt><dd className="rd-mono">{view.name}</dd>
                    <dt>Schema</dt><dd className="rd-mono">{view.schema || '—'}</dd>
                    <dt>Mode</dt><dd>{custom ? 'Personalizada (custom SQL governs the view)' : 'Regular (generated from sources, join and filter)'}</dd>
                    <dt>Definition</dt><dd>{view.description || '—'}</dd>
                    <dt>Join</dt><dd className="rd-mono">{view.joinOverride?.trim() || <span className="wk-insp-default">inferred from relationships</span>}</dd>
                    <dt>Filter</dt><dd className="rd-mono">{view.filter?.trim() || '—'}</dd>
                    <dt>Tags</dt><dd>{view.tags?.length ? view.tags.map((t) => `${t.key}${t.value ? `=${t.value}` : ''}`).join(' · ') : '—'}</dd>
                    <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{view.id}</dd>
                  </dl>
                  <div className="wk-props-sec">Source tables</div>
                  {data.sources.length === 0 && muted('No sources.')}
                  {data.sources.map((s, i) => (
                    <div key={s.id} className="wk-insp-view-row">
                      <Table2 size={13} style={{ flex: 'none' }} />
                      <span className="rd-mono" style={{ fontWeight: 600 }}>t{i + 1} · {s.schema ? `${s.schema}.` : ''}{s.physicalName}</span>
                      <span className="rd-small" style={{ color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.logicalName}</span>
                      <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }} title="Inspect this table" onClick={() => openInspector({ kind: 'table', id: s.id })}>
                        <Eye size={12} /> Inspect
                      </button>
                    </div>
                  ))}
                </>
              )}

              {tab === 'columns' && (
                nCols === 0 ? muted('No output columns.') : (
                  <table className="wk-insp-grid">
                    <thead>
                      {custom
                        ? <tr><th>#</th><th>Output</th><th>Expression</th></tr>
                        : <tr><th>#</th><th>Output</th><th>Source</th><th>Type</th><th>Expression</th><th>Definition</th></tr>}
                    </thead>
                    <tbody>
                      {custom
                        ? (view.customColumns ?? []).map((c, i) => (
                          <tr key={`${c.name}:${i}`} style={{ cursor: 'default' }}>
                            <td className="n">{i + 1}</td>
                            <td className="rd-mono">{c.name}</td>
                            <td className="rd-mono def" title={c.expression ?? undefined}>{c.expression || '—'}</td>
                          </tr>
                        ))
                        : (view.sources ?? []).map((s, i) => (
                          <tr key={`${s.tableId ?? s.table ?? ''}:${s.column ?? ''}:${i}`} style={{ cursor: 'default' }}>
                            <td className="n">{i + 1}</td>
                            <td className="rd-mono">{s.outputAlias || s.column || '—'}</td>
                            <td className="rd-mono muted">{s.column ? `${srcName(s.tableId ?? s.table)}.${s.column}` : '— (expression)'}</td>
                            <td className="rd-mono">{s.castType?.trim() ? `${s.castType} (cast)` : <span className="wk-insp-default">inherited</span>}</td>
                            <td className="rd-mono def" title={s.expression ?? undefined}>{s.expression || '—'}</td>
                            <td className="def" title={s.description ?? undefined}>{s.description || <span className="wk-insp-default">inherited</span>}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )
              )}

              {tab === 'sql' && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}>{custom ? 'Custom SQL script — the body of the CREATE VIEW.' : 'Stored DDL preview (generated from sources; regenerate it from the View Editor).'}</p>
                  <pre className="wk-insp-sql">{view.customSql?.trim() || view.sql?.trim() || 'No SQL stored for this view yet.'}</pre>
                </>
              )}

              {tab === 'udps' && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}><b>View UDPs</b> — governance tags of the view (read-only here; edit them from the view’s Properties).</p>
                  {std ? <UdpReadonly defs={std.udp} level="view" facet="physical" values={view.udpValues ?? {}} /> : muted('Loading…')}
                </>
              )}

              {tab === 'usage' && <UsageList usage={data.usage} activeSaId={activeSaId} noun="view" onOpen={goCanvas} />}

              {tab === 'history' && <AuditHistory kind="view" entityId={target.id} />}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
