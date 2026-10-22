// Toolbar del canvas: cada botón de ícono tiene nombre accesible, además del
// tooltip visual al pasar el mouse (sin él, un lector de pantalla anunciaría
// «button» sin más y con el teclado no se sabría qué hace cada uno).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// En un render del lado del servidor zustand lee el estado inicial del store:
// la sesión sale de este objeto (el resto del store, real).
const session: Record<string, unknown> = {};
vi.mock('@/store/useSessionStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useSessionStore')>();
  const real = actual.useSessionStore;
  const hook = (sel: (s: unknown) => unknown) => sel({ ...real.getState(), ...session });
  return { ...actual, useSessionStore: Object.assign(hook, real) };
});
// El atajo real depende del sistema: un valor centinela prueba que el nombre lo usa.
vi.mock('./ColumnContextMenu', async (orig) => ({ ...(await orig<object>()), SEARCH_KEY_LABEL: 'Mod+K' }));
import Toolbar from './Toolbar';

function buttons(): { html: string; name: string }[] {
  const html = renderToStaticMarkup(<Toolbar pushToast={() => {}} onOpenModel={() => {}} />);
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => {
    const label = /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const text = inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
    return { html: `<button${attrs}>`.slice(0, 120), name: label || text };
  });
}

describe('Toolbar: cada botón tiene nombre accesible', () => {
  it('editando: ninguno queda sin nombre (texto visible o aria-label)', () => {
    Object.assign(session, { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    const all = buttons();
    expect(all.length).toBeGreaterThan(15);
    expect(all.filter((b) => !b.name).map((b) => b.html)).toEqual([]);
  });

  it('en solo lectura el nombre dice qué es y por qué está deshabilitado', () => {
    Object.assign(session, { openMode: 'readonly', activeChangesetId: null, activeProjectId: 'p1' });
    const all = buttons();
    expect(all.filter((b) => !b.name).map((b) => b.html)).toEqual([]);
    expect(all.some((b) => /^New (table|entity)\b.*Read-only/.test(b.name))).toBe(true);
  });
});

// Artículo correcto («Add an ellipse»), atajo del buscador según el sistema («⌘K» en
// Mac, Ctrl+K en Windows) y Logical/Physical anuncian cuál está activa.
describe('Toolbar: nombres y estado', () => {
  it('artículo correcto, atajo del sistema y la vista activa anunciada', async () => {
    Object.assign(session, { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
    const html = renderToStaticMarkup(<Toolbar pushToast={() => {}} onOpenModel={() => {}} />);
    const names = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
    expect(names).toContain('Add an ellipse');
    expect(names).not.toContain('Add a ellipse');
    expect(names.some((n) => n.startsWith('Search the model') && n.includes('(Mod+K)'))).toBe(true);
    const seg = [...html.matchAll(/<button[^>]*class="wk-seg-btn[^"]*"[^>]*>(Logical|Physical)</g)].map((m) => m[0]);
    expect(seg).toHaveLength(2);
    expect(seg.every((b) => /aria-pressed="(true|false)"/.test(b))).toBe(true);
  });
});
