/**
 * VersionToolsModal: popup "Version tools" del Home (caja Versions):
 *
 *   · Compare versions: diferencias netas entre dos versiones publicadas
 *     (`GET /api/versions/compare`): conteos por verbo, buckets por tipo de
 *     entidad y, por fila, el diff de campos antes→después bajo demanda
 *     (`POST /api/versions/compare/details`, con la misma forma que el detalle
 *     del popup de revisión, cuyo renderer se reusa). Aviso ámbar si el rango
 *     incluye entidades irreconstruibles (publicadas sin before-images).
 *   · Version details: cabecera completa de una versión: dueño, revisores y
 *     sus decisiones (fecha + nota), fechas clave, procedencia de restauración
 *     y comentarios, vía `GET /api/changesets/{id}`. Botón «Open in canvas»:
 *     una versión publicada abre el Model en modo visor con el changeset
 *     virtual `asof:<versionId>` (snapshot exacto reconstruido del ledger:
 *     producción + inverso de las versiones posteriores); la producción actual
 *     abre el visor normal; un draft/request abre su overlay en visor.
 *
 * Details también administra un draft: «Transfer» (pasa la propiedad a otro
 * usuario que edita modelos; la versión registra quién la inició) y «Delete»
 * (lo elimina con sus cambios; producción no cambia). Los ve su dueño o un
 * administrador; solo sobre drafts (en revisión: retirar primero; publicadas:
 * nunca). El resto del popup es de solo lectura (el Restore vive en la fila de
 * la caja Versions).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, ArrowRightLeft, GitCompare, PanelsTopLeft, Trash2, TriangleAlert, Undo2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui';
import { confirmDialog } from '@/components/ui/dialogs';
import { ApiError, apiErrorMessage } from '@/services/http';
import {
  OPEN_VERSION_DENIED,
  asOfChangesetId,
  canOpenVersion,
  compareVersionDetails,
  compareVersions,
  deleteVersion,
  getChangeset,
} from '@/services/versioning.service';
import { canManageVersion, showStartedBy, versionActionBlock } from '@/lib/versionAdmin';
import TransferVersionDialog from './TransferVersionDialog';
import { trapTab } from '@/components/ui/focusTrap';
import { useAuthStore } from '@/store/useAuthStore';
import { useSessionStore } from '@/store/useSessionStore';
import { projectMeta, sortProjects } from '@/lib/projects';
import type { Project } from '@/types/model';
import type {
  ChangesetDetail,
  SimUserDto,
  VersionCompare,
  VersionRow,
} from '@/types/versioning';
import DiffExplorer from '@/screens/review/DiffExplorer';
import type { DetailRef } from '@/screens/review/diffDetailCache';
import type { TreeSelection } from '@/screens/review/DiffTree';

type Tab = 'compare' | 'details';

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

const STATUS_TEXT: Record<VersionRow['status'], string> = {
  draft: 'Editing (draft)',
  submitted: 'In review',
  approved: 'Published',
  rejected: 'Rejected',
};

/** «v20261026143005 (ana@bcp.com.pe) — Título»: el código con el correo de su
 *  dueño (el id del usuario es su correo) y el título solo si dice algo más
 *  que el código (por defecto un draft se titula como su código). */
function versionOptionText(v: VersionRow): string {
  const owner = v.owner ? ` (${v.owner})` : '';
  const title = v.title?.trim() && v.title !== v.versionLabel ? ` — ${v.title}` : '';
  return `${v.versionLabel ?? '—'}${owner}${title}`;
}

export default function VersionToolsModal({
  versions, users, projects, initialTab = 'compare', initialVersionId = null, initialProjectId = null, onClose,
  onChanged,
}: {
  versions: VersionRow[];
  users: SimUserDto[];
  projects: Project[];
  initialTab?: Tab;
  initialVersionId?: string | null;
  /** Proyecto preseleccionado (el de la fila que abrió el popup). */
  initialProjectId?: string | null;
  onClose: () => void;
  /** Una versión se transfirió o eliminó: el Home recarga la lista. */
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // Las versiones son por proyecto: el selector acota Compare y Details.
  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
  const [projectId, setProjectId] = useState<string>(() =>
    initialProjectId
    ?? versions.find((v) => v.id === initialVersionId)?.projectId
    ?? sortedProjects[0]?.id ?? '');
  // Versiones que este popup vio eliminarse (acá o por un 404): salen
  // de la lista al instante, sin esperar la recarga del Home.
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(() => new Set());
  const markGone = (id: string) => setGoneIds((s) => (s.has(id) ? s : new Set(s).add(id)));
  const projectVersions = useMemo(
    () => versions.filter((v) => v.projectId === projectId && !goneIds.has(v.id)),
    [versions, projectId, goneIds]);
  const published = useMemo(() => projectMeta(projectVersions, null)[projectId]?.productionRow ?? null, [projectVersions, projectId]);
  const navigate = useNavigate();
  const openModel = useSessionStore((s) => s.openModel);
  // Quién puede abrir qué versión en el canvas (espejo del backend).
  const me = useAuthStore((s) => s.user?.username ?? null);
  // Se suscribe a los permisos (cambian con `refreshMe`): `s.has` es siempre la
  // misma función y el popup no se enteraría de los cambios.
  const perms = useAuthStore((s) => s.user?.permissions);
  const has = (perm: string) => Boolean(perms?.[perm]);

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

  // ── Compare: solo versiones publicadas, en orden cronológico ──────────────
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

  const optionLabel = (v: VersionRow): string => {
    const date = v.appliedAt ? new Date(v.appliedAt).toLocaleDateString() : '';
    return `${versionOptionText(v)}${date ? ` · ${date}` : ''}`;
  };

  const runCompare = async () => {
    if (!fromId || !toId) return;
    if (fromId === toId) {
      toast.error('Pick two different versions to compare.');
      return;
    }
    setCmpLoading(true);
    setCmp(null);
    try {
      setCmp(await compareVersions(fromId, toId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't compare the versions.");
    } finally {
      setCmpLoading(false);
    }
  };

  // El detalle de campos sale del rango comparado, bajo demanda
  // (mismo explorer que el popup de revisión).
  const loadCompareDetails = useCallback(
    (items: DetailRef[]) => (cmp ? compareVersionDetails(cmp.from.id, cmp.to.id, items) : Promise.resolve({ items: [] })),
    [cmp],
  );
  // Atribución por entidad: la última versión del rango que la
  // tocó (etiqueta, autor y fecha de publicación), del ledger compuesto.
  const compareAttribution = useCallback((sel: TreeSelection) => {
    const bucket = cmp?.collections[sel.collection];
    if (!bucket) return null;
    const hit = [...bucket.added, ...bucket.edited, ...bucket.deleted].find((e) => e.id === sel.entityId);
    const lv = hit?.lastVersion ?? null;
    if (!lv) return null;
    return (
      <div className="dmh-rvd-attr">
        <span className="dmh-vt-vchip rd-mono">{lv.versionLabel ?? '—'}</span>
        <span>
          {lv.owner ? `published by ${userName(lv.owner)}` : 'published'}
          {lv.appliedAt ? ` on ${fmtWhen(lv.appliedAt)}` : ''}
        </span>
      </div>
    );
  }, [cmp, users]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Details: cualquier versión (draft/review/publicada) ───────────────────
  const detailRows = useMemo(() => {
    const ts = (v: VersionRow) => Date.parse(v.submittedAt ?? v.updatedAt ?? v.createdAt ?? '') || 0;
    return [...projectVersions].sort((a, b) => ts(b) - ts(a));
  }, [projectVersions]);
  const [selId, setSelId] = useState<string>(
    initialVersionId ?? published?.id ?? detailRows[0]?.id ?? '',
  );
  // Cambiar de proyecto re-apunta los selectores a las versiones de ese proyecto.
  const pickProject = (pid: string) => {
    setProjectId(pid);
    const rows = versions.filter((v) => v.projectId === pid && !goneIds.has(v.id));
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
  // Re-leer la versión tras transferirla (o si se modificó por fuera).
  const [detailTick, setDetailTick] = useState(0);
  // La versión que se está transfiriendo: el diálogo queda ligado a ella (no
  // al detalle, que se recarga), así un error no lo cierra ni lo re-apunta.
  const [transferFor, setTransferFor] = useState<ChangesetDetail | null>(null);
  // Con el confirm de Delete encima, el popup queda inerte (como con el de
  // transferencia) y, al cerrarse, re-renderiza: el efecto de abajo le devuelve
  // el foco (si no, Cancel lo dejaría en <body>).
  const [confirming, setConfirming] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Una recarga del detalle (tras transferir, eliminar o un 409) quita el
  // botón que tenía el foco y el navegador lo manda a <body>: Tab saltaría a
  // la página de atrás. Mientras este popup sea el de arriba, el foco vuelve a él.
  useEffect(() => {
    const box = boxRef.current;
    const active = document.activeElement;
    if (!box || transferFor || confirming || (active && active !== document.body)) return;
    if ([...document.querySelectorAll('[aria-modal="true"]')].some((m) => m !== box)) return;
    box.focus();
  });

  // Si la versión elegida desaparece de la lista (se eliminó) o no
  // hay ninguna elegida, el selector va a la producción o a la más reciente.
  useEffect(() => {
    if (detailRows.some((v) => v.id === selId)) return;
    const next = published?.id ?? detailRows[0]?.id ?? '';
    if (next !== selId) setSelId(next);
  }, [detailRows, selId, published]);

  useEffect(() => {
    if (tab !== 'details' || !selId) return undefined;
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    getChangeset(selId)
      .then((d) => { if (alive) setDetail(d); })
      .catch((err: unknown) => {
        if (!alive) return;
        toast.error(err instanceof Error ? err.message : "Couldn't load the version.");
        // Eliminada en otra sesión: sale de la lista (y el selector de ella,
        // efecto de arriba) y el Home se recarga.
        if (err instanceof ApiError && err.status === 404) { markGone(selId); onChanged?.(); }
      })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [tab, selId, detailTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const isProduction = published?.id === selId;
  const isPublished = detail?.status === 'approved' && !!detail?.appliedAt;
  const canOpen = !!detail && canOpenVersion(detail, me, has);
  // Administrar (transferir / eliminar): dueño que edita o admin; una versión
  // publicada es historia y no se ofrece.
  const canManage = !!detail && detail.status !== 'approved' && canManageVersion(detail, me, has);
  const transferBlock = detail ? versionActionBlock(detail, 'transfer') : null;
  const deleteBlock = detail ? versionActionBlock(detail, 'delete') : null;
  const starter = detail ? showStartedBy(detail) : null;

  /** La versión se modificó por fuera (otra sesión la envió, transfirió o
   *  eliminó): recarga la lista del Home y, si sigue existiendo, el detalle
   *  (una eliminada sale sola del selector: releerla daría otro 404). */
  const refreshAll = (status?: number) => {
    onChanged?.();
    if (status !== 404) setDetailTick((t) => t + 1);
  };

  const doDelete = async () => {
    if (!detail || deleteBlock) return;
    const target = detail;
    const label = target.versionLabel ?? 'this version';
    const n = target.changeCount ?? 0;
    const mine = !!me && target.owner === me;
    setConfirming(true);
    try {
      let removed = 0;
      const ok = await confirmDialog({
        title: `Delete version ${target.versionLabel ?? ''}`.trim(),
        variant: 'danger',
        confirmLabel: 'Delete version',
        // Irreversible: el foco arranca en Cancel (un Enter doble no borra).
        initialFocus: 'cancel',
        message: (
          <>
            <strong>{label}</strong>{target.title && target.title !== target.versionLabel ? <> — “{target.title}”</> : null}
            {' '}will be permanently deleted
            {n > 0 ? <> with its <strong>{n}</strong> pending change{n === 1 ? '' : 's'}</> : <> (it has no pending changes)</>}.
            {' '}Production doesn&apos;t change. This can&apos;t be undone.
            {!mine && (
              <>
                {' '}It belongs to <strong>{userName(target.owner)}</strong>: if they have it open, their unsaved
                changes are lost.
              </>
            )}
          </>
        ),
        // Con el dueño que mostraba la pantalla: si otra sesión la transfirió
        // en el medio, 409 — no se borra el draft de otra persona.
        action: async () => { removed = (await deleteVersion(target.id, target.owner)).changes; },
      });
      if (!ok) return;
      toast.success(`${target.versionLabel ? `Version ${target.versionLabel}` : 'The version'} deleted${removed ? ` with its ${removed} change${removed === 1 ? '' : 's'}` : ''}.`);
      setDetail(null);
      markGone(target.id);
      setSelId(published?.id ?? detailRows.find((v) => v.id !== target.id)?.id ?? '');
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't delete the version."));
      if (err instanceof ApiError && err.status === 404) markGone(target.id);
      if (err instanceof ApiError && [403, 404, 409].includes(err.status)) refreshAll(err.status);
    } finally {
      setConfirming(false);
    }
  };

  /** Abre la versión en el canvas, siempre en modo visor. Publicada
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
      {/* Con el diálogo de transferencia abierto, el popup queda
          inerte (ni foco ni clics): no se puede cambiar la versión por detrás. */}
      <div className="dmh-vt-modal" role="dialog" aria-modal="true" aria-label="Version tools"
        ref={boxRef} tabIndex={-1} inert={transferFor || confirming ? true : undefined}
        onKeyDown={(e) => trapTab(e, boxRef.current)}>
        <div className="dmh-rvd-head">
          <div className="dmh-rvd-head-ico"><GitCompare size={16} strokeWidth={1.7} aria-hidden /></div>
          <div className="dmh-rvd-head-text">
            <div className="dmh-rvd-head-title">Version tools</div>
            <div className="dmh-rvd-head-sub">
              Compare published versions, inspect who changed, approved and published each one, and transfer or delete drafts
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
          {/* Versiones por proyecto. */}
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
                  {/* El código con el correo y el título: los dos combos se reparten el ancho. */}
                  <div className="dmh-vt-picker" style={{ flex: '1 1 250px' }}>
                    <label htmlFor="dmh-vt-from">From (older)</label>
                    <select id="dmh-vt-from" value={fromId} onChange={(e) => setFromId(e.target.value)}
                      style={{ width: '100%', maxWidth: 'none', minWidth: 0 }}>
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
                  <div className="dmh-vt-picker" style={{ flex: '1 1 250px' }}>
                    <label htmlFor="dmh-vt-to">To (newer)</label>
                    <select id="dmh-vt-to" value={toId} onChange={(e) => setToId(e.target.value)}
                      style={{ width: '100%', maxWidth: 'none', minWidth: 0 }}>
                      {publishedRows.map((v) => (
                        <option key={v.id} value={v.id}>{optionLabel(v)}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="dmh-btn dmh-btn--primary dmh-vt-compare"
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

                    {cmp.counts.total > 0 && (
                      <div className="dmh-vt-explorer">
                        <DiffExplorer
                          diff={cmp}
                          loadDetails={loadCompareDetails}
                          attribution={compareAttribution}
                          hint={{
                            title: 'Select a changed item',
                            body: 'Pick a row on the left to see what changed between the two versions, field by field. Each item shows the version that last changed it.',
                          }}
                        />
                      </div>
                    )}
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
                    style={{ width: '100%', maxWidth: 'none', minWidth: 0 }}
                  >
                    {detailRows.map((v) => (
                      <option key={v.id} value={v.id}>
                        {`${versionOptionText(v)} · ${published?.id === v.id ? 'Production' : STATUS_TEXT[v.status]}`}
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
                    {canManage && (
                      <span className="dmh-vt-manage">
                        {/* Deshabilitado, el motivo va también en
                            el nombre accesible (patrón de «View in canvas» en Review). */}
                        <button
                          type="button"
                          className="dmh-btn dmh-btn--secondary"
                          title={transferBlock ?? 'Give this draft to another user: they edit it, send it for approval and appear as its author'}
                          disabled={!!transferBlock}
                          aria-label={transferBlock ? `Transfer: ${transferBlock}` : undefined}
                          data-vt-action="transfer"
                          onClick={() => setTransferFor(detail)}
                        >
                          <ArrowRightLeft size={13} strokeWidth={1.7} aria-hidden />
                          Transfer
                        </button>
                        <button
                          type="button"
                          className="dmh-btn dmh-btn--danger"
                          title={deleteBlock ?? 'Delete this draft and all its changes (production does not change)'}
                          disabled={!!deleteBlock}
                          aria-label={deleteBlock ? `Delete: ${deleteBlock}` : undefined}
                          onClick={() => void doDelete()}
                        >
                          <Trash2 size={13} strokeWidth={1.7} aria-hidden />
                          Delete
                        </button>
                      </span>
                    )}
                    <button
                      type="button"
                      className="dmh-btn dmh-btn--primary"
                      title={openHint}
                      disabled={!canOpen}
                      aria-label={canOpen ? undefined : `Open in canvas: ${openHint}`}
                      onClick={openInCanvas}
                    >
                      <PanelsTopLeft size={13} strokeWidth={1.7} aria-hidden />
                      Open in canvas
                    </button>
                  </div>
                  <p className="dmh-vt-desc" style={{ marginTop: 4 }}>{openHint}</p>
                  {canManage && transferBlock && (
                    <p className="dmh-vt-desc" style={{ marginTop: -6 }}>{transferBlock}</p>
                  )}

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
                    {/* La versión fue transferida: se muestra quién la inició. */}
                    {starter && (
                      <>
                        <span className="dmh-vt-glabel">Started by</span>
                        <span>{userName(starter)}</span>
                      </>
                    )}
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

                  {(detail.transfers?.length ?? 0) > 0 && (
                    <>
                      <div className="dmh-vt-subhead">Ownership transfers ({detail.transfers!.length})</div>
                      {detail.transfers!.map((t, i) => (
                        <div key={`${t.at}-${i}`} className="dmh-vt-transfer">
                          <span className="dmh-vt-aname">{userName(t.from)}</span>
                          <span className="dmh-vt-tarrow">→</span>
                          <span className="dmh-vt-aname">{userName(t.to)}</span>
                          {t.by !== t.from && <span className="dmh-vt-awhen">by {userName(t.by)}</span>}
                          <span className="dmh-vt-awhen">{fmtWhen(t.at)}</span>
                          {t.note && <span className="dmh-vt-anote" title={t.note}>“{t.note}”</span>}
                        </div>
                      ))}
                    </>
                  )}

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
      {transferFor && (
        <TransferVersionDialog
          version={transferFor}
          me={me}
          userName={userName}
          onClose={() => setTransferFor(null)}
          // Un 404 = otra sesión la eliminó: sale de la lista al instante,
          // como al eliminarla acá (la recarga del Home puede demorar).
          onStale={(status) => { if (status === 404) markGone(transferFor.id); refreshAll(status); }}
          // Si el botón que lo abrió dejó de existir (el detalle se recargó), el
          // foco vuelve al Transfer recreado o, si no hay, a este popup.
          returnFocus={() => boxRef.current?.querySelector<HTMLElement>('[data-vt-action="transfer"]:not(:disabled)')
            ?? boxRef.current}
          onTransferred={(updated) => {
            setTransferFor(null);
            toast.success(`${updated.versionLabel ? `Version ${updated.versionLabel}` : 'The version'} transferred to ${userName(updated.owner)}.`);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}
