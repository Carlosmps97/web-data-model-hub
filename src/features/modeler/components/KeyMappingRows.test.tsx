// El mapeo de llave del popup de relación (alta y Sync) y de subcategoría usa
// los nombres del modelo del canvas: en el lógico van los nombres lógicos
// (atributos), como en el canvas; en el físico, los físicos.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import KeyMappingRows, { type KeyRowState } from './KeyMappingRows';

const col = (id: string, logicalName: string, physicalName: string, tableId: string, pk = false): CanonicalColumn =>
  ({ id, tableId, logicalName, physicalName, dataType: 'STRING', typeOverridden: false, ordinal: 0, isPrimaryKey: pk });

const parentPks = [col('p1', 'Codigo Cliente', 'COD_CLI', 'tp', true), col('p2', 'Codigo Cuenta', 'COD_CTA', 'tp', true)];
const childCols = [col('c1', 'Codigo Cliente Hijo', 'COD_CLI_HIJO', 'tc'), col('c2', 'Codigo Cuenta Hijo', 'COD_CTA_HIJO', 'tc')];
const rows: KeyRowState[] = [
  { parentColumnId: 'p1', target: { kind: 'existing', columnId: 'c1' }, roleName: '', inherit: true },
  { parentColumnId: 'p2', target: { kind: 'existing', columnId: 'c2' }, roleName: '', inherit: true, locked: true },
];
const html = (mode: 'logical' | 'physical') =>
  renderToStaticMarkup(<KeyMappingRows parentPks={parentPks} childCols={childCols} rows={rows} onChange={() => {}} mode={mode} />);

describe('KeyMappingRows: nombres según el modelo del canvas', () => {
  it('lógico: atributos del padre y del hijo (también el par fijo del Sync)', () => {
    const out = html('logical');
    for (const n of ['Codigo Cliente', 'Codigo Cuenta', 'Codigo Cliente Hijo', 'Codigo Cuenta Hijo']) expect(out).toContain(n);
    for (const n of ['COD_CLI', 'COD_CTA']) expect(out).not.toContain(n);
  });
  it('físico: columnas', () => {
    const out = html('physical');
    for (const n of ['COD_CLI', 'COD_CTA', 'COD_CLI_HIJO', 'COD_CTA_HIJO']) expect(out).toContain(n);
    expect(out).not.toContain('Codigo Cliente Hijo');
  });
});

// Dos atributos del hijo con el mismo nombre lógico deben distinguirse; los
// textos usan el sustantivo de la faceta (atributo en el lógico); el nombre
// elegido, recortado, se lee entero en el tooltip.
describe('KeyMappingRows: repetidos, sustantivos y tooltip', () => {
  const dupChild = [col('c1', 'Codigo Cliente', 'COD_CLIENTE_ANT', 'tc'), col('c2', 'Codigo Cliente', 'COD_CLI', 'tc')];
  const dupRows: KeyRowState[] = [
    { parentColumnId: 'p1', target: { kind: 'existing', columnId: 'c1' }, roleName: '', inherit: true },
    { parentColumnId: 'p2', target: { kind: 'existing', columnId: 'c2' }, roleName: '', inherit: true, locked: true },
  ];
  it('lógico: los repetidos se distinguen por su físico (el elegido y el par fijo)', () => {
    const out = renderToStaticMarkup(<KeyMappingRows parentPks={parentPks} childCols={dupChild} rows={dupRows} onChange={() => {}} mode="logical" />);
    expect(out).toContain('Codigo Cliente (COD_CLIENTE_ANT)');
    expect(out).toContain('Codigo Cliente (COD_CLI)');
  });
  it('lógico: los textos dicen atributo; físico: columna', () => {
    const lo = html('logical');
    expect(lo).toContain('child attribute…');
    expect(lo).toContain('renames this attribute');
    expect(lo).toContain('from the parent attribute');
    expect(lo).not.toMatch(/\bcolumn\b/);
    const ph = html('physical');
    expect(ph).toContain('child column…');
    expect(ph).toContain('renames this column');
  });
  it('el nombre elegido, entero en el tooltip del selector', () => {
    expect(html('logical')).toContain('title="Codigo Cliente Hijo"');
    expect(html('physical')).toContain('title="COD_CLI_HIJO"');
  });
});
