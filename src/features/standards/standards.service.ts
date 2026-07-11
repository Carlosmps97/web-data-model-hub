/**
 * standards.service — módulo Data Standards (versionado independiente de UDP +
 * Parent Domains). Backend `/api/standards/*` (envelope `{success,data}`).
 *
 * Las MUTACIONES puntuales de preview (physicalize, impacto de dominio) siguen
 * usando `@/services/naming.service`; este servicio agrega el snapshot + el
 * versionado (apply/rollback/history), que es lo nuevo del módulo.
 */
import { apiGet, apiPost } from '@/services/http';
import type { UdpScope, WordType, Separator, Casing } from '@/services/naming.service';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const STD = `${API_BASE}/api/standards`;

export interface SnapshotTerm { id: string; term: string; abbrev: string; scope: UdpScope; wordType?: WordType | null; locked?: boolean; lockedBy?: string | null; lockedAt?: string | null; }
export interface SnapshotDomain { id: string; name: string; defaultDataType: string; namingTerm?: string | null; description?: string | null; }
export interface NamingRuleSnap { separator: Separator | string | null; case: Casing | string | null; }
/** Definición de un UDP (User Defined Property): la KEY + su tipo + default +
 *  valores permitidos (enum si dataType='list') + niveles donde aplica. */
export type UdpDataType = 'string' | 'number' | 'boolean' | 'date' | 'list';
export type UdpLevel = 'table' | 'column';
export interface UdpDefinition {
  id: string;
  name: string;
  level: UdpLevel;              // Class: 'table' | 'column' (extensible a más jerarquías)
  dataType: UdpDataType;
  defaultValue?: string | null;
  allowedValues: string[];
  description?: string | null;
}

export interface StandardsSnapshot {
  domains: SnapshotDomain[];
  dict: SnapshotTerm[];
  namingConfig: { column: NamingRuleSnap; table: NamingRuleSnap };
  udp: UdpDefinition[];
}

export interface StandardsVersion {
  id: string;
  seq: number;
  label: string;
  kind: 'glossary' | 'udp' | 'domain' | 'naming' | 'batch' | 'baseline' | 'rollback';
  title: string;
  description?: string | null;
  author: string;
  createdAt?: string | null;
  appliedAt?: string | null;
  status: string;
  diff: { added: string[]; edited: string[]; removed: string[] };
  impact: { tables: number; columns: number };
  revertsSeq?: number | null;
}

// ── Batch de cambios que se aplica como UNA versión (15d/15e) ──
export interface TermEditInput { id?: string; term: string; abbrev: string; scope: UdpScope; wordType?: WordType; }
export interface DomainEditInput { id?: string; name: string; defaultDataType: string; namingTerm?: string; description?: string; }
export interface NamingEditInput { separator: string; case: string; }
export interface UdpEditInput {
  id?: string;
  name: string;
  level: UdpLevel;
  dataType: UdpDataType;
  defaultValue?: string;
  allowedValues?: string[];
  description?: string;
}
export interface ApplyStandardsBody {
  kind?: 'glossary' | 'udp' | 'domain' | 'naming' | 'batch';
  title?: string;
  description?: string;
  termsUpsert?: TermEditInput[];
  termsDelete?: string[];
  namingConfig?: Partial<Record<UdpScope, NamingEditInput>>;
  domainsUpsert?: DomainEditInput[];
  domainsDelete?: string[];
  udpUpsert?: UdpEditInput[];
  udpDelete?: string[];
}

export const getSnapshot = () => apiGet<StandardsSnapshot>(`${STD}/snapshot`);
export const getVersions = () => apiGet<StandardsVersion[]>(`${STD}/versions`);
export const applyStandards = (body: ApplyStandardsBody) => apiPost<StandardsVersion>(`${STD}/apply`, body);
export const rollbackStandards = (targetSeq: number) => apiPost<StandardsVersion>(`${STD}/rollback`, { targetSeq });

/** Definiciones UDP activas (para el módulo Data Standards y el panel de
 *  Properties). GET abierto (`/api/udp`); las mutaciones van por applyStandards
 *  con kind='udp' (versionado). */
export const getUdpDefs = () => apiGet<UdpDefinition[]>(`${API_BASE}/api/udp`);
