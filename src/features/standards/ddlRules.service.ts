/**
 * ddlRules.service — reglas del Export DDL (pestaña de Data Standards).
 *
 * Lectura, validación y vista previa van a `/api/projects/{pid}/ddl-rules/*`
 * (por proyecto, sin guardar nada). Las mutaciones son versionadas: pasan por
 * `applyStandards` (rulesUpsert / rulesDelete / ddlConfigPatch) — cada guardado
 * es una versión del historial, con rollback incluido, igual que
 * UDP/Glossary/Parent Domains.
 */
import { apiGet, apiPost } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import {
  tablePreviewPayload, type DdlOutputSettings, type RenderedExport, type RulesPayload,
} from '@/features/ddl';

import {
  applyStandards,
  type DdlRule, type DdlRuleEditInput, type DdlRulesetConfig, type StandardsVersion,
} from './standards.service';

const DDL = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}/ddl-rules`;

/** Un error de una regla (o de las piezas/variables): campo y línea. */
export interface DdlRuleIssue { field: string; line: number | null; message: string; }
/** Errores (bloquean el guardado) y avisos (un UDP que no existe). */
export interface DdlValidation { errors: DdlRuleIssue[]; warnings: string[]; }
/** El set base: los 7 DDL de la macro + la excepción legacy DAC. */
export interface DdlBaseRuleSet { rules: DdlRuleEditInput[]; pieces: string; variables: Record<string, string>; }
export interface DdlPreviewTable { id: string; physicalName: string; logicalName?: string; schema?: string | null; }

/** Valida una regla en edición (con las piezas y variables en edición o las
 *  guardadas); sin regla, solo las piezas y las variables. */
export const validateDdlRule = (
  projectId: string, rule: DdlRuleEditInput | null, pieces?: string, variables?: Record<string, string>,
) => apiPost<DdlValidation>(`${DDL(projectId)}/validate`, { rule, pieces, variables });

/** Vista previa del editor: corre la lista que se le pasa (la regla en edición
 *  en su lugar) sobre el payload de una tabla. No guarda. */
export const previewDdlRules = (projectId: string, body: {
  rules: DdlRuleEditInput[]; pieces: string; variables: Record<string, string>; payload: RulesPayload;
}) => apiPost<RenderedExport>(`${DDL(projectId)}/preview`, body);

export const getBaseRuleSet = (projectId: string) => apiGet<DdlBaseRuleSet>(`${DDL(projectId)}/base`);

/** Tablas del catálogo del proyecto para la vista previa (por nombre). */
export const searchPreviewTables = (projectId: string, q: string) =>
  apiGet<DdlPreviewTable[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/catalog/tables?q=${encodeURIComponent(q)}&limit=15`);

/** Payload de la vista previa con una tabla real (publicada) y sus vistas,
 *  como si el popup exportara solo esa tabla. Las otras fuentes de una vista
 *  de 2+ tablas se leen para escribir su FROM. */
export async function previewPayloadFor(tableId: string): Promise<RulesPayload> {
  const t = await apiGet<Omit<Parameters<typeof tablePreviewPayload>[0], 'otherTables'>>(
    `${API_BASE}/api/catalog/inspect/tables/${encodeURIComponent(tableId)}`);
  const others = new Map<string, DdlPreviewTable>();
  await Promise.all(t.views.filter((v) => (v.sourceTableIds?.length ?? 0) > 1).map(async (v) => {
    const iv = await apiGet<{ sources: DdlPreviewTable[] }>(`${API_BASE}/api/catalog/inspect/views/${encodeURIComponent(v.id)}`);
    iv.sources.filter((s) => s.id !== tableId).forEach((s) => others.set(s.id, s));
  }));
  return tablePreviewPayload({
    table: t.table, columns: t.columns, views: t.views,
    otherTables: [...others.values()].map((s) => ({ id: s.id, physicalName: s.physicalName, schema: s.schema ?? undefined })),
  });
}

// ── Mutaciones versionadas (una versión del historial del proyecto por acción) ──

export const saveDdlRule = (projectId: string, rule: DdlRuleEditInput, isNew: boolean): Promise<StandardsVersion> =>
  applyStandards(projectId, { kind: 'ddl', title: `Rule ${rule.name} · ${isNew ? 'added' : 'edited'}`, rulesUpsert: [rule] });

export const deleteDdlRule = (projectId: string, rule: DdlRule): Promise<StandardsVersion> =>
  applyStandards(projectId, { kind: 'ddl', title: `Rule ${rule.name} · deleted`, rulesDelete: [rule.id] });

export const toggleDdlRule = (projectId: string, rule: DdlRule, enabled: boolean): Promise<StandardsVersion> =>
  applyStandards(projectId, {
    kind: 'ddl',
    title: `Rule ${rule.name} · ${enabled ? 'enabled' : 'disabled'}`,
    rulesUpsert: [{ ...toEditInput(rule), enabled }],
  });

/** Lista en su nuevo orden: `order` = posición (0 = arriba = más prioridad);
 *  solo viajan las reglas cuya posición cambia. Null si nada cambia. */
export function reorderDdlRules(projectId: string, rules: DdlRule[]): Promise<StandardsVersion> | null {
  const moved = rules.flatMap((r, i) => (r.order === i ? [] : [{ ...toEditInput(r), order: i }]));
  if (!moved.length) return null;
  return applyStandards(projectId, { kind: 'ddl', title: 'DDL export rules · reordered', rulesUpsert: moved });
}

/** Guarda las piezas comunes y las variables (una versión del historial). */
export const saveDdlConfig = (
  projectId: string, patch: { pieces?: string; variables?: Record<string, string> },
): Promise<StandardsVersion> =>
  applyStandards(projectId, { kind: 'ddl', title: 'DDL pieces & variables · edited', ddlConfigPatch: patch });

/** Guarda las Output settings del proyecto (una versión del historial). */
export const saveDdlOutput = (projectId: string, output: DdlOutputSettings): Promise<StandardsVersion> =>
  applyStandards(projectId, {
    kind: 'ddl', title: 'DDL output settings · edited',
    ddlConfigPatch: { output: output as unknown as Record<string, unknown> },
  });

/** CTA de la lista vacía: el set base con sus piezas, como una versión del
 *  proyecto. Las variables del proyecto se conservan (p. ej. la función de
 *  desencriptado de la instalación); las que falten se agregan. En una BD nueva
 *  esto mismo lo siembra `scripts/seed_ddl_export_rules.py --all-projects`. */
export async function restoreBaseRuleSet(projectId: string, current: DdlRulesetConfig): Promise<StandardsVersion> {
  const base = await getBaseRuleSet(projectId);
  return applyStandards(projectId, {
    kind: 'ddl', title: `Base — DDL export rules · ${base.rules.length} rules + pieces`,
    rulesUpsert: base.rules,
    ddlConfigPatch: { pieces: base.pieces, variables: { ...base.variables, ...current.variables } },
  });
}

export const toEditInput = (r: DdlRule): DdlRuleEditInput => ({
  id: r.id, name: r.name, description: r.description ?? undefined, scope: r.scope, when: r.when ?? '',
  files: (r.files ?? []).map((f) => ({ name: f.name, content: f.content })), order: r.order, enabled: r.enabled,
});
