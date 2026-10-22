// Tras la carga Excel no se reacomoda el canvas: solo lo que entró (tablas y
// sus vistas) se ordena como grupo, sin pisarse entre sí, en el centro de lo
// que el usuario ve (o del contenido, si el canvas no está abierto). Lo
// existente no se mueve. Vista nueva de una tabla que ya estaba: pegada a su
// derecha.
import { describe, expect, it } from 'vitest';
import { pinsForEntering, pinsForLeaving, placeNewMembers, seenAt, type LayoutFn } from './placeNewMembers';
import { tableLodSize, viewLodSize } from './lodSize';
import { buildViewGraph, defaultViewPosition } from './viewGraph';
import { gridSlot } from './viewerLayout';
import type { Diagram } from '../services/modeler.service';

type Box = { x: number; y: number; w: number; h: number };

const table = (id: string, name = id.toUpperCase()) => ({ id, projectId: 'p', physicalName: name, logicalName: name.toLowerCase(), schema: 'stg' });
const col = (tableId: string, name: string) => ({ id: `${tableId}.${name}`, tableId, physicalName: name, logicalName: name.toLowerCase(), dataType: 'STRING', typeOverridden: false, ordinal: 0 });
const view = (id: string, tableId: string, cols: string[]) => ({
  id, name: id.toUpperCase(), schema: 'stg_vu', tableId, sourceTableIds: [tableId],
  sources: cols.map((c) => ({ tableId, column: c, outputAlias: c })),
});

function diagram(opts: { tables: ReturnType<typeof table>[]; views?: ReturnType<typeof view>[]; layout?: Record<string, { x: number; y: number }> }): Diagram {
  const columns = opts.tables.flatMap((t) => [col(t.id, 'COD'), col(t.id, 'NOMBRE_LARGO_DE_COLUMNA')]);
  return {
    subjectArea: { id: 'sa', projectId: 'p', name: 'C', folderId: null, tableIds: opts.tables.map((t) => t.id),
      viewIds: (opts.views ?? []).map((v) => v.id), layout: opts.layout ?? {}, drawings: [], udpValues: {} },
    tables: opts.tables, columns, relationships: [], views: opts.views ?? [],
  } as unknown as Diagram;
}

/** Cajas de lo ubicado (con el mismo tamaño estimado que usa la colocación). */
function boxes(dia: Diagram, pos: Record<string, { x: number; y: number }>): Record<string, Box> {
  const colTypes: Record<string, string> = {};
  for (const c of dia.columns) colTypes[`${c.tableId}::${c.physicalName}`] = c.dataType;
  const out: Record<string, Box> = {};
  for (const [id, p] of Object.entries(pos)) {
    const t = dia.tables.find((x) => x.id === id);
    const v = (dia.views ?? []).find((x) => x.id === id);
    const s = t ? tableLodSize(t, dia.columns.filter((c) => c.tableId === id), 'physical') : viewLodSize(v!, colTypes);
    out[id] = { x: p.x, y: p.y, w: s.w, h: s.h };
  }
  return out;
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const bbox = (bs: Box[]) => {
  const l = Math.min(...bs.map((b) => b.x)), t = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w)), btm = Math.max(...bs.map((b) => b.y + b.h));
  return { cx: (l + r) / 2, cy: (t + btm) / 2, l, t };
};

describe('placeNewMembers', () => {
  it('solo devuelve posición para lo que entró: lo existente no se mueve', async () => {
    const dia = diagram({ tables: [table('old1'), table('old2'), table('n1')], views: [view('vn1', 'n1', ['COD'])],
      layout: { old1: { x: 0, y: 0 }, old2: { x: 600, y: 0 }, n1: { x: 40, y: 9000 }, vn1: { x: 520, y: 9000 } } });
    const pos = await placeNewMembers(dia, ['n1', 'vn1'], { x: 1000, y: 2000 });
    expect(Object.keys(pos).sort()).toEqual(['n1', 'vn1']);
  });

  it('el grupo nuevo queda centrado en lo que el usuario ve', async () => {
    const dia = diagram({ tables: [table('old'), table('n1')], views: [view('vn1', 'n1', ['COD', 'NOMBRE_LARGO_DE_COLUMNA'])],
      layout: { old: { x: 0, y: 0 } } });
    const pos = await placeNewMembers(dia, ['n1', 'vn1'], { x: 1000, y: 2000 });
    const b = bbox(Object.values(boxes(dia, pos)));
    expect(Math.abs(b.cx - 1000)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.cy - 2000)).toBeLessThanOrEqual(1);
  });

  it('lo nuevo no se pisa entre sí y cada vista queda a la derecha de su tabla (ELK real)', async () => {
    const tables = Array.from({ length: 6 }, (_, i) => table(`n${i}`, `TABLA_NUEVA_${i}`));
    const views = tables.map((t) => view(`v${t.id}`, t.id, ['COD', 'NOMBRE_LARGO_DE_COLUMNA']));
    const dia = diagram({ tables, views });
    const entering = [...tables.map((t) => t.id), ...views.map((v) => v.id)];
    const pos = await placeNewMembers(dia, entering, { x: 0, y: 0 });
    const bs = boxes(dia, pos);
    const ids = Object.keys(bs);
    expect(ids).toHaveLength(12);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      expect(overlap(bs[ids[i]], bs[ids[j]]), `${ids[i]} vs ${ids[j]}`).toBe(false);
    }
    for (const t of tables) expect(bs[`v${t.id}`].x).toBeGreaterThanOrEqual(bs[t.id].x + bs[t.id].w);
  });

  it('vista nueva de una tabla que ya estaba: pegada a la derecha de su tabla, a su altura', async () => {
    const dia = diagram({ tables: [table('old')], views: [view('vold', 'old', ['COD'])], layout: { old: { x: 100, y: 300 } } });
    const pos = await placeNewMembers(dia, ['vold'], { x: 5000, y: 5000 });
    const w = tableLodSize(dia.tables[0], dia.columns, 'physical').w;
    expect(pos).toEqual({ vold: { x: 100 + w + 140, y: 300 } });
  });

  it('si esa vista chocaría con otro bloque nuevo, baja hasta quedar libre', async () => {
    const dia = diagram({ tables: [table('old'), table('n1')], views: [view('vold', 'old', ['COD'])], layout: { old: { x: 100, y: 300 } } });
    const wOld = tableLodSize(dia.tables[0], dia.columns.filter((c) => c.tableId === 'old'), 'physical').w;
    // La tabla nueva cae justo donde iría la vista (layout falso, determinista).
    const fake: LayoutFn = async () => ({ n1: { x: 0, y: 0 } });
    const n1 = tableLodSize(dia.tables[1], dia.columns.filter((c) => c.tableId === 'n1'), 'physical');
    const focus = { x: 100 + wOld + 140 + n1.w / 2, y: 300 + n1.h / 2 };
    const pos = await placeNewMembers(dia, ['n1', 'vold'], focus, fake);
    const bs = boxes(dia, pos);
    expect(overlap(bs.n1, bs.vold)).toBe(false);
    expect(bs.vold.x).toBe(100 + wOld + 140);
    expect(bs.vold.y).toBeGreaterThanOrEqual(bs.n1.y + bs.n1.h);
  });

  it('canvas que no está abierto (sin foco): el grupo va al centro del contenido existente', async () => {
    const dia = diagram({ tables: [table('a'), table('b'), table('n1')], layout: { a: { x: 0, y: 0 }, b: { x: 2000, y: 1000 } } });
    const pos = await placeNewMembers(dia, ['n1'], null);
    const existing = boxes(dia, { a: { x: 0, y: 0 }, b: { x: 2000, y: 1000 } });
    const e = bbox(Object.values(existing));
    const g = bbox(Object.values(boxes(dia, pos)));
    expect(Math.abs(g.cx - e.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.cy - e.cy)).toBeLessThanOrEqual(1);
  });

  it('canvas nuevo (nada existente, sin foco): el grupo arranca arriba a la izquierda', async () => {
    const dia = diagram({ tables: [table('n1'), table('n2')] });
    const pos = await placeNewMembers(dia, ['n1', 'n2'], null);
    const g = bbox(Object.values(boxes(dia, pos)));
    expect({ l: g.l, t: g.t }).toEqual({ l: 40, t: 40 });
  });

  it('posiciones enteras; nada que ubicar → vacío', async () => {
    const dia = diagram({ tables: [table('n1')] });
    const pos = await placeNewMembers(dia, ['n1'], { x: 10.5, y: 20.25 });
    expect(Object.values(pos).every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))).toBe(true);
    expect(await placeNewMembers(dia, [], { x: 0, y: 0 })).toEqual({});
  });

  it('una vista que entró pero cuya tabla no está en el canvas no se ubica (no se muestra)', async () => {
    const dia = diagram({ tables: [table('n1')], views: [view('vx', 'otra', ['COD'])] });
    const pos = await placeNewMembers(dia, ['n1', 'vx'], { x: 0, y: 0 });
    expect(Object.keys(pos)).toEqual(['n1']);
  });
});

// Tablas que ya estaban sin posición guardada (entraron sin layout) se pintan
// donde las pone el canvas: la grilla por número de orden; la colocación las
// cuenta ahí (centro del contenido, y la vista nueva de una de ellas a su
// derecha).
describe('placeNewMembers con lo existente sin posición guardada', () => {
  it('canvas no abierto: el centro del contenido cuenta la grilla por número de orden del canvas', async () => {
    // a (índice 0) y b (índice 1) sin layout → (60,60) y (320,60), como ModelerCanvas.
    const dia = diagram({ tables: [table('a'), table('b'), table('n1')] });
    const pos = await placeNewMembers(dia, ['n1'], null);
    const e = bbox(Object.values(boxes(dia, { a: { x: 60, y: 60 }, b: { x: 320, y: 60 } })));
    const g = bbox(Object.values(boxes(dia, { n1: pos.n1 })));
    expect(Math.abs(g.cx - e.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.cy - e.cy)).toBeLessThanOrEqual(1);
  });

  it('la vista nueva de una tabla sin posición guardada va a la derecha de donde se la ve', async () => {
    const dia = diagram({ tables: [table('old')], views: [view('vold', 'old', ['COD'])] });
    const pos = await placeNewMembers(dia, ['vold'], { x: 5000, y: 5000 });
    const w = tableLodSize(dia.tables[0], dia.columns, 'physical').w;
    expect(pos).toEqual({ vold: { x: 60 + w + 140, y: 60 } });          // solo entró una vista: nada que fijar
  });
});

// Lo existente sin posición guardada que el canvas correría de lugar al entrar
// lo nuevo queda fijado donde estaba: una tabla se pinta por su número de orden
// (el backend ordena por nombre, también en el draft) y una tabla que entra y
// la precede en el orden la corre; se fijan todas, así tampoco las corre un
// alta posterior. Una vista se re-ancla a una tabla que entra si es su primera
// fuente. Lo que no se correría, no se toca.
describe('placeNewMembers fija lo existente que el canvas correría de lugar', () => {
  it('tabla sin posición cuyo número de orden cambia: queda en su casilla previa', async () => {
    // Previo a la carga: a (casilla 0) y z (1). Entra b, que ordena entre las dos: z pasaría a la 2.
    const dia = diagram({ tables: [table('a'), table('b'), table('z')], layout: { a: { x: 0, y: 0 } } });
    const pos = await placeNewMembers(dia, ['b'], { x: 5000, y: 5000 });
    expect(pos.z).toEqual(gridSlot(1));
    expect(pos.a).toBeUndefined();
  });

  it('tabla sin posición que no cambia de casilla: también se fija (una alta posterior que la preceda en el orden la correría)', async () => {
    const dia = diagram({ tables: [table('a'), table('b'), table('n', 'Z_NUEVA')] });
    const pos = await placeNewMembers(dia, ['n'], { x: 5000, y: 5000 });
    expect(pos.a).toEqual(gridSlot(0));
    expect(pos.b).toEqual(gridSlot(1));
  });

  it('si solo entran vistas, las tablas no cambian de casilla: no se fija nada', async () => {
    const dia = diagram({ tables: [table('a'), table('b')], views: [view('vb', 'b', ['COD'])] });
    const pos = await placeNewMembers(dia, ['vb'], { x: 5000, y: 5000 });
    expect(Object.keys(pos)).toEqual(['vb']);
  });

  it('vista sin posición con fuentes [nueva, existente]: queda junto a la tabla existente', async () => {
    const vx = { ...view('vx', 'n1', ['COD']), sourceTableIds: ['n1', 'old'] };
    const dia = diagram({ tables: [table('n1'), table('old')], views: [vx], layout: { old: { x: 0, y: 0 } } });
    const pos = await placeNewMembers(dia, ['n1'], { x: 5000, y: 5000 });
    expect(pos.vx).toEqual(defaultViewPosition({ x: 0, y: 0 }));
  });

  it('vista sin posición de una tabla que ya estaba: no se toca (sigue a su tabla)', async () => {
    const dia = diagram({ tables: [table('old'), table('n1')], views: [view('vo', 'old', ['COD'])], layout: { old: { x: 0, y: 0 } } });
    const pos = await placeNewMembers(dia, ['n1'], { x: 5000, y: 5000 });
    expect(pos.vo).toBeUndefined();
  });

  it('vista sin posición de una tabla que se fija: no hace falta fijarla (su tabla no se mueve)', async () => {
    const dia = diagram({ tables: [table('a'), table('b'), table('z')], views: [view('vz', 'z', ['COD'])], layout: { a: { x: 0, y: 0 } } });
    const pos = await placeNewMembers(dia, ['b'], { x: 5000, y: 5000 });
    expect(pos.z).toEqual(gridSlot(1));
    expect(pos.vz).toBeUndefined();
  });

  it('fuzz: con lo fijado, cada bloque existente se ve exactamente donde se veía antes de la carga', async () => {
    type P = { x: number; y: number };
    type V = ReturnType<typeof view>;
    const row: LayoutFn = async (nodes) => {
      let x = 0; const out: Record<string, P> = {};
      for (const n of nodes) { out[n.id] = { x, y: 0 }; x += n.width + 100; }
      return out;
    };
    /** Dónde pinta ModelerCanvas cada bloque (grilla por número de orden + vistas junto a su 1.ª fuente presente). */
    const painted = (dia: Diagram, layout: Record<string, P>): Record<string, P> => {
      const tablePos = new Map(dia.tables.map((t, i) => [t.id, layout[t.id] ?? gridSlot(i)]));
      const vs = buildViewGraph(dia.views ?? [], dia.tables, dia.columns, layout, tablePos, () => {});
      return { ...Object.fromEntries(tablePos), ...Object.fromEntries(vs.nodes.map((n) => [n.id, n.position])) };
    };
    let seed = 20261017;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(rnd() * 8);
      const tables = Array.from({ length: n }, (_, i) => table(`t${i}`, `M_${Math.floor(rnd() * 900) + 100}_${i}`))
        .sort((a, b) => a.physicalName.localeCompare(b.physicalName));
      const fresh = new Set(tables.filter(() => rnd() < 0.35).map((t) => t.id));
      if (fresh.size === n) fresh.delete(tables[0].id);
      if (!fresh.size) fresh.add(tables[n - 1].id);
      const layout: Record<string, P> = {};
      for (const t of tables) if (!fresh.has(t.id) && rnd() < 0.5) layout[t.id] = { x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 3000) };
      const views: V[] = [];
      for (let j = 0; j < Math.floor(rnd() * 5); j++) {
        const src = [tables[Math.floor(rnd() * n)].id, tables[Math.floor(rnd() * n)].id].slice(0, rnd() < 0.4 ? 2 : 1);
        views.push({ ...view(`v${j}`, src[0], ['COD']), sourceTableIds: [...new Set(src)] });
      }
      // Una vista se veía antes de la carga si alguna fuente ya estaba; si no, entra con ella.
      const before = views.filter((v) => v.sourceTableIds.some((id) => !fresh.has(id)));
      for (const v of before) if (rnd() < 0.4) layout[v.id] = { x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 3000) };
      const entering = [...fresh, ...views.filter((v) => !before.includes(v)).map((v) => v.id)];
      const after = diagram({ tables, views, layout });
      const pos = await placeNewMembers(after, entering, rnd() < 0.5 ? null : { x: 4000, y: 4000 }, row);
      const was = painted(diagram({ tables: tables.filter((t) => !fresh.has(t.id)), views: before, layout }), layout);
      const now = painted(after, { ...layout, ...pos });
      for (const id of Object.keys(was)) expect(now[id], `caso ${k}, ${id}`).toEqual(was[id]);
      checked += Object.keys(was).length;
    }
    expect(checked).toBeGreaterThan(500);
  });
});

// Lo mismo al crear, importar, CTAS o pegar una tabla: el canvas que se mira es
// el previo al alta (el diagrama no incluye la tabla que entra). Una tabla
// que entra y las precede en el orden correría de casilla a las que no tienen
// posición guardada; con los pins quedan donde se ven.
describe('pinsForEntering (crear, importar, CTAS y pegar)', () => {
  it('alta de una tabla nueva: las existentes sin posición quedan en su casilla actual', () => {
    const dia = diagram({ tables: [table('a'), table('z')], layout: { a: { x: 0, y: 0 } } });
    expect(pinsForEntering(dia, ['nueva']).pins).toEqual({ z: gridSlot(1) });
  });

  it('sin una tabla que entre no se fija nada; con todas posicionadas, tampoco', () => {
    const dia = diagram({ tables: [table('a'), table('b')] });
    expect(pinsForEntering(dia, []).pins).toEqual({});
    const placed = diagram({ tables: [table('a'), table('b')], layout: { a: { x: 0, y: 0 }, b: { x: 9, y: 9 } } });
    expect(pinsForEntering(placed, ['n']).pins).toEqual({});
  });

  it('importar una tabla que es la primera fuente de una vista que ya se ve (por otra fuente): la vista queda donde se ve', () => {
    const vx = { ...view('vx', 'imp', ['COD']), sourceTableIds: ['imp', 'old'] };
    const dia = diagram({ tables: [table('old')], views: [vx], layout: { old: { x: 100, y: 50 } } });
    expect(pinsForEntering(dia, ['imp']).pins).toEqual({ vx: defaultViewPosition({ x: 100, y: 50 }) });
  });

  it('fuzz: sobre el canvas previo al alta, cada bloque existente se ve exactamente donde se veía', () => {
    type P = { x: number; y: number };
    type V = ReturnType<typeof view>;
    const painted = (dia: Diagram, layout: Record<string, P>): Record<string, P> => {
      const tablePos = new Map(dia.tables.map((t, i) => [t.id, layout[t.id] ?? gridSlot(i)]));
      const vs = buildViewGraph(dia.views ?? [], dia.tables, dia.columns, layout, tablePos, () => {});
      return { ...Object.fromEntries(tablePos), ...Object.fromEntries(vs.nodes.map((n) => [n.id, n.position])) };
    };
    const byName = (a: { physicalName: string }, b: { physicalName: string }) => a.physicalName.localeCompare(b.physicalName);
    let seed = 20261114;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const n = 1 + Math.floor(rnd() * 8);
      const existing = Array.from({ length: n }, (_, i) => table(`t${i}`, `M_${Math.floor(rnd() * 900) + 100}_${i}`)).sort(byName);
      // Lo que entra: tablas nuevas o importadas (1 a 3), con o sin posición.
      const entering = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => table(`n${i}`, `M_${Math.floor(rnd() * 900) + 100}_n${i}`));
      const layout: Record<string, P> = {};
      for (const t of existing) if (rnd() < 0.5) layout[t.id] = { x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 3000) };
      const all = [...existing, ...entering];
      const views: V[] = [];
      for (let j = 0; j < Math.floor(rnd() * 4); j++) {
        // Se ve si alguna fuente ya está; una fuente puede ser una que entra (importada).
        const src = [existing[Math.floor(rnd() * n)].id, all[Math.floor(rnd() * all.length)].id];
        views.push({ ...view(`v${j}`, src[0], ['COD']), sourceTableIds: rnd() < 0.5 ? [...new Set(src)] : [...new Set(src)].reverse() });
      }
      for (const v of views) if (rnd() < 0.4) layout[v.id] = { x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 3000) };
      const before = diagram({ tables: existing, views, layout });
      const { pins } = pinsForEntering(before, entering.map((t) => t.id));
      const enteringLayout: Record<string, P> = {};
      for (const t of entering) if (rnd() < 0.6) enteringLayout[t.id] = { x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 3000) };
      const after = diagram({ tables: [...all].sort(byName), views, layout });
      const was = painted(before, layout);
      const now = painted(after, { ...layout, ...enteringLayout, ...pins });
      for (const id of Object.keys(was)) expect(now[id], `caso ${k}, ${id}`).toEqual(was[id]);
      // Solo se fija lo que no tiene posición guardada.
      for (const id of Object.keys(pins)) expect(layout[id], `caso ${k}, ${id} ya tenía posición`).toBeUndefined();
      checked += Object.keys(was).length;
    }
    expect(checked).toBeGreaterThan(500);
  });
});

// Sacar o borrar una tabla correría una casilla hacia atrás a las que no tienen
// posición, y si después se creara otra (que las fija ahí), deshacer las dos
// acciones dejaría una tabla tapando a otra. Al sacar también se fijan donde se
// ven (el canvas previo a sacarla).
describe('pinsForLeaving (sacar o borrar)', () => {
  it('sacar la primera: las siguientes sin posición quedan en su casilla actual', () => {
    const dia = diagram({ tables: [table('a'), table('b'), table('c')] });
    expect(pinsForLeaving(dia, ['a'])).toEqual({ b: gridSlot(1), c: gridSlot(2) });
  });
  it('sin tablas que salgan (o ninguna sin posición): nada', () => {
    const dia = diagram({ tables: [table('a'), table('b')], layout: { b: { x: 9, y: 9 } } });
    expect(pinsForLeaving(dia, ['zz'])).toEqual({});
    expect(pinsForLeaving(dia, ['a'])).toEqual({});
  });
  it('una vista sin posición cuya primera fuente sale (y le queda otra): queda donde se ve', () => {
    const vx = { ...view('vx', 'a', ['COD']), sourceTableIds: ['a', 'b'] };
    const dia = diagram({ tables: [table('a'), table('b')], views: [vx], layout: { a: { x: 100, y: 50 }, b: { x: 900, y: 50 } } });
    expect(pinsForLeaving(dia, ['a'])).toEqual({ vx: defaultViewPosition({ x: 100, y: 50 }) });
  });
  it('fuzz: tras sacar, cada bloque que queda se ve exactamente donde se veía', () => {
    type P = { x: number; y: number };
    type V = ReturnType<typeof view>;
    const painted = (dia: Diagram, layout: Record<string, P>): Record<string, P> => {
      const tablePos = new Map(dia.tables.map((t, i) => [t.id, layout[t.id] ?? gridSlot(i)]));
      const vs = buildViewGraph(dia.views ?? [], dia.tables, dia.columns, layout, tablePos, () => {});
      return { ...Object.fromEntries(tablePos), ...Object.fromEntries(vs.nodes.map((n) => [n.id, n.position])) };
    };
    const byName = (a: { physicalName: string }, b: { physicalName: string }) => a.physicalName.localeCompare(b.physicalName);
    let seed = 20261117;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(rnd() * 8);
      const tables = Array.from({ length: n }, (_, i) => table(`t${i}`, `M_${Math.floor(rnd() * 900) + 100}_${i}`)).sort(byName);
      const leaving = tables.filter(() => rnd() < 0.3).map((t) => t.id);
      if (!leaving.length) leaving.push(tables[Math.floor(rnd() * n)].id);
      if (leaving.length === n) leaving.pop();
      const layout: Record<string, P> = {};
      for (const t of tables) if (rnd() < 0.5) layout[t.id] = { x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 3000) };
      const views: V[] = [];
      for (let j = 0; j < Math.floor(rnd() * 5); j++) {
        const src = [...new Set([tables[Math.floor(rnd() * n)].id, tables[Math.floor(rnd() * n)].id])];
        views.push({ ...view(`v${j}`, src[0], ['COD']), sourceTableIds: src });
      }
      for (const v of views) if (rnd() < 0.4) layout[v.id] = { x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 3000) };
      const before = diagram({ tables, views, layout });
      const pins = pinsForLeaving(before, leaving);
      const gone = new Set(leaving);
      const after = diagram({ tables: tables.filter((t) => !gone.has(t.id)), views: views.filter((v) => v.sourceTableIds.some((id) => !gone.has(id))), layout });
      const was = painted(before, layout);
      const now = painted(after, { ...layout, ...pins });
      for (const id of Object.keys(now)) expect(now[id], `caso ${k}, ${id}`).toEqual(was[id]);
      for (const id of Object.keys(pins)) expect(layout[id], `caso ${k}, ${id} ya tenía posición`).toBeUndefined();
      checked += Object.keys(now).length;
    }
    expect(checked).toBeGreaterThan(500);
  });
});

// Borrar una tabla de un canvas que no está abierto: el Undo la repone donde se
// veía en ese canvas (su posición o su casilla).
describe('seenAt', () => {
  it('su posición guardada o, sin ella, su casilla por número de orden; null si no está', () => {
    const dia = diagram({ tables: [table('a'), table('b'), table('c')], layout: { c: { x: 700, y: 80 } } });
    expect(seenAt(dia, 'b')).toEqual(gridSlot(1));
    expect(seenAt(dia, 'c')).toEqual({ x: 700, y: 80 });
    expect(seenAt(dia, 'zz')).toBeNull();
  });
});
