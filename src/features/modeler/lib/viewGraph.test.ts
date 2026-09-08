// Armado puro de nodos 'view' + edges 'derivation' (F3, contrato compartido:
// id `deriv__{viewId}__{tableId}`, handles __hdr_src/__hdr_tgt, posición en
// layout[viewId] o default junto a la primera fuente: x+280, misma y).
import { describe, expect, it } from 'vitest';
import { buildViewGraph, viewNodeRows, viewSourceIds } from './viewGraph';
import type { View } from '@/services/views.service';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';

const tables: CanonicalTable[] = [
  { id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente' },
  { id: 't2', physicalName: 'CUENTA', logicalName: 'Cuenta' },
];
const columns: CanonicalColumn[] = [
  { id: 'c1', tableId: 't1', physicalName: 'ID', logicalName: 'Id', dataType: 'bigint', typeOverridden: false, ordinal: 0 },
];
const view: View = {
  id: 'v1', name: 'v_cc', sourceTableIds: ['t1', 't2'], showOnCanvas: true,
  sources: [
    { column: 'ID', tableId: 't1' },
    { column: 'SALDO', tableId: 't2', castType: 'STRING', outputAlias: 'saldo_txt' },
    { expression: 'CURRENT_DATE()', outputAlias: 'foto' },
  ],
};
const pos = new Map([['t1', { x: 100, y: 50 }], ['t2', { x: 500, y: 50 }]]);
const noop = () => {};

describe('viewSourceIds', () => {
  it('canónico con fallback al tableId legacy', () => {
    expect(viewSourceIds(view)).toEqual(['t1', 't2']);
    expect(viewSourceIds({ id: 'v', name: 'v', tableId: 't9' })).toEqual(['t9']);
    expect(viewSourceIds({ id: 'v', name: 'v' })).toEqual([]);
  });
});

describe('viewNodeRows', () => {
  it('vista Personalizada (doc 61): filas desde customColumns, fx = expresión', () => {
    const rows = viewNodeRows({
      ...view,
      customSql: 'SELECT ID, CURRENT_DATE() AS foto FROM t',
      customColumns: [{ name: 'ID' }, { name: 'foto', expression: 'CURRENT_DATE()' }],
    }, { 't1::ID': 'bigint' });
    expect(rows).toEqual([
      { name: 'ID', type: '', fx: false },
      { name: 'foto', type: '', fx: true },
    ]);
  });

  it('customSql vacío ⇒ camino Regular (sources)', () => {
    const rows = viewNodeRows({ ...view, customSql: '  ', customColumns: [{ name: 'zombi' }] }, { 't1::ID': 'bigint' });
    expect(rows[0]).toEqual({ name: 'ID', type: 'bigint', fx: false });
  });

  it('outputAlias||column + castType||tipo origen + marca fx', () => {
    const rows = viewNodeRows(view, { 't1::ID': 'bigint' });
    expect(rows[0]).toEqual({ name: 'ID', type: 'bigint', fx: false });
    expect(rows[1]).toEqual({ name: 'saldo_txt', type: 'STRING', fx: true });
    expect(rows[2]).toEqual({ name: 'foto', type: '', fx: true });
  });
});

describe('buildViewGraph', () => {
  it('usa layout[viewId] cuando existe', () => {
    const { nodes } = buildViewGraph([view], tables, columns, { v1: { x: 9, y: 9 } }, pos, noop);
    expect(nodes[0].position).toEqual({ x: 9, y: 9 });
  });

  it('default: junto a la primera fuente presente (x+280, misma y)', () => {
    const { nodes } = buildViewGraph([view], tables, columns, {}, pos, noop);
    expect(nodes[0].type).toBe('view');
    expect(nodes[0].position).toEqual({ x: 380, y: 50 });
  });

  it('un edge derivation por fuente PRESENTE — contrato de ids y handles', () => {
    const { edges } = buildViewGraph([view], tables, columns, {}, pos, noop);
    expect(edges).toEqual([
      { id: 'deriv__v1__t1', source: 't1', target: 'v1', sourceHandle: '__hdr_src', targetHandle: '__hdr_tgt', type: 'derivation' },
      { id: 'deriv__v1__t2', source: 't2', target: 'v1', sourceHandle: '__hdr_src', targetHandle: '__hdr_tgt', type: 'derivation' },
    ]);
  });

  it('fuente ausente del canvas ⇒ sin su edge; vista sin NINGUNA fuente presente ⇒ sin nodo', () => {
    const onlyT1 = new Map([['t1', { x: 0, y: 0 }]]);
    expect(buildViewGraph([view], tables, columns, {}, onlyT1, noop).edges).toHaveLength(1);
    expect(buildViewGraph([view], tables, columns, {}, new Map(), noop).nodes).toHaveLength(0);
  });

  it('data del nodo: view + sourceTables resueltas + colTypes + onEdit', () => {
    const { nodes } = buildViewGraph([view], tables, columns, {}, pos, noop);
    const data = nodes[0].data as { sourceTables: { physicalName: string }[]; colTypes: Record<string, string>; onEdit: unknown };
    expect(data.sourceTables.map((t) => t.physicalName)).toEqual(['CLIENTE', 'CUENTA']);
    expect(data.colTypes['t1::ID']).toBe('bigint');
    expect(data.onEdit).toBe(noop);
  });
});
