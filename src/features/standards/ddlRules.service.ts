/**
 * ddlRules.service — DDL Export Rules (doc 30, 5ta pestaña de Data Standards).
 *
 * Lectura + validación/test/impact van a `/api/projects/{pid}/ddl-rules/*`
 * (stateless, por proyecto — doc 75).
 * Las MUTACIONES son versionadas: pasan por `applyStandards` (rulesUpsert /
 * rulesDelete / ddlConfigPatch) — cada guardado es una versión del historial,
 * con rollback incluido, igual que UDP/Glossary/Parent Domains.
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { apiGet, apiPost } from '@/services/http';
import { API_BASE } from '@/services/apiBase';

import {
  applyStandards,
  type DdlLookup, type DdlRule, type DdlRuleEditInput, type DdlRulesetConfig,
  type DdlValidationReport, type StandardsVersion,
} from './standards.service';

const DDL = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}/ddl-rules`;

/** Artefacto del catálogo. `kind` (doc 71 H4): table | view — el editor lo
 *  muestra para elegir destinos compatibles con la acción. */
export interface DdlArtifact { id: string; label: string; root: boolean; generatedBy?: string; kind?: 'table' | 'view'; }
export interface DdlTestFragment { column?: string; label?: string; sql: string; why?: string | null; }
export interface DdlTestResult { table: string; matched: number; total: number; fragments: DdlTestFragment[]; }
export interface DdlImpact { columns: number; tables: number; }
export interface DdlTemplate { id: string; title: string; summary: string; rule: Partial<DdlRuleEditInput>; }
export interface DdlTemplatesPayload {
  templates: DdlTemplate[];
  seedRules: DdlRuleEditInput[];
  seedLookups: Record<string, DdlLookup>;
}
/** El /validate devuelve además la condición canonizada y los udpRefs. */
export interface DdlValidateResult extends DdlValidationReport {
  udpRefs: { udpId: string; level: string }[];
  condition: string;
}

export const listDdlRules = (projectId: string) => apiGet<DdlRule[]>(DDL(projectId));
export const getDdlConfig = (projectId: string) => apiGet<DdlRulesetConfig>(`${DDL(projectId)}/config`);
export const getDdlArtifacts = (projectId: string) => apiGet<DdlArtifact[]>(`${DDL(projectId)}/artifacts`);
export const getDdlTemplates = (projectId: string) => apiGet<DdlTemplatesPayload>(`${DDL(projectId)}/templates`);
export const validateDdlRule = (projectId: string, rule: DdlRuleEditInput) =>
  apiPost<DdlValidateResult>(`${DDL(projectId)}/validate`, rule);
export const testDdlRule = (projectId: string, rule: DdlRuleEditInput, tableId: string) =>
  apiPost<DdlTestResult>(`${DDL(projectId)}/test`, { rule, tableId });
export const impactDdlRule = (projectId: string, rule: DdlRuleEditInput) =>
  apiPost<DdlImpact>(`${DDL(projectId)}/impact`, { rule });

// ── Mutaciones versionadas (una versión del historial del proyecto por acción) ──

export const saveDdlRule = (projectId: string, rule: DdlRuleEditInput, isNew: boolean): Promise<StandardsVersion> =>
  applyStandards(projectId, {
    kind: 'ddl',
    title: `${rule.kind === 'generator' ? 'Generator' : 'Rule'} ${rule.name} · ${isNew ? 'added' : 'edited'}`,
    rulesUpsert: [rule],
  });

export const deleteDdlRule = (projectId: string, rule: DdlRule): Promise<StandardsVersion> =>
  applyStandards(projectId, {
    kind: 'ddl',
    title: `${rule.kind === 'generator' ? 'Generator' : 'Rule'} ${rule.name} · deleted`,
    rulesDelete: [rule.id],
  });

export const toggleDdlRule = (projectId: string, rule: DdlRule, enabled: boolean): Promise<StandardsVersion> =>
  applyStandards(projectId, {
    kind: 'ddl',
    title: `Rule ${rule.name} · ${enabled ? 'enabled' : 'disabled'}`,
    rulesUpsert: [{ ...toEditInput(rule), enabled }],
  });

export const saveDdlConfig = (
  projectId: string,
  patch: { lookups?: Record<string, DdlLookup>; functions?: DdlRulesetConfig['functions'] },
): Promise<StandardsVersion> =>
  applyStandards(projectId, { kind: 'ddl', title: 'DDL lookups & functions · edited', ddlConfigPatch: patch });

/** CTA del catálogo vacío: aplica el ruleset base (8 reglas + lookups) como
 *  UNA versión del proyecto. En una BD nueva esto mismo lo corre
 *  `scripts/seed_ddl_export_rules.py --all-projects` — acá queda para quien
 *  lo borró todo. */
export const seedStarterRules = async (projectId: string): Promise<StandardsVersion> => {
  const t = await getDdlTemplates(projectId);
  return applyStandards(projectId, {
    kind: 'ddl', title: `Base — DDL export rules · ${t.seedRules.length} rules + lookups`,
    rulesUpsert: t.seedRules, ddlConfigPatch: { lookups: t.seedLookups },
  });
};

export const toEditInput = (r: DdlRule): DdlRuleEditInput => ({
  id: r.id, name: r.name, description: r.description ?? undefined, kind: r.kind,
  target: r.target ?? undefined, sourceArtifact: r.sourceArtifact ?? undefined,
  condition: r.condition, udpRefs: r.udpRefs, action: r.action,
  appliesTo: r.appliesTo, priority: r.priority, enabled: r.enabled,
});

// ── Form ↔ YAML (claves en inglés, 1:1 con el formulario — spec §6.1) ──────

const YAML_KEYS = ['name', 'description', 'kind', 'target', 'sourceArtifact',
                   'condition', 'action', 'appliesTo', 'priority', 'enabled'] as const;

export function ruleToYaml(rule: DdlRuleEditInput): string {
  const doc: Record<string, unknown> = {};
  for (const k of YAML_KEYS) {
    const v = (rule as unknown as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
        && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)) {
      doc[k] = v;
    }
  }
  return stringifyYaml(doc, { lineWidth: 100 });
}

/** YAML → regla (conserva id/udpRefs del borrador actual). Lanza Error legible
 *  si el YAML no parsea o le falta lo mínimo. */
export function yamlToRule(text: string, current: DdlRuleEditInput): DdlRuleEditInput {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new Error(`Invalid YAML: ${e instanceof Error ? e.message.split('\n')[0] : 'parse error'}`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('The YAML must be a mapping (key: value).');
  }
  const d = doc as Record<string, unknown>;
  const kind = d.kind === 'generator' ? 'generator' : 'rule';
  return {
    ...current,
    name: typeof d.name === 'string' ? d.name : current.name,
    description: typeof d.description === 'string' ? d.description : undefined,
    kind,
    target: kind === 'rule' ? (d.target === 'table' ? 'table' : 'column') : undefined,
    sourceArtifact: kind === 'generator' && typeof d.sourceArtifact === 'string'
      ? d.sourceArtifact : undefined,
    condition: typeof d.condition === 'string' ? d.condition : '',
    action: (typeof d.action === 'object' && d.action !== null ? d.action : {}) as Record<string, unknown>,
    appliesTo: Array.isArray(d.appliesTo) ? d.appliesTo.map(String) : [],
    priority: typeof d.priority === 'number' ? d.priority : current.priority,
    enabled: typeof d.enabled === 'boolean' ? d.enabled : current.enabled,
  };
}
