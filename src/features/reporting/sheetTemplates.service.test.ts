/** sheetTemplates.service: el bloqueo va por su propia ruta con el estado pedido
 *  (no «invertir»): dos clics seguidos piden lo mismo y no se anulan. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', async (orig) => ({ ...(await orig<typeof import('@/services/http')>()), apiPut: vi.fn() }));

import { apiPut } from '@/services/http';
import { setSheetTemplateLock } from './sheetTemplates.service';

beforeEach(() => { vi.clearAllMocks(); });

describe('setSheetTemplateLock', () => {
  it('manda el estado pedido a la ruta /lock de la plantilla', async () => {
    await setSheetTemplateLock('p 1', 't/1', true);
    const [url, body] = vi.mocked(apiPut).mock.calls[0];
    expect(String(url)).toMatch(/\/api\/projects\/p%201\/sheet-templates\/t%2F1\/lock$/);
    expect(body).toEqual({ locked: true });
  });
});
