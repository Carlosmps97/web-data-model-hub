import { describe, expect, it } from 'vitest';
import { applyFailed, applyLoaded, keyOf, markLoading, type CacheMap } from './diffDetailCache';
import type { DiffEntityDetail } from '@/types/versioning';

const ref = (c: string, e: string) => ({ collection: c, entityId: e });
const det = (c: string, e: string): DiffEntityDetail =>
  ({ collection: c, entityId: e, action: 'created', name: e, fields: [] });

describe('diffDetailCache (un fallo no puede verse como «Loading…»)', () => {
  it('markLoading no pisa lo ya resuelto', () => {
    const prev: CacheMap = { [keyOf('canonical_tables', 't1')]: det('canonical_tables', 't1') };
    const next = markLoading(prev, [ref('canonical_tables', 't1'), ref('canonical_columns', 'c1')]);
    expect(next[keyOf('canonical_tables', 't1')]).toBe(prev[keyOf('canonical_tables', 't1')]);
    expect(next[keyOf('canonical_columns', 'c1')]).toBe('loading');
  });

  it('markLoading SÍ pisa un error previo (reintentar vuelve a spinner)', () => {
    const k = keyOf('canonical_columns', 'c1');
    expect(markLoading({ [k]: 'error' }, [ref('canonical_columns', 'c1')])[k]).toBe('loading');
  });

  it('lo pedido que el backend no devuelve queda «missing», no «error»', () => {
    const chunk = [ref('canonical_tables', 't1'), ref('canonical_tables', 't2')];
    const next = applyLoaded(markLoading({}, chunk), chunk, [det('canonical_tables', 't1')]);
    expect(next[keyOf('canonical_tables', 't1')]).toEqual(det('canonical_tables', 't1'));
    expect(next[keyOf('canonical_tables', 't2')]).toBe('missing');
  });

  it('al fallar marca «error» — NUNCA borra (borrar = spinner eterno)', () => {
    const chunk = [ref('canonical_tables', 't1')];
    const next = applyFailed(markLoading({}, chunk), chunk);
    expect(next[keyOf('canonical_tables', 't1')]).toBe('error');
    expect(keyOf('canonical_tables', 't1') in next).toBe(true);
  });

  it('un fallo no descarta detalles que ya se habían resuelto', () => {
    const ok = keyOf('canonical_tables', 't1');
    const prev: CacheMap = { [ok]: det('canonical_tables', 't1') };
    const next = applyFailed(prev, [ref('canonical_tables', 't1'), ref('canonical_columns', 'c9')]);
    expect(next[ok]).toBe(prev[ok]);
    expect(next[keyOf('canonical_columns', 'c9')]).toBe('error');
  });
});
