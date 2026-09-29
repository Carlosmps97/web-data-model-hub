import { describe, expect, it } from 'vitest';
import { buildDiagramScene, type SceneInput } from './exportScene';
import { STUB_BLOCK, roundedPath, routedGeometry } from './wireRoute';

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

describe('buildDiagramScene — etiqueta de relación (doc 98)', () => {
  type TextItem = Extract<SceneItem, { k: 'text' }>;
  type RectItem = Extract<SceneItem, { k: 'rect' }>;
  type Rel = FixtureInput['diagram']['relationships'][number];
  const SHORT = 'Orden tiene / es de una Orden';                      // 29 caracteres
  const withPhrases = (over: Partial<Rel> = {}, mutate?: (inp: FixtureInput) => void): FixtureInput => {
    const inp = base();
    Object.assign(inp.diagram.relationships[0], {
      parentToChildPhrase: 'Orden tiene', childToParentPhrase: 'es de una Orden', ...over,
    });
    mutate?.(inp);
    return inp;
  };
  /** Líneas de la etiqueta (texto centrado de 11px) y su fondo (el rect previo). */
  const labelOf = (scene: ReturnType<typeof buildDiagramScene>) => {
    const all = items(scene);
    const lines = all.filter((i): i is TextItem => i.k === 'text' && i.anchor === 'middle' && i.size === 11);
    const bg = lines.length ? all[all.indexOf(lines[0]) - 1] as RectItem : undefined;
    return { lines, bg, all };
  };

  it('las dos frases en UNA línea, centrada en el punto medio del wire', () => {
    const { lines } = labelOf(buildDiagramScene(withPhrases()));
    expect(lines.map((l) => l.s)).toEqual([SHORT]);
    // t1 → borde derecho x=60+240=300 · t2 → borde izquierdo x=560 ⇒ centro x=430.
    // salida y=60+(32+2·28)/2=104 · entrada y=154 (fila de c5) ⇒ centro y=129.
    expect(lines[0].x).toBe(430);
    expect(Math.abs(lines[0].y - 129)).toBeLessThanOrEqual(6);
  });

  it('lleva un fondo del color del canvas que tapa el wire bajo el texto', () => {
    const scene = buildDiagramScene(withPhrases());
    const { bg } = labelOf(scene);
    expect(bg!.k).toBe('rect');
    expect(bg!.fill).toBe(scene.bg);
    expect(bg!.x).toBeLessThan(430 - 60);                  // 29 caracteres ≈ 160px de texto
    expect(bg!.x + bg!.w).toBeGreaterThan(430 + 60);
    expect(bg!.y).toBeLessThan(129);
    expect(bg!.y + bg!.h).toBeGreaterThan(129);
  });

  it('va ENCIMA de todos los wires y DEBAJO de los bloques', () => {
    const { lines, all } = labelOf(buildDiagramScene(withPhrases()));
    const at = all.indexOf(lines[0]);
    const lastWire = Math.max(...all.map((i, idx) => (i.k === 'path' ? idx : -1)));
    const firstBlock = all.findIndex((i) => i.k === 'rect' && i.fill === '#1A2B4A');   // header navy
    expect(at).toBeGreaterThan(lastWire);
    expect(at).toBeLessThan(firstBlock);
  });

  it('bloques a 140px (auto-arrange): la etiqueta PARTE LÍNEA y deja libres la línea y los marcadores', () => {
    // t1 ocupa x=100..340 ⇒ t2 en x=480 deja un hueco de 140 (en escena: 300..440).
    const scene = buildDiagramScene(withPhrases({}, (inp) => { inp.diagram.subjectArea.layout.t2 = { x: 480, y: 220 }; }));
    const { lines, bg } = labelOf(scene);
    expect(lines.map((l) => l.s)).toEqual(['Orden tiene /', 'es de una', 'Orden']);
    expect(lines.every((l) => l.x === 370)).toBe(true);                  // todas centradas en el hueco
    expect(lines[1].y - lines[0].y).toBe(14);                            // interlineado
    expect(bg!.x).toBeGreaterThanOrEqual(300 + 28);                      // crow-foot del padre a la vista
    expect(bg!.x + bg!.w).toBeLessThanOrEqual(440 - 28);                 // crow-foot del hijo a la vista
    expect(bg!.h).toBeGreaterThanOrEqual(3 * 14);
  });

  it('hueco amplio pero frase larga: parte a lo más al ancho máximo (260)', () => {
    const scene = buildDiagramScene(withPhrases(
      { parentToChildPhrase: 'Detalle Motivo Party Negativo tiene Tipo Origen', childToParentPhrase: 'es el origen del Detalle Motivo' },
      (inp) => { inp.diagram.subjectArea.layout.t2 = { x: 1200, y: 220 }; }));
    const { lines, bg } = labelOf(scene);
    expect(lines.length).toBeGreaterThan(1);
    expect(bg!.w).toBeLessThanOrEqual(260);
    expect(lines.map((l) => l.s).join(' ')).toBe('Detalle Motivo Party Negativo tiene Tipo Origen / es el origen del Detalle Motivo');
  });

  it('relación RECURSIVA: la etiqueta va encima del propio bloque, no debajo de él', () => {
    const scene = buildDiagramScene(withPhrases({
      childTableId: 't1', identifying: false, pairs: [{ parentColumnId: 'c1', childColumnId: 'c3' }],
    }));
    const { lines, bg } = labelOf(scene);
    expect(lines.map((l) => l.s)).toEqual([SHORT]);
    const block = items(scene).find((i): i is RectItem => i.k === 'rect' && i.fill === '#1A2B4A')!;   // header de t1
    expect(lines[0].x).toBe(block.x + block.w / 2);                      // centrada sobre el bloque
    expect(bg!.y + bg!.h).toBeLessThanOrEqual(block.y);                  // todo el fondo queda ARRIBA
    expect(bg!.y).toBeGreaterThanOrEqual(0);
  });

  it('los límites de la escena incluyen la etiqueta (no sale cortada del export)', () => {
    // Recursiva con frases largas: varias líneas encima del bloque más alto del diagrama.
    const scene = buildDiagramScene(withPhrases({
      childTableId: 't1', identifying: false, pairs: [{ parentColumnId: 'c1', childColumnId: 'c3' }],
      parentToChildPhrase: 'Orden reemplaza a otra Orden emitida con anterioridad por el mismo cliente en la misma',
      childToParentPhrase: 'es reemplazada por una Orden posterior del mismo cliente cuando hay una correccion',
    }));
    const { lines, bg } = labelOf(scene);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(bg!.y).toBeGreaterThanOrEqual(0);
    expect(bg!.x).toBeGreaterThanOrEqual(0);
    expect(bg!.x + bg!.w).toBeLessThanOrEqual(scene.w);
    expect(bg!.y + bg!.h).toBeLessThanOrEqual(scene.h);
  });

  it('el texto lleva su factor de ancho para que el PDF lo centre bien', () => {
    const { lines } = labelOf(buildDiagramScene(withPhrases()));
    expect(lines[0].wf).toBe(0.5);
  });

  it('con una sola frase dibuja solo esa', () => {
    const { lines } = labelOf(buildDiagramScene(withPhrases({ parentToChildPhrase: null })));
    expect(lines.map((l) => l.s)).toEqual(['es de una Orden']);
  });

  it('relación sin frases: la escena no cambia', () => {
    expect(buildDiagramScene(withPhrases({ parentToChildPhrase: null, childToParentPhrase: '  ' })))
      .toEqual(buildDiagramScene(base()));
  });

  it('etiquetas ocultas en el canvas ⇒ el export sale sin ellas', () => {
    expect(buildDiagramScene({ ...withPhrases(), relLabels: false })).toEqual(buildDiagramScene(base()));
  });

  describe('subcategoría', () => {
    const sub = (over: Partial<Rel> = {}) => withPhrases({
      subcategory: true, subtypeSymbolId: 'sym1', identifying: true, parentCardinality: 'one', childCardinality: 'one', ...over,
    }, (inp) => { inp.viewMode = 'logical'; });

    it('la etiqueta va sobre la RAMA símbolo → subtipo, en su punto medio', () => {
      const scene = buildDiagramScene(sub());
      const { lines, bg } = labelOf(scene);
      expect(lines.map((l) => l.s).join(' ')).toBe(SHORT);
      const rombo = items(scene).find((i): i is Extract<SceneItem, { k: 'poly' }> => i.k === 'poly')!;
      const symX = Math.max(...rombo.pts.map(([x]) => x));                 // borde derecho del símbolo
      const childX = 560;                                                  // borde izquierdo de t2
      expect(lines[0].x).toBeGreaterThan(symX);
      expect(lines[0].x).toBeLessThan(childX);
      expect(bg!.fill).toBe(scene.bg);
    });

    it('va encima del doble trazo (ninguna línea la tacha) y debajo de los bloques', () => {
      const { lines, all } = labelOf(buildDiagramScene(sub()));
      const at = all.indexOf(lines[0]);
      const lastWire = Math.max(...all.map((i, idx) => (i.k === 'path' ? idx : -1)));
      const firstBlock = all.findIndex((i) => i.k === 'rect' && i.fill === '#1A2B4A');
      expect(at).toBeGreaterThan(lastWire);
      expect(at).toBeLessThan(firstBlock);
    });

    it('en el modelo FÍSICO la subcategoría no se dibuja: tampoco su etiqueta', () => {
      const scene = buildDiagramScene({ ...sub(), viewMode: 'physical' });
      expect(labelOf(scene).lines).toEqual([]);
    });

    it('respeta el botón de ocultar etiquetas', () => {
      const scene = buildDiagramScene({ ...sub(), relLabels: false });
      expect(labelOf(scene).lines).toEqual([]);
    });

    it('rama sin frases: sin etiqueta', () => {
      const scene = buildDiagramScene(sub({ parentToChildPhrase: null, childToParentPhrase: null }));
      expect(labelOf(scene).lines).toEqual([]);
    });
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

// ── Doc 99: trazos manuales de wires ───────────────────────────────────────
describe('buildDiagramScene — trazos manuales de wires (doc 99)', () => {
  type PathItem = Extract<SceneItem, { k: 'path' }>;
  type LineItem = Extract<SceneItem, { k: 'line' }>;
  type TextItem = Extract<SceneItem, { k: 'text' }>;
  type Point = { x: number; y: number };
  const INK = '#3A4658';
  const wiresOf = (s: ReturnType<typeof buildDiagramScene>) =>
    items(s).filter((i): i is PathItem => i.k === 'path' && i.stroke === INK && !i.fill);
  const routed = (routes: Record<string, unknown>, mutate?: (inp: FixtureInput) => void): FixtureInput => {
    const inp = base();
    (inp.diagram.subjectArea as { routes?: unknown }).routes = routes;
    mutate?.(inp);
    return inp;
  };
  const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

  // Fixture base: t1 (100,200) 240×116 · t2 (600,220) · origen de la escena = (40,140).
  // Wire r1: sale de t1 por y=244 (escena 104) y entra a t2 por y=294 (escena 154).

  it('sin trazos la escena es EXACTAMENTE la de siempre', () => {
    expect(buildDiagramScene(routed({}))).toEqual(buildDiagramScene(base()));
    const noKey = base();
    expect('routes' in noKey.diagram.subjectArea).toBe(false);
    expect(wiresOf(buildDiagramScene(noKey))).toHaveLength(1);
  });

  it('el wire sigue el trazo: un punto entre los bloques mueve el tramo vertical', () => {
    const [wire] = wiresOf(buildDiagramScene(routed({ r1: [{ x: 450, y: 250 }] })));
    // punto (450,250) del canvas = (410,110) de la escena
    expect(wire.d).toBe('M 300,104 L 400,104 Q 410,104 410,114 L 410,144 Q 410,154 420,154 L 560,154');
    expect(wire.dash).toBeUndefined();                                  // sigue siendo identifying
  });

  it('el camino automático del mismo wire es otro (el trazo SÍ cambia el dibujo)', () => {
    const auto = wiresOf(buildDiagramScene(base()))[0].d;
    const manual = wiresOf(buildDiagramScene(routed({ r1: [{ x: 450, y: 250 }] })))[0].d;
    expect(manual).not.toBe(auto);
  });

  it('los límites de la escena incluyen los puntos del trazo (no sale cortado)', () => {
    const plain = buildDiagramScene(base());
    // punto muy arriba y muy a la derecha de los dos bloques
    const scene = buildDiagramScene(routed({ r1: [{ x: 1200, y: -300 }] }));
    expect(scene.h).toBeGreaterThan(plain.h);
    expect(scene.w).toBeGreaterThan(plain.w);
    for (const w of wiresOf(scene)) {
      const n = numbers(w.d);
      expect(Math.min(...n)).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < n.length; i += 2) {
        expect(n[i]).toBeLessThanOrEqual(scene.w);
        expect(n[i + 1]).toBeLessThanOrEqual(scene.h);
      }
    }
    // el punto queda a 60 px (padding) del borde superior
    expect(numbers(wiresOf(scene)[0].d).filter((_, i) => i % 2 === 1).some((y) => y === 60)).toBe(true);
  });

  it('el lado lo decide el trazo: con el último punto a la derecha del hijo, entra por la derecha', () => {
    const scene = buildDiagramScene(routed({ r1: [{ x: 1000, y: 250 }] }));
    const [wire] = wiresOf(scene);
    const n = numbers(wire.d);
    const end = { x: n[n.length - 2], y: n[n.length - 1] };
    expect(end).toEqual({ x: 560 + 240, y: 154 });                       // borde DERECHO de t2
    // y la pata de gallo del hijo se dibuja hacia afuera de ese borde
    const foot = items(scene).filter((i): i is LineItem => i.k === 'line' && i.stroke === INK && i.y1 !== i.y2 || (i.k === 'line' && i.stroke === INK));
    expect(foot.some((l) => Math.min(l.x1, l.x2) >= 800 && Math.max(l.x1, l.x2) <= 822)).toBe(true);
  });

  it('la etiqueta va en el punto medio del camino trazado', () => {
    const inp = routed({ r1: [{ x: 450, y: 250 }] });
    Object.assign(inp.diagram.relationships[0], { parentToChildPhrase: 'Orden tiene' });
    const scene = buildDiagramScene(inp);
    const label = items(scene).find((i): i is TextItem => i.k === 'text' && i.s === 'Orden tiene')!;
    // camino: 110 horizontal + 50 vertical + 150 horizontal = 310 ⇒ mitad a 155:
    // cae en el tramo vertical (x=410), 45 px por debajo de la salida (y=104).
    expect(label.x).toBe(410);
    // centrada en y=149: fondo de 18 de alto (149−9) + padding 2 + línea base 10.5
    expect(label.y).toBe(149 - 9 + 2 + 10.5);
  });

  it('relación recursiva con trazo: la etiqueta sigue al trazo, no al bloque', () => {
    const inp = routed({ r1: [{ x: 500, y: 450 }] });
    Object.assign(inp.diagram.relationships[0], { childTableId: 't1', parentToChildPhrase: 'es jefe de',
      pairs: [{ parentColumnId: 'c1', childColumnId: 'c3' }] });
    const scene = buildDiagramScene(inp);
    const label = items(scene).find((i): i is TextItem => i.k === 'text' && i.s === 'es jefe de')!;
    const t1Top = 60;
    expect(label.y).toBeGreaterThan(t1Top + 116);                        // debajo del bloque, sobre el trazo
  });

  it('un trazo corrupto o de un wire que no existe se ignora: camino automático', () => {
    const auto = buildDiagramScene(base());
    expect(buildDiagramScene(routed({ r1: [{ x: 'a', y: 1 }], fantasma: [{ x: 1, y: 2 }] }))).toEqual(auto);
    expect(buildDiagramScene(routed('no soy un mapa' as never))).toEqual(auto);
  });

  it('con bloques en posiciones con fracción el camino es el del CANVAS, trasladado', () => {
    // t1 en (100.3, 200.7): el origen de la escena queda con fracción. El wire
    // se rutea en coordenadas del canvas (anclajes y puntos enteros) y recién
    // después se traslada; ruteado en las de la escena, el punto alineado con
    // la fila del padre quedaba a 0.3 px de ella y el tramo salía inclinado.
    const via = [{ x: 450, y: 245 }];
    const inp = routed({ r1: via }, (i) => { i.diagram.subjectArea.layout.t1 = { x: 100.3, y: 200.7 }; });
    const scene = buildDiagramScene(inp);
    const canvas = routedGeometry({
      sBox: { x: 100.3, w: 240 }, sy: 200.7 + 44, sStub: STUB_BLOCK,
      tBox: { x: 600, w: 240 }, ty: 294, tStub: STUB_BLOCK, via,
    });
    expect(canvas.corners).toEqual([{ x: 340, y: 245 }, { x: 450, y: 245 }, { x: 450, y: 294 }, { x: 600, y: 294 }]);
    const ox = 100.3 - 60, oy = 200.7 - 60;
    const [wire] = wiresOf(scene);
    expect(wire.d).toBe(roundedPath(canvas.corners.map((c) => ({ x: c.x - ox, y: c.y - oy }))));
    // el marcador del padre va donde arranca el camino, no en la fila sin redondear
    const bar = items(scene).find((i): i is LineItem => i.k === 'line' && i.stroke === INK && i.x1 === i.x2 && i.x1 < 320);
    expect((bar!.y1 + bar!.y2) / 2).toBeCloseTo(245 - oy, 6);
    expect(bar!.x1).toBeCloseTo(340 - ox + 6.5, 6);
  });

  it('el lado que cambia para no volver sobre sí también sale en el export', () => {
    // t2 justo debajo de t1 (misma X): con el punto entre los dos, forma de S.
    const inp = routed({ r1: [{ x: 220, y: 380 }] }, (i) => { i.diagram.subjectArea.layout.t2 = { x: 100, y: 440 }; });
    const scene = buildDiagramScene(inp);
    const n = numbers(wiresOf(scene)[0].d);
    // El trazo baja por x=72 (28 px a la izquierda de t2): el origen de la
    // escena es (12,140). Sale por la DERECHA de t1 (340 → 328) y entra por la
    // IZQUIERDA de t2 (100 → 88).
    expect({ x: n[0], y: n[1] }).toEqual({ x: 328, y: 104 });
    expect(n[n.length - 2]).toBe(88);
    expect(Math.min(...n.filter((_, i) => i % 2 === 0))).toBe(60);       // el tramo de más a la izquierda, a 60 del borde
  });

  it('`routes` de la entrada manda sobre el del canvas (trazos vivos del store)', () => {
    const inp = routed({ r1: [{ x: 450, y: 250 }] });
    const live = buildDiagramScene({ ...inp, routes: { r1: [{ x: 500, y: 250 }] } });
    expect(wiresOf(live)[0].d).toContain('Q 460,104');                   // vertical en x=500 (escena 460)
    // `{}` = sin trazos: camino automático
    expect(buildDiagramScene({ ...inp, routes: {} })).toEqual(buildDiagramScene(base()));
  });

  describe('subcategoría', () => {
    const CANVAS_BG = '#FBFCFD';
    const subcat = (routes: Record<string, Point[]>): FixtureInput => routed(routes, (inp) => {
      inp.viewMode = 'logical';
      inp.diagram.subjectArea.layout.sym1 = { x: 420, y: 230 };
      inp.diagram.relationships = [
        { id: 'r1', parentTableId: 't1', childTableId: 't2', identifying: true,
          parentCardinality: 'one', childCardinality: 'one',
          subcategory: true, subtypeSymbolId: 'sym1',
          pairs: [{ parentColumnId: 'c1', childColumnId: 'c5' }] },
      ] as never;
    });
    const doubles = (s: ReturnType<typeof buildDiagramScene>) =>
      items(s).filter((i): i is PathItem => i.k === 'path' && i.stroke === CANVAS_BG).map((p) => p.d);

    it('el TRONCO usa el trazo `subsym-{símbolo}` y la RAMA el de su relación', () => {
      const [autoTrunk, autoBranch] = doubles(buildDiagramScene(subcat({})));
      const [trunk, branch] = doubles(buildDiagramScene(subcat({ 'subsym-sym1': [{ x: 380, y: 300 }] })));
      expect(trunk).not.toBe(autoTrunk);
      expect(branch).toBe(autoBranch);
      const [trunk2, branch2] = doubles(buildDiagramScene(subcat({ r1: [{ x: 520, y: 300 }] })));
      expect(trunk2).toBe(autoTrunk);
      expect(branch2).not.toBe(autoBranch);
    });

    it('el trazo doble (color + carve) sigue el MISMO camino', () => {
      const scene = buildDiagramScene(subcat({ r1: [{ x: 520, y: 300 }] }));
      const branch = doubles(scene)[1];
      expect(items(scene).filter((i) => i.k === 'path' && i.d === branch)).toHaveLength(2);
    });

    it('en el modelo FÍSICO no se dibuja, con o sin trazo', () => {
      const phys = buildDiagramScene({ ...subcat({ r1: [{ x: 520, y: 300 }], 'subsym-sym1': [{ x: 380, y: 300 }] }), viewMode: 'physical' });
      expect(doubles(phys)).toEqual([]);
    });
  });
});
