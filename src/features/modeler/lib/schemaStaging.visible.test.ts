import { describe, expect, it } from 'vitest';
import { stageDelete, stageRename, visibleSchemas, type StagedOp } from './schemaStaging';

const S = [
  { id: 's1', name: 'BCP_DDV_CLIENTES' },
  { id: 's2', name: 'BCP_DDV_CLIENTES_VU' },
  { id: 's3', name: 'PLANEAMIENTO' },
  { id: 's4', name: 'riesgos' },
];
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe('visibleSchemas (doc 80 §2 — el placeholder de New schema filtra)', () => {
  it('sin texto muestra todo', () => {
    expect(visibleSchemas(S, [], '   ')).toHaveLength(4);
  });

  it('filtra por CONTIENE, no por empieza-por (doc 57)', () => {
    expect(names(visibleSchemas(S, [], 'CLIENTES'))).toEqual(['BCP_DDV_CLIENTES', 'BCP_DDV_CLIENTES_VU']);
    expect(names(visibleSchemas(S, [], 'ddv'))).toEqual(['BCP_DDV_CLIENTES', 'BCP_DDV_CLIENTES_VU']);
  });

  it('es case-insensitive en ambos sentidos', () => {
    expect(names(visibleSchemas(S, [], 'RIESGOS'))).toEqual(['riesgos']);
    expect(names(visibleSchemas(S, [], 'planea'))).toEqual(['PLANEAMIENTO']);
  });

  it('sin coincidencias no muestra nada (el texto pasa a ser el nombre a crear)', () => {
    expect(visibleSchemas(S, [], 'NO_EXISTE')).toEqual([]);
  });

  it('un esquema con cambio PENDIENTE nunca se esconde detrás del filtro', () => {
    let ops: StagedOp[] = [];
    ops = stageRename(ops, S[2], 'PLANEAMIENTO_2');
    ops = stageDelete(ops, S[3]);
    expect(names(visibleSchemas(S, ops, 'CLIENTES')))
      .toEqual(['BCP_DDV_CLIENTES', 'BCP_DDV_CLIENTES_VU', 'PLANEAMIENTO', 'riesgos']);
  });

  it('la fila con un editor inline abierto (`keep`) tampoco se esconde (doc 119)', () => {
    expect(names(visibleSchemas(S, [], 'CLIENTES', ['s4']))).toEqual(['BCP_DDV_CLIENTES', 'BCP_DDV_CLIENTES_VU', 'riesgos']);
    expect(names(visibleSchemas(S, [], 'NO_EXISTE', ['s3']))).toEqual(['PLANEAMIENTO']);
    expect(visibleSchemas(S, [], '', ['s3'])).toHaveLength(4);
  });
});
