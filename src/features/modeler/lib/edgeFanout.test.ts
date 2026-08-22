import { describe, expect, it } from 'vitest';
import { fanSlots, fanSourceY, HEADER_H, ROW_H } from './edgeFanout';

describe('fanSlots', () => {
  it('agrupa por padre y ordena por Y del destino (desempate X, luego id)', () => {
    const slots = fanSlots([
      { id: 'a', parentId: 'P', targetY: 300, targetX: 0 },
      { id: 'b', parentId: 'P', targetY: 100, targetX: 0 },
      { id: 'c', parentId: 'P', targetY: 300, targetX: -50 },
      { id: 'z', parentId: 'OTRA', targetY: 0, targetX: 0 },
    ]);
    expect(slots.get('b')).toEqual({ slot: 0, count: 3 });
    expect(slots.get('c')).toEqual({ slot: 1, count: 3 });   // misma Y que 'a', X menor
    expect(slots.get('a')).toEqual({ slot: 2, count: 3 });
    expect(slots.get('z')).toEqual({ slot: 0, count: 1 });
  });
});

describe('fanSourceY', () => {
  it('reparte equiespaciado dentro de la zona de llave (header 32 + pkRows·28)', () => {
    // 2 PKs → zona = 32 + 56 = 88; 3 wires → paso 88/4 = 22
    expect(fanSourceY(1000, 400, 2, 0, 3)).toBe(1022);
    expect(fanSourceY(1000, 400, 2, 1, 3)).toBe(1044);
    expect(fanSourceY(1000, 400, 2, 2, 3)).toBe(1066);
  });
  it('la zona nunca excede el alto del nodo', () => {
    // 20 PKs → zona teórica 592 > alto 200 → usa 200
    expect(fanSourceY(0, 200, 20, 0, 1)).toBe(100);
  });
  it('espaciado < MIN_GAP → extiende la zona a todo el bloque', () => {
    // zona llave = 60 con 8 wires → paso 60/9 < 9 → zona = 300 → paso ~33.3
    expect(fanSourceY(0, 300, 1, 0, 8)).toBeCloseTo(300 / 9, 5);
  });
  it('constantes espejo de lodSize (32/28)', () => {
    expect(HEADER_H).toBe(32);
    expect(ROW_H).toBe(28);
  });
});
