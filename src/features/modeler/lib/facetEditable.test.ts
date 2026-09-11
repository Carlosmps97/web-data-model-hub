import { describe, expect, it } from 'vitest';
import { facetEditable } from './facetEditable';

describe('facetEditable (doc 85 §3.7)', () => {
  it('tabla: nombres por faceta, schema físico, definición compartida', () => {
    expect(facetEditable('table', 'logicalName', 'logical')).toBe(true);
    expect(facetEditable('table', 'logicalName', 'physical')).toBe(false);
    expect(facetEditable('table', 'physicalName', 'physical')).toBe(true);
    expect(facetEditable('table', 'physicalName', 'logical')).toBe(false);
    expect(facetEditable('table', 'schema', 'logical')).toBe(false);
    expect(facetEditable('table', 'description', 'logical')).toBe(true);
    expect(facetEditable('table', 'description', 'physical')).toBe(true);
  });
  it('columna: definición lógica vs comment físico, tipos y flags por faceta, llaves y dominio compartidos', () => {
    expect(facetEditable('column', 'description', 'logical')).toBe(true);
    expect(facetEditable('column', 'description', 'physical')).toBe(false);
    expect(facetEditable('column', 'physicalDescription', 'physical')).toBe(true);
    expect(facetEditable('column', 'physicalDescription', 'logical')).toBe(false);
    expect(facetEditable('column', 'logicalDataType', 'logical')).toBe(true);
    expect(facetEditable('column', 'dataType', 'logical')).toBe(false);
    expect(facetEditable('column', 'isNullable', 'logical')).toBe(false);
    expect(facetEditable('column', 'isPartition', 'physical')).toBe(true);
    expect(facetEditable('column', 'isPrimaryKey', 'logical')).toBe(true);
    expect(facetEditable('column', 'isForeignKey', 'physical')).toBe(true);
    expect(facetEditable('column', 'parentDomainId', 'logical')).toBe(true);
  });
});
