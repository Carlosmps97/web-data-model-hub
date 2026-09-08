/** ddlRules.service: YAML round-trip 1:1 con el form, mutaciones vía
 *  standards/apply (versionadas) y el CTA de semillas. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), LONG_TIMEOUT_MS: 120_000 }));

import { apiGet, apiPost } from '@/services/http';
import {
  ruleToYaml, saveDdlRule, seedStarterRules, toEditInput, toggleDdlRule, yamlToRule,
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

  it('seedStarterRules aplica las 7 semillas + lookups como UNA versión', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      templates: [], seedRules: [{ name: 'a' }, { name: 'b' }],
      seedLookups: { vacuum_map: { values: {} } },
    });
    vi.mocked(apiPost).mockResolvedValue({ seq: 11 });
    await seedStarterRules('p1');
    const body = vi.mocked(apiPost).mock.calls[0][1] as {
      rulesUpsert: unknown[]; ddlConfigPatch: { lookups: Record<string, unknown> };
    };
    expect(body.rulesUpsert).toHaveLength(2);
    expect(body.ddlConfigPatch.lookups.vacuum_map).toBeDefined();
  });
});
