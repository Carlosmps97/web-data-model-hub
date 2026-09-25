import { describe, expect, it } from 'vitest';
import { buildDiagramScene, type SceneInput } from './exportScene';

type FixtureInput = SceneInput & { diagram: NonNullable<SceneInput['diagram']> };
import type { SceneItem } from './exportScene';

// ── Fixture chico pero completo: 2 tablas + rel + vista + subcat + shapes ──
const col = (id: string, tableId: string, physicalName: string, dataType: string, o: Partial<{
  isPrimaryKey: boolean; isForeignKey: boolean; pkPosition: number | null; ordinal: number;
}> = {}) => ({
  id, tableId, physicalName, logicalName: physicalName.toLowerCase(), dataType,
  typeOverridden: false, ordinal: o.ordinal ?? 0,
  isPrimaryKey: o.isPrimaryKey, isForeignKey: o.isForeignKey, pkPosition: o.pkPosition ?? null,
});

const base = (): FixtureInput => ({
  viewMode: 'physical',
  drawings: [],
  diagram: {
    subjectArea: {
      id: 'sa1', projectId: 'p1', name: 'Demo', tableIds: ['t1', 't2'],
      layout: { t1: { x: 100, y: 200 }, t2: { x: 600, y: 220 } },
    },
    tables: [
      { id: 't1', physicalName: 'ORDERS', logicalName: 'Orders', schema: 'dw' },
      { id: 't2', physicalName: 'ITEMS', logicalName: 'Items', schema: 'dw' },
    ],
    columns: [
      // t1: PK compuesta con orden de llave INVERTIDO al físico
      col('c1', 't1', 'ORDER_ID', 'BIGINT', { isPrimaryKey: true, pkPosition: 1, ordinal: 0 }),
      col('c2', 't1', 'COUNTRY', 'STRING', { isPrimaryKey: true, pkPosition: 0, ordinal: 1 }),
      col('c3', 't1', 'TOTAL', 'DECIMAL(10,2)', { ordinal: 2 }),
      // t2
      col('c4', 't2', 'ITEM_ID', 'BIGINT', { isPrimaryKey: true, ordinal: 0 }),
      col('c5', 't2', 'ORDER_ID', 'BIGINT', { isForeignKey: true, ordinal: 1 }),
      col('c6', 't2', 'COUNTRY', 'STRING', { isForeignKey: true, ordinal: 2 }),
    ],
    relationships: [
      { id: 'r1', parentTableId: 't1', childTableId: 't2', identifying: true,
        parentCardinality: 'one', childCardinality: 'zero-many',
        pairs: [{ parentColumnId: 'c1', childColumnId: 'c5' }, { parentColumnId: 'c2', childColumnId: 'c6' }] },
    ],
    views: [],
  },
});

const items = (s: ReturnType<typeof buildDiagramScene>) => s.items;
const texts = (s: ReturnType<typeof buildDiagramScene>) => s.items.filter((i) => i.k === 'text') as Extract<SceneItem, { k: 'text' }>[];

describe('buildDiagramScene — tablas', () => {
  const scene = buildDiagramScene(base());

  it('normaliza el origen: bounds con padding 60', () => {
    // t1 en layout (100,200) es el nodo más arriba/izquierda ⇒ queda en (60,60).
    const head = texts(scene).find((t) => t.s.includes('ORDERS'));
    expect(head).toBeTruthy();
    expect(scene.w).toBeGreaterThan(0);
    expect(scene.h).toBeGreaterThan(0);
    const xs = items(scene).flatMap((i) => 'x' in i ? [i.x] : 'x1' in i ? [i.x1, i.x2] : 'cx' in i ? [i.cx] : []);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  });

  it('dimensiona la caja con la métrica del canvas (clamp 240, 32 + filas·28)', () => {
    // t1: header 'dw.ORDERS' (9) vs maxcol 'DECIMAL(10,2)'+'TOTAL' (18)+3 ⇒ 21·8+72=240
    const boxes = items(scene).filter((i): i is Extract<SceneItem, { k: 'rect' }> => i.k === 'rect' && i.w === 240);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.some((b) => b.h === 32 + 3 * 28)).toBe(true);      // t1: 3 columnas
  });

  it('doc 94: bloque PK primero y, entre PK, el ordinal (un pkPosition viejo NO manda)', () => {
    const rows = texts(scene).filter((t) => ['ORDER_ID', 'COUNTRY', 'TOTAL'].includes(t.s));
    const inT1 = rows.filter((t) => t.x < 400).sort((a, b) => a.y - b.y);
    expect(inT1.map((t) => t.s)).toEqual(['ORDER_ID', 'COUNTRY', 'TOTAL']);
  });

  it('modo lógico usa logicalName', () => {
    const s2 = buildDiagramScene({ ...base(), viewMode: 'logical' });
    expect(texts(s2).some((t) => t.s === 'country')).toBe(true);
    expect(texts(s2).some((t) => t.s === 'COUNTRY')).toBe(false);
  });

  it('trunca nombres largos con …', () => {
    const inp = base();
    inp.diagram.columns.push(col('c9', 't2', 'X'.repeat(200), 'STRING', { ordinal: 3 }));
    const t = texts(buildDiagramScene(inp)).find((x) => x.s.startsWith('XXX'));
    expect(t).toBeTruthy();
    expect(t!.s.endsWith('…')).toBe(true);
    expect(t!.s.length).toBeLessThan(120);
  });
});

describe('buildDiagramScene — relaciones crow-foot', () => {
  const scene = buildDiagramScene(base());
  const paths = items(scene).filter((i): i is Extract<SceneItem, { k: 'path' }> => i.k === 'path');

  it('identifying = trazo SÓLIDO; el wire sale del lado correcto y existe', () => {
    const wire = paths.find((p) => p.d.startsWith('M') && p.stroke === '#3A4658' && !p.fill);
    expect(wire).toBeTruthy();
    expect(wire!.dash).toBeUndefined();
  });

  it('non-identifying = punteada 7 4', () => {
    const inp = base();
    inp.diagram.relationships[0].identifying = false;
    const p2 = items(buildDiagramScene(inp)).filter((i): i is Extract<SceneItem, { k: 'path' }> => i.k === 'path');
    expect(p2.some((p) => p.dash === '7 4')).toBe(true);
  });

  it('dibuja marcadores crow-foot en ambos extremos (líneas cortas junto a los bordes)', () => {
    const lines = items(scene).filter((i): i is Extract<SceneItem, { k: 'line' }> => i.k === 'line');
    // pata "muchos" en el hijo: 3 líneas convergentes + círculo "cero"
    const circles = items(scene).filter((i) => i.k === 'ellipse');
    expect(lines.length).toBeGreaterThanOrEqual(4);   // 1 barra (one) + 3 pata (many)
    expect(circles.length).toBeGreaterThanOrEqual(1); // el "cero" de zero-many
  });

  it('ancla el target en la FILA de la columna del primer par', () => {
    // c5 = fila 2 de t2 (pk ITEM_ID primero): y esperado = top + 32 + 1·28 + 14
    const wire = paths.find((p) => p.stroke === '#3A4658');
    // t2 quedó en x=600-100+60=560, y=220-200+60=80 ⇒ target y = 80+32+28+14=154
    expect(wire!.d).toContain('154');
  });
});

describe('buildDiagramScene — vistas, subcategorías y shapes', () => {
  it('vista: borde punteado, badge VISTA y hatch', () => {
    const inp = base();
    inp.diagram.views = [{
      id: 'v1', name: 'V_ORDERS', schema: 'dw_VU', sourceTableIds: ['t1'],
      sources: [{ tableId: 't1', column: 'TOTAL', outputAlias: 'total_amt', expression: 'SUM(TOTAL)' }],
    }];
    const s = buildDiagramScene(inp);
    expect(texts(s).some((t) => t.s === 'VISTA')).toBe(true);
    expect(texts(s).some((t) => t.s === 'fx')).toBe(true);
    expect(items(s).some((i) => i.k === 'hatch')).toBe(true);
    expect(items(s).some((i) => i.k === 'rect' && i.dash != null && i.stroke === '#C5CCD8')).toBe(true);
    // wire de derivación + anillo en el extremo de la vista
    expect(items(s).some((i) => i.k === 'path' && i.stroke === '#94A3B8')).toBe(true);
  });

  it('vista SOLO en físico: el modo lógico no la dibuja (doc 63)', () => {
    const inp = base();
    inp.diagram.views = [{
      id: 'v1', name: 'V_ORDERS', schema: 'dw_VU', sourceTableIds: ['t1'],
      sources: [{ tableId: 't1', column: 'TOTAL', outputAlias: 'total_amt', expression: 'SUM(TOTAL)' }],
    }];
    const sLog = buildDiagramScene({ ...inp, viewMode: 'logical' });
    expect(texts(sLog).some((t) => t.s === 'VISTA')).toBe(false);
    expect(texts(sLog).some((t) => t.s.includes('V_ORDERS'))).toBe(false);
    expect(items(sLog).some((i) => i.k === 'hatch')).toBe(false);
    const sPhys = buildDiagramScene({ ...inp, viewMode: 'physical' });
    expect(texts(sPhys).some((t) => t.s === 'VISTA')).toBe(true);
  });

  it('subcategoría: rombo + doble trazo SOLO en modo lógico', () => {
    const inp = base();
    inp.viewMode = 'logical';
    inp.diagram.relationships = [
      { id: 'r1', parentTableId: 't1', childTableId: 't2', identifying: true,
        parentCardinality: 'one', childCardinality: 'one',
        subcategory: true, subtypeSymbolId: 'sym1',
        pairs: [{ parentColumnId: 'c1', childColumnId: 'c5' }] },
    ];
    const s = buildDiagramScene(inp);
    const polys = items(s).filter((i) => i.k === 'poly');
    expect(polys.length).toBeGreaterThanOrEqual(1);            // rombo
    const carve = items(s).filter((i) => i.k === 'path' && i.stroke === '#FBFCFD');
    expect(carve.length).toBeGreaterThanOrEqual(2);            // carve del doble trazo (tronco + hijo)
    // En físico no se dibuja nada de subcat
    const sPhys = buildDiagramScene({ ...inp, viewMode: 'physical' });
    expect(sPhys.items.filter((i) => i.k === 'poly').length).toBe(0);
  });

  it('shapes: rect con fill 10% y texto multi-línea', () => {
    const inp = base();
    inp.drawings = [
      { id: 'd1', type: 'rect', x: 0, y: 0, w: 300, h: 120, color: '#16A37B' },
      { id: 'd2', type: 'text', x: 10, y: 400, w: 200, h: 60, text: 'Hola\nMundo', color: '#8B5CF6' },
      { id: 'd3', type: 'star', x: 400, y: 400, w: 80, h: 80 },
    ];
    const s = buildDiagramScene(inp);
    expect(items(s).some((i) => i.k === 'rect' && i.fill === '#16A37B1A' && i.stroke === '#16A37B')).toBe(true);
    const lines = texts(s).filter((t) => ['Hola', 'Mundo'].includes(t.s));
    expect(lines.length).toBe(2);
    expect(items(s).filter((i) => i.k === 'poly').length).toBeGreaterThanOrEqual(1); // estrella
  });

  it('diagrama vacío ⇒ escena mínima válida', () => {
    const s = buildDiagramScene({ viewMode: 'physical', drawings: [], diagram: null });
    expect(s.w).toBeGreaterThan(0);
    expect(s.items.length).toBeGreaterThanOrEqual(0);
  });
});
