/**
 * VersionToolsModal (doc 65) — popup "Version tools" del Home (caja Versions):
 *
 *   · Compare versions — diferencias NETAS entre DOS versiones publicadas
 *     (`GET /api/versions/compare`): conteos por verbo, buckets por tipo de
 *     entidad y, por fila, el diff de campos antes→después BAJO DEMANDA
 *     (`POST /api/versions/compare/details`, shape doc 31 — se reusa el
 *     renderer del popup de revisión). Aviso ámbar si el rango incluye
 *     entidades irreconstruibles (publicadas antes de las before-images).
 *   · Version details — cabecera completa de UNA versión: owner, revisores y
 *     sus decisiones (fecha + nota), fechas clave, procedencia de restauración
 *     y comentarios, vía `GET /api/changesets/{id}`. Doc 70: botón «Open in
 *     canvas» — una versión PUBLICADA abre el Model en modo visor con el
 *     changeset virtual `asof:<versionId>` (snapshot exacto reconstruido del
 *     ledger: producción + inverso de las versiones posteriores); la producción
 *     actual abre el visor normal; un draft/request abre su overlay en visor.
 *
 * READ-ONLY: no toca el flujo de aprobación ni el rollback (el Restore sigue
 * viviendo en la fila de la caja Versions).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, ChevronDown, ChevronRight, GitCompare, PanelsTopLeft, TriangleAlert, Undo2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui';
import {
  OPEN_VERSION_DENIED,
  SUMMARY_ROWS,
  asOfChangesetId,
  canOpenVersion,
  collectionLabel,
  compareVersionDetails,
  compareVersions,
  getChangeset,
} from '@/services/versioning.service';
import { useAuthStore } from '@/store/useAuthStore';
import { useSessionStore } from '@/store/useSessionStore';
import { projectMeta, sortProjects } from '@/lib/projects';
import type { Project } from '@/types/model';
import type {
  ChangesetDetail,
  DiffEntityDetail,
  SimUserDto,
  VersionCompare,
  VersionRow,
} from '@/types/versioning';
import { FieldRows } from '@/screens/review/ChangesDetailModal';

type Tab = 'compare' | 'details';
type CacheEntry = DiffEntityDetail | 'loading' | 'missing';

const keyOf = (collection: string, id: string) => `${collection}::${id}`;

/** Fecha legible corta ("Aug 31, 2026, 10:24") o '—'. */
function fmtWhen(iso?: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const AVATAR_TONES = ['blue', 'purple', 'green', 'navy'] as const;
/** Mismo hash estable de HomeScreen: un usuario siempre con el mismo tono. */
function avatarTone(id: string): (typeof AVATAR_TONES)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

const VERBS = [
  { verb: 'added', cls: 'is-added', pill: 'added' },
  { verb: 'edited', cls: 'is-edited', pill: 'modified' },
  { verb: 'deleted', cls: 'is-deleted', pill: 'deleted' },
] as const;

const STATUS_TEXT: Record<VersionRow['status'], string> = {
  draft: 'Editing (draft)',
  submitted: 'In review',
  approved: 'Published',
  rejected: 'Rejected',
};

export default function VersionToolsModal({
  versions, users, projects, initialTab = 'compare', initialVersionId = null, initialProjectId = null, onClose,
}: {
  versions: VersionRow[];
  users: SimUserDto[];
  projects: Project[];
  initialTab?: Tab;
  initialVersionId?: string | null;
  /** Doc 75: proyecto preseleccionado (el de la fila que abrió el popup). */
  initialProjectId?: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // Doc 75: las versiones son por proyecto — el selector acota Compare y Details.
  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
  const [projectId, setProjectId] = useState<string>(() =>
    initialProjectId
    ?? versions.find((v) => v.id === initialVersionId)?.projectId
    ?? sortedProjects[0]?.id ?? '');
  const projectVersions = useMemo(() => versions.filter((v) => v.projectId === projectId), [versions, projectId]);
  const published = useMemo(() => projectMeta(projectVersions, null)[projectId]?.productionRow ?? null, [projectVersions, projectId]);
  const navigate = useNavigate();
  const openModel = useSessionStore((s) => s.openModel);
  // Doc 70 §12: quién puede abrir qué versión en el canvas (espejo del backend).
  const me = useAuthStore((s) => s.user?.username ?? null);
  const has = useAuthStore((s) => s.has);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const userName = (id?: string | null): string => {
    if (!id) return 'Unknown';
    return users.find((u) => u.id === id)?.name ?? id;
  };
  const userInitials = (id?: string | null): string => {
    if (!id) return '?';
    return users.find((u) => u.id === id)?.initials ?? id.slice(0, 2).toUpperCase();
  };

  // ── Compare: solo versiones PUBLICADAS, en orden cronológico ──────────────
  const publishedRows = useMemo(
    () => projectVersions
      .filter((v) => v.status === 'approved' && !!v.appliedAt)
      .sort((a, b) => String(a.appliedAt).localeCompare(String(b.appliedAt))),
    [projectVersions],
  );
  const [fromId, setFromId] = useState<string>(
    () => (publishedRows.length >= 2
      ? publishedRows[publishedRows.length - 2].id
      : publishedRows[0]?.id ?? ''),
  );
  const [toId, setToId] = useState<string>(() => publishedRows[publishedRows.length - 1]?.id ?? '');
  const [cmp, setCmp] = useState<VersionCompare | null>(null);
  const [cmpLoading, setCmpLoading] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Record<string, CacheEntry>>({});

  const optionLabel = (v: VersionRow): string => {
    const date = v.appliedAt ? new Date(v.appliedAt).toLocaleDateString() : '';
    return `${v.versionLabel ?? '—'} — ${v.title ?? 'Untitled'}${date ? ` (${date})` : ''}`;
  };

  const runCompare = async () => {
    if (!fromId || !toId) return;
    if (fromId === toId) {
      toast.error('Pick two different versions to compare.');
      return;
    }
    setCmpLoading(true);
    setCmp(null);
    setOpenRows(new Set());
    setCache({});
    try {
      setCmp(await compareVersions(fromId, toId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't compare the versions.");
    } finally {
      setCmpLoading(false);
    }
  };

  const toggleRow = (collection: string, id: string) => {
    const key = keyOf(collection, id);
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!cmp || cache[key]) return;
    setCache((prev) => ({ ...prev, [key]: 'loading' }));
    compareVersionDetails(cmp.from.id, cmp.to.id, [{ collection, entityId: id }])
      .then((r) => setCache((prev) => ({ ...prev, [key]: r.items[0] ?? 'missing' })))
      .catch(() => setCache((prev) => ({ ...prev, [key]: 'missing' })));
  };

  /** Colecciones del resultado en el orden canónico del resumen (doc 31). */
  const orderedCollections = useMemo(() => {
    if (!cmp) return [];
    const known = SUMMARY_ROWS.map(([c]) => c);
    return Object.keys(cmp.collections).sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      return (ia === -1 ? known.length : ia) - (ib === -1 ? known.length : ib);
    });
  }, [cmp]);

  // ── Details: cualquier versión (draft/review/publicada) ───────────────────
  const detailRows = useMemo(() => {
    const ts = (v: VersionRow) => Date.parse(v.submittedAt ?? v.updatedAt ?? v.createdAt ?? '') || 0;
    return [...projectVersions].sort((a, b) => ts(b) - ts(a));
  }, [projectVersions]);
  const [selId, setSelId] = useState<string>(
    initialVersionId ?? published?.id ?? detailRows[0]?.id ?? '',
  );
  // Cambiar de proyecto re-apunta los selectores a las versiones de ESE proyecto.
  const pickProject = (pid: string) => {
    setProjectId(pid);
    const rows = versions.filter((v) => v.projectId === pid);
    const pub = rows.filter((v) => v.status === 'approved' && !!v.appliedAt)
      .sort((a, b) => String(a.appliedAt).localeCompare(String(b.appliedAt)));
    setFromId(pub.length >= 2 ? pub[pub.length - 2].id : pub[0]?.id ?? '');
    setToId(pub[pub.length - 1]?.id ?? '');
    setCmp(null);
    const ts = (v: VersionRow) => Date.parse(v.submittedAt ?? v.updatedAt ?? v.createdAt ?? '') || 0;
    setSelId(pub[pub.length - 1]?.id ?? [...rows].sort((a, b) => ts(b) - ts(a))[0]?.id ?? '');
  };
  const [detail, setDetail] = useState<ChangesetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'details' || !selId) return undefined;
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    getChangeset(selId)
      .then((d) => { if (alive) setDetail(d); })
      .catch((err: unknown) => {
        if (alive) toast.error(err instanceof Error ? err.message : "Couldn't load the version.");
      })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [tab, selId]);

  const isProduction = published?.id === selId;
  const isPublished = detail?.status === 'approved' && !!detail?.appliedAt;
  const canOpen = !!detail && canOpenVersion(detail, me, has);

  /** Doc 70: abre la versión en el canvas, SIEMPRE en modo visor. Publicada
   *  pasada → snapshot `asof:` (el backend compone el inverso de las versiones
   *  posteriores); producción → visor normal; draft/request → su overlay. */
  const openInCanvas = () => {
    if (!detail) return;
    const label = detail.versionLabel ?? null;
    if (isProduction) {
      openModel({ projectId: detail.projectId, mode: 'readonly', versionLabel: label });
    } else if (isPublished) {
      openModel({
        projectId: detail.projectId,
        mode: 'readonly',
        changesetId: asOfChangesetId(detail.id),
        versionLabel: label ? `${label} · as published` : 'as published',
      });
    } else {
      openModel({ projectId: detail.projectId, mode: 'readonly', changesetId: detail.id, versionLabel: label });
    }
    onClose();
    navigate('/model');
  };
  const openHint = !canOpen
    ? OPEN_VERSION_DENIED
    : isProduction
      ? 'Opens the current production model in read-only mode.'
      : isPublished
        ? 'Opens a read-only snapshot of the model exactly as it was published in this version. It is rebuilt from the change ledger (before/after images of every change), so canvases, tables, columns, views and relationships reflect that moment.'
        : 'Opens the model in read-only mode with the changes of this version overlaid on production.';
  const projectNames = detail
    ? [projects.find((p) => p.id === detail.projectId)?.name ?? null].filter((n): n is string => !!n)
    : [];

  return (
    <div className="dmh-rvd-overlay" role="presentation">
      <div className="dmh-vt-modal" role="dialog" aria-modal="true" aria-label="Version tools">
        <div className="dmh-rvd-head">
          <div className="dmh-rvd-head-ico"><GitCompare size={16} strokeWidth={1.7} aria-hidden /></div>
          <div className="dmh-rvd-head-text">
            <div className="dmh-rvd-head-title">Version tools</div>
            <div className="dmh-rvd-head-sub">
              Compare published versions and inspect who changed, approved and published each one
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        <div className="dmh-vt-tabs">
          <button
            type="button"
            className={`dmh-vt-tab${tab === 'compare' ? ' is-active' : ''}`}
            onClick={() => setTab('compare')}
          >
            Compare versions
          </button>
          <button
            type="button"
            className={`dmh-vt-tab${tab === 'details' ? ' is-active' : ''}`}
            onClick={() => setTab('details')}
          >
            Version details
          </button>
          <span style={{ flex: 1 }} />
          {/* Doc 75: versiones por proyecto. */}
          <div className="dmh-vt-picker dmh-vt-project">
            <label htmlFor="dmh-vt-project">Project</label>
            <select id="dmh-vt-project" value={projectId} onChange={(e) => pickProject(e.target.value)}>
              {sortedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="dmh-vt-body">
          {tab === 'compare' && (
            publishedRows.length < 2 ? (
              <div className="dmh-vt-empty">
                At least two published versions are needed to compare — publish another version first.
              </div>
            ) : (
              <>
                <div className="dmh-vt-pickers">
                  <div className="dmh-vt-picker">
                    <label htmlFor="dmh-vt-from">From (older)</label>
                    <select id="dmh-vt-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                      {publishedRows.map((v) => (
                        <option key={v.id} value={v.id}>{optionLabel(v)}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="dmh-vt-swap"
                    title="Swap versions"
                    onClick={() => { setFromId(toId); setToId(fromId); }}
                  >
                    <ArrowLeftRight size={13} strokeWidth={1.7} aria-hidden />
                  </button>
                  <div className="dmh-vt-picker">
                    <label htmlFor="dmh-vt-to">To (newer)</label>
                    <select id="dmh-vt-to" value={toId} onChange={(e) => setToId(e.target.value)}>
                      {publishedRows.map((v) => (
                        <option key={v.id} value={v.id}>{optionLabel(v)}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="dmh-btn dmh-btn--primary"
                    onClick={runCompare}
                    disabled={cmpLoading}
                  >
                    <GitCompare size={13} strokeWidth={1.7} aria-hidden />
                    {cmpLoading ? 'Comparing…' : 'Compare'}
                  </button>
                </div>

                {!cmp && !cmpLoading && (
                  <div className="dmh-vt-empty">Pick two published versions and press Compare.</div>
                )}
                {cmpLoading && <div className="dmh-vt-empty">Comparing versions…</div>}

                {cmp && (
                  <>
                    <div className="dmh-vt-cmphead">
                      <span className="dmh-vt-vchip rd-mono">{cmp.from.versionLabel ?? '—'}</span>
                      <span className="dmh-vt-cmparrow">→</span>
                      <span className="dmh-vt-vchip rd-mono">{cmp.to.versionLabel ?? '—'}</span>
                      <span className="dmh-vt-cmpspan">
                        net result across {cmp.versionsSpanned} published version{cmp.versionsSpanned === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="dmh-rvs-stats" style={{ marginBottom: 12 }}>
                      <div className="dmh-rvs-stat is-added"><span className="n">+{cmp.counts.added}</span><span className="t">added</span></div>
                      <div className="dmh-rvs-stat is-edited"><span className="n">~{cmp.counts.edited}</span><span className="t">modified</span></div>
                      <div className="dmh-rvs-stat is-deleted"><span className="n">−{cmp.counts.deleted}</span><span className="t">deleted</span></div>
                    </div>

                    {cmp.unreconstructed.length > 0 && (
                      <div className="dmh-vt-warn">
                        <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />
                        <span>
                          {cmp.unreconstructed.length} entit{cmp.unreconstructed.length === 1 ? 'y' : 'ies'} changed
                          in versions published before change-history capture and can&apos;t be reconstructed —
                          not listed below.
                        </span>
                      </div>
                    )}

                    {cmp.counts.total === 0 && (
                      <div className="dmh-vt-empty">No net differences between these two versions.</div>
                    )}

                    {orderedCollections.map((coll) => {
                      const bucket = cmp.collections[coll];
                      const total = bucket.added.length + bucket.edited.length + bucket.deleted.length;
                      if (total === 0) return null;
                      return (
                        <div key={coll} className="dmh-vt-sec">
                          <div className="dmh-vt-sechead">
                            {collectionLabel(coll)}
                            <span className="dmh-rvs-rowchips" style={{ marginLeft: 'auto' }}>
                              {bucket.added.length > 0 && <span className="dmh-rvs-cnt is-added">+{bucket.added.length}</span>}
                              {bucket.edited.length > 0 && <span className="dmh-rvs-cnt is-edited">~{bucket.edited.length}</span>}
                              {bucket.deleted.length > 0 && <span className="dmh-rvs-cnt is-deleted">−{bucket.deleted.length}</span>}
                            </span>
                          </div>
                          {VERBS.map(({ verb, cls, pill }) => bucket[verb].map((ent) => {
                            const key = keyOf(coll, ent.id);
                            const open = openRows.has(key);
                            const entry = cache[key];
                            const d = typeof entry === 'object' ? entry : null;
                            return (
                              <div key={key} className="dmh-vt-row">
                                <button type="button" className="dmh-vt-rowhead" onClick={() => toggleRow(coll, ent.id)}>
                                  {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                                  <span className={`dmh-rvd-pill ${cls}`}>{pill}</span>
                                  <span className={`dmh-vt-rowname${verb === 'deleted' ? ' strike' : ''}`}>
                                    {ent.name ?? ent.id}
                                  </span>
                                </button>
                                {open && (
                                  <div className="dmh-vt-rowbody">
                                    {d
                                      ? <FieldRows detail={d} />
                                      : (
                                        <div className="dmh-rvd-nofields">
                                          {entry === 'missing' ? 'No detail available for this entity.' : 'Loading diff…'}
                                        </div>
                                      )}
                                  </div>
                                )}
                              </div>
                            );
                          }))}
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )
          )}

          {tab === 'details' && (
            <>
              <div className="dmh-vt-pickers">
                <div className="dmh-vt-picker" style={{ flex: 1 }}>
                  <label htmlFor="dmh-vt-version">Version</label>
                  <select
                    id="dmh-vt-version"
                    value={selId}
                    onChange={(e) => setSelId(e.target.value)}
                    style={{ width: '100%', maxWidth: 'none' }}
                  >
                    {detailRows.map((v) => (
                      <option key={v.id} value={v.id}>
                        {`${v.versionLabel ?? '—'} — ${v.title ?? 'Untitled'} · ${published?.id === v.id ? 'Production' : STATUS_TEXT[v.status]}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {detailLoading && <div className="dmh-vt-empty">Loading version…</div>}
              {!detailLoading && !detail && (
                <div className="dmh-vt-empty">Pick a version to inspect.</div>
              )}

              {!detailLoading && detail && (
                <>
                  <div className="dmh-vt-dhead">
                    <span className="dmh-vt-vchip rd-mono">{detail.versionLabel ?? '—'}</span>
                    <span className="dmh-vt-dtitle">{detail.title ?? 'Untitled version'}</span>
                    <span
                      className={`dmh-vpill ${isProduction ? 'dmh-vpill--production'
                        : detail.status === 'submitted' ? 'dmh-vpill--review'
                          : detail.status === 'rejected' ? 'dmh-vpill--rejected'
                            : detail.status === 'approved' ? 'dmh-vpill--historical' : 'dmh-vpill--draft'}`}
                    >
                      <span className="dot" />
                      {isProduction ? 'Production' : STATUS_TEXT[detail.status]}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="dmh-btn dmh-btn--primary"
                      title={openHint}
                      disabled={!canOpen}
                      onClick={openInCanvas}
                    >
                      <PanelsTopLeft size={13} strokeWidth={1.7} aria-hidden />
                      Open in canvas
                    </button>
                  </div>
                  <p className="dmh-vt-desc" style={{ marginTop: 4 }}>{openHint}</p>

                  {detail.restoredFrom && (
                    <div className="dmh-vt-restored">
                      <Undo2 size={13} strokeWidth={1.8} aria-hidden />
                      <span>
                        Restore of <strong>{detail.restoredFrom.versionLabel ?? 'a previous version'}</strong>
                        {' '}— publishing this version put the model back to that state.
                      </span>
                    </div>
                  )}

                  {detail.description && <p className="dmh-vt-desc">{detail.description}</p>}

                  <div className="dmh-vt-grid">
                    <span className="dmh-vt-glabel">Owner</span>
                    <span className="dmh-vt-approver" style={{ padding: 0 }}>
                      <Avatar
                        initials={userInitials(detail.owner)}
                        tone={avatarTone(detail.owner ?? detail.id)}
                        size={22}
                      />
                      {userName(detail.owner)}
                    </span>
                    {projectNames.length > 0 && (
                      <>
                        <span className="dmh-vt-glabel">Projects</span>
                        <span>{projectNames.join(' · ')}</span>
                      </>
                    )}
                    <span className="dmh-vt-glabel">Created</span>
                    <span>{fmtWhen(detail.createdAt)}</span>
                    <span className="dmh-vt-glabel">Sent to review</span>
                    <span>{fmtWhen(detail.submittedAt)}</span>
                    <span className="dmh-vt-glabel">Published</span>
                    <span>{detail.appliedAt ? fmtWhen(detail.appliedAt) : '—'}</span>
                    {detail.reviewedBy && (
                      <>
                        <span className="dmh-vt-glabel">Final decision by</span>
                        <span>
                          {userName(detail.reviewedBy)}
                          {detail.reviewedAt ? ` · ${fmtWhen(detail.reviewedAt)}` : ''}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="dmh-vt-subhead">Reviewers &amp; approvals</div>
                  {detail.reviewers.length === 0 && (
                    <div className="dmh-vt-none">
                      No reviewers assigned yet (the version hasn&apos;t been sent to review).
                    </div>
                  )}
                  {detail.reviewers.map((rid) => {
                    const a = detail.approvals[rid];
                    return (
                      <div key={rid} className="dmh-vt-approver">
                        <Avatar initials={userInitials(rid)} tone={avatarTone(rid)} size={24} />
                        <span className="dmh-vt-aname">{userName(rid)}</span>
                        {a ? (
                          <span className={`dmh-rvd-pill ${a.status === 'approved' ? 'is-added' : 'is-deleted'}`}>
                            {a.status === 'approved' ? 'approved' : 'rejected'}
                          </span>
                        ) : (
                          <span className="dmh-rvd-pill">pending</span>
                        )}
                        {a?.at && <span className="dmh-vt-awhen">{fmtWhen(a.at)}</span>}
                        {a?.note && <span className="dmh-vt-anote" title={a.note}>“{a.note}”</span>}
                      </div>
                    );
                  })}

                  <div className="dmh-vt-subhead">Comments ({detail.comments.length})</div>
                  {detail.comments.length === 0 && (
                    <div className="dmh-vt-none">No comments on this version.</div>
                  )}
                  {detail.comments.map((c, i) => (
                    <div key={`${c.author}-${i}`} className="dmh-vt-comment">
                      <span className="dmh-vt-cauthor">{userName(c.author)}</span>
                      <span className="dmh-vt-cwhen">{fmtWhen(c.at)}</span>
                      <div className="dmh-vt-ctext">{c.text}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
