// El clipboard recuerda de qué proyecto viene y sobrevive al cambio de versión
// y de proyecto (se pega en otro tras su revisión); la selección, el menú y los
// popups no. El logout lo limpia.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, searchTables: vi.fn(async () => []), recordChangesBulk: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/structure.service', () => ({
  addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
}));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as gov from '@/services/governance.service';
import { ALL_COPY, reviewPaste } from '../features/modeler/lib/pasteReview';
import * as mod from '../features/modeler/services/modeler.service';
import * as struct from '../features/modeler/services/structure.service';
import { resetAppState } from './resetAppState';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const T1 = { id: 't1', logicalName: 'cliente', physicalName: 'M_CLIENTE' };
const C1 = { id: 'c1', tableId: 't1', logicalName: 'cod', physicalName: 'COD', dataType: 'STRING', typeOverridden: false, ordinal: 0 };
const DIA = { subjectArea: { id: 'sa1', projectId: 'pA', name: 'C', tableIds: ['t1'], layout: {} }, tables: [T1], columns: [C1], relationships: [], views: [] };

beforeEach(async () => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'csA', activeProjectId: 'pA' });
  vi.mocked(mod.loadDiagram).mockImplementation(async () => structuredClone(DIA) as never);
  useModelerStore.setState({
    activeProjectId: 'pA', activeSaId: null, diagram: null, openingSaId: null, flow: null, viewMode: 'physical',
    projects: [{ id: 'pA', name: 'Modelo A' }, { id: 'pB', name: 'Modelo B' }] as never, colClipboard: null, tblClipboard: null,
  });
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await sleep(5); });

describe('clipboard entre proyectos', () => {
  it('copiar una tabla o columnas anota el proyecto de origen', () => {
    st().copyTable('t1');
    expect(st().tblClipboard?.source).toEqual({ projectId: 'pA', projectName: 'Modelo A' });
    useModelerStore.setState({ colSel: { tableId: 't1', ids: ['c1'], anchor: 'c1' } });
    st().copySelectedColumns();
    expect(st().colClipboard?.source).toMatchObject({ physicalName: 'M_CLIENTE', projectId: 'pA', projectName: 'Modelo A' });
  });

  it('el proyecto de origen es el de la sesión (la que cargó el canvas), no el que recuerde el Explorer', () => {
    useModelerStore.setState({ activeProjectId: 'pB' });
    st().copyTable('t1');
    expect(st().tblClipboard?.source).toEqual({ projectId: 'pA', projectName: 'Modelo A' });
  });

  it('sobrevive a otra versión y a otro proyecto; la selección y los popups no', () => {
    st().copyTable('t1');
    useModelerStore.setState({ pasteTarget: 't1', tablePasteOpen: true });
    useSessionStore.getState().openModel({ projectId: 'pB', mode: 'editing', changesetId: 'csB' });
    expect(st().tblClipboard?.table.physicalName).toBe('M_CLIENTE');
    expect(st().pasteTarget).toBeNull();
    expect(st().tablePasteOpen).toBe(false);
  });

  it('el nombre del proyecto de origen no se pierde mientras el Explorer recarga la lista', async () => {
    vi.mocked(struct.listProjects).mockResolvedValueOnce([{ id: 'pA', name: 'Modelo A' }] as never);
    await st().loadProjects();
    useModelerStore.setState({ projects: [] });   // como al empezar `refreshExplorer`
    st().copyTable('t1');
    expect(st().tblClipboard?.source).toEqual({ projectId: 'pA', projectName: 'Modelo A' });
  });

  it('el clipboard de columnas también sobrevive a otra versión y a otro proyecto', () => {
    useModelerStore.setState({ colSel: { tableId: 't1', ids: ['c1'], anchor: 'c1' } });
    st().copySelectedColumns();
    useSessionStore.getState().openModel({ projectId: 'pA', mode: 'editing', changesetId: 'csA2' });
    useSessionStore.getState().openModel({ projectId: 'pB', mode: 'editing', changesetId: 'csB' });
    expect(st().colClipboard?.cols.map((c) => c.id)).toEqual(['c1']);
  });

  it('sobrevive al Explorer que abre otro proyecto', async () => {
    st().copyTable('t1');
    await st().selectProject('pB');
    expect(st().activeProjectId).toBe('pB');
    expect(st().tblClipboard?.table.physicalName).toBe('M_CLIENTE');
  });

  it('el logout lo limpia (los dos clipboards y el popup)', () => {
    // resetAppState barre el sessionStorage: en node no hay ventana.
    const logout = () => {
      vi.stubGlobal('window', { sessionStorage: { length: 0, key: () => null, removeItem: () => {} } });
      try {
        resetAppState();
      } finally { vi.unstubAllGlobals(); }
    };
    st().copyTable('t1');
    useModelerStore.setState({ tablePasteOpen: true });
    logout();
    expect(st().tblClipboard).toBeNull();
    expect(st().tablePasteOpen).toBe(false);
    useModelerStore.setState({ diagram: structuredClone(DIA) as never, colSel: { tableId: 't1', ids: ['c1'], anchor: 'c1' } });
    st().copySelectedColumns();
    expect(st().colClipboard).not.toBeNull();
    logout();
    expect(st().colClipboard).toBeNull();
  });

  it('sin revisión no se pega lo copiado en otro proyecto (llevaría sus ids)', async () => {
    st().copyTable('t1');
    useSessionStore.setState({ activeChangesetId: 'csB', activeProjectId: 'pB' });
    useModelerStore.setState({ activeProjectId: 'pB' });
    await expect(st().pasteTable()).rejects.toThrow('Open the paste review to paste from another project.');
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
  });

  it('lo revisado entre proyectos llega al lote con los ids del destino, nunca los del origen', async () => {
    const A = {
      udpDefs: [{ id: 'udp-de-A', name: 'Tipo de Carga', level: 'table' as const, view: 'physical' as const, dataType: 'list' as const, allowedValues: ['Full'] }],
      domains: [{ id: 'dom-de-A', name: 'Codigo', defaultDataType: 'STRING' }],
      themes: [{ id: 'theme-de-A', name: 'Azul', color: '#0070C0' }],
    };
    const B = {
      udpDefs: [{ id: 'udp-de-B', name: 'tipo de carga', level: 'table' as const, view: 'physical' as const, dataType: 'list' as const, allowedValues: ['FULL'] }],
      domains: [{ id: 'dom-de-B', name: 'codigo', defaultDataType: 'STRING' }],
      themes: [{ id: 'theme-de-B', name: 'AZUL', color: '#000080' }],
      schemas: [], naming: null,
    };
    useModelerStore.setState({ tblClipboard: {
      table: { ...T1, udpValues: { 'udp-de-A': 'full' }, color: 'theme:theme-de-A' },
      cols: [{ ...C1, parentDomainId: 'dom-de-A' }],
      source: { projectId: 'pA', projectName: 'Modelo A' },
    } as never });
    useSessionStore.setState({ activeChangesetId: 'csB', activeProjectId: 'pB' });
    useModelerStore.setState({ activeProjectId: 'pB' });
    const clip = st().tblClipboard!;
    const r = reviewPaste({ table: clip.table, cols: clip.cols, source: A, target: B, sameProject: false, options: ALL_COPY });
    await st().pasteTable({ table: r.payload.table!, cols: r.payload.cols });
    const lot = vi.mocked(gov.recordChangesBulk).mock.calls[0][0];
    expect(JSON.stringify(lot)).not.toMatch(/de-A/);
    expect(lot.find((c) => c.collection === 'canonical_tables')?.payload).toMatchObject({ udpValues: { 'udp-de-B': 'FULL' }, color: 'theme:theme-de-B' });
    expect(lot.find((c) => c.collection === 'canonical_columns')?.payload).toMatchObject({ parentDomainId: 'dom-de-B' });
  });

  it('pegar desde otro proyecto anota el proyecto de origen en la procedencia', async () => {
    st().copyTable('t1');
    useSessionStore.setState({ activeChangesetId: 'csB', activeProjectId: 'pB' });
    useModelerStore.setState({ activeProjectId: 'pB' });
    await st().pasteTable({ table: T1 as never, cols: [C1 as never] });
    const lot = vi.mocked(gov.recordChangesBulk).mock.calls[0][0];
    expect(lot[0].origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE', sourceProject: 'Modelo A' });
  });

  it('en el mismo proyecto la procedencia no nombra proyecto', async () => {
    st().copyTable('t1');
    await st().pasteTable({ table: T1 as never, cols: [C1 as never] });
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[0][0][0].origin).toEqual({ kind: 'paste-table', sourceTable: 'M_CLIENTE' });
  });
});
