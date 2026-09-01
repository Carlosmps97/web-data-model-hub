import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

// La orquestación se testea con los SERVICIOS mockeados (patrón
// arrangeCanvases.test.ts) y los builders REALES (integración de verdad).
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(),
  listFolders: vi.fn(),
  listSubjectAreas: vi.fn(),
}));
vi.mock('@/features/governance/services/governance.service', () => ({ listDomains: vi.fn() }));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn() }));
vi.mock('@/features/modeler/lib/exportFonts', () => ({ EXPORT_FONT_CSS: '' }));

import { listFolders, listSubjectAreas, loadDiagram } from '@/features/modeler/services/modeler.service';
import { listDomains } from '@/features/governance/services/governance.service';
import { getUdpDefs } from '@/features/standards/standards.service';
import { exportNodeHtml } from './exportPackage';
import type { Diagram, Folder, SubjectArea } from '@/features/modeler/services/modeler.service';

const F = (id: string, parent: string | null, name: string): Folder =>
  ({ id, projectId: 'p1', parentFolderId: parent, name, order: 0 });
const SA = (id: string, folderId: string | null, name: string): SubjectArea =>
  ({ id, projectId: 'p1', name, folderId, tableIds: ['t1'], layout: { t1: { x: 0, y: 0 } } });
const dia = (sa: SubjectArea): Diagram => ({
  subjectArea: sa,
  tables: [{ id: 't1', physicalName: `PH_${sa.id.toUpperCase()}`, logicalName: `Log ${sa.name}` }],
  columns: [{ id: 'c1', tableId: 't1', physicalName: 'CODMES', logicalName: 'Mes', dataType: 'INT', typeOverridden: false, ordinal: 0 }],
  relationships: [], views: [],
} as unknown as Diagram);

async function zipEntries(blob: Blob): Promise<Record<string, string>> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const files = unzipSync(u8);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDomains).mockResolvedValue([]);
  vi.mocked(getUdpDefs).mockResolvedValue([]);
});

describe('exportNodeHtml', () => {
  it('folder → ZIP con rutas espejo, index y páginas; progreso completo', async () => {
    vi.mocked(listFolders).mockResolvedValue([F('f1', null, 'CPYBCA'), F('f2', 'f1', 'CPYBCAPYM')]);
    const sas = [SA('s1', 'f2', 'Datamart PYME'), SA('s2', 'f1', 'Suelto')];
    vi.mocked(listSubjectAreas).mockResolvedValue(sas);
    vi.mocked(loadDiagram).mockImplementation(async (id: string) => dia(sas.find((s) => s.id === id)!));

    const download = vi.fn();
    const progress: number[] = [];
    const out = await exportNodeHtml({
      kind: 'folder', nodeId: 'f1', projectId: 'p1', projectName: 'Modelo DDV',
      onProgress: (p) => progress.push(p.done), download,
    });

    expect(out).toMatchObject({ exported: 2, total: 2, failed: [], cancelled: false });
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, filename] = download.mock.calls[0];
    expect(filename).toBe('CPYBCA.zip');
    const entries = await zipEntries(blob);
    expect(Object.keys(entries).sort()).toEqual([
      'CPYBCA/CPYBCAPYM/Datamart PYME.html',
      'CPYBCA/Suelto.html',
      'CPYBCA/index.html',
    ]);
    expect(entries['CPYBCA/index.html']).toContain('Datamart PYME');
    expect(entries['CPYBCA/CPYBCAPYM/Datamart PYME.html']).toContain('PH_S1');
    expect(progress[progress.length - 1]).toBe(2);
  });

  it('canvas que falla → failed[] con su nombre y el ZIP sale con el resto', async () => {
    vi.mocked(listFolders).mockResolvedValue([F('f1', null, 'CPYBCA')]);
    const sas = [SA('s1', 'f1', 'Bueno'), SA('s2', 'f1', 'Malo')];
    vi.mocked(listSubjectAreas).mockResolvedValue(sas);
    vi.mocked(loadDiagram).mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('boom');
      return dia(sas[0]);
    });
    const download = vi.fn();
    const out = await exportNodeHtml({ kind: 'folder', nodeId: 'f1', projectId: 'p1', projectName: 'P', download });
    expect(out.failed).toEqual(['Malo']);
    expect(out.exported).toBe(1);
    const entries = await zipEntries(download.mock.calls[0][0]);
    expect(Object.keys(entries)).toContain('CPYBCA/Bueno.html');
    expect(Object.keys(entries)).not.toContain('CPYBCA/Malo.html');
  });

  it('cancel antes de empezar → no descarga nada', async () => {
    vi.mocked(listFolders).mockResolvedValue([F('f1', null, 'C')]);
    vi.mocked(listSubjectAreas).mockResolvedValue([SA('s1', 'f1', 'X')]);
    vi.mocked(loadDiagram).mockResolvedValue(dia(SA('s1', 'f1', 'X')));
    const download = vi.fn();
    const out = await exportNodeHtml({ kind: 'folder', nodeId: 'f1', projectId: 'p1', projectName: 'P', cancel: { cancelled: true }, download });
    expect(out.cancelled).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it('kind=canvas → baja el .html directo, sin ZIP', async () => {
    const sa = SA('s1', null, 'Mi Canvas: v1');
    vi.mocked(loadDiagram).mockResolvedValue(dia(sa));
    const download = vi.fn();
    const out = await exportNodeHtml({ kind: 'canvas', nodeId: 's1', projectId: 'p1', projectName: 'P', download });
    expect(out).toMatchObject({ exported: 1, total: 1, failed: [] });
    const [blob, filename] = download.mock.calls[0];
    expect(filename).toBe('Mi Canvas_ v1.html');
    expect(blob.type).toBe('text/html');
    expect(vi.mocked(listFolders)).not.toHaveBeenCalled();
  });
});
