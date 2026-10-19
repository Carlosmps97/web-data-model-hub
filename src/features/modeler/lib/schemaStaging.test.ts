import { describe, expect, it } from 'vitest';
import {
  editCreate, orderedForSave, pendingFor, stageCreate, stageDelete, stageRename, stageSetKind,
  takenNames, unstage, visibleSchemas, type StagedOp,
} from './schemaStaging';

const core = { id: 's1', name: 'core' };
const temp = { id: 's2', name: 'temp_x' };
const SCHEMAS = [core, temp];
// Doc 119: un esquema guardado como de tablas que se pasa a vistas o a ambos.
const mixto = { id: 's3', name: 'core_vu', kind: 'tables' as const };

describe('setKind del esquema (doc 119)', () => {
  it('stageSetKind guarda el kind nuevo y reemplaza uno previo del mismo esquema', () => {
    let ops = stageSetKind([], mixto, 'views');
    ops = stageSetKind(ops, mixto, 'both');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'setKind', id: 's3', name: 'core_vu', from: 'tables', to: 'both' });
  });

  it('volver al kind actual deshace el pendiente', () => {
    let ops = stageSetKind([], mixto, 'views');
    ops = stageSetKind(ops, mixto, 'tables');
    expect(ops).toHaveLength(0);
    expect(stageSetKind([], mixto, 'both')).toHaveLength(1);
  });

  it('un esquema sin clasificar: cualquier kind es un cambio, desde null', () => {
    expect(stageSetKind([], { id: 's9', name: 'x', kind: 'views' }, 'views')).toHaveLength(0);
    expect(stageSetKind([], { id: 's9', name: 'x', kind: null }, 'tables'))
      .toEqual([expect.objectContaining({ kind: 'setKind', from: null, to: 'tables' })]);
    expect(stageSetKind([], { id: 's9', name: 'x' }, 'both')).toHaveLength(1);
  });

  it('setKind y rename del mismo esquema se excluyen: el último manda; delete descarta ambos', () => {
    let ops = stageRename([], mixto, 'core_v2');
    ops = stageSetKind(ops, mixto, 'views');
    expect(ops.map((o) => o.kind)).toEqual(['setKind']);
    ops = stageRename(ops, mixto, 'core_v3');
    expect(ops.map((o) => o.kind)).toEqual(['rename']);
    ops = stageSetKind(ops, mixto, 'views');
    ops = stageDelete(ops, mixto);
    expect(ops.map((o) => o.kind)).toEqual(['delete']);
  });

  it('orderedForSave: creates → setKind → renames → deletes; pendingFor y visibleSchemas lo ven', () => {
    let ops: StagedOp[] = stageDelete([], temp);
    ops = stageRename(ops, core, 'core_v2');
    ops = stageSetKind(ops, mixto, 'views');
    ops = stageCreate(ops, 'nuevo', 'both');
    expect(orderedForSave(ops).map((o) => o.kind)).toEqual(['create', 'setKind', 'rename', 'delete']);
    expect(pendingFor(ops, 's3')?.kind).toBe('setKind');
    expect(takenNames([...SCHEMAS, mixto], ops).has('core_vu')).toBe(true);
    expect(visibleSchemas([...SCHEMAS, mixto], ops, 'zzz').map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });
});

describe('schemaStaging', () => {
  it('stageCreate agrega y takenNames lo cuenta (case-insensitive)', () => {
    const ops = stageCreate([], 'Nuevo_Esq');
    expect(ops).toHaveLength(1);
    expect(takenNames(SCHEMAS, ops).has('nuevo_esq')).toBe(true);
  });

  it('stageRename reemplaza un rename previo del mismo esquema', () => {
    let ops: StagedOp[] = stageRename([], core, 'core_v2');
    ops = stageRename(ops, core, 'core_v3');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'rename', id: 's1', from: 'core', to: 'core_v3' });
  });

  it('renombrar de vuelta al nombre original deshace el pendiente', () => {
    let ops = stageRename([], core, 'core_v2');
    ops = stageRename(ops, core, 'core');
    expect(ops).toHaveLength(0);
  });

  it('stageDelete descarta el rename pendiente del mismo esquema y no duplica', () => {
    let ops = stageRename([], core, 'core_v2');
    ops = stageDelete(ops, core);
    ops = stageDelete(ops, core);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'delete', id: 's1', name: 'core' });
  });

  it('unstage saca el pendiente por key; editCreate cambia el nombre', () => {
    let ops = stageCreate([], 'uno');
    const key = ops[0].key;
    ops = editCreate(ops, key, 'dos');
    expect(ops[0]).toMatchObject({ kind: 'create', name: 'dos' });
    expect(unstage(ops, key)).toHaveLength(0);
  });

  it('orderedForSave: creates → renames → deletes', () => {
    let ops: StagedOp[] = stageDelete([], temp);
    ops = stageRename(ops, core, 'core_v2');
    ops = stageCreate(ops, 'nuevo');
    expect(orderedForSave(ops).map((o) => o.kind)).toEqual(['create', 'rename', 'delete']);
  });

  it('takenNames: delete libera el nombre; rename libera el viejo y toma el nuevo', () => {
    let ops: StagedOp[] = stageDelete([], temp);
    ops = stageRename(ops, core, 'core_v2');
    const names = takenNames(SCHEMAS, ops);
    expect(names.has('temp_x')).toBe(false);
    expect(names.has('core')).toBe(false);
    expect(names.has('core_v2')).toBe(true);
  });

  it('pendingFor devuelve el pendiente del esquema (rename o delete)', () => {
    const ops = stageRename([], core, 'core_v2');
    expect(pendingFor(ops, 's1')?.kind).toBe('rename');
    expect(pendingFor(ops, 's2')).toBeUndefined();
  });
});

describe('schemaKind del create (doc 44)', () => {
  it('stageCreate guarda el kind elegido y editCreate lo preserva', () => {
    let ops = stageCreate([], 'core_vu', 'views');
    expect(ops[0]).toMatchObject({ kind: 'create', name: 'core_vu', schemaKind: 'views' });
    ops = editCreate(ops, ops[0].key, 'core_v2_vu');
    expect(ops[0]).toMatchObject({ name: 'core_v2_vu', schemaKind: 'views' });
  });

  it('sin kind explícito, el create nace como tables', () => {
    const ops = stageCreate([], 'core');
    expect(ops[0]).toMatchObject({ kind: 'create', schemaKind: 'tables' });
  });
});
