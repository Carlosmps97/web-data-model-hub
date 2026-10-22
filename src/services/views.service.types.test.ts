// Tipos de vistas (contrato compartido con el backend).
// Los literales tipados de abajo solo compilan (`tsc --noEmit`) si
// View/ViewInput/ViewSource/Diagram declaran estos campos: esa es la verificación;
// vitest solo confirma que los valores llegan enteros al runtime.
import { describe, expect, it } from 'vitest';
import type { View, ViewInput, ViewSource } from './views.service';
import type { Diagram } from '@/features/modeler/services/modeler.service';

const src: ViewSource = { column: 'ID', tableId: 't1', outputAlias: 'cid', castType: 'STRING', expression: 'UPPER(ID)' };
const v: View = {
  id: 'v1', name: 'v_cliente_cuenta',
  sourceTableIds: ['t1', 't2'],   // canónico; tableId = primera fuente
  tableId: 't1',
  showOnCanvas: true,             // global por vista; no afecta el export DDL
  sources: [src],
};
const body: ViewInput = { name: 'v', sourceTableIds: ['t1', 't2'], showOnCanvas: false };
// User-Defined SQL (verbatim) y UDPs de vista: la verificación es tsc (si compila,
// los tipos existen); vitest confirma el round-trip en runtime.
const custom: View = {
  id: 'v2', name: 'v_custom', tableId: 't1',
  customSql: 'CREATE VIEW s.v_custom AS SELEC ID FRM T',   // se guarda aunque no parsee
  sources: [{ column: 'ID', tableId: 't1' }],               // todas las columnas de la fuente
  udpValues: { 'udp-vt': 'Personalizada' },
};
const d: Pick<Diagram, 'views'> = { views: [v] };

describe('tipos de View/ViewInput/ViewSource/Diagram', () => {
  it('los literales tipados conservan sus campos', () => {
    expect(v.sourceTableIds).toEqual(['t1', 't2']);
    expect(v.showOnCanvas).toBe(true);
    expect(src.castType).toBe('STRING');
    expect(body.name).toBe('v');
    expect(d.views[0].id).toBe('v1');
  });

  it('customSql (verbatim) y udpValues viajan enteros', () => {
    expect(custom.customSql).toContain('SELEC ID FRM T');
    expect(custom.sources).toHaveLength(1);
    expect(custom.udpValues?.['udp-vt']).toBe('Personalizada');
  });
});
