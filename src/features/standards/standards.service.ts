/**
 * standards.service — módulo Data Standards (versionado independiente de UDP +
 * Parent Domains), por proyecto: cada proyecto tiene su glosario, dominios,
 * UDPs, naming, reglas DDL y su propio historial. Backend
 * `/api/projects/{pid}/standards/*` (envelope `{success,data}`).
 *
 * Las operaciones puntuales de preview (physicalize, impacto de dominio) usan
 * `@/services/naming.service`; este servicio aporta el snapshot y el
 * versionado (apply/rollback/history).
 */
import { apiGet, apiPost, LONG_TIMEOUT_MS } from '@/services/http';
import { runBlocking } from '@/store/useBusyStore';
import type { UdpScope, Separator, Casing } from '@/services/naming.service';
import type { Theme } from '@/lib/colors';

import { API_BASE } from '@/services/apiBase';
const PROJECT = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}`;
const STD = (pid: string) => `${PROJECT(pid)}/standards`;

import type { StandardsBlock } from '@/types/api';
export type { StandardsBlock };
/** Bloques copiables, con su etiqueta de UI (asistente «New project»). */
export const STANDARDS_BLOCKS: { key: StandardsBlock; label: string }[] = [
  { key: 'glossary', label: 'Glossary' },
  { key: 'domains', label: 'Parent domains' },
  { key: 'udp', label: 'UDP definitions' },
  { key: 'naming', label: 'Naming rules' },
  { key: 'ddl', label: 'DDL export rules' },
  { key: 'themes', label: 'Color themes' },
];
/** Conteos por bloque del proyecto fuente (`GET …/standards/summary`). */
export interface StandardsSummary { glossary: number; domains: number; udp: number; rules: number; naming: boolean; themes?: number }

export interface SnapshotTerm { id: string; term: string; abbrev: string; scope: UdpScope; locked?: boolean; lockedBy?: string | null; lockedAt?: string | null; }
export interface SnapshotDomain {
  id: string; name: string;
  /** `defaultDataType` = tipo físico por defecto; `logicalDataType` = faceta lógica. */
  defaultDataType: string; logicalDataType?: string | null;
  namingTerm?: string | null; description?: string | null;
  /** Dominio «atributo estándar» (FecRutina, CodMes, TipIngresoLKDE…). Solo
   *  estos imponen su nombre lógico y su definición a la columna al asignarse;
   *  el resto aporta únicamente el tipo de dato. El backend lo proyecta y el
   *  campo se declara aquí para que no se pierda en el round-trip de la UI. */
  inheritsName?: boolean | null;
  /** Faceta física (null = derivado / igual a la lógica) + UDP por defecto de atributo/columna. */
  physicalName?: string | null; physicalDescription?: string | null; udpValues?: Record<string, string> | null;
}
export interface NamingRuleSnap { separator: Separator | string | null; case: Casing | string | null; maxLength?: number | null; }
/** Definición de un UDP (User Defined Property): la clave + su tipo + default +
 *  valores permitidos (enum si dataType='list') + niveles donde aplica. */
export type UdpDataType = 'string' | 'number' | 'boolean' | 'date' | 'list';
export type UdpLevel = 'table' | 'column' | 'canvas' | 'view';
/** Faceta Erwin: 'logical' = Entity/Attribute · 'physical' = Table/Column/View/Model. */
export type UdpView = 'logical' | 'physical';
export interface UdpDefinition {
  id: string;
  name: string;
  level: UdpLevel;              // Class: 'table' | 'column' | 'canvas' (Modelo de Datos) | 'view'
  view?: UdpView;               // faceta: ausente = physical
  dataType: UdpDataType;
  defaultValue?: string | null;
  allowedValues: string[];
  description?: string | null;
}

// ── Reglas del Export DDL: viven en el mismo snapshot/versionado ──
/** Por cada tabla o cada vista del export. */
export type DdlRuleScope = 'table' | 'view';
/** Un archivo que escribe la regla: nombre y contenido son plantillas Jinja;
 *  un contenido vacío no genera el archivo. */
export interface DdlRuleFile { name: string; content: string; }
export interface DdlRule {
  id: string;
  name: string;
  description?: string | null;
  scope: DdlRuleScope;
  /** Expresión Jinja; vacía = siempre. */
  when: string;
  files: DdlRuleFile[];
  /** Posición en la lista (0 = arriba = más prioridad). */
  order: number;
  enabled: boolean;
  updatedBy?: string | null;
}
export interface DdlRulesetConfig {
  /** Piezas comunes: macros y constantes Jinja que todas las reglas pueden usar. */
  pieces: string;
  variables: Record<string, string>;
  /** Output settings del Export DDL (ver features/ddl/outputSettings). */
  output?: Record<string, unknown>;
}

export interface StandardsSnapshot {
  domains: SnapshotDomain[];
  dict: SnapshotTerm[];
  namingConfig: { column: NamingRuleSnap; table: NamingRuleSnap };
  udp: UdpDefinition[];
  ddlRules?: DdlRule[];
  ddlConfig?: DdlRulesetConfig;
  /** Themes de color del proyecto (opcional: un snapshot puede no traerlos). */
  themes?: Theme[];
}

export interface StandardsVersion {
  id: string;
  seq: number;
  label: string;
  kind: 'glossary' | 'udp' | 'domain' | 'naming' | 'ddl' | 'themes' | 'batch' | 'baseline' | 'rollback';
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

// ── Lote de cambios que se aplica como una versión ──
export interface TermEditInput { id?: string; term: string; abbrev: string; scope: UdpScope; }
export interface DomainEditInput { id?: string; name: string; defaultDataType: string; logicalDataType?: string; namingTerm?: string; description?: string; inheritsName?: boolean; physicalName?: string; physicalDescription?: string; udpValues?: Record<string, string>; }
export interface NamingEditInput { separator: string; case: string; maxLength: number; }
export interface UdpEditInput {
  id?: string;
  name: string;
  level: UdpLevel;
  view?: UdpView;               // faceta; el backend asume physical si falta
  dataType: UdpDataType;
  defaultValue?: string;
  allowedValues?: string[];
  description?: string;
}
/** Regla del Export DDL en el lote (sin `id` = alta). */
export interface DdlRuleEditInput {
  id?: string;
  name: string;
  description?: string | null;
  scope: DdlRuleScope;
  when: string;
  files: DdlRuleFile[];
  order: number;
  enabled: boolean;
}
/** Alta/edición de un theme de color (sin `id` = alta). */
export interface ThemeEditInput { id?: string; name: string; color: string; order?: number }
export interface ApplyStandardsBody {
  kind?: 'glossary' | 'udp' | 'domain' | 'naming' | 'ddl' | 'themes' | 'batch';
  title?: string;
  description?: string;
  termsUpsert?: TermEditInput[];
  termsDelete?: string[];
  namingConfig?: Partial<Record<UdpScope, NamingEditInput>>;
  domainsUpsert?: DomainEditInput[];
  domainsDelete?: string[];
  udpUpsert?: UdpEditInput[];
  udpDelete?: string[];
  rulesUpsert?: DdlRuleEditInput[];
  rulesDelete?: string[];
  ddlConfigPatch?: { pieces?: string; variables?: Record<string, string>; output?: Record<string, unknown> };
  themesUpsert?: ThemeEditInput[];
  themesDelete?: string[];
}

export const getSnapshot = (projectId: string) => apiGet<StandardsSnapshot>(`${STD(projectId)}/snapshot`);
export const getVersions = (projectId: string) => apiGet<StandardsVersion[]>(`${STD(projectId)}/versions`);
export const getStandardsSummary = (projectId: string) => apiGet<StandardsSummary>(`${STD(projectId)}/summary`);
/** Aplica un lote como una versión del proyecto: re-deriva nombres/tipos en
 *  sus tablas (acción larga). */
export const applyStandards = (projectId: string, body: ApplyStandardsBody) =>
  runBlocking('Applying standards…', () =>
    apiPost<StandardsVersion>(`${STD(projectId)}/apply`, body, { timeoutMs: LONG_TIMEOUT_MS }));
export const rollbackStandards = (projectId: string, targetSeq: number) =>
  runBlocking('Rolling back standards…', () =>
    apiPost<StandardsVersion>(`${STD(projectId)}/rollback`, { targetSeq }, { timeoutMs: LONG_TIMEOUT_MS }));

/** Una versión de Data Standards que modificó un dominio. */
export interface DomainHistoryEntry {
  seq: number;
  label: string;
  title: string;
  author: string;
  createdAt?: string | null;
  kind: StandardsVersion['kind'];
  /** Estado del dominio en esa versión (null = no existía o estaba borrado). */
  state: Omit<SnapshotDomain, 'id'> | null;
  /** Campos que cambiaron respecto de la entrada anterior. */
  changed: string[];
}
export const getDomainHistory = (projectId: string, domainId: string) =>
  apiGet<DomainHistoryEntry[]>(`${STD(projectId)}/domains/${encodeURIComponent(domainId)}/history`);

/** Vista previa del rollback de Data Standards. */
export interface RollbackPreviewDomain {
  id: string;
  name: string;
  physical: { from: string | null; to: string } | null;
  logical: { from: string | null; to: string } | null;
  /** Columnas que se re-tipan (las que siguen al dominio). */
  columns: number;
}
export interface RollbackPreview {
  target: { seq: number; label: string };
  domains: RollbackPreviewDomain[];
  /** Glosario o naming distintos ⇒ se re-derivan nombres físicos. */
  namesRederived: boolean;
  /** La versión guarda reglas del Export DDL del formato anterior: quedan las vigentes. */
  ddlRulesKept: boolean;
  /** UDP que esas reglas vigentes citan y la versión no tiene (saldrían vacíos). */
  ddlRulesMissingUdps: string[];
}
export const getRollbackPreview = (projectId: string, targetSeq: number) =>
  apiGet<RollbackPreview>(`${STD(projectId)}/rollback-preview?targetSeq=${targetSeq}`);

/** Definiciones UDP activas del proyecto (módulo Data Standards y panel de
 *  Properties). GET abierto; las mutaciones van por applyStandards con
 *  kind='udp' (versionado). */
export const getUdpDefs = (projectId: string) => apiGet<UdpDefinition[]>(`${PROJECT(projectId)}/udp`);
