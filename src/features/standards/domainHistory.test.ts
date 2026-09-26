import { describe, expect, it } from 'vitest';
import { historyLines, revertForm } from './domainHistory';
import type { DomainHistoryEntry, SnapshotDomain } from './standards.service';

const st = (over: Partial<SnapshotDomain> = {}) => ({
  name: 'Codigo Clave', defaultDataType: 'INTEGER', logicalDataType: 'NUMBER', namingTerm: null,
  description: 'desc', inheritsName: false, physicalName: null, physicalDescription: null, udpValues: null, ...over,
});
const entry = (seq: number, state: ReturnType<typeof st> | null, changed: string[] = []): DomainHistoryEntry => ({
  seq, label: `v${seq}`, title: `t${seq}`, author: 'ana', createdAt: '2026-09-25T10:00:00Z', kind: 'domain', state, changed,
});

describe('historyLines (doc 95 D8)', () => {
  it('«antes → después» en campos cortos; «changed» en los largos', () => {
    const entries = [entry(3, st({ defaultDataType: 'UUID', description: 'otra' }), ['defaultDataType', 'description']), entry(1, st())];
    expect(historyLines(entries)).toEqual([['Physical type: INTEGER → UUID', 'Description changed'], ['Created']]);
  });
  it('borrado y restaurado', () => {
    expect(historyLines([entry(5, st()), entry(4, null), entry(1, st())])).toEqual([['Restored'], ['Deleted'], ['Created']]);
  });
});

describe('revertForm', () => {
  it('carga los valores de la versión y conserva el id', () => {
    const current: SnapshotDomain = { id: 'd1', ...st({ defaultDataType: 'UUID' }) };
    expect(revertForm(current, entry(1, st()))).toMatchObject({ id: 'd1', defaultDataType: 'INTEGER', logicalDataType: 'NUMBER' });
  });
  it('sin tipo lógico en la versión conserva el actual: el formulario muestra lo que de verdad queda (final review #10)', () => {
    const current: SnapshotDomain = { id: 'd1', ...st({ logicalDataType: 'NUMBER' }) };
    expect(revertForm(current, entry(1, st({ logicalDataType: null })))).toMatchObject({ logicalDataType: 'NUMBER' });
  });
  it('una descripción vacía en la versión queda vacía (el apply la limpia)', () => {
    const current: SnapshotDomain = { id: 'd1', ...st({ description: 'agregada después' }) };
    expect(revertForm(current, entry(1, st({ description: null }))).description).toBeNull();
  });
});
