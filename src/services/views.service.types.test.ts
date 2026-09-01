// Tipos F3 de vistas (10-PRECISIONES §3-5, contrato compartido F3).
// Los literales tipados de abajo NO compilan (`tsc --noEmit`) hasta que
// View/ViewInput/ViewSource/Diagram ganan los campos F3 — ese es el gate;
// vitest solo confirma que los valores llegan enteros al runtime.
import { describe, expect, it } from 'vitest';
import type { View, ViewInput, ViewSource } from './views.service';
import type { Diagram } from '@/features/modeler/services/modeler.service';

const src: ViewSource = { column: 'ID', tableId: 't1', outputAlias: 'cid', castType: 'STRING', expression: 'UPPER(ID)' };
const v: View = {
  id: 'v1', name: 'v_cliente_cuenta',
  sourceTableIds: ['t1', 't2'],   // canónico; tableId legacy = primera fuente
  tableId: 't1',
  showOnCanvas: true,             // D3: global por vista, NO afecta export DDL
  joinOverride: 't1.ID = t2.CLIENTE_ID',
  sources: [src],
};
const body: ViewInput = { name: 'v', sourceTableIds: ['t1', 't2'], showOnCanvas: false, joinOverride: undefined };
// Doc 61: modo Personalizada + UDPs de vista — el gate es tsc (compila = los
// tipos existen); vitest confirma round-trip runtime.
const custom: View = {
  id: 'v2', name: 'v_custom', tableId: 't1',
  customSql: 'WITH b AS (SELECT ID FROM T) SELECT ID FROM b',
  customColumns: [{ name: 'ID' }, { name: 'FOTO', expression: 'CURRENT_DATE()' }],
  udpValues: { 'udp-vt': 'Personalizada' },
};
const d: Pick<Diagram, 'views'> = { views: [v] };

describe('tipos F3 de View/ViewInput/ViewSource/Diagram', () => {
  it('los literales tipados conservan los campos F3', () => {
    expect(v.sourceTableIds).toEqual(['t1', 't2']);
    expect(v.showOnCanvas).toBe(true);
    expect(v.joinOverride).toBe('t1.ID = t2.CLIENTE_ID');
    expect(src.castType).toBe('STRING');
    expect(body.name).toBe('v');
    expect(d.views[0].id).toBe('v1');
  });

  it('los campos del doc 61 (customSql/customColumns/udpValues) viajan enteros', () => {
    expect(custom.customSql).toContain('WITH b AS');
    expect(custom.customColumns).toHaveLength(2);
    expect(custom.customColumns?.[1].expression).toBe('CURRENT_DATE()');
    expect(custom.udpValues?.['udp-vt']).toBe('Personalizada');
  });
});
