/** ddlRules.service: YAML round-trip 1:1 con el form, mutaciones vía
 *  standards/apply (versionadas) y el CTA de semillas. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), LONG_TIMEOUT_MS: 120_000 }));

import { apiGet, apiPost } from '@/services/http';
import {
  ruleActionSummary, ruleToYaml, saveDdlOutput, saveDdlRule, seedStarterRules, toEditInput, toggleDdlRule, yamlToRule,
} from './ddlRules.service';
import type { DdlRule } from './standards.service';

const RULE: DdlRule = {
  id: 'r1', name: 'enmascarar_dac', description: null, kind: 'rule', target: 'column',
  sourceArtifact: null, condition: 'columna.udp["Clasificacion del Dato"] LIKE \'DAC-%\'',
  udpRefs: [{ udpId: 'u1', level: 'column' }],
  action: { expression: 'sha2({col}, 512)', alias: '{columna.nombre}' },
  appliesTo: ['ddl.vista_tecnica'], priority: 100, enabled: true,
  validationState: 'valid', validationReport: {},
};

beforeEach(() => vi.clearAllMocks());

describe('YAML round-trip', () => {
  it('form → yaml → form conserva los campos (claves inglesas, spec §6.1)', () => {
    const edit = toEditInput(RULE);
    const yaml = ruleToYaml(edit);
    expect(yaml).toContain('name: enmascarar_dac');
    expect(yaml).toContain('condition:');
    expect(yaml).toContain('appliesTo:');
    const back = yamlToRule(yaml, edit);
    expect(back.name).toBe(edit.name);
    expect(back.condition).toBe(edit.condition);
    expect(back.action).toEqual(edit.action);
    expect(back.appliesTo).toEqual(edit.appliesTo);
    expect(back.priority).toBe(100);
    expect(back.id).toBe('r1');                        // conserva id del borrador
    expect(back.udpRefs).toEqual(edit.udpRefs);        // y los bindings
  });

  it('yaml inválido lanza error legible', () => {
    expect(() => yamlToRule('name: [rota', toEditInput(RULE))).toThrow(/Invalid YAML/);
    expect(() => yamlToRule('- solo una lista', toEditInput(RULE))).toThrow(/mapping/);
  });
});

describe('mutaciones versionadas (standards/apply)', () => {
  it('saveDdlRule postea rulesUpsert con kind ddl y título legible', async () => {
    vi.mocked(apiPost).mockResolvedValue({ seq: 9 });
    await saveDdlRule('p1', toEditInput(RULE), false);
    const [url, body] = vi.mocked(apiPost).mock.calls[0];
    expect(String(url)).toContain('/api/projects/p1/standards/apply');
    expect(body).toMatchObject({ kind: 'ddl', title: 'Rule enmascarar_dac · edited' });
    expect((body as { rulesUpsert: unknown[] }).rulesUpsert).toHaveLength(1);
  });

  it('toggleDdlRule manda la regla entera con enabled flipped', async () => {
    vi.mocked(apiPost).mockResolvedValue({ seq: 10 });
    await toggleDdlRule('p1', RULE, false);
    const body = vi.mocked(apiPost).mock.calls[0][1] as {
      rulesUpsert: { id: string; enabled: boolean }[]; title: string;
    };
    expect(body.rulesUpsert[0]).toMatchObject({ id: 'r1', enabled: false });
    expect(body.title).toContain('disabled');
  });

  it('seedStarterRules aplica las semillas + lookups + Output settings como UNA versión', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      templates: [], seedRules: [{ name: 'a' }, { name: 'b' }],
      seedLookups: { vacuum_map: { values: {} } },
      seedOutput: { typeCase: 'lower' },
    });
    vi.mocked(apiPost).mockResolvedValue({ seq: 11 });
    await seedStarterRules('p1');
    const body = vi.mocked(apiPost).mock.calls[0][1] as {
      rulesUpsert: unknown[]; ddlConfigPatch: { lookups: Record<string, unknown> };
    };
    expect(body.rulesUpsert).toHaveLength(2);
    expect(body.ddlConfigPatch.lookups.vacuum_map).toBeDefined();
    expect((body as { ddlConfigPatch: { output?: unknown } }).ddlConfigPatch.output).toEqual({ typeCase: 'lower' });
  });

  it('doc 101: restaurar el ruleset base conserva el dialecto por default y la config Oracle del proyecto', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      templates: [], seedRules: [{ name: 'a' }], seedLookups: {},
      seedOutput: { typeCase: 'lower', dialect: 'databricks', oracle: { typeCase: 'upper' } },
    });
    vi.mocked(apiPost).mockResolvedValue({ seq: 13 });
    await seedStarterRules('p1', { dialect: 'oracle', oracle: { includeComments: true }, typeCase: 'upper' });
    const out = (vi.mocked(apiPost).mock.calls[0][1] as { ddlConfigPatch: { output: Record<string, unknown> } }).ddlConfigPatch.output;
    // lo de Databricks vuelve a la semilla; el dialecto y Oracle quedan como estaban
    expect(out).toEqual({ typeCase: 'lower', dialect: 'oracle', oracle: { includeComments: true } });
  });

  it('saveDdlOutput guarda las Output settings como UNA versión (ddlConfigPatch.output)', async () => {
    vi.mocked(apiPost).mockResolvedValue({ seq: 12 });
    await saveDdlOutput('p1', { viewTagsAs: 'view' } as unknown as Parameters<typeof saveDdlOutput>[1]);
    const [url, body] = vi.mocked(apiPost).mock.calls[0];
    expect(String(url)).toContain('/api/projects/p1/standards/apply');
    expect(body).toMatchObject({ kind: 'ddl', title: 'DDL output settings · edited', ddlConfigPatch: { output: { viewTagsAs: 'view' } } });
  });
});

describe('ruleActionSummary — resumen de la acción en el catálogo', () => {
  const layout = (lay: Record<string, unknown>): DdlRule => ({ ...RULE, target: 'table', action: { layout: lay } });
  it('doc 107: layout «partitioned-by» = particiones solo en el PARTITIONED BY', () => {
    expect(ruleActionSummary(layout({ partitionColumns: 'partitioned-by', partitionUdp: 'Particion' })))
      .toBe('Column layout: partition columns only in PARTITIONED BY · partitions from UDP "Particion"');
  });
  it('last / keep / sin valor, igual que antes', () => {
    expect(ruleActionSummary(layout({ partitionColumns: 'last' }))).toBe('Column layout: partition columns last');
    expect(ruleActionSummary(layout({ partitionColumns: 'keep' }))).toBe('Column layout: partition columns in physical order');
    expect(ruleActionSummary(layout({ partitionUdp: 'Particion' })))
      .toBe('Column layout: partition columns in physical order · partitions from UDP "Particion"');
  });
  it('las demás acciones', () => {
    expect(ruleActionSummary(RULE)).toBe('sha2({col}, 512)');
    expect(ruleActionSummary({ ...RULE, action: { types: { CHAR: 'VARCHAR' } } })).toBe('Data types: CHAR → VARCHAR');
    expect(ruleActionSummary({ ...RULE, action: {} })).toBe('—');
  });
});

