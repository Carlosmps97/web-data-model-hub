// Doc 105 (H6) — UNA caída de red = UN aviso. Al entrar a Model con la sesión
// abierta salían tres («Couldn't load the projects», «…the schemas…», «…the
// explorer…») y el botón Refresh del Explorer daba dos:
//  · el `loadProjects` del montaje de WorkspaceScreen: su resultado lo
//    descartaba el refresco (`_explorerSeq`), pero su error igual se avisaba;
//  · el aviso de esquemas salía aunque fallara todo el refresco (y éste avisa).
// Los handlers de los componentes se copian tal cual (sin DOM).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/modeler/services/structure.service', () => ({
  listProjects: vi.fn(), listFolders: vi.fn(), listSubjectAreas: vi.fn(), projectDeletionPending: vi.fn(async () => false),
}));
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn() }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import { toast } from 'sonner';
import * as struct from '../features/modeler/services/structure.service';
import * as schemasSvc from '../features/modeler/services/schemas.service';
import * as mod from '../features/modeler/services/modeler.service';
import { stillAskedSession } from '../features/modeler/lib/sessionGuard';
import { canvasSessionKey } from '../features/modeler/lib/canvasSession';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError, errorReason } from '@/services/http';
import { useSessionStore } from './useSessionStore';
import { useModelerStore } from './useModelerStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const down = () => new ApiError('Failed to fetch', 0, null, '/api/changesets/cs1/effective/projects');
const shown = () => vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
const st = () => useModelerStore.getState();

/** Efecto de sesión de WorkspaceScreen (entrar a Model / abrir una versión), tal cual. */
function enterModel(): void {
  const asked = useSessionStore.getState();
  const askedKey = canvasSessionKey(asked);
  st().refreshExplorer().catch(async (e: unknown) => {
    const current = () => canvasSessionKey(useSessionStore.getState());
    if (!(await stillAskedSession(e, asked.activeChangesetId, askedKey, current))) return;
    const reason = errorReason(e, 'unknown error');
    toast.error(`Couldn't load the explorer: ${reason}. Use Refresh to try again.`, { id: `dmh-explorer-load:${askedKey}` });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(struct.listProjects).mockRejectedValue(down());
  vi.mocked(struct.listFolders).mockRejectedValue(down());
  vi.mocked(struct.listSubjectAreas).mockRejectedValue(down());
  vi.mocked(schemasSvc.listSchemas).mockRejectedValue(down());
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ projects: [], activeProjectId: 'p1', activeSaId: null, diagram: null, trees: {}, schemas: [] });
});

describe('una caída = un aviso (doc 105, H6)', () => {
  it('entrar a Model con la red caída: sólo «Couldn\'t load the explorer…»', async () => {
    enterModel();
    await sleep(20);
    expect(shown()).toEqual(["Couldn't load the explorer: Failed to fetch. Use Refresh to try again."]);
  });

  it('un loadProjects que un refresco más nuevo dejó atrás no avisa su error (ya no cuenta)', async () => {
    const early = st().loadProjects();     // p. ej. el del montaje de WorkspaceScreen
    enterModel();                          // el efecto de sesión: su refresco lo deja atrás
    await expect(early).resolves.toBeUndefined();
    await sleep(20);
    expect(shown()).toHaveLength(1);
  });

  it('el botón Refresh del Explorer con la red caída: UN aviso (el suyo)', async () => {
    // ExplorerPanel, tal cual.
    await st().refreshExplorer().catch((e: unknown) =>
      toast.error(`Couldn't refresh the explorer${e instanceof Error && e.message ? `: ${e.message}` : ''}`));
    await sleep(20);
    expect(shown()).toEqual(["Couldn't refresh the explorer: Failed to fetch"]);
  });

  it('si falla la recarga del canvas (ya avisa), los esquemas no suman otro aviso', async () => {
    vi.mocked(struct.listProjects).mockResolvedValue([{ id: 'p1', name: 'Uno' }] as never);
    vi.mocked(struct.listFolders).mockResolvedValue([] as never);
    vi.mocked(struct.listSubjectAreas).mockResolvedValue([{ id: 'sa1', projectId: 'p1', name: 'Uno', tableIds: [] }] as never);
    vi.mocked(mod.loadDiagram).mockRejectedValue(new ApiError('Failed to fetch', 0, null, '/api/subject-areas/sa1/diagram'));
    useModelerStore.setState({ activeSaId: 'sa1' });
    enterModel();
    await sleep(20);
    expect(shown()).toEqual(["Couldn't reload the canvas: Failed to fetch. Open it again from the explorer."]);
  });

  it('si sólo fallan los esquemas, se avisa eso (una vez)', async () => {
    vi.mocked(struct.listProjects).mockResolvedValue([{ id: 'p1', name: 'Uno' }] as never);
    vi.mocked(struct.listFolders).mockResolvedValue([] as never);
    vi.mocked(struct.listSubjectAreas).mockResolvedValue([] as never);
    enterModel();
    await sleep(20);
    expect(shown()).toEqual(["Couldn't load the schemas: Failed to fetch. Use Refresh in the explorer to try again."]);
  });
});

// Doc 105 (ronda 3, cosmético): el texto de un timeout ya trae su consejo
// («— try again in a moment.»); pegado al del aviso, repetía la instrucción.
describe('el aviso no repite «try again» (doc 105, ronda 3)', () => {
  const timeout = () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/x');

  it('WorkspaceScreen arma el aviso como la copia de arriba (sin deriva)', () => {
    const src = readFileSync(join(__dirname, '../features/modeler/components/WorkspaceScreen.tsx'), 'utf-8');
    expect(src).toContain("const reason = errorReason(e, 'unknown error');\n        toast.error(`Couldn't load the explorer: ${reason}. Use Refresh to try again.`");
  });

  it('explorer: un solo «try again»', async () => {
    vi.mocked(struct.listProjects).mockRejectedValue(timeout());
    enterModel();
    await sleep(20);
    expect(shown()).toEqual(["Couldn't load the explorer: The server didn't respond within 30s. Use Refresh to try again."]);
  });

  it('esquemas: ídem', async () => {
    vi.mocked(struct.listProjects).mockResolvedValue([{ id: 'p1', name: 'Uno' }] as never);
    vi.mocked(struct.listFolders).mockResolvedValue([] as never);
    vi.mocked(struct.listSubjectAreas).mockResolvedValue([] as never);
    vi.mocked(schemasSvc.listSchemas).mockRejectedValue(timeout());
    enterModel();
    await sleep(20);
    expect(shown()).toEqual(["Couldn't load the schemas: The server didn't respond within 30s. Use Refresh in the explorer to try again."]);
  });
});
