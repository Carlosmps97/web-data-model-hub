// Borrar una relación en un solo lote (doc 133 §4): primero las lecturas (las
// relaciones y columnas vigentes de la tabla hija) y después un solo envío con la
// relación y el FK que se apaga en las hijas —todo o nada—. Si el envío queda sin
// respuesta, se releen las relaciones de la hija: si ya no está, se grabó y su
// Undo pasa el candado; si sigue, no se borró nada. Backend en memoria.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn(), info: vi.fn() } }));
vi.mock('@/services/changeset.service', async (orig) => {
  const actual = await (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig());
  return { ...actual, effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn() };
});
vi.mock('../features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, listRelationships: vi.fn(), listColumns: vi.fn() };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(async () => []), listViewsForTables: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import { ApiError } from '@/services/http';
import { forgetDraftSeqs } from '@/services/draftSeqs';
import * as mod from '../features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import { draftLedger } from './draftLedger.testutil';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { CanonicalColumn } from '@/services/governance.service';

const CS = 'cs1';
const NETWORK = "Couldn't reach the server — check your connection.";
const KEYS = "Couldn't check the keys of this relationship: nothing was deleted. Try again.";
const TABLES = [{ id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente' }, { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta' }];
const col = (id: string, tableId: string, over: Partial<CanonicalColumn> = {}): CanonicalColumn =>
  ({ id, tableId, physicalName: id.toUpperCase(), logicalName: id, dataType: 'STRING', typeOverridden: false, ordinal: 0, ...over });
const rel = (id: string, parent: string, child: string, pairs: [string, string][]) => ({
  id, parentTableId: parent, childTableId: child, identifying: false, parentCardinality: 'one', childCardinality: 'many',
  pairs: pairs.map(([parentColumnId, childColumnId]) => ({ parentColumnId, childColumnId })),
}) as unknown as gov.Relationship;

let cols = new Map<string, CanonicalColumn>();
let rels = new Map<string, gov.Relationship>();
let ops = new Map<string, 'upsert' | 'delete'>();
let lots: string[][] = [];
let log: string[] = [];
let fault: null | 'lost' | 'lost-saved' = null;
let relsReadFails = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const gone = (coll: string, id: string) => ops.get(`${coll}:${id}`) === 'delete';
const labels = () => useUndoStore.getState().stack.map((e) => e.label);

function apply(changes: csvc.BulkChange[]): void {
  for (const c of changes) {
    ops.set(`${c.collection}:${c.entityId}`, c.op);
    if (c.op === 'upsert' && c.collection === 'canonical_columns') cols.set(c.entityId, structuredClone(c.payload) as unknown as CanonicalColumn);
    if (c.op === 'upsert' && c.collection === 'relationships') rels.set(c.entityId, structuredClone(c.payload) as unknown as gov.Relationship);
  }
}

beforeEach(async () => {
  vi.resetAllMocks();
  forgetDraftSeqs();
  fault = null;
  relsReadFails = 0;
  ops = new Map();
  lots = [];
  cols = new Map([['k', col('k', 't1', { isPrimaryKey: true })], ['c', col('c', 't2', { isForeignKey: true })], ['x', col('x', 't2', { isForeignKey: true })]]);
  rels = new Map([['r1', rel('r1', 't1', 't2', [['k', 'c']])]]);
  vi.mocked(csvc.writeSeqOf).mockImplementation(async () => ({ writeSeq: draftLedger.seq }));
  vi.mocked(csvc.recordChangesBulk).mockImplementation(async (cs, changes) => {
    log.push('write');
    lots.push(changes.map((c) => `${c.collection}:${c.entityId}:${c.op}`));
    await sleep(2);
    const f = fault;
    fault = null;
    if (f === 'lost') { draftLedger.lost(cs, changes); throw new ApiError(NETWORK, 0, null, '/api/x'); }
    apply(changes);
    if (f === 'lost-saved') { draftLedger.foreign(); draftLedger.lost(cs, changes); throw new ApiError(NETWORK, 0, null, '/api/x'); }
    return { writeSeq: draftLedger.write(cs, changes) } as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (cs, coll, id, op, payload) => {
    log.push('write');
    await sleep(2);
    apply([{ collection: coll, entityId: id, op, ...(payload ? { payload } : {}) }]);
    return { writeSeq: draftLedger.write(cs) } as never;
  });
  vi.mocked(gov.listRelationships).mockImplementation(async (t?: string) => {
    log.push(`read-rels:${t}`);
    await sleep(1);
    if (relsReadFails > 0) { relsReadFails -= 1; throw new ApiError(NETWORK, 0, null, '/api/x'); }
    return [...rels.values()].filter((r) => (r.parentTableId === t || r.childTableId === t) && !gone('relationships', r.id)).map((r) => structuredClone(r));
  });
  vi.mocked(csvc.effective).mockImplementation(async (_cs, coll, opts) => {
    if (coll !== 'canonical_columns') throw new Error(`lectura inesperada ${coll}`);
    log.push(`read-cols-by-id:${(opts?.ids ?? []).join(',')}`);
    await sleep(1);
    return [...cols.values()].filter((c) => opts?.ids?.includes(c.id) && !gone('canonical_columns', c.id)).map((c) => ({ ...c })) as never;
  });
  vi.mocked(gov.listColumns).mockImplementation(async (t: string) => {
    log.push(`read-cols:${t}`);
    await sleep(1);
    return [...cols.values()].filter((c) => c.tableId === t && !gone('canonical_columns', c.id)).map((c) => ({ ...c }));
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const draftSeq = draftLedger.seq;
    await sleep(2);
    return {
      subjectArea: { id: saId, projectId: 'p', name: 'Uno', folderId: null, tableIds: ['t1', 't2'], viewIds: [], layout: {}, routes: {} },
      draftSeq, tables: TABLES, views: [],
      columns: [...cols.values()].filter((c) => !gone('canonical_columns', c.id)).map((c) => ({ ...c })),
      relationships: [...rels.values()].filter((r) => !gone('relationships', r.id)).map((r) => structuredClone(r)),
    } as never;
  });
  const naming = await import('@/services/naming.service');
  vi.mocked(naming.getNamingConfig).mockImplementation(async () => ({}) as never);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: CS, activeProjectId: 'p' });
  useUndoStore.getState().clear();
  useUndoStore.setState({ busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, flow: null, activeProjectId: 'p', selectedEdgeId: null } as never);
  await st().selectSubjectArea('sa1');
  log = [];
});
afterEach(async () => { await sleep(10); });

describe('borrar una relación: un solo lote', () => {
  it('primero las lecturas; después un solo envío con la relación y el FK que se apaga', async () => {
    await st().deleteRelationship('r1');
    expect(lots).toEqual([['relationships:r1:delete', 'canonical_columns:c:upsert']]);
    expect(log.indexOf('write')).toBeGreaterThan(log.lastIndexOf('read-cols-by-id:c'));
    expect(log.indexOf('write')).toBeGreaterThan(log.lastIndexOf('read-rels:t2'));
    expect(log.filter((l) => l === 'write')).toHaveLength(1);
    expect(cols.get('c')?.isForeignKey).toBe(false);
    expect(labels()).toEqual(['Delete relationship']);
  });

  it('lee solo las columnas hijas de sus pares, no la tabla hija entera', async () => {
    await st().deleteRelationship('r1');
    expect(gov.listColumns).not.toHaveBeenCalled();
    expect(log).toContain('read-cols-by-id:c');
  });

  it('una relación de llave compuesta apaga el FK de todas sus columnas hijas', async () => {
    cols.set('k2', col('k2', 't1', { isPrimaryKey: true, ordinal: 1 }));
    rels.set('r1', rel('r1', 't1', 't2', [['k', 'c'], ['k2', 'x']]));
    await st().reload();
    await st().deleteRelationship('r1');
    expect(new Set(lots[0])).toEqual(new Set(['relationships:r1:delete', 'canonical_columns:c:upsert', 'canonical_columns:x:upsert']));
    expect([cols.get('c')?.isForeignKey, cols.get('x')?.isForeignKey]).toEqual([false, false]);
  });

  it('una hija que sigue en otra relación conserva su FK', async () => {
    rels.set('r2', rel('r2', 't1', 't2', [['k', 'c']]));
    await st().deleteRelationship('r1');
    expect(lots).toEqual([['relationships:r1:delete']]);
    expect(cols.get('c')?.isForeignKey).toBe(true);
  });

  it('su Undo repone la relación y el FK', async () => {
    await st().deleteRelationship('r1');
    expect(await useUndoStore.getState().undoLast()).toBe('Delete relationship');
    expect(gone('relationships', 'r1')).toBe(false);
    expect(cols.get('c')?.isForeignKey).toBe(true);
  });

  it('si no se pueden leer las relaciones de la hija, no se borra nada y no queda Undo', async () => {
    relsReadFails = 1;
    await expect(st().deleteRelationship('r1')).rejects.toThrow(KEYS);
    expect(lots).toEqual([]);
    expect(labels()).toEqual([]);
  });

  it('sin respuesta, pero se grabó: sigue como borrada, con su Undo, que pasa el candado', async () => {
    fault = 'lost-saved';
    await st().deleteRelationship('r1');
    expect(gone('relationships', 'r1')).toBe(true);
    expect(labels()).toEqual(['Delete relationship']);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete relationship');
    expect(gone('relationships', 'r1')).toBe(false);
    expect(cols.get('c')?.isForeignKey).toBe(true);
  });

  it('sin respuesta y no se grabó: no se borró nada, sin Undo, y se puede reintentar', async () => {
    fault = 'lost';
    await expect(st().deleteRelationship('r1')).rejects.toThrow('No response from the server: nothing was deleted. Try again.');
    expect(gone('relationships', 'r1')).toBe(false);
    expect(cols.get('c')?.isForeignKey).toBe(true);
    expect(labels()).toEqual([]);
    await st().deleteRelationship('r1');
    expect(gone('relationships', 'r1')).toBe(true);
  });

  it('rehacer con la respuesta perdida pero grabado: lo que vuelve a Undo pasa el candado', async () => {
    await st().deleteRelationship('r1');
    await useUndoStore.getState().undoLast();
    fault = 'lost-saved';
    expect(await useUndoStore.getState().redoLast()).toBe('Delete relationship');
    expect(gone('relationships', 'r1')).toBe(true);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete relationship');
    expect(gone('relationships', 'r1')).toBe(false);
  });
});
