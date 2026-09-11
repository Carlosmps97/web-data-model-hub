// Doc 72 §3: helpers puros del Object Inspector.
import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, TableLinkRow } from '@/services/governance.service';
import {
  cardinalityLabel, facetName, facetOnly, facetType, keyLabel, linkRole, ownColumns, positionIn, primaryCanvas, tableDeleteImpact, usagePath,
} from './inspectorModel';

const col = (id: string, ordinal: number, extra: Partial<CanonicalColumn> = {}): CanonicalColumn => ({
  id, tableId: 't1', physicalName: `P_${id}`, logicalName: `L ${id}`, dataType: 'INT', typeOverridden: false, ordinal, ...extra,
});

describe('inspectorModel', () => {
  it('facetName / facetType con fallback entre facetas', () => {
    expect(facetName({ logicalName: 'Cliente', physicalName: 'M_CLIENTE' }, 'logical')).toBe('Cliente');
    expect(facetName({ logicalName: '', physicalName: 'M_CLIENTE' }, 'logical')).toBe('M_CLIENTE');
    expect(facetName({ logicalName: 'Cliente', physicalName: undefined }, 'physical')).toBe('Cliente');
    expect(facetType({ dataType: 'VARCHAR(30)', logicalDataType: 'VARCHAR(20)' }, 'logical')).toBe('VARCHAR(20)');
    expect(facetType({ dataType: 'VARCHAR(30)', logicalDataType: null }, 'logical')).toBe('VARCHAR(30)');
    expect(facetType({ dataType: 'VARCHAR(30)', logicalDataType: 'X' }, 'physical')).toBe('VARCHAR(30)');
  });

  it('positionIn sigue el orden de display canónico: bloque PK primero (doc 81)', () => {
    const cols = [col('a', 3), col('b', 1), col('c', 2)];
    expect(positionIn(cols, 'a')).toEqual({ pos: 3, of: 3 });
    expect(positionIn(cols, 'c')).toEqual({ pos: 2, of: 3 });
    expect(positionIn(cols, 'zzz')).toEqual({ pos: 0, of: 3 });
    // Tabla legacy (Excel pre-doc-81, ordinal no PK-first): el badge acompaña
    // a la lista — la PK se muestra 1.ª aunque su ordinal sea el último.
    const legacy = [col('x', 0), col('y', 1), col('pk', 2, { isPrimaryKey: true })];
    expect(positionIn(legacy, 'pk')).toEqual({ pos: 1, of: 3 });
    expect(positionIn(legacy, 'x')).toEqual({ pos: 2, of: 3 });
  });

  it('keyLabel / facetOnly', () => {
    const cols = [col('a', 1, { isPrimaryKey: true, pkPosition: 0 }), col('b', 2, { isPrimaryKey: true, pkPosition: 1, isForeignKey: true }), col('c', 3)];
    expect(keyLabel(cols[0], cols)).toBe('PK · #1 of 2 in the key');
    expect(keyLabel(cols[1], cols)).toBe('PK · #2 of 2 in the key · FK');
    expect(keyLabel(cols[2], cols)).toBe('—');
    expect(keyLabel(col('x', 1, { isPrimaryKey: true }), [col('x', 1, { isPrimaryKey: true })])).toBe('PK');
    expect(facetOnly({ logicalOnly: true })).toBe('logical');
    expect(facetOnly({ physicalOnly: true })).toBe('physical');
    expect(facetOnly({})).toBeNull();
  });

  it('relaciones: rótulo, rol y columnas propias', () => {
    const l: TableLinkRow = {
      id: 'r1', parentTableId: 'tP', parentTableName: 'PADRE', childTableId: 'tC', childTableName: 'HIJO',
      parentCardinality: 'one', childCardinality: 'zero-many', identifying: true,
      pairs: [
        { parentColumnId: 'p1', parentColumnName: 'ID', childColumnId: 'c1', childColumnName: 'ID_PADRE' },
        { parentColumnId: 'p2', parentColumnName: 'COD', childColumnId: 'c2', childColumnName: 'COD_PADRE' },
      ],
      canvases: [],
    };
    expect(cardinalityLabel(l)).toBe('1 : 0..N · identifying · 2 pairs');
    expect(linkRole(l, 'tP')).toBe('child');
    expect(linkRole(l, 'tC')).toBe('parent');
    expect(ownColumns(l, 'tP')).toEqual(['ID', 'COD']);
    expect(ownColumns(l, 'tC')).toEqual(['ID_PADRE', 'COD_PADRE']);
  });

  it('usagePath / primaryCanvas', () => {
    const a = { canvasId: 'a', canvas: 'Finanzas', project: 'DDV', folder: 'CPYBCA' };
    const b = { canvasId: 'b', canvas: 'Pricing', project: null, folder: null };
    expect(usagePath(a)).toBe('DDV › CPYBCA › Finanzas');
    expect(usagePath(b)).toBe('— › root › Pricing');
    expect(primaryCanvas([a, b], 'b')?.canvasId).toBe('b');
    expect(primaryCanvas([a, b], 'zzz')).toBeNull();
    expect(primaryCanvas([a], null)?.canvasId).toBe('a');
    expect(primaryCanvas([], 'a')).toBeNull();
  });
});

// Doc 89 §3.2: conteos del diálogo «Delete table…» del inspector, calculados
// del dossier ya cargado (sin re-consultar como hace Properties).
describe('tableDeleteImpact (doc 89)', () => {
  const link = (id: string, parent: string, child: string): TableLinkRow => ({
    id, parentTableId: parent, parentTableName: parent, childTableId: child, childTableName: child,
    parentCardinality: 'one', childCardinality: 'many', identifying: false, pairs: [], canvases: [],
  });

  it('cuenta canvases, tablas relacionadas ÚNICAS (sin la propia) y vistas', () => {
    const impact = tableDeleteImpact('t1', {
      usage: [{ canvasId: 'sa1' }, { canvasId: 'sa2' }],
      links: [link('r1', 't1', 'tB'), link('r2', 'tC', 't1'), link('r3', 't1', 'tB'), link('r4', 't1', 't1')],
      views: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
    });
    expect(impact).toEqual({ canvases: 2, related: 2, views: 3 });
  });

  it('todo vacío → ceros', () => {
    expect(tableDeleteImpact('t1', { usage: [], links: [], views: [] })).toEqual({ canvases: 0, related: 0, views: 0 });
  });
});
