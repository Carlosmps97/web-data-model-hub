// La píldora de la barra del Model dice proyecto · modo · código. Si no entra, se
// acorta el proyecto y nunca el modo ni el código; en el paso compacto «pill» se
// ocultan juntos el proyecto y su separador (los dos llevan `wk-vpill-proj`).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const session: Record<string, unknown> = {
  openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1', activeVersionLabel: 'v20261026143005',
};
const modeler: Record<string, unknown> = {
  viewMode: 'physical', activeProjectId: 'p1', projects: [{ id: 'p1', name: 'RDV DATAENTRY CANALES DIGITALES' }],
};
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
vi.mock('./useToolbarFit', () => ({ useToolbarFit: () => 0 }));
import Toolbar from './Toolbar';

const pill = () => {
  const html = renderToStaticMarkup(<Toolbar pushToast={() => {}} onOpenModel={() => {}} />);
  return /<span class="wk-vpill[^"]*"[^>]*>([\s\S]*?)<\/span><\/div>/.exec(html)?.[1] ?? '(sin píldora)';
};

describe('Toolbar: píldora de la versión', () => {
  it('proyecto y separador ocultables juntos; modo y código en un span que no se acorta', () => {
    expect(pill()).toBe('<span class="wk-vpill-proj wk-ctx-proj">«RDV DATAENTRY CANALES DIGITALES»</span>'
      + '<span class="wk-vpill-proj wk-ctx-sep"> · </span><span class="wk-ctx-ver">Editing · v20261026143005</span>');
  });
});
