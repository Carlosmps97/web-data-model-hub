import { describe, expect, it } from 'vitest';
import { buildInteractiveHtml, escapeHtml, jsStringLiteral } from './exportHtml';

describe('escapeHtml', () => {
  it('escapa los 5 caracteres peligrosos', () => {
    expect(escapeHtml(`<a b="c" & 'd'>`)).toBe('&lt;a b=&quot;c&quot; &amp; &#39;d&#39;&gt;');
  });
  it('deja texto normal intacto', () => {
    expect(escapeHtml('Modelo Fisico 01')).toBe('Modelo Fisico 01');
  });
});

describe('jsStringLiteral', () => {
  it('produce un literal JS que round-tripea el string original', () => {
    const src = '<svg></svg><script>alert(1)</script><!-- comentario -->';
    const lit = jsStringLiteral(src);
    expect(new Function(`return ${lit}`)()).toBe(src);
  });
  it('nunca deja `</script` ni `<!--` crudos (romperian el parser HTML)', () => {
    const lit = jsStringLiteral('a</script>b<!--c');
    expect(lit.includes('</script')).toBe(false);
    expect(lit.includes('<!--')).toBe(false);
  });
});

describe('buildInteractiveHtml', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect/></svg>';
  const out = buildInteractiveHtml({ title: 'My <Canvas> & "co"', svgMarkup: svg });

  it('es un documento HTML completo con el titulo escapado', () => {
    expect(out.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<title>My &lt;Canvas&gt; &amp; &quot;co&quot;</title>');
    expect(out).not.toContain('<title>My <Canvas>');
  });

  it('embebe el SVG como literal JS parseable (no inline crudo)', () => {
    expect(out).toContain(jsStringLiteral(svg));
  });

  it('incluye el visor pan/zoom autocontenido', () => {
    expect(out).toContain('id="stage"');
    expect(out).toContain('id="vp"');
    expect(out).toContain("addEventListener('wheel'");
    expect(out).toContain('DOMParser');
  });

  it('no referencia recursos externos (funciona offline)', () => {
    // El unico http permitido es el xmlns DENTRO del payload SVG del usuario.
    const template = buildInteractiveHtml({ title: 't', svgMarkup: '<svg/>' });
    expect(/https?:\/\//.test(template.replace(jsStringLiteral('<svg/>'), ''))).toBe(false);
  });
});
