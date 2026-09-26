import { describe, expect, it, vi } from 'vitest';
import { specForExport } from './exportSpec';
import { emptySpec, type SqlValidation } from '../query.service';

const BUILDER = { ...emptySpec('p1', 'tables'), select: ['physicalName'] };
const SQL_SPEC = { ...emptySpec('p1', 'columns'), select: ['physicalName', 'dataType'] };

describe('specForExport (doc 95 D12)', () => {
  it('en modo Builder exporta el spec del Builder, sin validar', async () => {
    const validate = vi.fn();
    expect(await specForExport('builder', BUILDER, 'SELECT x FROM columns', validate)).toBe(BUILDER);
    expect(validate).not.toHaveBeenCalled();
  });
  it('en modo SQL exporta la SQL validada, en el proyecto del diseñador', async () => {
    const validate = vi.fn(async (): Promise<SqlValidation> => ({ spec: { ...SQL_SPEC, projectId: 'otro' }, errors: [] }));
    const out = await specForExport('sql', BUILDER, 'SELECT physicalName, dataType FROM columns', validate);
    expect(out).toEqual({ ...SQL_SPEC, projectId: 'p1' });
  });
  it('SQL vacía o inválida: error legible, nada que exportar', async () => {
    await expect(specForExport('sql', BUILDER, '  ', vi.fn())).rejects.toThrow('Write a query before exporting.');
    const bad = vi.fn(async (): Promise<SqlValidation> => ({ spec: null, errors: [{ line: 2, col: 1, message: 'Unknown field' }] }));
    await expect(specForExport('sql', BUILDER, 'SELECT nope FROM columns', bad)).rejects.toThrow('Line 2: Unknown field');
  });
});
