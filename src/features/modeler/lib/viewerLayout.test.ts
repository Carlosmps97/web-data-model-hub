import { describe, expect, it } from 'vitest';
import { effectiveLayout, liveLayout } from './viewerLayout';

describe('effectiveLayout (doc 84 E)', () => {
  it('sin overrides devuelve el layout publicado tal cual', () => {
    const persisted = { t1: { x: 1, y: 2 } };
    expect(effectiveLayout(persisted, undefined)).toBe(persisted);
    expect(effectiveLayout(persisted, {})).toBe(persisted);
    expect(effectiveLayout(undefined, undefined)).toEqual({});
  });

  it('los movimientos de la sesión pisan al publicado sin tocarlo', () => {
    const persisted = { t1: { x: 1, y: 2 }, t2: { x: 3, y: 4 } };
    const out = effectiveLayout(persisted, { t1: { x: 99, y: 99 } });
    expect(out).toEqual({ t1: { x: 99, y: 99 }, t2: { x: 3, y: 4 } });
    expect(persisted.t1).toEqual({ x: 1, y: 2 });
  });
});

// Doc 99: el export en EDICIÓN dibuja lo que está en pantalla. El diagrama del
// store guarda el layout de la última carga: mover una tabla graba su posición
// en el draft pero no refresca ese layout, y un trazo manual recién hecho sí
// está vivo — sin las posiciones vivas el export uniría el trazo nuevo con la
// tabla en su sitio viejo.
describe('liveLayout', () => {
  const nodes = [
    { id: 't1', type: 'table', position: { x: 10.4, y: 20.6 } },
    { id: 'v1', type: 'view', position: { x: 300, y: 40 } },
    { id: 'sym1', type: 'subcat', position: { x: 150, y: 90 } },
    { id: 'd1', type: 'shape', position: { x: 1, y: 1 } },
  ];

  it('las posiciones en pantalla de tablas, vistas y símbolos pisan las cargadas', () => {
    const persisted = { t1: { x: 0, y: 0 }, t2: { x: 500, y: 500 } };
    expect(liveLayout(persisted, nodes)).toEqual({
      t1: { x: 10, y: 21 }, t2: { x: 500, y: 500 }, v1: { x: 300, y: 40 }, sym1: { x: 150, y: 90 },
    });
    expect(persisted.t1).toEqual({ x: 0, y: 0 });                    // no muta
  });

  it('los dibujos (shapes) no son layout: sus posiciones viven en `drawings`', () => {
    expect(liveLayout({}, nodes)).not.toHaveProperty('d1');
  });

  it('sin nodos devuelve el layout cargado', () => {
    const persisted = { t1: { x: 1, y: 2 } };
    expect(liveLayout(persisted, [])).toEqual(persisted);
    expect(liveLayout(undefined, [])).toEqual({});
  });
});
