/**
 * Naming-standards (UDP) service — PER PROJECT (doc 75), not changeset-scoped.
 *
 * Unlike `governance.service` (which routes model writes through the active
 * changeset overlay), glossary terms + naming config are project-wide
 * configuration: editing a term or a separator/case rule re-physicalizes
 * existing names in THAT project and is **not** part of a publish. So this
 * layer talks to the plain REST endpoints directly via `@/services/http`,
 * always under `/api/projects/{pid}/…`.
 *
 * Backend contract (envelope `{ success, data }`):
 *   - GET    …/glossary?scope=table|column   → DictTerm[]
 *   - POST   …/glossary                       {term, abbrev, scope}
 *   - PUT    …/glossary/{id}                  {term, abbrev, scope}
 *   - DELETE …/glossary/{id}
 *   - GET    …/settings/naming                → {column:NamingRule, table:NamingRule}
 *   - PUT    …/settings/naming/{scope}        {separator, case}
 *   - POST   …/glossary/physicalize           {logical, scope} → {physical}
 *   - POST   …/glossary/rephysicalize         {scope?}         → {updated}
 *   - POST   …/glossary/impact                {scope, termsUpsert, termsDelete, namingConfig?} → GlossaryImpact
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/http';

import { API_BASE } from '@/services/apiBase';
const PROJECT = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}`;
const DICT = (pid: string) => `${PROJECT(pid)}/glossary`;
const NAMING = (pid: string) => `${PROJECT(pid)}/settings/naming`;

export type UdpScope = 'column' | 'table';
export type Separator = '_' | '' | '-';
export type Casing = 'upper' | 'lower' | 'camel';

export interface DictTerm {
  id: string;
  term: string;
  abbrev: string;
  scope: UdpScope;
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

// ── Dictionary terms (scoped) ──
export const listTerms = (projectId: string, scope: UdpScope) =>
  apiGet<DictTerm[]>(`${DICT(projectId)}?scope=${encodeURIComponent(scope)}`);

export const createTerm = (projectId: string, x: Omit<DictTerm, 'id'>) => apiPost<DictTerm>(DICT(projectId), x);

export const updateTerm = (projectId: string, id: string, x: Omit<DictTerm, 'id'>) =>
  apiPut<DictTerm>(`${DICT(projectId)}/${encodeURIComponent(id)}`, x);

export const deleteTerm = (projectId: string, id: string) =>
  apiDelete<{ id: string }>(`${DICT(projectId)}/${encodeURIComponent(id)}`);

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
export const validateTerm = (projectId: string, term: string, scope: UdpScope) =>
  apiPost<GlossaryValidation>(`${DICT(projectId)}/validate`, { term, scope });

// ── Dry-run del re-derivado (doc 94 D7): el aviso sale solo con impacto real ──
export interface GlossaryImpactSample {
  entity: 'column' | 'table';
  /** Tabla (físico) de la columna, o la tabla misma si `entity` = 'table'. */
  table: string;
  from: string;
  to: string;
}

export interface GlossaryImpact {
  /** Nombres físicos de COLUMNAS (campos) que cambiarían. */
  columns: number;
  /** Tablas distintas a las que pertenecen esas columnas. */
  columnTables: number;
  /** Nombres físicos de TABLAS que cambiarían. */
  tables: number;
  /** Muestra (cap 20). */
  sample: GlossaryImpactSample[];
}

export interface GlossaryImpactBody {
  scope: UdpScope;
  termsUpsert: { id?: string; term: string; abbrev: string }[];
  termsDelete: string[];
  namingConfig?: { separator?: string; case?: string };
}

/** Cuántos nombres físicos cambiaría aplicar el borrador del glosario. No escribe. */
export const glossaryImpact = (projectId: string, body: GlossaryImpactBody) =>
  apiPost<GlossaryImpact>(`${DICT(projectId)}/impact`, body);

/** Bloquea/desbloquea una entrada (solo admin.manage; D4: intocable para todos). */
export const lockTerm = (projectId: string, id: string) =>
  apiPost<DictTerm>(`${DICT(projectId)}/${encodeURIComponent(id)}/lock`, {});
export const unlockTerm = (projectId: string, id: string) =>
  apiPost<DictTerm>(`${DICT(projectId)}/${encodeURIComponent(id)}/unlock`, {});

// ── Naming config (separator / case per scope) ──
export const getNamingConfig = (projectId: string) => apiGet<NamingConfig>(NAMING(projectId));

export const setNamingConfig = (projectId: string, scope: UdpScope, rule: NamingRule) =>
  apiPut<NamingRule>(`${NAMING(projectId)}/${encodeURIComponent(scope)}`, rule);

// ── Physicalize / retroactive re-physicalize ──
export const physicalize = (projectId: string, logical: string, scope: UdpScope) =>
  apiPost<{ physical: string }>(`${DICT(projectId)}/physicalize`, { logical, scope });

/** Retroactive, project-wide propagation after a term/config change. */
export const rephysicalize = (projectId: string, scope?: UdpScope) =>
  apiPost<{ updated: number }>(`${DICT(projectId)}/rephysicalize`, scope ? { scope } : {});

// ── Parent Domains (per project — direct REST, not changeset; not part of publish) ──
const DOMAINS = (pid: string) => `${PROJECT(pid)}/domains`;

export interface ParentDomainFull {
  id: string;
  name: string;
  defaultDataType: string;
  namingTerm?: string;
  description?: string;
}

/** Fila del impacto agrupado por tabla (F2 #2). */
export interface DomainImpactTable {
  tableId: string;
  schema: string | null;
  physicalName: string;
  logicalName: string;
  columns: number;    // columnas del dominio en esta tabla
  overridden: number; // de esas, con override manual (NO cambian)
}

export interface DomainImpact {
  columnsUsing: number;
  willUpdate: number;
  overridden: number;
  totalTables: number;    // tablas que matchean q (sin q = todas)
  modelsAffected: number; // canvases cuyos tableIds intersectan las afectadas
  tables: DomainImpactTable[];
}

export const listDomainsGlobal = (projectId: string) => apiGet<ParentDomainFull[]>(DOMAINS(projectId));
export const createDomainGlobal = (projectId: string, d: Omit<ParentDomainFull, 'id'>) =>
  apiPost<ParentDomainFull>(DOMAINS(projectId), d);
export const updateDomainGlobal = (projectId: string, id: string, d: Omit<ParentDomainFull, 'id'>) =>
  apiPut<ParentDomainFull>(`${DOMAINS(projectId)}/${encodeURIComponent(id)}`, d);
export const deleteDomainGlobal = (projectId: string, id: string) =>
  apiDelete<{ id: string }>(`${DOMAINS(projectId)}/${encodeURIComponent(id)}`);
/** Impacto detallado de un cambio de tipo del dominio (F2 #2): totales del
 *  proyecto + tablas agrupadas; `q` busca por nombre de tabla server-side. */
export const getDomainImpact = (
  projectId: string,
  id: string,
  opts: { q?: string; offset?: number; limit?: number } = {},
) => {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.offset != null) params.set('offset', String(opts.offset));
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiGet<DomainImpact>(`${DOMAINS(projectId)}/${encodeURIComponent(id)}/impact${qs ? `?${qs}` : ''}`);
};
/** Aplica el `defaultDataType` actual del dominio a las columnas sin override. */
export const propagateDomain = (projectId: string, id: string) =>
  apiPost<{ updated: number }>(`${DOMAINS(projectId)}/${encodeURIComponent(id)}/propagate`);
