// Doc 88 §2: la firma estructural del diagrama decide cuándo invalidar el
// catálogo del Explorer.
import { describe, it, expect } from 'vitest';
import { diagramSignature } from './diagramSignature';

const base = () => ({
  tables: [{ id: 't1', physicalName: 'CLIENTE', logicalName: 'Cliente', schema: 'ddv' }],
  columns: [{ tableId: 't1' }, { tableId: 't1' }],
  views: [{ id: 'v1', name: 'CLIENTE', schema: 'ddv_vu' }],
});

describe('diagramSignature', () => {
  it('es estable ante descripciones, layout u orden de las listas', () => {
    const a = base();
    const b = { ...base(), tables: [{ ...base().tables[0], description: 'x' } as never], columns: [...base().columns].reverse() };
    expect(diagramSignature(a)).toBe(diagramSignature(b));
    expect(diagramSignature(null)).toBe('');
  });

  it('cambia con tabla/vista nueva, borrada o renombrada y con el nº de columnas', () => {
    const a = diagramSignature(base());
    expect(diagramSignature({ ...base(), tables: [...base().tables, { id: 't2', physicalName: 'X' }] })).not.toBe(a);
    expect(diagramSignature({ ...base(), tables: [{ ...base().tables[0], physicalName: 'CLIENTE2' }] })).not.toBe(a);
    expect(diagramSignature({ ...base(), columns: [{ tableId: 't1' }] })).not.toBe(a);
    expect(diagramSignature({ ...base(), views: [] })).not.toBe(a);
    expect(diagramSignature({ ...base(), views: [{ id: 'v1', name: 'CLIENTE', schema: 'ddv_vu', customSql: 'select 1' }] })).not.toBe(a);
  });
});
