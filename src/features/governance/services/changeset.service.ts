import { apiGet, apiPost, apiPut } from '@/services/http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const CS = `${API_BASE}/api/changesets`;

export interface ChangesetDiff { added: string[]; modified: string[]; removed: string[]; }
export interface Changeset {
  id: string; title: string; owner: string; status: string;
  changes: Record<string, Record<string, { op: string; payload?: Record<string, unknown> }>>;
  diff?: Record<string, ChangesetDiff>;
  submittedAt?: string; reviewedBy?: string; reviewedAt?: string; reviewNote?: string;
}

export const listChangesets = () => apiGet<Changeset[]>(CS);
export const getChangeset = (id: string) => apiGet<Changeset>(`${CS}/${encodeURIComponent(id)}`);
export const createChangeset = (title: string) => apiPost<Changeset>(CS, { title });
export const recordChange = (id: string, collection: string, entityId: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) =>
  apiPut<Changeset>(`${CS}/${encodeURIComponent(id)}/changes`, { collection, entityId, op, payload });
export const effective = <T>(id: string, collection: string) => apiGet<T[]>(`${CS}/${encodeURIComponent(id)}/effective/${collection}`);
export const submitChangeset = (id: string) => apiPost<Changeset>(`${CS}/${encodeURIComponent(id)}/submit`);
export const approveChangeset = (id: string) => apiPost<Changeset>(`${CS}/${encodeURIComponent(id)}/approve`);
export const rejectChangeset = (id: string, note?: string) => apiPost<Changeset>(`${CS}/${encodeURIComponent(id)}/reject`, { note });
