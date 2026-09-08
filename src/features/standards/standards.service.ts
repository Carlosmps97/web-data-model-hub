/**
 * standards.service — módulo Data Standards (versionado independiente de UDP +
 * Parent Domains), POR PROYECTO (doc 75): cada proyecto tiene su glosario,
 * dominios, UDPs, naming, reglas DDL y su propio historial. Backend
 * `/api/projects/{pid}/standards/*` (envelope `{success,data}`).
 *
 * Las MUTACIONES puntuales de preview (physicalize, impacto de dominio) siguen
 * usando `@/services/naming.service`; este servicio agrega el snapshot + el
 * versionado (apply/rollback/history), que es lo nuevo del módulo.
 */
import { apiGet, apiPost, LONG_TIMEOUT_MS } from '@/services/http';
import { runBlocking } from '@/store/useBusyStore';
import type { UdpScope, WordType, Separator, Casing } from '@/services/naming.service';

import { API_BASE } from '@/services/apiBase';
const PROJECT = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}`;
const STD = (pid: string) => `${PROJECT(pid)}/standards`;

import type { StandardsBlock } from '@/types/api';
export type { StandardsBlock };
/** Bloques copiables, con su etiqueta de UI (asistente «New project», doc 75 D15). */
export const STANDARDS_BLOCKS: { key: StandardsBlock; label: string }[] = [
  { key: 'glossary', label: 'Glossary' },
  { key: 'domains', label: 'Parent domains' },
  { key: 'udp', label: 'UDP definitions' },
  { key: 'naming', label: 'Naming rules' },
  { key: 'ddl', label: 'DDL export rules' },
];
/** Conteos por bloque del proyecto fuente (`GET …/standards/summary`). */
export interface StandardsSummary { glossary: number; domains: number; udp: number; rules: number; naming: boolean }

export interface SnapshotTerm { id: string; term: string; abbrev: string; scope: UdpScope; wordType?: WordType | null; locked?: boolean; lockedBy?: string | null; lockedAt?: string | null; }
export interface SnapshotDomain {
  id: string; name: string;
  /** Doc 69: `defaultDataType` = tipo FÍSICO por defecto; `logicalDataType` = faceta lógica. */
  defaultDataType: string; logicalDataType?: string | null;
  namingTerm?: string | null; description?: string | null;
}
export interface NamingRuleSnap { separator: Separator | string | null; case: Casing | string | null; maxLength?: number | null; }
/** Definición de un UDP (User Defined Property): la KEY + su tipo + default +
 *  valores permitidos (enum si dataType='list') + niveles donde aplica. */
export type UdpDataType = 'string' | 'number' | 'boolean' | 'date' | 'list';
export type UdpLevel = 'table' | 'column' | 'canvas' | 'view';
/** Faceta Erwin (doc 69): 'logical' = Entity/Attribute · 'physical' = Table/Column/View/Model. */
export type UdpView = 'logical' | 'physical';
export interface UdpDefinition {
  id: string;
  name: string;
  level: UdpLevel;              // Class: 'table' | 'column' | 'canvas' (Modelo de Datos) | 'view'
  view?: UdpView;               // faceta (doc 69): ausente = physical (defs previas)
  dataType: UdpDataType;
  defaultValue?: string | null;
  allowedValues: string[];
  description?: string | null;
}

// ── DDL Export Rules (doc 30) — viven en el MISMO snapshot/versionado ──
export type DdlRuleKind = 'rule' | 'generator';
export type DdlRuleTarget = 'column' | 'table';
export type DdlValidationState = 'valid' | 'invalid' | 'stale';
export interface DdlValidationCheck { name: string; ok: boolean | null; detail: string; }
export interface DdlValidationError {
  check: string; message: string; token?: string | null; suggestion?: string | null;
  snippet?: string | null; line: number; col: number;
}
export interface DdlValidationReport {
  state: 'valid' | 'invalid';
  checks: DdlValidationCheck[];
  errors: DdlValidationError[];
  warnings: string[];
}
export interface DdlRule {
  id: string;
  name: string;
  description?: string | null;
  kind: DdlRuleKind;
  target?: DdlRuleTarget | null;          // solo kind='rule'
  sourceArtifact?: string | null;         // solo kind='generator'
  condition: string;
  udpRefs: { udpId: string; level: UdpLevel }[];
  action: Record<string, unknown>;        // expression|tags|tblproperties|emit (spec §6.6)
  appliesTo: string[];
  priority: number;
  enabled: boolean;
  validationState: DdlValidationState;
  validationReport: Partial<DdlValidationReport>;
  updatedBy?: string | null;
}
export interface DdlLookup {
  fromUdpId?: string; fromLevel?: UdpLevel;
  values: Record<string, string | null>;
  default?: string | null;
}
export interface DdlRulesetConfig {
  lookups: Record<string, DdlLookup>;
  functions: { name: string; params: string[]; body: string }[];
}

export interface StandardsSnapshot {
  domains: SnapshotDomain[];
  dict: SnapshotTerm[];
  namingConfig: { column: NamingRuleSnap; table: NamingRuleSnap };
  udp: UdpDefinition[];
  ddlRules?: DdlRule[];
  ddlConfig?: DdlRulesetConfig;
}

export interface StandardsVersion {
  id: string;
  seq: number;
  label: string;
  kind: 'glossary' | 'udp' | 'domain' | 'naming' | 'ddl' | 'batch' | 'baseline' | 'rollback';
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
export interface DomainEditInput { id?: string; name: string; defaultDataType: string; logicalDataType?: string; namingTerm?: string; description?: string; }
export interface NamingEditInput { separator: string; case: string; maxLength: number; }
export interface UdpEditInput {
  id?: string;
  name: string;
  level: UdpLevel;
  view?: UdpView;               // faceta (doc 69); el backend asume physical si falta
  dataType: UdpDataType;
  defaultValue?: string;
  allowedValues?: string[];
  description?: string;
}
/** Regla de DDL Export en el batch: `udpRefs`/estado los deriva el server. */
export interface DdlRuleEditInput {
  id?: string;
  name: string;
  description?: string | null;
  kind: DdlRuleKind;
  target?: DdlRuleTarget | null;
  sourceArtifact?: string | null;
  condition: string;
  udpRefs?: { udpId: string; level: UdpLevel }[];
  action: Record<string, unknown>;
  appliesTo: string[];
  priority: number;
  enabled: boolean;
}
export interface ApplyStandardsBody {
  kind?: 'glossary' | 'udp' | 'domain' | 'naming' | 'ddl' | 'batch';
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
  ddlConfigPatch?: { lookups?: Record<string, DdlLookup>; functions?: DdlRulesetConfig['functions'] };
}

export const getSnapshot = (projectId: string) => apiGet<StandardsSnapshot>(`${STD(projectId)}/snapshot`);
export const getVersions = (projectId: string) => apiGet<StandardsVersion[]>(`${STD(projectId)}/versions`);
export const getStandardsSummary = (projectId: string) => apiGet<StandardsSummary>(`${STD(projectId)}/summary`);
/** Aplica un batch como UNA versión del proyecto: re-deriva nombres/tipos en
 *  sus tablas — acción larga (doc 75 D18). */
export const applyStandards = (projectId: string, body: ApplyStandardsBody) =>
  runBlocking('Applying standards…', () =>
    apiPost<StandardsVersion>(`${STD(projectId)}/apply`, body, { timeoutMs: LONG_TIMEOUT_MS }));
export const rollbackStandards = (projectId: string, targetSeq: number) =>
  runBlocking('Rolling back standards…', () =>
    apiPost<StandardsVersion>(`${STD(projectId)}/rollback`, { targetSeq }, { timeoutMs: LONG_TIMEOUT_MS }));

/** Definiciones UDP activas DEL PROYECTO (módulo Data Standards y panel de
 *  Properties). GET abierto; las mutaciones van por applyStandards con
 *  kind='udp' (versionado). */
export const getUdpDefs = (projectId: string) => apiGet<UdpDefinition[]>(`${PROJECT(projectId)}/udp`);
