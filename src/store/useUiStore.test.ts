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

describe('useUiStore (doc 92 D7 — chrome colapsable)', () => {
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
