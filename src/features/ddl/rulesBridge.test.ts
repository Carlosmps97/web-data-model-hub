import { describe, expect, it } from 'vitest';
import { layoutFromRules, type ExportRule } from './rulesBridge';

const rule = (id: string, over: Partial<ExportRule> = {}): ExportRule => ({
  id, name: id, kind: 'rule', priority: 100, enabled: true, validationState: 'valid',
  appliesTo: ['ddl.tabla_fisica'], action: { layout: { partitionColumns: 'last' } }, ...over,
});

describe('layoutFromRules (doc 73)', () => {
  it('regla de layout seleccionada sobre la física ⇒ partitionsLast', () => {
    expect(layoutFromRules([rule('l1')], ['l1'])).toEqual({ partitionsLast: true });
  });
  it('no seleccionada, keep, otro artefacto o generador ⇒ false', () => {
    expect(layoutFromRules([rule('l1')], [])).toEqual({ partitionsLast: false });
    expect(layoutFromRules([rule('l1', { action: { layout: { partitionColumns: 'keep' } } })], ['l1'])).toEqual({ partitionsLast: false });
    expect(layoutFromRules([rule('l1', { appliesTo: ['ddl.tabla_rej'] })], ['l1'])).toEqual({ partitionsLast: false });
    expect(layoutFromRules([rule('l1', { kind: 'generator' })], ['l1'])).toEqual({ partitionsLast: false });
    expect(layoutFromRules([rule('t1', { action: { tags: { a: 'b' } } })], ['t1'])).toEqual({ partitionsLast: false });
  });
});
