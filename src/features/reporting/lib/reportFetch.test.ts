// Doc 102: columnas por tandas de 300 tablas y vistas por tandas de 2 000, con
// los ids en el cuerpo; una vista con fuentes en dos tandas sale una sola vez.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/reporting.service', () => ({ queryReportColumns: vi.fn(), queryReportViews: vi.fn() }));
import { queryReportColumns, queryReportViews, type ReportViewRow } from '@/services/reporting.service';
import type { RelationshipRow } from '../query.service';
import { fetchColumnsFor, fetchRelationshipsFor, fetchViewsFor } from './reportFetch';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const view = (id: string, name: string, schema = 's'): ReportViewRow =>
  ({ id, name, schema, sourceTableIds: [], sourceTables: [], showOnCanvas: false, columns: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('reportFetch', () => {
  it('columnas: tandas de 300 con la versión', async () => {
    vi.mocked(queryReportColumns).mockImplementation(async (_p, part) => part.map((t) => ({ tableId: t }) as never));
    const rows = await fetchColumnsFor('p1', ids(650), 'cs1');
    expect(vi.mocked(queryReportColumns).mock.calls.map(([, part, cs]) => [part.length, cs])).toEqual([[300, 'cs1'], [300, 'cs1'], [50, 'cs1']]);
    expect(rows).toHaveLength(650);
    expect(await fetchColumnsFor('p1', [], null)).toEqual([]);
  });
  it('vistas: tandas de 2 000, sin repetidas y en orden (esquema, nombre)', async () => {
    vi.mocked(queryReportViews)
      .mockResolvedValueOnce([view('v2', 'B'), view('v1', 'a')])
      .mockResolvedValueOnce([view('v2', 'B'), view('v3', 'C', 'r')]);
    const rows = await fetchViewsFor('p1', ids(2500), null);
    expect(vi.mocked(queryReportViews).mock.calls.map(([, part]) => part.length)).toEqual([2000, 500]);
    expect(rows.map((v) => v.id)).toEqual(['v3', 'v1', 'v2']);
  });

  // Doc 105 (B8): con 15 000 tablas salían 50 POST a la vez y el timeout de
  // 30 s de cada uno corría desde el despacho — los últimos se vencían en cola.
  it('columnas: 15 000 tablas → 50 lotes, nunca más de 4 en vuelo y en el orden de los ids', async () => {
    let inflight = 0;
    let peak = 0;
    vi.mocked(queryReportColumns).mockImplementation(async (_p, part) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, part[0].endsWith('0') ? 3 : 1));   // terminan desordenados
      inflight -= 1;
      return part.map((t) => ({ tableId: t }) as never);
    });
    const all = ids(15000);
    const rows = await fetchColumnsFor('p1', all, 'cs1');
    expect(vi.mocked(queryReportColumns)).toHaveBeenCalledTimes(50);
    expect(peak).toBe(4);
    expect(rows.map((r) => r.tableId)).toEqual(all);
  });
  it('columnas: un lote que falla corta la lectura (sin despachar el resto)', async () => {
    vi.mocked(queryReportColumns).mockImplementation(async (_p, part) => {
      if (part[0] === 't300') throw new Error('HTTP 502');
      await new Promise((r) => setTimeout(r, 2));
      return [];
    });
    await expect(fetchColumnsFor('p1', ids(15000), null)).rejects.toThrow('HTTP 502');
    await new Promise((r) => setTimeout(r, 15));
    expect(vi.mocked(queryReportColumns).mock.calls.length).toBeLessThanOrEqual(5);
  });
  it('vistas: también de a 4 lotes en vuelo', async () => {
    let inflight = 0;
    let peak = 0;
    vi.mocked(queryReportViews).mockImplementation(async (_p, part) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 2));
      inflight -= 1;
      return [view(`v-${part[0]}`, part[0])];
    });
    const rows = await fetchViewsFor('p1', ids(12000), null);
    expect(vi.mocked(queryReportViews)).toHaveBeenCalledTimes(6);
    expect(peak).toBe(4);
    expect(rows).toHaveLength(6);
  });
});

// Doc 105 (A3-o1): la hoja Relationships pedía las primeras 5 000 relaciones de
// TODO el proyecto y las filtraba acá — en proyectos grandes faltaban. Ahora van
// por lotes de 300 tablas (POST, contrato del backend) y se deduplican por
// relación. Se prueba contra `fetch` (servicio + http reales).
describe('relaciones por lotes (doc 105 A3-o1)', () => {
  type Body = { projectId: string; tableIds: string[]; changesetId?: string | null };
  const rel = (id: string, parentTableId: string, childTableId: string, pairIndex = 0, pairCount = 1): RelationshipRow => ({
    id, pairIndex, pairCount, parentTableId, childTableId, parent: `${parentTableId}.C`, child: `${childTableId}.C`,
    parentTable: parentTableId, parentColumn: 'C', childTable: childTableId, childColumn: 'C', roleName: null,
    parentToChildPhrase: null, childToParentPhrase: null, cardinality: '1 → 0..N', identifying: false,
    isSelfReferencing: parentTableId === childTableId, crossSchema: false, label: id,
  });
  const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
  const bodyOf = (init?: RequestInit): Body => JSON.parse(String(init?.body));

  it('lotes de 300 ids por POST, con la versión; sin ids no hay pedido', async () => {
    const calls: { url: string; method?: string; body: Body }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: bodyOf(init) });
      return ok([]);
    }));
    expect(await fetchRelationshipsFor('p1', ids(650), 'cs1')).toEqual([]);
    expect(calls.map((c) => [c.method, c.body.projectId, c.body.tableIds.length, c.body.changesetId]))
      .toEqual([['POST', 'p1', 300, 'cs1'], ['POST', 'p1', 300, 'cs1'], ['POST', 'p1', 50, 'cs1']]);
    expect(calls.every((c) => /\/api\/reporting\/insights\/relationships\/query$/.test(c.url))).toBe(true);
    expect(calls[1].body.tableIds[0]).toBe('t300');
    expect(calls.flatMap((c) => c.body.tableIds)).toEqual(ids(650));

    calls.length = 0;
    await fetchRelationshipsFor('p1', ids(3), null);
    expect(calls[0].body).toEqual({ projectId: 'p1', tableIds: ['t0', 't1', 't2'] });   // producción: sin changesetId
    calls.length = 0;
    expect(await fetchRelationshipsFor('p1', [], null)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('una relación con extremos en dos lotes sale UNA vez, con todas sus filas de par, en el orden de los lotes', async () => {
    // r1 (t5 → t400) es compuesta (2 pares) y la devuelven ambos lotes; el lote 2 responde primero.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const first = bodyOf(init).tableIds[0] === 't0';
      await sleep(first ? 6 : 1);
      return ok(first
        ? [rel('r1', 't5', 't400', 0, 2), rel('r1', 't5', 't400', 1, 2), rel('r2', 't10', 't11')]
        : [rel('r1', 't5', 't400', 0, 2), rel('r1', 't5', 't400', 1, 2), rel('r3', 't400', 't401')]);
    }));
    const rows = await fetchRelationshipsFor('p1', ids(600), null);
    expect(rows.map((r) => `${r.id}#${r.pairIndex}`)).toEqual(['r1#0', 'r1#1', 'r2#0', 'r3#0']);
  });

  it('de a 4 lotes en vuelo; un lote que falla rechaza con su error', async () => {
    let inflight = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await sleep(2);
      inflight -= 1;
      return ok([rel(`r-${bodyOf(init).tableIds[0]}`, bodyOf(init).tableIds[0], 'tx')]);
    }));
    const rows = await fetchRelationshipsFor('p1', ids(3000), 'cs1');
    expect(peak).toBe(4);
    expect(rows.map((r) => r.id)).toEqual(['t0', 't300', 't600', 't900', 't1200', 't1500', 't1800', 't2100', 't2400', 't2700'].map((t) => `r-${t}`));

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => (bodyOf(init).tableIds[0] === 't300'
      ? new Response(JSON.stringify({ detail: 'This version is no longer open.' }), { status: 409 })
      : ok([]))));
    await expect(fetchRelationshipsFor('p1', ids(900), 'cs1')).rejects.toThrow('This version is no longer open.');
  });
});
