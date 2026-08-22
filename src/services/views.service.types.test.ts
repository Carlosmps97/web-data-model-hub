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
});
