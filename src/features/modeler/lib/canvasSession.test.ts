import { describe, expect, it } from 'vitest';
import { canvasSessionKey } from './canvasSession';

/**
 * La clave de contexto incluye el proyecto: con un proyecto abierto en solo
 * lectura, abrir otro proyecto también en solo lectura re-sincroniza el
 * workspace (explorer, toolbar y canvas), aunque `openMode` y
 * `activeChangesetId` no cambien. Cualquier cambio de proyecto, modo o
 * changeset produce una clave distinta ⇒ `refreshExplorer()`.
 */
describe('canvasSessionKey', () => {
  it('sin sesión de canvas (openMode null) ⇒ null', () => {
    expect(canvasSessionKey({ openMode: null, activeChangesetId: null, activeProjectId: null })).toBeNull();
    expect(canvasSessionKey({ openMode: null, activeChangesetId: 'cs1', activeProjectId: 'A' })).toBeNull();
  });

  it('readonly A → readonly B cambia la clave (mismo modo, sin changeset)', () => {
    const a = canvasSessionKey({ openMode: 'readonly', activeChangesetId: null, activeProjectId: 'A' });
    const b = canvasSessionKey({ openMode: 'readonly', activeChangesetId: null, activeProjectId: 'B' });
    expect(a).not.toBeNull();
    expect(a).not.toEqual(b);
  });

  it('misma sesión ⇒ misma clave (estable, no dispara refrescos de más)', () => {
    const s = { openMode: 'editing' as const, activeChangesetId: 'cs1', activeProjectId: 'A' };
    expect(canvasSessionKey(s)).toEqual(canvasSessionKey({ ...s }));
  });

  it('cambiar de modo o de changeset también cambia la clave', () => {
    const base = { openMode: 'readonly' as const, activeChangesetId: null, activeProjectId: 'A' };
    expect(canvasSessionKey({ ...base, openMode: 'editing' })).not.toEqual(canvasSessionKey(base));
    expect(canvasSessionKey({ ...base, activeChangesetId: 'cs9' })).not.toEqual(canvasSessionKey(base));
  });
});
