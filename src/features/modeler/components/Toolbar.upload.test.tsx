// Doc 113 §1.2: «Upload from Excel» sólo en el modelo físico (como Views, CTAS
// y Schemas) — la carga crea tablas con esquema y sus vistas `_vu`; en Logical
// queda deshabilitado y su nombre accesible dice por qué.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// En un render del lado del servidor zustand lee el estado INICIAL de cada
// store: la sesión y la faceta salen de estos objetos (el resto, real).
const session: Record<string, unknown> = { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' };
const modeler: Record<string, unknown> = {};
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
import Toolbar from './Toolbar';

function uploadButton(): string {
  const html = renderToStaticMarkup(<Toolbar pushToast={() => {}} onOpenModel={() => {}} />);
  const btn = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).find((b) => /aria-label="Upload from Excel/.test(b));
  if (!btn) throw new Error('no Upload from Excel button');
  return btn;
}

describe('Toolbar: Upload from Excel sólo en Physical (doc 113)', () => {
  it('en Logical está deshabilitado y su nombre dice que es del modelo físico', () => {
    modeler.viewMode = 'logical';
    const btn = uploadButton();
    expect(btn).toMatch(/\sdisabled=""/);
    expect(btn).toContain('aria-label="Upload from Excel belongs to the physical model — switch to Physical"');
  });

  it('en Physical está habilitado (con versión en edición)', () => {
    modeler.viewMode = 'physical';
    const btn = uploadButton();
    expect(btn).not.toMatch(/\sdisabled=""/);
    expect(btn).toContain('aria-label="Upload from Excel — create or update tables, columns and structure in bulk"');
  });
});
