import { describe, expect, it } from 'vitest';
import { ACTION_LABEL, fieldValue, formatWhen, originText, refLabel, userLabel } from './history';

describe('history — presentación del historial de auditoría (doc 51)', () => {
  it('userLabel: nombre > email > id, y System para la entrada sintética', () => {
    expect(userLabel({ user: { id: 'u1', name: 'Ana P', email: 'a@x' }, synthetic: false })).toBe('Ana P');
    expect(userLabel({ user: { id: 'u1', email: 'a@x' }, synthetic: false })).toBe('a@x');
    expect(userLabel({ user: { id: 'u1' }, synthetic: false })).toBe('u1');
    expect(userLabel({ user: null, synthetic: true })).toBe('System (initial load)');
    expect(refLabel({ id: 'u2', name: null, email: 'rev@x' })).toBe('rev@x');
  });

  it('originText: migración, paste de tabla/columnas y CTAS', () => {
    expect(originText({ origin: { kind: 'migration' } })).toBe('Initial load — Erwin migration');
    expect(originText({ origin: { kind: 'paste-table', sourceTable: 'M_CLIENTE' } }))
      .toBe('Copied from table M_CLIENTE');
    expect(originText({ origin: { kind: 'paste-columns', sourceTable: 'M_CLIENTE', sourceColumn: 'ID_CLI' } }))
      .toBe('Copied from column M_CLIENTE.ID_CLI');
    expect(originText({ origin: { kind: 'ctas', sourceTable: 'M_SRC', sourceColumn: 'COD' } }))
      .toBe('Created from source M_SRC.COD (CTAS)');
    expect(originText({ origin: { kind: 'ctas' } })).toBe('Created from sources (CTAS)');
    expect(originText({ origin: null })).toBeNull();
  });

  it('fieldValue: vacíos, booleanos y contenedores', () => {
    expect(fieldValue(null)).toBe('—');
    expect(fieldValue('')).toBe('—');
    expect(fieldValue(true)).toBe('Yes');
    expect(fieldValue(false)).toBe('No');
    expect(fieldValue(0)).toBe('0');           // 0 es un valor real (pkPosition/ordinal)
    expect(fieldValue('BIGINT')).toBe('BIGINT');
    expect(fieldValue({ a: 1 })).toBe('{"a":1}');
  });

  it('formatWhen: inválidas → "—"; válidas → fecha · hora', () => {
    expect(formatWhen(null)).toBe('—');
    expect(formatWhen('no-es-fecha')).toBe('—');
    expect(formatWhen('2026-08-21T15:32:00Z')).toMatch(/2026 · \d{1,2}:\d{2}/);
  });

  it('ACTION_LABEL cubre las tres acciones', () => {
    expect(ACTION_LABEL).toEqual({ created: 'Created', edited: 'Edited', deleted: 'Deleted' });
  });
});
