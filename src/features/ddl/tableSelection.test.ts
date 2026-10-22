import { describe, expect, it } from 'vitest';
import { pickedTableIds } from './tableSelection';

describe('pickedTableIds — «Tables to export»', () => {
  it('sin una elección explícita no hay ninguna tabla elegida', () => {
    expect([...pickedTableIds(null, ['a', 'b'])]).toEqual([]);
  });
  it('una elección conserva solo las tablas que siguen en el canvas', () => {
    expect([...pickedTableIds(new Set(['a', 'x']), ['a', 'b'])]).toEqual(['a']);
    expect([...pickedTableIds(new Set(['a', 'b']), ['a', 'b'])]).toEqual(['a', 'b']);
  });
});
