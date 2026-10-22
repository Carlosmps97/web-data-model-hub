import { describe, expect, it } from 'vitest';
import { stageDelete, stageRename, visibleSchemas, type StagedOp } from './schemaStaging';

const S = [
  { id: 's1', name: 'CORE_CLIENTES' },
  { id: 's2', name: 'CORE_CLIENTES_VU' },
  { id: 's3', name: 'PLANEAMIENTO' },
  { id: 's4', name: 'riesgos' },
];
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe('visibleSchemas (el placeholder de New schema filtra)', () => {
  it('sin texto muestra todo', () => {
    expect(visibleSchemas(S, [], '   ')).toHaveLength(4);
  });

  it('filtra por contiene, no por empieza-por', () => {
    expect(names(visibleSchemas(S, [], 'CLIENTES'))).toEqual(['CORE_CLIENTES', 'CORE_CLIENTES_VU']);
    expect(names(visibleSchemas(S, [], 'core'))).toEqual(['CORE_CLIENTES', 'CORE_CLIENTES_VU']);
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
      .toEqual(['CORE_CLIENTES', 'CORE_CLIENTES_VU', 'PLANEAMIENTO', 'riesgos']);
  });

  it('la fila con un editor inline abierto (`keep`) tampoco se esconde', () => {
    expect(names(visibleSchemas(S, [], 'CLIENTES', ['s4']))).toEqual(['CORE_CLIENTES', 'CORE_CLIENTES_VU', 'riesgos']);
    expect(names(visibleSchemas(S, [], 'NO_EXISTE', ['s3']))).toEqual(['PLANEAMIENTO']);
    expect(visibleSchemas(S, [], '', ['s3'])).toHaveLength(4);
  });
});
