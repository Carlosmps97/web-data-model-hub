import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Entorno vitest = node: un localStorage mínimo (el store lo usa con try/catch).
const mem = new Map<string, string>();
beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
  });
});

const { useUiStore } = await import('./useUiStore');
// Estado con el que nace el store en un navegador sin preferencias guardadas.
const bornRelLabelsHidden = useUiStore.getState().relLabelsHidden;

describe('useUiStore (chrome colapsable)', () => {
  beforeEach(() => {
    mem.clear();
    useUiStore.setState({ toolbarCollapsed: false, explorerCollapsed: false });
  });
  it('toggles y persiste en localStorage', () => {
    useUiStore.getState().toggleToolbar();
    expect(useUiStore.getState().toolbarCollapsed).toBe(true);
    expect(localStorage.getItem('dmh:ui:toolbarCollapsed')).toBe('1');
    useUiStore.getState().toggleExplorer();
    useUiStore.getState().toggleExplorer();
    expect(useUiStore.getState().explorerCollapsed).toBe(false);
    expect(localStorage.getItem('dmh:ui:explorerCollapsed')).toBe('0');
  });
  it('setters explícitos', () => {
    useUiStore.getState().setExplorerCollapsed(true);
    expect(useUiStore.getState().explorerCollapsed).toBe(true);
  });
});

describe('useUiStore · etiquetas de relación', () => {
  beforeEach(() => {
    mem.clear();
    useUiStore.setState({ relLabelsHidden: false });
  });
  it('por defecto las etiquetas se ven', () => {
    expect(bornRelLabelsHidden).toBe(false);
  });
  it('un navegador que las dejó ocultas las encuentra ocultas al volver', async () => {
    localStorage.setItem('dmh:ui:relLabelsHidden', '1');
    vi.resetModules();                                   // store recién creado
    const fresh = await import('./useUiStore');
    expect(fresh.useUiStore.getState().relLabelsHidden).toBe(true);
  });
  it('ocultar y volver a mostrar persiste por navegador', () => {
    useUiStore.getState().toggleRelLabels();
    expect(useUiStore.getState().relLabelsHidden).toBe(true);
    expect(localStorage.getItem('dmh:ui:relLabelsHidden')).toBe('1');
    useUiStore.getState().toggleRelLabels();
    expect(useUiStore.getState().relLabelsHidden).toBe(false);
    expect(localStorage.getItem('dmh:ui:relLabelsHidden')).toBe('0');
  });
});
