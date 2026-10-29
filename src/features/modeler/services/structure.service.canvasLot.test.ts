// Doc 133 §4 (fase 3): una cascada que toca el modelo y varios canvases viaja en
// un solo lote (todo o nada). `canvasLot` toma la cola de cada canvas (en orden de
// id: dos lotes nunca se esperan en cruz), lee sus documentos en una sola lectura
// y graba los cambios del modelo y los canvases en un solo envío. `planCanvasAdd`
// y `planCanvasRemove` son lo que hacen `addToCanvas` y `removeFromCanvas` sobre
// un documento, sin escribir.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', () => ({ effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn() }));
vi.mock('./modeler.service', () => ({}));

import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { forgetCanvasWrites, writtenSince } from '../lib/canvasWrites';
import * as struct from './structure.service';
import type { SubjectArea } from './modeler.service';

const canvas = (id: string, over: Partial<SubjectArea> = {}): SubjectArea => ({
  id, projectId: 'p1', name: id, folderId: null,
  tableIds: ['t1', 't2'], viewIds: [],
  layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 } },
  drawings: [], udpValues: {}, routes: {}, ...over,
});

let draft: Record<string, SubjectArea>;
const calls: string[] = [];
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  forgetCanvasWrites();
  draft = { sa1: canvas('sa1'), sa2: canvas('sa2') };
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const ids = (opts?.ids ?? []) as string[];
    calls.push(`get:${ids.join(',')}`);
    await tick();
    return ids.filter((id) => draft[id]).map((id) => structuredClone(draft[id])) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, _op, payload) => {
    calls.push(`put:${id}`);
    await tick();
    draft[id] = structuredClone(payload) as unknown as SubjectArea;
    return {} as never;
  });
  vi.mocked(csvc.recordChangesBulk).mockImplementation(async (_cs, changes) => {
    calls.push(`lote:${changes.map((c) => `${c.op}:${c.entityId}`).join(',')}`);
    await tick();
    for (const c of changes) if (c.collection === 'subject_areas') draft[c.entityId] = structuredClone(c.payload) as unknown as SubjectArea;
    return {} as never;
  });
});

describe('canvasLot', () => {
  it('con muchos canvases los lee en tandas de 100 ids (la URL no pasa el tope del servidor) y graba en un solo envío', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `sb${String(i).padStart(3, '0')}`);
    for (const id of ids) draft[id] = canvas(id);
    let read = 0;
    await struct.canvasLot(ids, (docs) => {
      read = [...docs.values()].filter((d) => d?.name === d?.id).length;   // cada uno, con lo leído de él
      return {
        changes: [], result: null,
        canvases: new Map([...docs].map(([id, d]) => [id, { ...d!, tableIds: ['t2'] }])),
      };
    });
    expect(read).toBe(250);
    const gets = calls.filter((c) => c.startsWith('get:'));
    expect(gets).toHaveLength(3);
    expect(gets.every((g) => g.slice(4).split(',').length <= 100)).toBe(true);
    expect(new Set(gets.flatMap((g) => g.slice(4).split(',')))).toEqual(new Set(ids));
    expect(calls.filter((c) => c.startsWith('lote:'))).toHaveLength(1);
    expect(ids.every((id) => draft[id].name === id && draft[id].tableIds[0] === 't2')).toBe(true);
  });

  it('lee los canvases en una lectura y graba el modelo y los canvases en un solo envío', async () => {
    const out = await struct.canvasLot(['sa2', 'sa1', 'sa2'], (docs) => ({
      changes: [{ collection: 'canonical_tables', entityId: 't1', op: 'delete' }],
      canvases: new Map([['sa1', { ...docs.get('sa1')!, tableIds: ['t2'], layout: { t2: { x: 400.4, y: 0 } } }]]),
      result: [...docs.keys()],
    }));
    expect(out).toEqual(['sa1', 'sa2']);
    expect(calls).toEqual(['get:sa1,sa2', 'lote:delete:t1,upsert:sa1']);
    expect(vi.mocked(csvc.recordChangesBulk).mock.calls[0][2]).toBe(2);   // un solo envío
    expect(draft.sa1).toMatchObject({ tableIds: ['t2'], layout: { t2: { x: 400, y: 0 } } });
    expect(writtenSince('cs1', 'sa1', 0)?.layout).toEqual({ t2: { x: 400, y: 0 } });
  });

  it('va en la cola de cada canvas: espera lo que ya se estaba grabando y lo que llega después lo espera a él', async () => {
    const before = struct.setSubjectAreaLayout('sa1', { t1: { x: 5, y: 5 } });
    const lot = struct.canvasLot(['sa1'], (docs) => ({
      changes: [], canvases: new Map([['sa1', { ...docs.get('sa1')!, tableIds: ['t1'] }]]), result: docs.get('sa1')!.layout,
    }));
    const after = struct.setSubjectAreaLayout('sa1', { t1: { x: 9, y: 9 } });
    const [, seen] = await Promise.all([before, lot, after]);
    expect(seen).toMatchObject({ t1: { x: 5, y: 5 } });
    expect(calls).toEqual(['get:sa1', 'put:sa1', 'get:sa1', 'lote:upsert:sa1', 'get:sa1', 'put:sa1']);
    expect(draft.sa1).toMatchObject({ tableIds: ['t1'], layout: { t1: { x: 9, y: 9 } } });
  });

  it('dos lotes con los mismos canvases pedidos en otro orden no se traban', async () => {
    const plan = (docs: Map<string, SubjectArea | null>) => ({ changes: [], canvases: new Map([...docs].map(([id, d]) => [id, d!])), result: true });
    await expect(Promise.race([
      Promise.all([struct.canvasLot(['sa1', 'sa2'], plan), struct.canvasLot(['sa2', 'sa1'], plan)]),
      new Promise((_r, reject) => setTimeout(() => reject(new Error('trabados')), 500)),
    ])).resolves.toEqual([true, true]);
  });

  it('un canvas que ya no está llega como null; sin nada que grabar no hay envío', async () => {
    const out = await struct.canvasLot(['sa9'], (docs) => ({ changes: [], canvases: new Map(), result: docs.get('sa9') }));
    expect(out).toBeNull();
    expect(csvc.recordChangesBulk).not.toHaveBeenCalled();
  });

  it('con más cambios de los que admite un envío no graba nada', async () => {
    const many = Array.from({ length: struct.LOT_MAX }, (_x, i) => ({ collection: 'canonical_columns', entityId: `c${i}`, op: 'delete' as const }));
    await expect(struct.canvasLot(['sa1'], (docs) => ({
      changes: many, canvases: new Map([['sa1', docs.get('sa1')!]]), result: null,
    }))).rejects.toBeInstanceOf(struct.LotTooLargeError);
    expect(csvc.recordChangesBulk).not.toHaveBeenCalled();
  });

  it('si el envío falla no anota nada como grabado', async () => {
    vi.mocked(csvc.recordChangesBulk).mockRejectedValueOnce(new Error('sin red'));
    await expect(struct.canvasLot(['sa1'], (docs) => ({
      changes: [], canvases: new Map([['sa1', { ...docs.get('sa1')!, layout: { t1: { x: 1, y: 1 } } }]]), result: null,
    }))).rejects.toThrow('sin red');
    expect(writtenSince('cs1', 'sa1', 0)).toBeNull();
  });

  it('exige sesión de edición', async () => {
    useSessionStore.setState({ openMode: 'readonly' });
    await expect(struct.canvasLot(['sa1'], () => ({ changes: [], canvases: new Map(), result: null }))).rejects.toThrow(/working copy/);
  });
});

describe('planCanvasAdd / planCanvasRemove (sin escribir)', () => {
  it('lo mismo que addToCanvas: solo entra lo que falta, con su posición', () => {
    const { next, entered } = struct.planCanvasAdd(canvas('sa1'), { tableIds: ['t2', 't3'], layout: { t2: { x: 1, y: 1 }, t3: { x: 7, y: 7 } } });
    expect(entered).toEqual({ tableIds: ['t3'], viewIds: [] });
    expect(next).toMatchObject({ tableIds: ['t1', 't2', 't3'], layout: { t2: { x: 400, y: 0 }, t3: { x: 7, y: 7 } } });
    expect(struct.planCanvasAdd(canvas('sa1'), { tableIds: ['t1'] }).next).toBeNull();
  });

  it('lo mismo que removeFromCanvas: saca miembro, posición, color y los trazos pedidos, y dice qué salió', () => {
    const cur = canvas('sa1', { colors: { t1: '#FF0000' }, routes: { r1: [{ x: 1, y: 2 }] } });
    const { next, out } = struct.planCanvasRemove(cur, { tableIds: ['t1'], dropRouteIds: ['r1'] });
    expect(next).toMatchObject({ tableIds: ['t2'], layout: { t2: { x: 400, y: 0 } }, colors: {}, routes: {} });
    expect(out).toEqual({ tableIds: ['t1'], viewIds: [], layout: { t1: { x: 0, y: 0 } }, colors: { t1: '#FF0000' }, routes: { r1: [{ x: 1, y: 2 }] } });
    expect(struct.planCanvasRemove(null, { tableIds: ['t1'] })).toEqual({ next: null, out: { tableIds: [], viewIds: [], layout: {}, colors: {}, routes: {} } });
    expect(struct.planCanvasRemove(cur, { tableIds: ['t9'] }).next).toBeNull();
  });
});

describe('canvasDocs', () => {
  it('trae los documentos pedidos que existen', async () => {
    const docs = await struct.canvasDocs(['sa1', 'sa2', 'nope']);
    expect([...docs.keys()].sort()).toEqual(['sa1', 'sa2']);
    expect(docs.get('sa2')?.name).toBe('sa2');
  });
});
