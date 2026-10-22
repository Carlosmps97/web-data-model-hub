import { describe, it, expect, beforeEach } from 'vitest';
import { LAST_PROJECT_KEY, sessionProjectId, useSessionStore } from './useSessionStore';

describe('useSessionStore · proyecto activo', () => {
  beforeEach(() => useSessionStore.setState({ openMode: null, activeChangesetId: null, activeVersionLabel: null, activeProjectId: null }));

  it('sessionProjectId lanza sin proyecto y devuelve el activo', () => {
    expect(() => sessionProjectId()).toThrow('Open a project first.');
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' });
    expect(sessionProjectId()).toBe('p1');
    expect(useSessionStore.getState().activeProjectId).toBe('p1');
  });

  it('closeModel vuelve al estado sin sesión de canvas', () => {
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs1', versionLabel: 'v2' });
    useSessionStore.getState().closeModel();
    const s = useSessionStore.getState();
    expect([s.openMode, s.activeChangesetId, s.activeVersionLabel, s.activeProjectId]).toEqual([null, null, null, null]);
  });

  it('openModel recuerda el último proyecto (tolera un storage ausente)', () => {
    expect(LAST_PROJECT_KEY).toBe('dmh:lastProject');
    expect(() => useSessionStore.getState().openModel({ projectId: 'p9', mode: 'readonly' })).not.toThrow();
    expect(sessionProjectId()).toBe('p9');
  });
});
