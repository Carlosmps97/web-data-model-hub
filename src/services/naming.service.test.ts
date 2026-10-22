/** naming.service · dry-run del glosario. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

import { apiPost } from '@/services/http';
import { glossaryImpact } from './naming.service';

beforeEach(() => vi.clearAllMocks());

describe('glossaryImpact', () => {
  it('postea el borrador del scope al dry-run y devuelve el conteo', async () => {
    const res = { columns: 2, columnTables: 1, tables: 0, sample: [] };
    vi.mocked(apiPost).mockResolvedValue(res);
    const body = {
      scope: 'column' as const,
      termsUpsert: [{ id: 't1', term: 'cliente', abbrev: 'CLTE' }],
      termsDelete: ['t2'],
      namingConfig: { separator: '', case: 'upper' },
    };
    await expect(glossaryImpact('p 1', body)).resolves.toEqual(res);
    const [url, sent] = vi.mocked(apiPost).mock.calls[0];
    expect(String(url)).toContain('/api/projects/p%201/glossary/impact');
    expect(sent).toEqual(body);
  });
});
