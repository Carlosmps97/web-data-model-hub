// ⌘K / Ctrl+K: con «Saving working copy…» (o el overlay de Locate) en pantalla no
// abre el buscador (quedaría debajo y se llevaría el foco).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const modal = { open: false };
vi.mock('@/components/ui/focusTrap', async (orig) => ({ ...(await orig<object>()), modalOpen: () => modal.open }));
import { useSessionStore } from '@/store/useSessionStore';
import { onSearchShortcut } from './Toolbar';

const key = (over: Partial<KeyboardEvent> = {}) =>
  ({ key: 'k', metaKey: true, ctrlKey: false, preventDefault: vi.fn(), ...over }) as unknown as KeyboardEvent;

beforeEach(() => {
  modal.open = false;
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
});

describe('atajo del buscador', () => {
  it('abre el buscador con una sesión de canvas', () => {
    const open = vi.fn();
    onSearchShortcut(key(), open);
    onSearchShortcut(key({ metaKey: false, ctrlKey: true, key: 'K' }), open);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('con un modal o una espera en pantalla no lo abre', () => {
    modal.open = true;
    const open = vi.fn();
    onSearchShortcut(key(), open);
    expect(open).not.toHaveBeenCalled();
  });

  it('otra tecla o sin sesión, tampoco', () => {
    const open = vi.fn();
    onSearchShortcut(key({ key: 'j' }), open);
    useSessionStore.setState({ openMode: null });
    onSearchShortcut(key(), open);
    expect(open).not.toHaveBeenCalled();
  });
});
