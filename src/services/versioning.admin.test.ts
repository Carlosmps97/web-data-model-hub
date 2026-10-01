import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteVersion, listUserNames, listUsers, transferVersion } from './versioning.service';

/** Doc 104: transferir / eliminar viajan con el dueño que MOSTRABA la pantalla
 *  (`expectedOwner`): si otra sesión lo cambió en el medio, el backend responde
 *  409 en vez de actuar sobre el draft de otra persona. */
describe('administración de versiones (doc 104)', () => {
  const calls: { url: string; method?: string; body?: unknown }[] = [];
  afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
  const stub = (data: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  }));

  it('deleteVersion manda el dueño esperado en el query string (codificado)', async () => {
    stub({ id: 'cs1', deleted: true, changes: 3 });
    await deleteVersion('cs1', 'ana@bcp.com.pe');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toMatch(/\/api\/changesets\/cs1\?expectedOwner=ana%40bcp\.com\.pe$/);
  });

  it('transferVersion manda destino, nota y dueño esperado en el cuerpo', async () => {
    stub({ id: 'cs1', owner: 'carla' });
    await transferVersion('cs1', { to: 'carla', note: 'vacaciones', expectedOwner: 'ana' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/api\/changesets\/cs1\/transfer$/);
    expect(calls[0].body).toEqual({ to: 'carla', note: 'vacaciones', expectedOwner: 'ana' });
  });
});

/** Doc 105 (U1): los NOMBRES se resuelven con el directorio completo (quien
 *  dejó la empresa sigue siendo dueño o autor de su versión); ofrecer personas
 *  (revisores, destinos) sigue siendo sólo con activos. */
describe('directorio de usuarios para nombres (doc 105)', () => {
  const urls: string[] = [];
  afterEach(() => { urls.length = 0; vi.unstubAllGlobals(); });
  const stub = () => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
  }));

  it('listUserNames pide también los deshabilitados', async () => {
    stub();
    await listUserNames();
    expect(urls[0]).toMatch(/\/api\/users\?includeDisabled=true$/);
  });

  it('listUsers (ofrecer personas) no los pide', async () => {
    stub();
    await listUsers('model.edit');
    expect(urls[0]).toMatch(/\/api\/users\?can=model\.edit$/);
    expect(urls[0]).not.toMatch(/includeDisabled/);
  });
});
