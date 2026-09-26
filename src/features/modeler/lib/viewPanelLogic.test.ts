// Doc 61: helpers puros del panel de Properties de vista.
import { describe, expect, it } from 'vitest';
import { moveSource, reseedDraft } from './viewPanelLogic';
import type { ViewSource } from '@/services/views.service';

const srcs: ViewSource[] = [
  { column: 'A', tableId: 't1' },
  { column: 'B', tableId: 't1' },
  { column: 'C', tableId: 't2' },
];

describe('moveSource', () => {
  it('mueve hacia adelante y hacia atrás (índices post-remoción)', () => {
    expect(moveSource(srcs, 0, 2).map((s) => s.column)).toEqual(['B', 'C', 'A']);
    expect(moveSource(srcs, 2, 0).map((s) => s.column)).toEqual(['C', 'A', 'B']);
  });
  it('clampa fuera de rango y no muta el original', () => {
    const out = moveSource(srcs, 1, 99);
    expect(out.map((s) => s.column)).toEqual(['A', 'C', 'B']);
    expect(srcs.map((s) => s.column)).toEqual(['A', 'B', 'C']);
    expect(moveSource(srcs, -1, 0).map((s) => s.column)).toEqual(['A', 'B', 'C']);
  });
});

describe('reseedDraft (minor #10: la SQL cambió por fuera, p. ej. en el View Editor)', () => {
  it('sin cambios locales sin guardar, el borrador toma el texto nuevo', () => {
    expect(reseedDraft('SELECT 1', 'SELECT 1', 'SELECT 2')).toBe('SELECT 2');
    expect(reseedDraft('', null, 'SELECT 2')).toBe('SELECT 2');
  });
  it('con cambios locales sin guardar, se conservan', () => {
    expect(reseedDraft('mi texto', 'SELECT 1', 'SELECT 2')).toBe('mi texto');
  });
});
