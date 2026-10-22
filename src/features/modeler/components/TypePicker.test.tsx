// TypePicker: las cajas de argumentos aceptan texto (`VARCHAR(MAX)`,
// `VARCHAR2(30 CHAR)`, `NUMBER(*,2)`), no solo números.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TypePicker from './TypePicker';

describe('cajas de argumentos', () => {
  it('VARCHAR(MAX) muestra MAX en la caja del largo (caja de texto)', () => {
    const html = renderToStaticMarkup(<TypePicker value="VARCHAR(MAX)" onChange={() => {}} />);
    expect(html).toMatch(/<input[^>]*type="text"[^>]*placeholder="length"[^>]*value="MAX"/);
  });

  it('NUMBER(*,2): una caja por argumento', () => {
    const html = renderToStaticMarkup(<TypePicker value="NUMBER(*,2)" onChange={() => {}} />);
    expect(html).toMatch(/placeholder="precision"[^>]*value="\*"/);
    expect(html).toMatch(/placeholder="scale"[^>]*value="2"/);
  });
});
