// En anchos menores la barra se compacta por pasos en una sola fila (sin scroll
// horizontal ni filas desparejas). Lo que se compacta de un grupo queda en un menú
// con su nombre, en su lugar: ninguna opción se quita. Aquí, con el nivel fijado
// (el hook mide en el navegador), se prueba qué queda a la vista y qué menús
// aparecen; abrir cada menú y encontrar todas las opciones requiere un navegador
// real.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const session: Record<string, unknown> = { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' };
const modeler: Record<string, unknown> = { viewMode: 'physical' };
vi.mock('@/store/useSessionStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useSessionStore')>();
  const real = actual.useSessionStore;
  const hook = (sel: (s: unknown) => unknown) => sel({ ...real.getState(), ...session });
  return { ...actual, useSessionStore: Object.assign(hook, real) };
});
vi.mock('@/store/useModelerStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useModelerStore')>();
  const real = actual.useModelerStore;
  const hook = (sel: (s: unknown) => unknown) => sel({ ...real.getState(), ...modeler });
  return { ...actual, useModelerStore: Object.assign(hook, real) };
});
const fit = { level: 0 };
vi.mock('./useToolbarFit', () => ({ useToolbarFit: () => fit.level }));
import Toolbar from './Toolbar';
import { TOOLBAR_STEPS } from '../lib/toolbarFit';

function render(level: number) {
  fit.level = level;
  const html = renderToStaticMarkup(<Toolbar pushToast={() => {}} onOpenModel={() => {}} />);
  const decode = (t: string) => t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => ({
    attrs,
    name: decode(/aria-label="([^"]*)"/.exec(attrs)?.[1]
      ?? inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim()),
  }));
  const toolbarClass = /<div[^>]*class="(wk-toolbar[^"]*)"/.exec(html)?.[1] ?? '';
  return { html, buttons, names: buttons.map((b) => b.name), menus: buttons.filter((b) => /wk-grpmenu/.test(b.attrs)), toolbarClass };
}

describe('Toolbar adaptable', () => {
  it('nivel 0 (pantalla ancha): todo a la vista, sin menús de compactación', () => {
    const r = render(0);
    expect(r.menus.filter((m) => /wk-grpmenu/.test(m.attrs))).toEqual([]);
    for (const n of ['New table', 'CTAS — create from existing', 'Create view', 'Schemas — create & manage', 'Autoarrange', 'Export DDL', 'Add a rectangle', 'Add a text'])
      expect(r.names).toContain(n);
    expect(r.names.filter((n) => /^(Parent|Child) end:/.test(n))).toHaveLength(8);
    expect(r.toolbarClass).toBe('wk-toolbar');
  });

  it('cada paso activo queda como clase de la barra (el CSS compacta con ellas)', () => {
    const r = render(4);
    expect(r.toolbarClass).toBe('wk-toolbar tb-open tb-drawing tb-pill tb-compact');
  });

  it('nivel máximo: a la vista lo esencial y un menú por grupo compactado, con nombre y estado', () => {
    const r = render(TOOLBAR_STEPS.length);
    for (const n of ['Logical', 'Physical', 'New table', 'Open model', 'Save', 'Publish', 'Hide the tools bar'])
      expect(r.names).toContain(n);
    expect(r.names.some((n) => n.startsWith('Model properties'))).toBe(true);
    expect(r.names.some((n) => n.startsWith('Search the model'))).toBe(true);
    expect(r.names.some((n) => n.startsWith('Undo'))).toBe(true);
    const menus = r.menus.filter((m) => /wk-grpmenu/.test(m.attrs)).map((m) => m.name);
    expect(menus).toEqual([
      expect.stringMatching(/^More structure tools/),
      expect.stringMatching(/^Relationships/),
      expect.stringMatching(/^Drawing/),
      expect.stringMatching(/^More actions/),
    ]);
    for (const m of r.menus.filter((x) => /wk-grpmenu/.test(x.attrs))) {
      expect(m.attrs).toContain('aria-expanded="false"');
      expect(m.attrs).not.toContain('aria-haspopup');   // patrón disclosure
    }
    // Lo compactado no está suelto en la barra (está en su menú).
    for (const n of ['CTAS — create from existing', 'Autoarrange', 'Export DDL', 'Add a rectangle']) expect(r.names).not.toContain(n);
    expect(r.names.filter((n) => /^(Parent|Child) end:/.test(n))).toHaveLength(0);
  });

  it('las cardinalidades compactadas muestran las elegidas en su botón', () => {
    const r = render(TOOLBAR_STEPS.indexOf('ends') + 1);
    const ends = r.menus.find((m) => m.name.startsWith('Relationship ends'));
    expect(ends?.name).toBe('Relationship ends — Parent: Exactly one · Child: Zero or many');
    expect(r.names.some((n) => n.startsWith('Draw an identifying relationship'))).toBe(true);   // dibujar sigue a la vista
  });

  it('en todos los niveles cada botón tiene nombre accesible (Save y Publish también sin su texto)', () => {
    for (let lv = 0; lv <= TOOLBAR_STEPS.length; lv++) {
      const r = render(lv);
      expect(r.buttons.filter((b) => !b.name).map((b) => b.attrs.slice(0, 80)), `nivel ${lv}`).toEqual([]);
    }
    const r = render(TOOLBAR_STEPS.length);
    expect(r.buttons.find((b) => /class="wk-save/.test(b.attrs) && /Save/.test(b.name))?.attrs).toContain('aria-label="Save"');
    expect(r.buttons.find((b) => /class="wk-publish/.test(b.attrs))?.attrs).toContain('aria-label="Publish"');
  });

  // Un comentario `//` escrito entre etiquetas JSX es texto: se dibujaría al pie
  // de la página (y achicaría el canvas). Lo de adentro de la barra es UI en
  // inglés: ni comentarios ni notas internas.
  it('no hay texto suelto de comentarios en lo que dibuja la barra', () => {
    for (let lv = 0; lv <= TOOLBAR_STEPS.length; lv++) {
      const text = render(lv).html.replace(/<[^>]+>/g, ' ');
      expect(text, `nivel ${lv}`).not.toMatch(/\/\/|Revisi[oó]n|\bdoc \d/);
    }
  });
});
