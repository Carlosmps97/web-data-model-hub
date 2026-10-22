/**
 * Administración de versiones: transferir el ownership de un draft y
 * eliminarlo. Reglas puras, espejo del backend (`changesets/access.can_manage`
 * + `service._state_block`), para mostrar los botones con su motivo; la
 * autoridad sigue siendo el backend (403/409 con mensaje legible).
 */
import type { OwnershipTransfer, SimUserDto, VersionStatus } from '@/types/versioning';

type Has = (perm: 'model.edit' | 'admin.manage') => boolean;

export type VersionAction = 'transfer' | 'delete';

/** Quién inició la versión: el origen de la primera transferencia; null si
 *  no tiene transferencias (entonces la inició su dueño actual). */
export function startedBy(v: { transfers?: OwnershipTransfer[] | null }): string | null {
  return v.transfers?.[0]?.from ?? null;
}

/** «Started by» solo cuando dice algo: quien la inició no es el dueño actual
 *  (una versión que volvió a sus manos, A→B→A, no lo muestra). */
export function showStartedBy(v: { owner?: string | null; transfers?: OwnershipTransfer[] | null }): string | null {
  const starter = startedBy(v);
  return starter && starter !== v.owner ? starter : null;
}

/** ¿El actor administra (transfiere / elimina) esta versión? Su dueño si su
 *  rol edita modelos, o un administrador; administrar no es editar. */
export function canManageVersion(v: { owner?: string | null }, me: string | null | undefined, has: Has): boolean {
  if (has('admin.manage')) return true;
  return Boolean(me) && v.owner === me && has('model.edit');
}

/** Motivo por el que el estado de la versión no admite la acción, o null si
 *  la admite: solo drafts (y, para eliminar, un `rejected`). */
export function versionActionBlock(
  v: { status: VersionStatus; appliedAt?: string | null },
  action: VersionAction,
): string | null {
  const past = action === 'transfer' ? 'transferred' : 'deleted';
  if (v.status === 'draft') return null;
  if (v.status === 'rejected' && action === 'delete') return null;
  if (v.status === 'approved') return `Published versions are part of the model history: they can't be ${past}.`;
  if (v.status === 'submitted') {
    return "The version is in review: its owner must withdraw the request first (or wait for the reviewers' decision).";
  }
  return `Only a version in draft can be ${past}.`;
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });

/** Candidatos a recibir la versión: todos menos su dueño actual, A–Z. La
 *  lista ya viene filtrada por `model.edit` (el backend vuelve a validarlo). */
export function transferTargets(users: SimUserDto[], owner: string | null | undefined): SimUserDto[] {
  return users.filter((u) => u.id !== owner).sort((a, b) => collator.compare(a.name, b.name));
}
