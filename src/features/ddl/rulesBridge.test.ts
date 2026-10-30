import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', async (orig) => ({
  ...(await orig<typeof import('@/services/http')>()), apiGet: vi.fn(), apiPost: vi.fn(),
}));

import { ApiError, apiPost } from '@/services/http';
import type { DatabricksDdlInput } from './generators';
import { buildRulesPayload, renderWithRules, ruleErrorText, rulesSql, type RenderedExport } from './rulesBridge';

beforeEach(() => vi.clearAllMocks());

type Source = Parameters<typeof buildRulesPayload>[0]['diagram'];
const asDiagram = (d: unknown) => d as Source;

// Golden compartido con el backend (tests/features/ddl_rules/golden): lo que
// exporta el popup para el set sintético y el payload que deben recibir las
// reglas; el test del backend corre ese payload y compara los archivos.
const GOLDEN = resolve(__dirname, '../../../../backend-data-model-hub/tests/features/ddl_rules/golden');

describe('buildRulesPayload', () => {
  it.skipIf(!existsSync(GOLDEN))('arma exactamente el payload del golden del backend', () => {
    const fx = JSON.parse(readFileSync(`${GOLDEN}/sintetico.input.json`, 'utf-8'));
    const golden = JSON.parse(readFileSync(`${GOLDEN}/sintetico.payload.json`, 'utf-8'));
    const input: DatabricksDdlInput = { ...fx.input, modelName: fx.modelName };
    expect(buildRulesPayload({ diagram: asDiagram(fx.diagram), input })).toEqual(golden.payload);
  });

  const diagram = asDiagram({
    subjectArea: { name: 'Canvas', udpValues: { u9: 'x' } },
    tables: [{ id: 't1', udpValues: { u1: 'DAC' } }, { id: 't2' }, { id: 't3' }],
    columns: [{ id: 'c1', udpValues: { u2: 'DAC-NOMBRE' } }, { id: 'c2' }, { id: 'c3' }],
  });
  const input: DatabricksDdlInput = {
    tables: [
      { id: 't1', physicalName: 'HD_X', schema: 'a' }, { id: 't2', physicalName: 'HD_X', schema: 'b' },
      { id: 't3', physicalName: 'HD_Y', schema: 'a' },
    ],
    columns: [
      { id: 'c1', tableId: 't1', physicalName: 'NOMCLI', dataType: 'CHAR(20)', ordinal: 1, description: 'Def', physicalDescription: ' Fisico ' },
      { id: 'c2', tableId: 't1', physicalName: 'CODCLI', dataType: 'INTEGER', ordinal: 0, isPrimaryKey: true, isNullable: false },
      { id: 'c3', tableId: 't3', physicalName: 'CODSEG', dataType: 'varchar', ordinal: 0 },
    ],
    relationships: [],
    views: [
      { id: 'v1', name: 'VU_X', sourceTableIds: ['t1', 't3'], sources: [
        { column: 'NOMCLI', tableId: 't1', outputAlias: 'NOMBRE' }, { column: 'CODSEG', tableId: 't3', castType: 'int' },
        { expression: 'upper(t1.nomcli)', outputAlias: 'X' }, { expression: 'current_date()' },
      ] },
      { id: 'v2', name: 'VU_FUERA', schema: 's', tableId: 't2', showOnCanvas: false },
      { id: 'v3', name: 'VU_STAR', schema: 's', sourceTableIds: ['t3'] },
    ],
    tableIds: ['t1', 't3'],
    modelName: 'Modelo',
  };

  it('solo las tablas marcadas, con su carpeta del zip, UDP del diagrama y el tipo como lo escribe la web', () => {
    const p = buildRulesPayload({ diagram, input });
    expect(p.model).toEqual({ name: 'Canvas', udpValues: { u9: 'x' } });
    expect(p.tables.map((t) => [t.table.id, t.table.folder, t.table.udpValues])).toEqual([
      ['t1', 'HD_X', { u1: 'DAC' }], ['t3', 'HD_Y', {}],
    ]);
    expect(p.tables[0].columns).toEqual([
      { id: 'c1', physicalName: 'NOMCLI', dataType: 'CHAR(20)', ddlType: 'char(20)', ordinal: 1, isPrimaryKey: false,
        isNullable: true, isPartition: false, description: 'Fisico', udpValues: { u2: 'DAC-NOMBRE' } },
      { id: 'c2', physicalName: 'CODCLI', dataType: 'INTEGER', ddlType: 'int', ordinal: 0, isPrimaryKey: true,
        isNullable: false, isPartition: false, description: null, udpValues: {} },
    ]);
  });

  it('las vistas que entran al export, con proyecciones y FROM como los escribe la web', () => {
    const p = buildRulesPayload({ diagram, input });
    expect(p.views.map((v) => [v.id, v.schema, v.folder, v.showOnCanvas])).toEqual([
      ['v1', 'a', 'HD_X', true], ['v3', 's', 'HD_Y', true],
    ]);
    expect(p.views[0].projections).toEqual([
      { sql: 't1.nomcli', alias: 'nombre', column: 'NOMCLI', tableId: 't1', expression: false },
      { sql: 'CAST(t2.codseg AS int)', alias: 'codseg', column: 'CODSEG', tableId: 't3', expression: false },
      { sql: 'upper(t1.nomcli)', alias: 'X', column: null, tableId: null, expression: true },
      { sql: 'current_date()', alias: null, column: null, tableId: null, expression: true },
    ]);
    expect(p.views[0].from).toBe('a.hd_x t1,\n  a.hd_y t2');
    expect(p.views[1]).toMatchObject({ projections: [], from: 'a.hd_y', sourceTableIds: ['t3'] });
  });
});

describe('renderWithRules', () => {
  it('manda las reglas elegidas y el payload al render del proyecto', async () => {
    vi.mocked(apiPost).mockResolvedValue({ files: [], log: [] });
    await renderWithRules({ projectId: 'p 1', diagram: asDiagram({ tables: [], columns: [] }),
      input: { tables: [], columns: [], relationships: [] }, ruleIds: ['r2', 'r1'] });
    const [url, body] = vi.mocked(apiPost).mock.calls[0];
    expect(url).toMatch(/\/api\/projects\/p%201\/ddl-rules\/render$/);
    expect(body).toMatchObject({ ruleIds: ['r2', 'r1'], payload: { tables: [], views: [] } });
  });
});

describe('rulesSql', () => {
  it('los archivos en orden, una línea en blanco entre ellos, con el encabezado', () => {
    const rendered: RenderedExport = {
      rulesetVersion: 'v7',
      files: [
        { path: 'A/T.sql', content: 'CREATE TABLE a;\nALTER TABLE a SET TAGS (x);\n', rule: 'r1', object: 's.A', objectKind: 'table' },
        { path: 'A/V.sql', content: 'CREATE VIEW v;\n', rule: 'r2', object: 's.A', objectKind: 'table' },
        { path: 'B/T.sql', content: 'CREATE TABLE b;\n', rule: 'r1', object: 's.B', objectKind: 'table' },
      ],
      log: [],
    };
    expect(rulesSql(rendered, 'Modelo', 2)).toBe([
      '-- Modelo · 2 table(s)', '-- Generated by Data Model Hub', '-- Export rules: v7 · 2 applied', '',
      'CREATE TABLE a;', 'ALTER TABLE a SET TAGS (x);', '', 'CREATE VIEW v;', '', 'CREATE TABLE b;', '',
    ].join('\n'));
  });
});

describe('ruleErrorText', () => {
  it('regla, objeto, archivo y línea del 422 del motor', () => {
    const err = new ApiError("'dict object' has no attribute 'nombr'", 422,
      { message: "'dict object' has no attribute 'nombr'", rule: 'tabla_fisica', object: 'bcp.HD_X', file: 'HD_X/TABLE-HD_X.sql', line: 4 });
    expect(ruleErrorText(err)).toBe("Rule tabla_fisica failed on bcp.HD_X (HD_X/TABLE-HD_X.sql, line 4): 'dict object' has no attribute 'nombr'");
  });
  it('error de las piezas (sin regla) y errores que no son de una regla', () => {
    const pieces = new ApiError('unexpected end of template', 422,
      { message: 'unexpected end of template', rule: null, object: null, file: 'pieces', line: 9 });
    expect(ruleErrorText(pieces)).toBe('The export rules failed (pieces, line 9): unexpected end of template');
    expect(ruleErrorText(new ApiError('x', 422, [{ loc: ['body'] }]))).toBeNull();
    expect(ruleErrorText(new ApiError('Forbidden', 403, 'Forbidden'))).toBeNull();
    expect(ruleErrorText(new Error('boom'))).toBeNull();
  });
});
