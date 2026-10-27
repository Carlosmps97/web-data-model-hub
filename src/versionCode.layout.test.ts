// El código de versión tiene 15 caracteres (`v20261026143005`). Estas reglas de
// maquetación lo mantienen entero y sin tapar nada; se verifican en el
// navegador, y aquí se fija que sigan escritas (una regresión de CSS no la ve
// ninguna otra prueba).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => resolve(__dirname, p);
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(['styles/home.css', 'features/modeler/modeler.css']
  .map((f) => readFileSync(src(f), 'utf-8')).join('\n'));
/** Declaraciones de las reglas cuyo selector (o uno de su lista) es exactamente `selector`. */
const decl = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').some((s) => s.trim() === selector))
  .map((m) => m[2]).join(';');

describe('código de versión largo: maquetación', () => {
  it('caja Versions del Home: el código no tiene ancho fijo y se acorta solo si no entra', () => {
    expect(decl('.dmh-vside-label')).not.toMatch(/(^|;)\s*width:/);
    expect(decl('.dmh-vside-label')).toMatch(/flex: 1/);
  });

  it('caja Versions del Home: «Deletes project» va en la línea del dueño, no en la del código', () => {
    const home = readFileSync(src('screens/HomeScreen.tsx'), 'utf-8');
    const row = home.slice(home.indexOf('className={`dmh-vside-row'), home.indexOf('{/* Rollback a cualquier versión publicada'));
    const meta = row.indexOf('className="dmh-vside-meta"');
    expect(meta).toBeGreaterThan(0);
    expect(row.indexOf('dmh-vpill--critical')).toBeGreaterThan(meta);
    // El dueño se acorta si la línea se llena: el nombre completo queda en el title.
    expect(row).toContain('className="dmh-vside-meta" title={userName(row.owner)}');
  });

  it('Version tools: la cabecera del resultado de Compare baja de línea', () => {
    expect(decl('.dmh-vt-cmphead')).toMatch(/flex-wrap: wrap/);
  });

  it('historial: acción y códigos envuelven; la flecha queda fuera de lo que envuelve', () => {
    expect(decl('.wk-pp-histtags')).toMatch(/flex-wrap: wrap/);
    expect(decl('.wk-pp-histtags')).toMatch(/min-width: 0/);
    const hist = readFileSync(src('features/modeler/components/AuditHistory.tsx'), 'utf-8');
    // La flecha va después de cerrar el bloque que envuelve y antes de la línea de quién y cuándo.
    const open = hist.lastIndexOf('<span', hist.indexOf('className="wk-pp-histtags"'));
    let depth = 0;
    let end = -1;
    for (const m of hist.slice(open).matchAll(/<span\b|<\/span>/g)) {
      depth += m[0] === '</span>' ? -1 : 1;
      if (depth === 0) { end = open + (m.index ?? 0); break; }
    }
    const caret = hist.indexOf('wk-pp-histcaret', open);
    expect(end).toBeGreaterThan(open);
    expect(caret).toBeGreaterThan(end);
    expect(caret).toBeLessThan(hist.indexOf('className="wk-pp-histline"', open));
  });

  it('barra del Model: se acorta el proyecto; el separador conserva sus espacios; modo y código nunca', () => {
    expect(decl('.wk-vpill')).toMatch(/white-space: nowrap/);
    expect(decl('.wk-tb-strip-ctx')).toMatch(/white-space: nowrap/);
    expect(decl('.wk-ctx-sep')).toMatch(/white-space: pre/);
    expect(decl('.wk-ctx-proj')).toMatch(/min-width: 0/);
    expect(decl('.wk-ctx-proj')).toMatch(/text-overflow: ellipsis/);
    expect(decl('.wk-ctx-ver')).toMatch(/flex: none/);
  });
});
