// Presentación del historial de auditoría — helpers puros que consume
// AuditHistory (testeables sin DOM). El dato viene del backend tal cual el
// ledger lo deriva; acá solo se vuelve legible (UI en inglés).
import type { HistoryItem, HistoryUser } from '@/services/changeset.service';

export const ACTION_LABEL: Record<HistoryItem['action'], string> = {
  created: 'Created',
  edited: 'Edited',
  deleted: 'Deleted',
};

/** Autor de la fila: nombre > email > id; la entrada sintética de la carga
 *  inicial (migración desde Erwin) no tiene usuario real — "System (initial load)". */
export function userLabel(item: Pick<HistoryItem, 'user' | 'synthetic'>): string {
  if (item.synthetic) return 'System (initial load)';
  const u = item.user;
  return u?.name || u?.email || u?.id || '—';
}

/** Nombre-o-correo de un usuario resuelto (aprobadores / publicado por). */
export function refLabel(u?: HistoryUser | null): string {
  return u?.name || u?.email || u?.id || '—';
}

/** Línea de procedencia del alta ("Origin: …") — null si no aplica. */
export function originText(item: Pick<HistoryItem, 'origin'>): string | null {
  const o = item.origin;
  if (!o) return null;
  if (o.kind === 'migration') return 'Initial load — Erwin migration';
  const src = o.sourceTable && o.sourceColumn
    ? `${o.sourceTable}.${o.sourceColumn}`
    : o.sourceTable || o.sourceColumn || null;
  // Si viene de otro proyecto, también su nombre.
  const from = o.sourceProject ? ` (project ${o.sourceProject})` : '';
  if (o.kind === 'paste-table') return `Copied from table ${src ?? '…'}${from}`;
  if (o.kind === 'paste-columns') return `Copied from column ${src ?? '…'}${from}`;
  if (o.kind === 'ctas') return src ? `Created from source ${src} (CTAS)` : 'Created from sources (CTAS)';
  return null;
}

/** Fecha compacta (misma forma que ReviewScreen) + hora local. */
export function formatWhen(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Valor de un campo del diff para mostrar: vacío → '—', booleanos → Yes/No,
 *  contenedores → JSON corto (el backend ya resuelve referencias a nombre). */
export function fieldValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 79)}…` : s;
  }
  return String(v);
}
