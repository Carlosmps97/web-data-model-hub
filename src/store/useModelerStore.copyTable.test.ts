import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import { useModelerStore } from './useModelerStore';

// Clipboard de tabla: snapshot por valor y exclusión mutua con el clipboard de
// columnas. La orquestación del paste (pool global, lote, canvas) se cubre con
// las libs puras (copyTable.test) + tsc.
const DIAGRAM = {
  subjectArea: { id: 'sa1', name: 's', tableIds: ['t1'] },
  tables: [{ id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core', udpValues: { u: '1' } }],
  columns: [
    // Desordenadas a propósito: el snapshot debe salir en orden físico.
    { id: 'c2', tableId: 't1', physicalName: 'B', logicalName: 'b', dataType: 'INT', typeOverridden: false, ordinal: 1 },
    { id: 'c1', tableId: 't1', physicalName: 'A', logicalName: 'a', dataType: 'INT', typeOverridden: false, ordinal: 0, udpValues: { x: 'y' } },
  ],
  relationships: [],
} as never;

beforeEach(() => {
  useModelerStore.setState({
    diagram: JSON.parse(JSON.stringify(DIAGRAM)),
    colSel: null, colClipboard: null, tblClipboard: null,
  });
});

describe('useModelerStore.copyTable', () => {
  it('snapshotea tabla + columnas en orden físico y devuelve el físico', () => {
    const name = useModelerStore.getState().copyTable('t1');
    expect(name).toBe('M_CLIENTE');
    const clip = useModelerStore.getState().tblClipboard;
    expect(clip?.table.physicalName).toBe('M_CLIENTE');
    expect(clip?.cols.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('el snapshot es por valor: editar el diagrama después no lo altera', () => {
    useModelerStore.getState().copyTable('t1');
    const d = useModelerStore.getState().diagram!;
    d.tables[0].physicalName = 'MUTADO';
    d.columns[1].udpValues!.x = 'mutado';
    const clip = useModelerStore.getState().tblClipboard!;
    expect(clip.table.physicalName).toBe('M_CLIENTE');
    expect(clip.cols.find((c) => c.id === 'c1')?.udpValues).toEqual({ x: 'y' });
  });

  it('los clipboards son excluyentes en ambos sentidos', () => {
    // copiar tabla limpia el de columnas (y la selección de filas)…
    useModelerStore.setState({
      colClipboard: { source: { logicalName: 'x', physicalName: 'X' }, cols: [] },
      colSel: { tableId: 't1', ids: ['c1'], anchor: 'c1' },
    });
    useModelerStore.getState().copyTable('t1');
    expect(useModelerStore.getState().colClipboard).toBeNull();
    expect(useModelerStore.getState().colSel).toBeNull();
    // …y copiar columnas limpia el de tabla.
    useModelerStore.setState({ colSel: { tableId: 't1', ids: ['c1'], anchor: 'c1' } });
    expect(useModelerStore.getState().copySelectedColumns()).toBe(1);
    expect(useModelerStore.getState().tblClipboard).toBeNull();
    expect(useModelerStore.getState().colClipboard?.cols).toHaveLength(1);
  });

  it('tabla inexistente → null y sin clipboard', () => {
    expect(useModelerStore.getState().copyTable('nope')).toBeNull();
    expect(useModelerStore.getState().tblClipboard).toBeNull();
  });
});
