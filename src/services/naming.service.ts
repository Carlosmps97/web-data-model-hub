/**
 * Naming-standards (UDP) service — GLOBAL, NOT changeset-scoped.
 *
 * Unlike `governance.service` (which routes dictionary writes through the
 * active changeset overlay), UDP terms + naming config are model-wide
 * configuration: editing a term or a separator/case rule re-physicalizes
 * existing names everywhere and is **not** part of a publish. So this layer
 * talks to the plain REST endpoints directly via `@/services/http`.
 *
 * Backend contract (envelope `{ success, data }`):
 *   - GET    /api/glossary?scope=table|column   → DictTerm[]
 *   - POST   /api/glossary                       {term, abbrev, scope, wordType?}
 *   - PUT    /api/glossary/{id}                  {term, abbrev, scope, wordType?}
 *   - DELETE /api/glossary/{id}
 *   - GET    /api/settings/naming                  → {column:NamingRule, table:NamingRule}
 *   - PUT    /api/settings/naming/{scope}          {separator, case}
 *   - POST   /api/glossary/physicalize           {logical, scope} → {physical}
 *   - POST   /api/glossary/rephysicalize         {scope?}         → {updated}
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const DICT = `${API_BASE}/api/glossary`;
const NAMING = `${API_BASE}/api/settings/naming`;

export type UdpScope = 'column' | 'table';
export type WordType = 'prime' | 'class' | 'modifier';
export type Separator = '_' | '' | '-';
export type Casing = 'upper' | 'lower' | 'camel';

export interface DictTerm {
  id: string;
  term: string;
  abbrev: string;
  scope: UdpScope;
  wordType?: WordType;
  // F2 #1 (round-trip TS ↔ Pydantic): lock por ADMIN. También en SnapshotTerm.
  locked?: boolean;
  lockedBy?: string | null;
  lockedAt?: string | null;
}

export interface NamingRule {
  separator: Separator;
  case: Casing;
}

export interface NamingConfig {
  column: NamingRule;
  table: NamingRule;
}

// ── Dictionary terms (scoped, with word type) ──
export const listTerms = (scope: UdpScope) =>
  apiGet<DictTerm[]>(`${DICT}?scope=${encodeURIComponent(scope)}`);

export const createTerm = (x: Omit<DictTerm, 'id'>) => apiPost<DictTerm>(DICT, x);

export const updateTerm = (id: string, x: Omit<DictTerm, 'id'>) =>
  apiPut<DictTerm>(`${DICT}/${encodeURIComponent(id)}`, x);

export const deleteTerm = (id: string) => apiDelete<{ id: string }>(`${DICT}/${encodeURIComponent(id)}`);

// ── Validación de término nuevo + lock por ADMIN (F2 #1) ──
export interface GlossaryCorpusHit {
  entity: 'table' | 'column';
  tableName: string;
  columnName: string | null;
  logicalName: string;
}

export interface GlossaryValidation {
  ok: boolean;
  conflicts: {
    glossaryDuplicate: { id: string; term: string; abbrev: string } | null;
    corpus: GlossaryCorpusHit[]; // muestra capada a 50
    total: number;               // corpus total + 1 si hay duplicado
  };
}

/** Valida un término/frase contra el glosario del scope y el corpus de nombres
 *  lógicos publicados. Cortesía de UX: el backend re-valida en cada write. */
export const validateTerm = (term: string, scope: UdpScope) =>
  apiPost<GlossaryValidation>(`${DICT}/validate`, { term, scope });

/** Bloquea/desbloquea una entrada (solo admin.manage; D4: intocable para todos). */
export const lockTerm = (id: string) =>
  apiPost<DictTerm>(`${DICT}/${encodeURIComponent(id)}/lock`, {});
export const unlockTerm = (id: string) =>
  apiPost<DictTerm>(`${DICT}/${encodeURIComponent(id)}/unlock`, {});

// ── Naming config (separator / case per scope) ──
export const getNamingConfig = () => apiGet<NamingConfig>(NAMING);

export const setNamingConfig = (scope: UdpScope, rule: NamingRule) =>
  apiPut<NamingRule>(`${NAMING}/${encodeURIComponent(scope)}`, rule);

// ── Physicalize / retroactive re-physicalize ──
export const physicalize = (logical: string, scope: UdpScope) =>
  apiPost<{ physical: string }>(`${DICT}/physicalize`, { logical, scope });

/** Retroactive, model-wide propagation after a term/config change. */
export const rephysicalize = (scope?: UdpScope) =>
  apiPost<{ updated: number }>(`${DICT}/rephysicalize`, scope ? { scope } : {});

// ── Parent Domains (GLOBAL — direct REST, not changeset; not part of publish) ──
const DOMAINS = `${API_BASE}/api/domains`;

export interface ParentDomainFull {
  id: string;
  name: string;
  defaultDataType: string;
  namingTerm?: string;
  description?: string;
}

export interface DomainImpactColumn {
  id: string;
  physicalName: string;
  tableId: string;
  overridden: boolean;
}

export interface DomainImpact {
  columnsUsing: number;
  willUpdate: number;
  overridden: number;
  columns: DomainImpactColumn[];
}

export const listDomainsGlobal = () => apiGet<ParentDomainFull[]>(DOMAINS);
export const createDomainGlobal = (d: Omit<ParentDomainFull, 'id'>) => apiPost<ParentDomainFull>(DOMAINS, d);
export const updateDomainGlobal = (id: string, d: Omit<ParentDomainFull, 'id'>) =>
  apiPut<ParentDomainFull>(`${DOMAINS}/${encodeURIComponent(id)}`, d);
export const deleteDomainGlobal = (id: string) => apiDelete<{ id: string }>(`${DOMAINS}/${encodeURIComponent(id)}`);
/** Columnas afectadas por un cambio de tipo del dominio (p4b). */
export const getDomainImpact = (id: string) => apiGet<DomainImpact>(`${DOMAINS}/${encodeURIComponent(id)}/impact`);
/** Aplica el `defaultDataType` actual del dominio a las columnas sin override. */
export const propagateDomain = (id: string) => apiPost<{ updated: number }>(`${DOMAINS}/${encodeURIComponent(id)}/propagate`);
