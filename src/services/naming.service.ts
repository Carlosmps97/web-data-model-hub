/**
 * Servicio de estándares de nombres (UDP): por proyecto, sin alcance de
 * changeset.
 *
 * A diferencia de `governance.service` (que enruta las escrituras del modelo por
 * el overlay del changeset activo), los términos del glosario y la configuración
 * de naming son configuración de todo el proyecto, siempre bajo
 * `/api/projects/{pid}/…`. Esta capa solo lee y calcula (validate, impact,
 * physicalize, lock/unlock): todo cambio de estándares pasa por el
 * `standards/apply` versionado (Data Standards › Save & apply, con historial y
 * rollback); el backend responde 409 a las escrituras directas (CRUD de
 * glossary/domains/naming, propagate, rephysicalize).
 *
 * Contrato del backend (envelope `{ success, data }`):
 *   - GET    …/settings/naming                → {column:NamingRule, table:NamingRule}
 *   - POST   …/glossary/physicalize           {logical, scope} → {physical}
 *   - POST   …/glossary/impact                {scope, termsUpsert, termsDelete, namingConfig?} → GlossaryImpact {renamed, outOfSync}
 */
import { apiGet, apiPost } from '@/services/http';

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
  // Round-trip TS ↔ Pydantic: lock por admin. También en SnapshotTerm.
  locked?: boolean;
  lockedBy?: string | null;
  lockedAt?: string | null;
}

export interface NamingRule {
  separator: Separator;
  case: Casing;
  /** Tope de largo del físico en caracteres (0 = sin tope); lo aplica el backend al crear o renombrar. */
  maxLength?: number;
}

export interface NamingConfig {
  column: NamingRule;
  table: NamingRule;
}

// ── Validación de término nuevo + lock por admin ──
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
    corpus: GlossaryCorpusHit[]; // lista completa del corpus
    total: number;               // corpus total + 1 si hay duplicado
  };
}

/** Valida un término/frase contra el glosario del scope y el corpus de nombres
 *  lógicos publicados. Cortesía de UX: el backend re-valida en cada write. */
export const validateTerm = (projectId: string, term: string, scope: UdpScope) =>
  apiPost<GlossaryValidation>(`${DICT(projectId)}/validate`, { term, scope });

// ── Dry-run del re-derivado: qué renombra el borrador y qué ya estaba desfasado ──
export interface GlossaryImpactRow {
  entity: 'column' | 'table';
  /** Tabla de la columna, o la tabla misma si `entity` = 'table'. */
  tableId: string;
  /** Nombre físico de esa tabla. */
  table: string;
  from: string;
  to: string;
}

export interface GlossaryImpact {
  /** Nombres que renombra el borrador (lista completa). */
  renamed: GlossaryImpactRow[];
  /** Nombres ya desfasados de la regla vigente que el apply repara de paso. */
  outOfSync: GlossaryImpactRow[];
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

/** Bloquea/desbloquea una entrada (solo admin.manage; bloqueada, es intocable para todos). */
export const lockTerm = (projectId: string, id: string) =>
  apiPost<DictTerm>(`${DICT(projectId)}/${encodeURIComponent(id)}/lock`, {});
export const unlockTerm = (projectId: string, id: string) =>
  apiPost<DictTerm>(`${DICT(projectId)}/${encodeURIComponent(id)}/unlock`, {});

// ── Configuración de naming (separador / case por scope) ──
export const getNamingConfig = (projectId: string) => apiGet<NamingConfig>(NAMING(projectId));

// ── Physicalize / re-physicalize retroactivo ──
export const physicalize = (projectId: string, logical: string, scope: UdpScope) =>
  apiPost<{ physical: string }>(`${DICT(projectId)}/physicalize`, { logical, scope });

// ── Parent Domains (por proyecto; solo lectura: los cambios van por standards/apply) ──
const DOMAINS = (pid: string) => `${PROJECT(pid)}/domains`;

export interface ParentDomainFull {
  id: string;
  name: string;
  defaultDataType: string;
  namingTerm?: string;
  description?: string;
}

// ── Impacto exacto por columna (la misma regla que aplica la cascada) ──
export type DomainColumnStatus = 'change' | 'override' | 'differs';

export interface DomainColumnImpactRow {
  columnId: string;
  tableId: string;
  schema: string | null;
  table: string;
  tableLogical: string;
  column: string;
  attribute: string;
  physicalType: string | null;
  logicalType: string | null;
  /** Estado por faceta que cambia (null = esa faceta no cambia). */
  physical: DomainColumnStatus | null;
  logical: DomainColumnStatus | null;
  status: DomainColumnStatus;
}

export interface DomainColumnImpact {
  /** Tipos actuales del dominio. */
  domain: { physical: string | null; logical: string | null };
  /** Tipos nuevos (homologados) de las facetas que cambian. */
  targets: { physical?: string | null; logical?: string | null };
  /** Globales (no dependen de q/status). `tables` = todas; `changeTables` = las que cambian; `models` = modelos de las que cambian (sin tipos nuevos, de todas). */
  totals: { columns: number; tables: number; change: number; changeTables: number; override: number; differs: number; models: number };
  /** Filas que coinciden con q/status (para paginar). */
  matched: number;
  rows: DomainColumnImpactRow[];
}

export const listDomainsGlobal = (projectId: string) => apiGet<ParentDomainFull[]>(DOMAINS(projectId));
/** Vista previa por columna de re-tipar el dominio (`physicalTo`/`logicalTo`);
 *  sin tipos nuevos mide quién lo sigue hoy. `limit: 0` = solo totales. */
export const getDomainColumnImpact = (
  projectId: string,
  id: string,
  opts: { physicalTo?: string; logicalTo?: string; q?: string; status?: DomainColumnStatus; offset?: number; limit?: number } = {},
) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return apiGet<DomainColumnImpact>(`${DOMAINS(projectId)}/${encodeURIComponent(id)}/impact/columns${qs ? `?${qs}` : ''}`);
};
