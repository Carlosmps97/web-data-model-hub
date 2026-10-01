// Grilla de resultados del Report Designer (doc 105, ronda 5): la UI va en
// inglés — la barra decía «1 fila · 1 columnas» y «cargando…».
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../query.service';
import ResultsGrid from './ResultsGrid';

const result = (rows: number, columns: number, hasMore = false): QueryResult => ({
  rows: Array.from({ length: rows }, (_, i) => ({ c0: `v${i}` })),
  columns: Array.from({ length: columns }, (_, i) => ({ key: `c${i}`, label: `C${i}` })),
  nextCursor: hasMore ? 'next' : null, hasMore, meta: { grouped: false, warnings: [] },
});
const bar = (r: QueryResult, loading = false) =>
  renderToStaticMarkup(<ResultsGrid result={r} loading={loading} onLoadMore={() => {}} />).replace(/<!-- -->/g, '');

describe('barra de la grilla en inglés', () => {
  it('singular y plural de filas y columnas', () => {
    expect(bar(result(1, 1))).toContain('1 row · 1 column<');
    expect(bar(result(2, 3, true))).toContain('2 rows+ · 3 columns');
    expect(bar(result(0, 2))).toContain('0 rows · 2 columns');
  });

  it('«loading…» mientras corre', () => {
    const html = bar(result(1, 1), true);
    expect(html).toContain(' · loading…');
    expect(html).not.toMatch(/fila|columnas|cargando/);
  });
});

describe('encabezados que se pueden ordenar (doc 105, ronda 5)', () => {
  it('sólo los que `canSort` permite parecen clicables', () => {
    const r: QueryResult = { ...result(1, 2), columns: [{ key: 'physicalName', label: 'Physical name' }, { key: 'dataType', label: 'Data type' }] };
    const html = renderToStaticMarkup(
      <ResultsGrid result={r} loading={false} onLoadMore={() => {}} onSort={() => {}} canSort={(k) => k === 'physicalName'} />,
    );
    const head = (label: string) => new RegExp(`<(?:div|button)[^>]*style="[^"]*cursor:(\\w+)[^"]*"[^>]*>${label}<`).exec(html)?.[1];
    expect(head('Physical name')).toBe('pointer');
    expect(head('Data type')).toBe('default');
  });
});

// Doc 105 (ronda 6, R17b): los encabezados ordenables eran <div> con onClick:
// no se podía ordenar con el teclado ni el lector de pantalla los anunciaba.
describe('ordenar con el teclado (doc 105, ronda 6)', () => {
  it('un encabezado ordenable es un botón con nombre (y el orden actual); uno que no, no', () => {
    const r: QueryResult = { ...result(1, 2), columns: [{ key: 'physicalName', label: 'Physical name' }, { key: 'dataType', label: 'Data type' }] };
    const html = renderToStaticMarkup(
      <ResultsGrid result={r} loading={false} onLoadMore={() => {}} onSort={() => {}} canSort={(k) => k === 'physicalName'}
        sort={{ field: 'physicalName', dir: 'asc' }} />,
    );
    expect(html).toMatch(/<button[^>]*aria-label="Sort by Physical name \(sorted ascending\)"/);
    expect(html).not.toMatch(/<button[^>]*Sort by Data type/);
  });
});

// Doc 105 (ronda 7, R18b): con un Run en vuelo el encabezado seguía como <div>
// (el <button> se remontaba y el foco del teclado caía a <body>).
describe('encabezado ordenable con un Run en vuelo (doc 105, ronda 7)', () => {
  it('sigue siendo el mismo botón, con aria-disabled', () => {
    const r: QueryResult = { ...result(1, 1), columns: [{ key: 'physicalName', label: 'Physical name' }] };
    const html = renderToStaticMarkup(
      <ResultsGrid result={r} loading onLoadMore={() => {}} onSort={() => {}} canSort={() => true} sortDisabled />,
    );
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-label="Sort by Physical name"|<button[^>]*aria-label="Sort by Physical name"[^>]*aria-disabled="true"/);
  });
});
