import { describe, expect, it } from 'vitest';
import {
  editCreate, orderedForSave, pendingFor, stageCreate, stageDelete, stageRename,
  takenNames, unstage, type StagedOp,
} from './schemaStaging';

const core = { id: 's1', name: 'core' };
const temp = { id: 's2', name: 'temp_x' };
const SCHEMAS = [core, temp];

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
