import { describe, it, expect } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import { mappingToBulk } from './relationshipPairs';

const col = (id: string, tableId: string, name: string, over: Partial<CanonicalColumn> = {}): CanonicalColumn => ({
  id, tableId, logicalName: name.toLowerCase(), physicalName: name,
  dataType: 'STRING', ordinal: 0, ...over,
} as CanonicalColumn);

/** Doc 53: el lote de una SUBCATEGORÍA lleva la relación con `subcategory` y
 *  su símbolo, y migra la llave como identifying (PK del hijo). */
describe('mappingToBulk — variante subcategoría (doc 53)', () => {
  const parentPk = col('pk1', 'party', 'CODPARTY', { isPrimaryKey: true });

  it('marca la relación con subcategory + subtypeSymbolId', () => {
    const { changes, relationship, createdCols } = mappingToBulk({
      relId: 'rel-1', parentTableId: 'party', childTableId: 'individuo',
      identifying: true, parentCardinality: 'one', childCardinality: 'one',
      rows: [{ parentCol: parentPk, inherit: false,
        target: { kind: 'create', id: 'new-1', logicalName: 'codparty', physicalName: 'CODPARTY' } }],
      childCols: [],
      subcategory: { symbolId: 'sym-9' },
    });
    expect(relationship.subcategory).toBe(true);
    expect(relationship.subtypeSymbolId).toBe('sym-9');
    expect(relationship.identifying).toBe(true);
    expect(relationship.parentCardinality).toBe('one');
    expect(relationship.childCardinality).toBe('one');
    // la columna heredada entra como PK+FK del subtipo (semántica ES-UN)
    expect(createdCols[0]).toMatchObject({ isPrimaryKey: true, isForeignKey: true, isNullable: false });
    // el lote termina con el upsert de la relación (payload doc completo)
    const last = changes[changes.length - 1];
    expect(last.collection).toBe('relationships');
    expect(last.payload).toMatchObject({ subcategory: true, subtypeSymbolId: 'sym-9' });
  });

  it('sin `subcategory` el lote queda EXACTAMENTE como antes (sin campos nuevos)', () => {
    const { relationship } = mappingToBulk({
      relId: 'rel-2', parentTableId: 'party', childTableId: 'party_rol',
      identifying: false, parentCardinality: 'one', childCardinality: 'zero-many',
      rows: [{ parentCol: parentPk, inherit: false,
        target: { kind: 'create', id: 'new-2', logicalName: 'codparty', physicalName: 'CODPARTY' } }],
      childCols: [],
    });
    expect('subcategory' in relationship).toBe(false);
    expect('subtypeSymbolId' in relationship).toBe(false);
  });
});
