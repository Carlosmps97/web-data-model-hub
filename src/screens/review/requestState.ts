/**
 * Estado de una SOLICITUD de publicación (doc 88 §6) — helpers PUROS de Review.
 * Una versión puede haber pasado por varios ciclos (enviar → retirar / rechazar
 * → corregir → re-enviar → aprobar); el badge y el filtro de la bandeja se
 * calculan por el estado de la versión + su último ciclo.
 */
import type { ChangesetDetail, RequestCycle, RequestOutcome, VersionStatus } from '@/types/versioning';

export interface RequestLike {
  status: VersionStatus;
  lastRequest?: RequestCycle | null;
  appliedAt?: string | null;
}

export interface BadgeSpec { cls: string; text: string }

/** Resultado EFECTIVO de la solicitud: por estado de la versión y, en draft, por
 *  su último ciclo (rechazada o retirada). Sin historial ni envío ⇒ `pending`
 *  no aplica: se devuelve null (la versión nunca fue una solicitud). */
export function outcomeOf(v: RequestLike): RequestOutcome | null {
  if (v.status === 'submitted') return 'pending';
  if (v.status === 'approved') return 'approved';
  if (v.status === 'rejected') return 'rejected';                 // legacy pre-doc 88
  return v.lastRequest?.outcome ?? null;
}

export const OUTCOME_BADGE: Record<RequestOutcome, BadgeSpec> = {
  pending: { cls: 'dmh-rv-spill--review', text: 'In review' },
  approved: { cls: 'dmh-rv-spill--approved', text: 'Approved' },
  rejected: { cls: 'dmh-rv-spill--rejected', text: 'Rejected' },
  withdrawn: { cls: 'dmh-rv-spill--draft', text: 'Withdrawn' },
};

/** Badge de la fila/cabecera: el resultado + dónde quedó la versión. */
export function requestBadge(v: RequestLike): BadgeSpec {
  const o = outcomeOf(v);
  if (o === 'pending') return OUTCOME_BADGE.pending;
  if (o === 'approved') return { cls: 'dmh-rv-spill--approved', text: v.appliedAt ? 'Approved · published' : 'Approved · publishing' };
  if (o === 'rejected') return { cls: 'dmh-rv-spill--rejected', text: v.status === 'draft' ? 'Rejected · back in draft' : 'Rejected' };
  if (o === 'withdrawn') return { cls: 'dmh-rv-spill--draft', text: 'Withdrawn · draft' };
  return { cls: 'dmh-rv-spill--draft', text: 'Editing' };
}

/** ¿La versión figura en la bandeja de solicitudes? Toda versión que fue
 *  enviada alguna vez (historial) o está en revisión / decidida (legacy). */
export function isRequest(v: { status: VersionStatus; requests?: RequestCycle[] | null; appliedAt?: string | null }): boolean {
  if ((v.requests?.length ?? 0) > 0) return true;
  return v.status === 'submitted' || v.status === 'rejected' || (v.status === 'approved' && !v.appliedAt);
}

/** Ciclos a mostrar (más reciente primero). Un doc legacy sin historial pero
 *  con una solicitud (enviada/decidida) gana un ciclo sintetizado desde su
 *  cabecera para que la decisión y su nota no se pierdan. */
export function historyOf(d: ChangesetDetail): RequestCycle[] {
  const list = d.requests ?? [];
  if (list.length) return [...list].sort((a, b) => b.cycle - a.cycle);
  if (d.status === 'draft') return [];
  return [{
    id: 'legacy', cycle: 1, submittedAt: d.submittedAt ?? null, submittedBy: d.owner,
    title: d.title, description: d.description ?? null, reviewers: d.reviewers,
    outcome: d.status === 'approved' ? 'approved' : d.status === 'rejected' ? 'rejected' : 'pending',
    decidedBy: d.reviewedBy ?? null, decidedAt: d.reviewedAt ?? null, note: d.reviewNote ?? null,
    decisions: d.approvals,
  }];
}

/** Verbo del cierre de un ciclo. */
export function decidedVerb(outcome: RequestOutcome): string {
  switch (outcome) {
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'withdrawn': return 'Withdrawn';
    default: return 'Pending';
  }
}

/** Fecha compacta para el historial (misma forma que la bandeja). */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Orden de la bandeja: pendientes primero, luego por última actividad. */
export function activityAt(v: { lastRequest?: RequestCycle | null; submittedAt?: string | null; updatedAt?: string | null; createdAt?: string | null }): number {
  const iso = v.lastRequest?.decidedAt ?? v.lastRequest?.submittedAt ?? v.submittedAt ?? v.updatedAt ?? v.createdAt ?? '';
  return Date.parse(iso) || 0;
}
