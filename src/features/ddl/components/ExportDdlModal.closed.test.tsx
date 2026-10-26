// El modal de Export DDL vive montado en la barra y el diagrama cambia en cada
// edición del canvas: cerrado no recorre el diagrama ni arma el DDL; abierto sí.
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../generators', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generators')>();
  return { ...actual, databricksDdl: vi.fn(actual.databricksDdl) };
});
vi.mock('../canvasDdlViews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canvasDdlViews')>();
  return { ...actual, canvasDdlViews: vi.fn(actual.canvasDdlViews) };
});
// Sin portal: el render de servidor no los soporta.
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null) };
});

import { canvasDdlViews } from '../canvasDdlViews';
import { databricksDdl } from '../generators';
import ExportDdlModal from './ExportDdlModal';

const diagram = {
  subjectArea: { id: 'sa1', name: 'Canvas', tableIds: ['t1'], viewIds: [] },
  tables: [{ id: 't1', physicalName: 'M_T1', logicalName: 'T1', schema: 'STG' }],
  columns: [{ id: 'c1', tableId: 't1', physicalName: 'COD', logicalName: 'Cod', dataType: 'STRING', ordinal: 0 }],
  relationships: [], views: [],
} as never;

beforeEach(() => { vi.mocked(databricksDdl).mockClear(); vi.mocked(canvasDdlViews).mockClear(); });

describe('Export DDL', () => {
  it('cerrado: no recorre el diagrama ni arma el DDL', () => {
    renderToStaticMarkup(<ExportDdlModal open={false} diagram={diagram} modelName="m" onClose={() => {}} />);
    expect(databricksDdl).not.toHaveBeenCalled();
    expect(canvasDdlViews).not.toHaveBeenCalledWith(diagram);
  });

  it('cerrado: ni siquiera lee las columnas del diagrama', () => {
    let reads = 0;
    const counted = { ...(diagram as object), get columns() { reads += 1; return []; } } as never;
    renderToStaticMarkup(<ExportDdlModal open={false} diagram={counted} modelName="m" onClose={() => {}} />);
    expect(reads).toBe(0);
  });

  it('abierto: arma el DDL del diagrama', () => {
    renderToStaticMarkup(<ExportDdlModal open diagram={diagram} modelName="m" onClose={() => {}} />);
    expect(canvasDdlViews).toHaveBeenCalledWith(diagram);
    expect(databricksDdl).toHaveBeenCalled();
  });
});
