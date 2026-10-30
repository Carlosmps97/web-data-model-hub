/** ddlRules.service: mutaciones vía standards/apply (versionadas), orden de la
 *  lista, set base, validación y el payload de la vista previa. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', async (orig) => ({
  ...(await orig<typeof import('@/services/http')>()), apiGet: vi.fn(), apiPost: vi.fn(),
}));

import { apiGet, apiPost } from '@/services/http';
import { DEFAULT_OUTPUT_SETTINGS } from '@/features/ddl';
import {
  previewPayloadFor, reorderDdlRules, restoreBaseRuleSet, saveDdlOutput, saveDdlRule, toEditInput, toggleDdlRule,
  validateDdlRule,
} from './ddlRules.service';
import type { DdlRule } from './standards.service';

const rule = (id: string, order: number, over: Partial<DdlRule> = {}): DdlRule => ({
  id, name: id, description: null, scope: 'table', when: '', order, enabled: true, updatedBy: 'otro',
  files: [{ name: '{{ tabla.carpeta }}/{{ tabla.nombre }}.sql', content: 'CREATE TABLE {{ tabla.nombre }};' }], ...over,
});
const bodyOf = (i = 0) => vi.mocked(apiPost).mock.calls[i][1] as Record<string, unknown>;

beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiPost).mockResolvedValue({ seq: 9 }); });

describe('mutaciones versionadas (standards/apply)', () => {
  it('saveDdlRule postea rulesUpsert con kind ddl, título legible y sus archivos', async () => {
    await saveDdlRule('p1', toEditInput(rule('tabla_fisica', 2)), false);
    const [url] = vi.mocked(apiPost).mock.calls[0];
    expect(String(url)).toContain('/api/projects/p1/standards/apply');
    expect(bodyOf()).toMatchObject({ kind: 'ddl', title: 'Rule tabla_fisica · edited' });
    expect(bodyOf().rulesUpsert).toEqual([{
      id: 'tabla_fisica', name: 'tabla_fisica', description: undefined, scope: 'table', when: '', order: 2, enabled: true,
      files: [{ name: '{{ tabla.carpeta }}/{{ tabla.nombre }}.sql', content: 'CREATE TABLE {{ tabla.nombre }};' }],
    }]);
  });

  it('toggleDdlRule manda la regla entera con su estado nuevo', async () => {
    await toggleDdlRule('p1', rule('r1', 0), false);
    expect((bodyOf().rulesUpsert as { id: string; enabled: boolean }[])[0]).toMatchObject({ id: 'r1', enabled: false });
    expect(bodyOf().title).toBe('Rule r1 · disabled');
  });

  it('reorderDdlRules: order = posición; solo viajan las que cambian; sin cambios no llama', async () => {
    const [a, b, c] = [rule('a', 0), rule('b', 1), rule('c', 2)];
    await reorderDdlRules('p1', [b, a, c]);
    expect((bodyOf().rulesUpsert as { id: string; order: number }[]).map((r) => [r.id, r.order])).toEqual([['b', 0], ['a', 1]]);
    expect(reorderDdlRules('p1', [a, b, c])).toBeNull();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('restoreBaseRuleSet: las reglas y piezas del set base; las variables del proyecto se conservan', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      rules: [{ name: 'a' }, { name: 'b' }], pieces: '{% macro m() %}{% endmacro %}',
      variables: { location: 'abfss://x', desencriptar: 'security.decrypt_column_view' },
    });
    await restoreBaseRuleSet('p1', { pieces: '', variables: { desencriptar: 'bcp.decrypt' }, output: {} });
    expect(String(vi.mocked(apiGet).mock.calls[0][0])).toContain('/api/projects/p1/ddl-rules/base');
    expect(bodyOf()).toMatchObject({
      kind: 'ddl', rulesUpsert: [{ name: 'a' }, { name: 'b' }],
      ddlConfigPatch: { pieces: '{% macro m() %}{% endmacro %}', variables: { location: 'abfss://x', desencriptar: 'bcp.decrypt' } },
    });
  });

  it('saveDdlOutput manda solo el bloque output', async () => {
    await saveDdlOutput('p1', DEFAULT_OUTPUT_SETTINGS);
    expect(Object.keys(bodyOf().ddlConfigPatch as object)).toEqual(['output']);
  });
});

describe('validación y vista previa', () => {
  it('validateDdlRule: con regla, o solo piezas y variables', async () => {
    vi.mocked(apiPost).mockResolvedValue({ errors: [], warnings: [] });
    await validateDdlRule('p1', toEditInput(rule('r1', 0)));
    await validateDdlRule('p1', null, '{% set A = 1 %}', { a: 'b' });
    expect(String(vi.mocked(apiPost).mock.calls[0][0])).toContain('/api/projects/p1/ddl-rules/validate');
    expect(bodyOf(1)).toEqual({ rule: null, pieces: '{% set A = 1 %}', variables: { a: 'b' } });
  });

  it('previewPayloadFor: la tabla publicada con sus vistas; las otras fuentes solo para el FROM', async () => {
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.includes('/inspect/tables/')) {
        return {
          table: { id: 't1', physicalName: 'HD_X', schema: 's', udpValues: { u1: 'DAC' } },
          columns: [{ id: 'c1', tableId: 't1', physicalName: 'COD', dataType: 'INTEGER', ordinal: 0, udpValues: {} }],
          views: [
            { id: 'v1', name: 'VU_X', schema: 's', sourceTableIds: ['t1', 't2'], sources: [{ column: 'COD', tableId: 't1' }] },
            { id: 'v2', name: 'VU_Y', schema: 's', sourceTableIds: ['t1'] },
          ],
        };
      }
      return { sources: [{ id: 't1', physicalName: 'HD_X', schema: 's' }, { id: 't2', physicalName: 'HD_Z', schema: 'r' }] };
    });
    const p = await previewPayloadFor('t1');
    expect(vi.mocked(apiGet).mock.calls.map(([u]) => String(u).replace(/^.*\/api/, '/api'))).toEqual([
      '/api/catalog/inspect/tables/t1', '/api/catalog/inspect/views/v1',
    ]);
    expect(p.tables.map((t) => [t.table.id, t.table.udpValues])).toEqual([['t1', { u1: 'DAC' }]]);
    expect(p.views.map((v) => [v.id, v.from])).toEqual([['v1', 's.hd_x t1,\n  r.hd_z t2'], ['v2', 's.hd_x']]);
  });
});
