import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn() }));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));

import * as naming from '@/services/naming.service';
import { useModelerStore } from './useModelerStore';

const CFG_UPPER = { column: { separator: '_', case: 'upper' }, table: { separator: '_', case: 'upper' } } as const;
const CFG_LOWER = { column: { separator: '_', case: 'lower' }, table: { separator: '_', case: 'upper' } } as const;

// El canvas cachea el naming config del proyecto (case por scope) para
// que el popup New column y el panel Properties muestren el físico con la
// regla al instante; el backend la aplica igual al escribir (autoritativo).
describe('useModelerStore.loadNaming — naming config del proyecto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelerStore.setState({ activeProjectId: 'p1', naming: null });
  });

  it('cachea la config del proyecto activo', async () => {
    vi.mocked(naming.getNamingConfig).mockResolvedValue(CFG_LOWER);
    await useModelerStore.getState().loadNaming('p1');
    expect(naming.getNamingConfig).toHaveBeenCalledWith('p1');
    expect(useModelerStore.getState().naming).toEqual(CFG_LOWER);
  });

  it('una respuesta de otro proyecto (cambio rápido de canvas) no pisa la config del activo', async () => {
    vi.mocked(naming.getNamingConfig).mockResolvedValue(CFG_LOWER);
    await useModelerStore.getState().loadNaming('p2');
    expect(useModelerStore.getState().naming).toBeNull();
  });

  it('si el GET falla no rompe ni pisa lo cacheado', async () => {
    useModelerStore.setState({ naming: CFG_UPPER });
    vi.mocked(naming.getNamingConfig).mockRejectedValue(new Error('boom'));
    await expect(useModelerStore.getState().loadNaming('p1')).resolves.toBeUndefined();
    expect(useModelerStore.getState().naming).toEqual(CFG_UPPER);
  });

  it('sin proyecto no pega al backend', async () => {
    await useModelerStore.getState().loadNaming(null);
    expect(naming.getNamingConfig).not.toHaveBeenCalled();
  });
});
