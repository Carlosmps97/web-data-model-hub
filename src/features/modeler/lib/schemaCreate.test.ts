// Alta de un esquema desde un combo: validación compartida con el gestor,
// cuándo se ofrece y el orden crear → recargar → seleccionar.
import { describe, expect, it, vi } from 'vitest';
import { canCreateSchema, createActionLabel, createSchemaAndPick, schemaNameError } from './schemaCreate';

describe('schemaNameError (compartida con el gestor)', () => {
  const taken = new Set(['stg_clientes']);
  it('requerido, patrón y duplicado sin mayúsculas', () => {
    expect(schemaNameError('  ', taken)).toBe('The schema name is required.');
    expect(schemaNameError('1abc', taken)).toMatch(/^Invalid name/);
    expect(schemaNameError('STG_CLIENTES', taken)).toBe('Schema STG_CLIENTES already exists');
    expect(schemaNameError('stg_nuevo', taken)).toBeNull();
  });
});

describe('schemaNameError — esquema de sistema', () => {
  it('su nombre está reservado, en cualquier grafía', () => {
    expect(schemaNameError('not_defined', new Set())).toBe('not_defined is reserved for the system default schema.');
    expect(schemaNameError('NOT_DEFINED', new Set(['not_defined']))).toBe('NOT_DEFINED is reserved for the system default schema.');
    expect(schemaNameError('not_defined_vu', new Set())).toBeNull();
  });
});

describe('canCreateSchema', () => {
  const ok = { kind: 'tables' as const, openMode: 'editing', changesetId: 'cs1', asOf: false };
  it('solo en edición, con versión viva, combo habilitado y kind tablas/vistas', () => {
    expect(canCreateSchema(ok)).toBe(true);
    expect(canCreateSchema({ ...ok, kind: 'views' })).toBe(true);
    expect(canCreateSchema({ ...ok, kind: 'all' })).toBe(false);
    expect(canCreateSchema({ ...ok, openMode: 'readonly' })).toBe(false);
    expect(canCreateSchema({ ...ok, changesetId: null })).toBe(false);
    expect(canCreateSchema({ ...ok, asOf: true })).toBe(false);
    expect(canCreateSchema({ ...ok, disabled: true })).toBe(false);
  });
});

describe('createSchemaAndPick — crear, recargar y recién seleccionar', () => {
  it('selecciona después de crear y de recargar el catálogo', async () => {
    const order: string[] = [];
    await createSchemaAndPick({
      name: ' stg_x ', kind: 'tables',
      create: async (n, k) => { order.push(`create:${n}:${k}`); },
      refresh: async () => { order.push('refresh'); },
      pick: (n) => { order.push(`pick:${n}`); },
    });
    expect(order).toEqual(['create:stg_x:tables', 'refresh', 'pick:stg_x']);
  });
  it('si la creación falla, no selecciona nada y propaga el error', async () => {
    const pick = vi.fn();
    await expect(createSchemaAndPick({
      name: 'stg_x', kind: 'views',
      create: async () => { throw new Error('Schema stg_x already exists'); },
      refresh: async () => {}, pick,
    })).rejects.toThrow('already exists');
    expect(pick).not.toHaveBeenCalled();
  });
  it('si la creación falla, recarga el catálogo igual (el cambio pudo quedar registrado) y no selecciona', async () => {
    const refresh = vi.fn(async () => {});
    const pick = vi.fn();
    await expect(createSchemaAndPick({
      name: 'stg_x', kind: 'tables',
      create: async () => { throw new Error('Network error'); }, refresh, pick,
    })).rejects.toThrow('Network error');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(pick).not.toHaveBeenCalled();
  });
  it('si solo falla la recarga, igual selecciona (el esquema ya está en la versión)', async () => {
    const pick = vi.fn();
    await createSchemaAndPick({
      name: 'stg_x', kind: 'tables', create: async () => {},
      refresh: async () => { throw new Error('net'); }, pick,
    });
    expect(pick).toHaveBeenCalledWith('stg_x');
  });
});

describe('createActionLabel', () => {
  it('con y sin texto tipeado', () => {
    expect(createActionLabel('')).toBe('+ New schema…');
    expect(createActionLabel(' stg_x ')).toBe('+ Create schema "stg_x"…');
  });
});
