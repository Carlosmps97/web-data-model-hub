import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/governance.service', () => ({}));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import { useModelerStore } from './useModelerStore';

/** Armado de la herramienta Subcategory: exclusión mutua con la de relación y
 *  desarme automático al pasar al modelo físico. */
describe('useModelerStore — subcatArmed', () => {
  beforeEach(() => {
    useModelerStore.setState({
      relPreset: null, subcatArmed: false, viewMode: 'logical', activeSaId: null,
    });
  });

  it('armar subcategoría desarma la herramienta de relación', () => {
    useModelerStore.getState().setRelPreset({ parent: 'one', child: 'zero-many', identifying: true });
    useModelerStore.getState().setSubcatArmed(true);
    const s = useModelerStore.getState();
    expect(s.subcatArmed).toBe(true);
    expect(s.relPreset).toBeNull();
  });

  it('armar relación desarma la subcategoría', () => {
    useModelerStore.getState().setSubcatArmed(true);
    useModelerStore.getState().setRelPreset({ parent: 'one', child: 'zero-many', identifying: false });
    const s = useModelerStore.getState();
    expect(s.relPreset?.identifying).toBe(false);
    expect(s.subcatArmed).toBe(false);
  });

  it('desarmar relación (null) no toca la subcategoría', () => {
    useModelerStore.getState().setSubcatArmed(true);
    useModelerStore.getState().setRelPreset(null);
    expect(useModelerStore.getState().subcatArmed).toBe(true);
  });

  it('pasar a físico desarma la subcategoría; volver a lógico no re-arma', () => {
    useModelerStore.getState().setSubcatArmed(true);
    useModelerStore.getState().setViewMode('physical');
    expect(useModelerStore.getState().subcatArmed).toBe(false);
    expect(useModelerStore.getState().viewMode).toBe('physical');
    useModelerStore.getState().setViewMode('logical');
    expect(useModelerStore.getState().subcatArmed).toBe(false);
  });

  it('pasar a lógico conserva un armado vigente', () => {
    useModelerStore.getState().setSubcatArmed(true);
    useModelerStore.getState().setViewMode('logical');
    expect(useModelerStore.getState().subcatArmed).toBe(true);
  });
});

/** Vistas exclusivas del modelo físico: entrar a lógico cierra el panel de
 *  vista (su bloque deja de estar en el canvas). */
describe('useModelerStore — setViewMode y vistas', () => {
  it('pasar a lógico limpia selectedViewId; volver a físico no re-selecciona', () => {
    useModelerStore.setState({ viewMode: 'physical', selectedViewId: 'v1', subcatArmed: false, relPreset: null });
    useModelerStore.getState().setViewMode('logical');
    expect(useModelerStore.getState().selectedViewId).toBeNull();
    useModelerStore.getState().setViewMode('physical');
    expect(useModelerStore.getState().selectedViewId).toBeNull();
  });

  it('pasar a físico conserva una vista seleccionada', () => {
    useModelerStore.setState({ viewMode: 'physical', selectedViewId: 'v2' });
    useModelerStore.getState().setViewMode('physical');
    expect(useModelerStore.getState().selectedViewId).toBe('v2');
  });
});
