import { describe, expect, it } from 'vitest';
import { effectiveLayout } from './viewerLayout';

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
