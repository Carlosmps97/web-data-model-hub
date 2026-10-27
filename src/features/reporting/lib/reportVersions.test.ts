// El combo Version del Reporting: producción + las versiones propias sin
// publicar del proyecto (borrador o en revisión).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, ApiError } from '@/services/http';
import type { VersionRow } from '@/types/versioning';
import {
  reportFileName, ownOpenVersions, productionLabel, readErrorText, vanishedVersionText, versionGoneText, versionOptionLabel,
} from './reportVersions';

const v = (over: Partial<VersionRow>): VersionRow => ({
  id: 'x', versionLabel: 'v1', title: null, owner: 'ana', status: 'draft', projectId: 'p1',
  deletesProject: false, reviewers: [], ...over,
});

describe('reportVersions', () => {
  it('solo mis draft / en revisión del proyecto, la más reciente primero', () => {
    const rows = [
      v({ id: 'a', updatedAt: '2026-09-01' }), v({ id: 'b', status: 'submitted', updatedAt: '2026-09-03' }),
      v({ id: 'c', owner: 'luis' }), v({ id: 'd', projectId: 'p2' }), v({ id: 'e', status: 'approved', appliedAt: 'x' }),
      v({ id: 'f', status: 'rejected' }),
    ];
    expect(ownOpenVersions(rows, 'p1', 'ana').map((r) => r.id)).toEqual(['b', 'a']);
    expect(ownOpenVersions(rows, 'p1', null)).toEqual([]);
  });
  it('etiquetas', () => {
    expect(versionOptionLabel(v({ versionLabel: 'v14', title: 'Carga Excel' }))).toBe('v14 · Carga Excel — draft');
    expect(versionOptionLabel(v({ versionLabel: 'v14', title: 'v14', status: 'submitted' }))).toBe('v14 — in review');
    expect(productionLabel(v({ versionLabel: 'v12', status: 'approved' }))).toBe('Production · v12');
    expect(productionLabel(null)).toBe('Production');
  });
  it('nombre del Excel por hojas: la versión propia va en el nombre', () => {
    const d = new Date(2026, 8, 28, 12, 0, 0);   // hora local: el nombre usa la fecha local
    expect(reportFileName('MODELO VENTAS', null, d)).toBe('data-model-hub-report-MODELO_VENTAS-2026-09-28.xlsx');
    expect(reportFileName('MODELO VENTAS', 'v14', d)).toBe('data-model-hub-report-MODELO_VENTAS-v14-2026-09-28.xlsx');
  });
  it('la fecha del nombre es la local de quien exporta (como la plantilla), no la UTC', () => {
    // Lima 23:59 ya es el día siguiente en UTC; 00:00 de un huso al este de UTC, el anterior.
    expect(reportFileName('MODELO VENTAS', null, new Date(2026, 8, 28, 23, 59, 59)))
      .toBe('data-model-hub-report-MODELO_VENTAS-2026-09-28.xlsx');
    expect(reportFileName('MODELO VENTAS', 'v14', new Date(2026, 8, 28, 0, 0, 1)))
      .toBe('data-model-hub-report-MODELO_VENTAS-v14-2026-09-28.xlsx');
  });
});

// Una versión transferida (403) o eliminada (404) no muestra el texto del canvas
// («Only published versions and your own drafts can be opened in the canvas…»):
// en modo versión se dice qué pasó; en producción, el error tal cual.
describe('errores de lectura del modo versión', () => {
  const FORBIDDEN = 'Only published versions and your own drafts can be opened in the canvas. Administrators can open any version.';
  // Como los arma http.ts con la respuesta del backend: FastAPI siempre manda `detail`.
  const backend = (message: string, status: number) => new ApiError(message, status, message);
  const e403 = backend(FORBIDDEN, 403);
  const e404 = backend('Version not found.', 404);
  const e409 = backend('That version is no longer open — it was published or closed. Pick another version.', 409);

  it('403 = se transfirió; 404 = se eliminó; lo demás no es «se fue»', () => {
    expect(versionGoneText(e403)).toBe('This version is no longer available to you — showing Production.');
    expect(versionGoneText(e404)).toBe('This version was deleted — showing Production.');
    expect(versionGoneText(e409)).toBeNull();
    expect(versionGoneText(backend('boom', 500))).toBeNull();
    expect(versionGoneText(new ApiError('Network error', 0))).toBeNull();
    expect(versionGoneText(new Error('403'))).toBeNull();
    expect(versionGoneText(undefined)).toBeNull();
  });

  it('texto del toast: en modo versión, el mapeo; si no, el mensaje del backend o el de respaldo', () => {
    expect(readErrorText(e403, 'Could not load.', true)).toBe('This version is no longer available to you — showing Production.');
    expect(readErrorText(e404, 'Could not load.', true)).toBe('This version was deleted — showing Production.');
    expect(readErrorText(e409, 'Could not load.', true)).toBe(e409.message);
    expect(readErrorText(e403, 'Could not load.', false)).toBe(FORBIDDEN);   // producción: sin «showing Production»
    expect(readErrorText('x', 'Could not load.', true)).toBe('Could not load.');
    expect(readErrorText(new Error(''), 'Could not load.', false)).toBe('Could not load.');
  });
});

// Al re-listar, la versión elegida no aparece entre las versiones abiertas
// propias. «No longer open» sería inexacto si se transfirió o se eliminó: el
// texto se decide con su cabecera (o el error al leerla).
describe('por qué desapareció la versión elegida', () => {
  const closed = 'That version is no longer open — showing Production.';
  it('eliminada (404), transferida (403 o con otro dueño), o publicada/cerrada', () => {
    expect(vanishedVersionText({ error: new ApiError('Version not found.', 404, 'Version not found.') }, 'ana')).toBe('This version was deleted — showing Production.');
    expect(vanishedVersionText({ error: new ApiError('Forbidden', 403, 'Forbidden') }, 'ana')).toBe('This version is no longer available to you — showing Production.');
    expect(vanishedVersionText({ header: { owner: 'beto', status: 'draft' } }, 'ana')).toBe('This version is no longer available to you — showing Production.');
    expect(vanishedVersionText({ header: { owner: 'ana', status: 'approved' } }, 'ana')).toBe(closed);
    expect(vanishedVersionText({ header: { owner: 'ana', status: 'rejected' } }, 'ana')).toBe(closed);
  });
  it('si la cabecera no se pudo leer, el texto genérico', () => {
    expect(vanishedVersionText({ error: new ApiError('Bad gateway', 502) }, 'ana')).toBe(closed);
    expect(vanishedVersionText({ error: new Error('offline') }, 'ana')).toBe(closed);
  });
});

// Un 403/404 de infraestructura — el HTML del proxy de Databricks, o el 404
// genérico de una ruta que el backend no tiene (front desplegado antes que el
// back) — no se anuncia como «no longer available to you» / «was deleted» ni
// cambia la versión en pantalla. Solo se atribuye a la versión un error del
// backend: trae `detail` (FastAPI siempre lo manda).
describe('un 403/404 que no es del backend no es de la versión', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const closed = 'That version is no longer open — showing Production.';

  it('403 HTML del proxy (por http.ts: sin JSON ⇒ sin detail): el error tal cual', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Forbidden</html>', { status: 403, headers: { 'Content-Type': 'text/html' } })));
    const err = await apiGet('/api/reporting/tables?projectId=p1&changesetId=cs1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(versionGoneText(err)).toBeNull();
    expect(readErrorText(err, 'Could not load.', true)).toBe('Invalid JSON response (HTTP 403)');
    expect(vanishedVersionText({ error: err }, 'ana')).toBe(closed);
  });

  it('404 HTML, o el «Not Found» genérico de una ruta inexistente, tampoco', () => {
    expect(versionGoneText(new ApiError('Invalid JSON response (HTTP 404)', 404))).toBeNull();
    expect(versionGoneText(new ApiError('Not Found', 404, 'Not Found'))).toBeNull();
    expect(readErrorText(new ApiError('Not Found', 404, 'Not Found'), 'Could not load.', true)).toBe('Not Found');
  });
});
