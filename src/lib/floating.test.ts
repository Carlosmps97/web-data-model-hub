// Doc 113 §5 — regla única de las ventanas flotantes (tooltips, menús, popovers):
// flip (lado opuesto si no entra), shift (se corre para quedar dentro, con
// margen) y size (alto máximo con scroll si no entra en ningún lado).
import { describe, expect, it, vi } from 'vitest';
import { contentBounds, intersectRects, outside, placeAnchored, placeAtPoint, placeBeside, placeNextTo, viewportBounds } from './floating';

const VP = { left: 0, top: 0, right: 1000, bottom: 800 };
const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

describe('placeNextTo — junto a un ancla (tooltip, menú de un botón)', () => {
  it('con espacio, abre del lado pedido (abajo) alineado al inicio del ancla', () => {
    const p = placeNextTo(rect(100, 100, 40, 20), { width: 200, height: 120 }, VP, { gap: 6 });
    expect(p).toEqual({ left: 100, top: 126, side: 'bottom', maxHeight: null });
  });

  it('flip: sin lugar abajo y con lugar arriba, abre ARRIBA del ancla (menú del Explorer en la última fila)', () => {
    const p = placeNextTo(rect(100, 760, 40, 20), { width: 200, height: 160 }, VP, { gap: 2 });
    expect(p.side).toBe('top');
    expect(p.top).toBe(760 - 2 - 160);
    expect(p.maxHeight).toBeNull();
  });

  it('shift: centrado sobre un ancla pegada al borde izquierdo, se corre para no cortarse (tooltip de «Logical»)', () => {
    const p = placeNextTo(rect(4, 40, 60, 24), { width: 300, height: 24 }, VP, { align: 'center', gap: 6 });
    expect(p.left).toBe(8);                       // margen de 8 px, no −116
    expect(p.top).toBe(70);
  });

  it('shift: tampoco se sale por la derecha', () => {
    const p = placeNextTo(rect(960, 40, 30, 24), { width: 240, height: 24 }, VP, { align: 'center' });
    expect(p.left).toBe(1000 - 8 - 240);
  });

  it('size: si no entra arriba ni abajo, toma el lado con más espacio y limita el alto (scroll interno)', () => {
    const p = placeNextTo(rect(100, 300, 40, 20), { width: 200, height: 900 }, VP, { gap: 4 });
    expect(p.side).toBe('bottom');                // abajo: 800−8−324 = 468 > arriba: 296−8 = 288
    expect(p.top).toBe(324);
    expect(p.maxHeight).toBe(468);
  });

  it('size del lado de arriba: queda pegado al margen superior', () => {
    const p = placeNextTo(rect(100, 600, 40, 20), { width: 200, height: 900 }, VP, { gap: 4 });
    expect(p.side).toBe('top');
    expect(p.maxHeight).toBe(600 - 4 - 8);
    expect(p.top).toBe(8);
  });

  it('pedido arriba con lugar: respeta el lado pedido', () => {
    const p = placeNextTo(rect(100, 400, 40, 20), { width: 100, height: 50 }, VP, { side: 'top', gap: 6 });
    expect(p).toEqual({ left: 100, top: 344, side: 'top', maxHeight: null });
  });

  it('align end: el borde derecho del cuadro coincide con el del ancla', () => {
    const p = placeNextTo(rect(500, 100, 40, 20), { width: 200, height: 50 }, VP, { align: 'end' });
    expect(p.left).toBe(340);
  });

  it('lado derecho (flyout): abre a la derecha; si no entra, a la izquierda del ancla', () => {
    expect(placeNextTo(rect(100, 100, 120, 30), { width: 180, height: 200 }, VP, { side: 'right', gap: 4 }))
      .toEqual({ left: 224, top: 100, side: 'right', maxHeight: null });
    const flip = placeNextTo(rect(800, 100, 120, 30), { width: 180, height: 200 }, VP, { side: 'right', gap: 4 });
    expect(flip.side).toBe('left');
    expect(flip.left).toBe(800 - 4 - 180);
  });

  it('lado derecho: se corre hacia arriba para no salirse por abajo, y limita el alto si no entra', () => {
    const p = placeNextTo(rect(100, 700, 120, 30), { width: 180, height: 300 }, VP, { side: 'right' });
    expect(p.top).toBe(800 - 8 - 300);
    const tall = placeNextTo(rect(100, 100, 120, 30), { width: 180, height: 2000 }, VP, { side: 'right' });
    expect(tall.top).toBe(8);
    expect(tall.maxHeight).toBe(800 - 16);
  });

  it('siempre devuelve enteros (sin medio píxel borroso)', () => {
    const p = placeNextTo(rect(10.4, 10.6, 33.3, 20.2), { width: 99.5, height: 40.7 }, VP, { align: 'center' });
    expect(Number.isInteger(p.left) && Number.isInteger(p.top)).toBe(true);
  });
});

describe('placeAtPoint — menú contextual en el cursor', () => {
  it('con espacio, abre abajo a la derecha del cursor', () => {
    expect(placeAtPoint({ x: 300, y: 200 }, { width: 200, height: 150 }, VP))
      .toEqual({ left: 300, top: 200, side: 'bottom', maxHeight: null });
  });

  it('cerca del borde derecho, abre a la IZQUIERDA del cursor', () => {
    const p = placeAtPoint({ x: 950, y: 200 }, { width: 200, height: 150 }, VP);
    expect(p.left).toBe(750);
  });

  it('cerca del borde inferior, abre HACIA ARRIBA del cursor', () => {
    const p = placeAtPoint({ x: 300, y: 780 }, { width: 200, height: 150 }, VP);
    expect(p.top).toBe(630);
    expect(p.side).toBe('top');
  });

  it('esquina inferior derecha: arriba y a la izquierda', () => {
    expect(placeAtPoint({ x: 990, y: 790 }, { width: 200, height: 150 }, VP))
      .toEqual({ left: 790, top: 640, side: 'top', maxHeight: null });
  });

  it('si no entra ni arriba ni abajo pero sí en la ventana, se corre hasta entrar', () => {
    const p = placeAtPoint({ x: 300, y: 400 }, { width: 200, height: 600 }, VP);
    expect(p.top).toBe(800 - 8 - 600);
    expect(p.maxHeight).toBeNull();
  });

  it('más alto que la ventana: pegado arriba con alto máximo', () => {
    const p = placeAtPoint({ x: 300, y: 400 }, { width: 200, height: 2000 }, VP);
    expect(p.top).toBe(8);
    expect(p.maxHeight).toBe(784);
  });

  it('más ancho que el espacio a ambos lados: se corre dentro del margen', () => {
    const p = placeAtPoint({ x: 500, y: 100 }, { width: 700, height: 100 }, VP);
    expect(p.left).toBe(1000 - 8 - 700);
  });
});

describe('placeAtPoint — margen (revisión doc 113)', () => {
  it('con el cursor dentro del margen, el menú igual queda a 8 px del borde', () => {
    expect(placeAtPoint({ x: 3, y: 3 }, { width: 200, height: 150 }, VP)).toMatchObject({ left: 8, top: 8 });
  });
});

describe('intersectRects — área donde puede vivir un desplegable', () => {
  it('la ventana recortada por los contenedores con scroll del control', () => {
    expect(intersectRects([VP, { left: 100, top: 50, right: 700, bottom: 600 }, { left: 0, top: 120, right: 900, bottom: 2000 }]))
      .toEqual({ left: 100, top: 120, right: 700, bottom: 600 });
  });
  it('sin intersección: un área vacía (ancho o alto 0)', () => {
    const r = intersectRects([{ left: 0, top: 0, right: 10, bottom: 10 }, { left: 20, top: 20, right: 30, bottom: 30 }]);
    expect(r.right <= r.left || r.bottom <= r.top).toBe(true);
  });
});

describe('outside — el control salió de su contenedor con scroll', () => {
  const clip = { left: 100, top: 100, right: 500, bottom: 400 };
  it('fuera por completo (arriba, abajo, a los costados) → true; asomando o adentro → false', () => {
    expect(outside(rect(150, 40, 100, 50), clip)).toBe(true);     // termina justo en el borde superior
    expect(outside(rect(150, 400, 100, 30), clip)).toBe(true);
    expect(outside(rect(20, 200, 60, 30), clip)).toBe(true);
    expect(outside(rect(150, 80, 100, 30), clip)).toBe(false);    // asoma 10 px
    expect(outside(rect(150, 200, 100, 30), clip)).toBe(false);
  });
});

describe('viewportBounds', () => {
  it('sin ventana (tests en node) devuelve un área vacía en el origen', () => {
    expect(viewportBounds()).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

// Ronda 2 de la revisión: el desplegable de un control dentro de paneles con
// scroll (editor de reglas DDL, filtros de Reporting) se UBICA en la ventana —
// limitado al medio panel quedaba de 60 px en ventanas bajas — y el recorte de
// sus paneles sólo decide si se oculta (el control salió de la vista).
describe('placeAnchored — desplegable de un control dentro de paneles con scroll', () => {
  const viewport = { left: 0, top: 0, right: 1440, bottom: 600 };
  const panel = { left: 300, top: 330, right: 860, bottom: 600 };      // medio panel bajo
  const input = { left: 320, top: 420, right: 840, bottom: 460 };
  it('con el control a la vista, usa la ventana: el desplegable entero, arriba si abajo no entra', () => {
    const at = placeAnchored(input, panel, { width: 520, height: 347 }, viewport, { side: 'bottom', gap: 6 });
    expect(at).toEqual({ left: 320, top: 420 - 6 - 347, side: 'top', maxHeight: null });
  });
  it('con el control fuera de la vista de su panel (scroll), se oculta', () => {
    const gone = { left: 320, top: 280, right: 840, bottom: 320 };
    expect(placeAnchored(gone, panel, { width: 520, height: 347 }, viewport, { side: 'bottom', gap: 6 })).toBeNull();
  });
});

// Ronda 3 de la revisión: la barra superior de la app (`.dmh-topnav`, z-index 40)
// queda por encima de los desplegables del contenido (z-index 30): abiertos hacia
// arriba en ventanas bajas se escondían debajo de ella.
describe('contentBounds — la ventana sin la barra superior de la app', () => {
  const viewport = { left: 0, top: 0, right: 1440, bottom: 650 };
  const withBar = (bottom: number | null) => vi.stubGlobal('document', {
    querySelector: (sel: string) => (sel === '.dmh-topnav' && bottom !== null ? { getBoundingClientRect: () => ({ bottom }) } : null),
  });
  it('el área empieza debajo de la barra', () => {
    withBar(52);
    try { expect(contentBounds(viewport)).toEqual({ ...viewport, top: 52 }); } finally { vi.unstubAllGlobals(); }
  });
  it('sin barra, o con la barra fuera de la vista, el área es la ventana', () => {
    withBar(null);
    try { expect(contentBounds(viewport)).toEqual(viewport); } finally { vi.unstubAllGlobals(); }
    withBar(-10);
    try { expect(contentBounds(viewport)).toEqual(viewport); } finally { vi.unstubAllGlobals(); }
  });
  it('con ese área, un desplegable que abre hacia arriba no pasa por debajo de la barra', () => {
    const input = { left: 24, top: 394, right: 696, bottom: 434 };
    const at = placeAnchored(input, { left: 0, top: 202, right: 720, bottom: 572 }, { width: 672, height: 347 }, { ...viewport, top: 52 }, { side: 'bottom', gap: 6 })!;
    expect(at.top).toBeGreaterThanOrEqual(52);
  });
});

// Revisión 2 doc 114 (barra, O2): el tooltip a la derecha de una herramienta de un
// menú de lista, en una ventana angosta, no entraba ni a la derecha ni a la
// izquierda — se corría encima de su propio botón y tapaba su nombre.
describe('placeBeside — al costado, y si no entra en ninguno, abajo', () => {
  const bounds = { left: 0, top: 0, right: 760, bottom: 600 };
  const box = { width: 300, height: 30 };
  it('entra a la derecha: a la derecha', () => {
    const anchor = { left: 100, top: 200, right: 300, bottom: 234 };
    expect(placeBeside(anchor, box, bounds, { side: 'right', align: 'center', gap: 6 }).side).toBe('right');
  });
  it('no entra a la derecha pero sí a la izquierda: a la izquierda', () => {
    const anchor = { left: 400, top: 200, right: 600, bottom: 234 };
    expect(placeBeside(anchor, box, bounds, { side: 'right', align: 'center', gap: 6 }).side).toBe('left');
  });
  it('no entra en ningún costado: abajo, sin tapar el botón', () => {
    const anchor = { left: 220, top: 200, right: 520, bottom: 234 };
    const p = placeBeside(anchor, box, bounds, { side: 'right', align: 'center', gap: 6 });
    expect(p.side).toBe('bottom');
    expect(p.top).toBeGreaterThanOrEqual(anchor.bottom);
  });
});
