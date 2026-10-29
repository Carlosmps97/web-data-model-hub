import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { announceDraftWrite } from '@/services/changeset.service';
import { forgetDraftSeqs, noteSeen } from '@/services/draftSeqs';
import {
  SessionChangedError, afterRevalidation, isVersionError, isVersionHeaderUrl, pinSession, reportWriteError, sessionFate,
  setCanvasSource, stillAskedSession, touchesChangeset, touchesVersion, trackRevalidation,
} from './sessionGuard';

const names = (id: string) => ({ carla: 'Carla Ruiz' }[id] ?? id);
const base = { changesetId: 'cs1', versionLabel: 'v14', me: 'ana', canViewAll: false, userName: names };
const draft = { status: 'draft' as const, owner: 'ana', reviewers: [] as string[], appliedAt: null };

describe('sessionFate', () => {
  it('draft propio en edición: la sesión sigue', () => {
    expect(sessionFate({ ...base, mode: 'editing', cs: draft })).toEqual({ kind: 'keep' });
  });

  it('versión eliminada: sale al chooser con aviso', () => {
    const f = sessionFate({ ...base, mode: 'editing', cs: null });
    expect(f.kind).toBe('close');
    expect(f.kind === 'close' && f.message).toMatch(/v14.*deleted/i);
    expect(sessionFate({ ...base, mode: 'readonly', cs: null }).kind).toBe('close');
  });

  it('transferida a otro y sin acceso a ella: producción en solo lectura', () => {
    const f = sessionFate({ ...base, mode: 'editing', cs: { ...draft, owner: 'carla' } });
    expect(f).toEqual({ kind: 'readonly', changesetId: null, message: expect.stringMatching(/transferred to Carla Ruiz/) });
  });

  it('transferida pero aún visible (administrador o quien revisa): la misma versión en solo lectura', () => {
    const admin = sessionFate({ ...base, canViewAll: true, mode: 'editing', cs: { ...draft, owner: 'carla' } });
    expect(admin).toEqual({ kind: 'readonly', changesetId: 'cs1', message: expect.stringMatching(/transferred to Carla Ruiz/) });
    const reviewer = sessionFate({ ...base, mode: 'editing', cs: { ...draft, owner: 'carla', reviewers: ['ana'] } });
    expect(reviewer.kind === 'readonly' && reviewer.changesetId).toBe('cs1');
  });

  it('propia pero fuera de draft (enviada o decidida en otra pestaña): la misma versión en solo lectura', () => {
    const f = sessionFate({ ...base, mode: 'editing', cs: { ...draft, status: 'submitted' } });
    expect(f).toEqual({ kind: 'readonly', changesetId: 'cs1', message: expect.stringMatching(/no longer in draft/) });
  });

  it('visor de una versión ajena que dejó de ser visible: producción, sin afirmar una transferencia', () => {
    const f = sessionFate({ ...base, mode: 'readonly', cs: { ...draft, owner: 'carla' } });
    expect(f.kind === 'readonly' && f.changesetId).toBeNull();
    expect(f.kind === 'readonly' && f.message).not.toMatch(/transferred|no longer/);   // p. ej. se reasignó la revisión a otra persona, o nunca pudo verla
    expect(f.kind === 'readonly' && f.message).toMatch(/isn't available to you/);
    // visible (publicada, propia, de quien revisa, admin): sigue igual
    expect(sessionFate({ ...base, mode: 'readonly', cs: { ...draft, status: 'submitted' } })).toEqual({ kind: 'keep' });
    expect(sessionFate({ ...base, mode: 'readonly', cs: { ...draft, owner: 'carla', status: 'approved', appliedAt: '2026-09-01' } }))
      .toEqual({ kind: 'keep' });
  });
});

describe('sessionFate — dueño ausente', () => {
  it('una sesión de edición sobre un draft sin dueño no dice «no longer in draft (draft)»', () => {
    const f = sessionFate({ ...base, mode: 'editing', cs: { ...draft, owner: null } });
    expect(f.kind).toBe('readonly');
    expect(f.kind === 'readonly' && f.message).not.toMatch(/no longer in draft/);
  });
});

describe('isVersionError', () => {
  const id = '5f2c1d7e-aaaa-bbbb-cccc-0123456789ab';
  it('403/404 de la versión abierta sí; otra URL, otro código o sin versión no', () => {
    expect(isVersionError(new ApiError('gone', 404, null, `/api/changesets/${id}/effective/projects`), id)).toBe(true);
    expect(isVersionError(new ApiError('no', 403, null, `/api/subject-areas/sa1/diagram?changesetId=${id}`), id)).toBe(true);
    expect(isVersionError(new ApiError('Project not found.', 404, null, '/api/projects/p1/folders'), id)).toBe(false);
    // «This project was deleted.» (409) es el borrado del proyecto
    expect(isVersionError(new ApiError('This project was deleted.', 409, null, `/api/changesets/${id}/effective/x`), id)).toBe(false);
    expect(isVersionError(new Error('x'), id)).toBe(false);
    expect(isVersionError(new ApiError('gone', 404, null, `/api/changesets/${id}`), null)).toBe(false);
  });
});

describe('touchesChangeset', () => {
  it('reconoce la versión en la ruta o en el query string, nunca otra ni un snapshot', () => {
    const id = '5f2c1d7e-aaaa-bbbb-cccc-0123456789ab';
    expect(touchesChangeset(`/api/changesets/${id}/changes`, id)).toBe(true);
    expect(touchesChangeset(`/api/subject-areas/sa1/diagram?changesetId=${id}`, id)).toBe(true);
    expect(touchesChangeset(`https://host/api/changesets/${id}`, id)).toBe(true);
    expect(touchesChangeset('/api/changesets/otra/changes', id)).toBe(false);
    expect(touchesChangeset(`/api/changesets/${id}0/changes`, id)).toBe(false);      // prefijo de otro id
    expect(touchesChangeset(`/api/changesets/asof:${id}/effective/x`, `asof:${id}`)).toBe(false);
    expect(touchesChangeset('/api/changesets/x', null)).toBe(false);
  });
});

describe('isVersionHeaderUrl', () => {
  // La revalidación lee la cabecera de la versión; si esa lectura falla (p. ej.
  // un 403 del proxy de Databricks), el observador no debe volver a dispararla:
  // sería un bucle de peticiones sin fin.
  const id = '5f2c1d7e-aaaa-bbbb-cccc-0123456789ab';
  it('solo la cabecera exacta de la versión', () => {
    expect(isVersionHeaderUrl(`/api/changesets/${id}`, id)).toBe(true);
    expect(isVersionHeaderUrl(`https://h/api/changesets/${id}?x=1`, id)).toBe(true);
    expect(isVersionHeaderUrl(`/api/changesets/${id}/changes`, id)).toBe(false);
    expect(isVersionHeaderUrl(`/api/subject-areas/sa1/diagram?changesetId=${id}`, id)).toBe(false);
    expect(isVersionHeaderUrl(`/api/changesets/${id}`, null)).toBe(false);
  });
});

describe('touchesVersion', () => {
  const id = '5f2c1d7e-aaaa-bbbb-cccc-0123456789ab';
  it('403/404/409 de la versión: pueden deberse a un cambio de la versión por fuera', () => {
    expect(touchesVersion(new ApiError('x', 409, null, `/api/changesets/${id}/changes`), id)).toBe(true);
    expect(touchesVersion(new ApiError('x', 403, null, `/api/changesets/${id}/changes`), id)).toBe(true);
    expect(touchesVersion(new ApiError('x', 500, null, `/api/changesets/${id}/changes`), id)).toBe(false);
    expect(touchesVersion(new ApiError('x', 409, null, '/api/projects/p1/folders'), id)).toBe(false);
  });
});

describe('afterRevalidation', () => {
  // Quien recibe un error de su versión espera a la revalidación en curso
  // antes de avisar: si la sesión es otra, la revalidación ya dio el aviso
  // correcto; si no (p. ej. le quitaron el rol), el error real se muestra.
  it('espera a la revalidación registrada y resuelve aunque falle', async () => {
    let done = false;
    let release!: () => void;
    trackRevalidation(new Promise<void>((r) => { release = r; }).then(() => { done = true; }));
    const waiting = afterRevalidation();
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await waiting;
    expect(done).toBe(true);
    trackRevalidation(Promise.reject(new Error('boom')));
    await expect(afterRevalidation()).resolves.toBeUndefined();
  });

  it('sin revalidación en curso no espera', async () => {
    await expect(afterRevalidation()).resolves.toBeUndefined();
  });
});

// Una carga que falla (el Explorer al abrir una versión, la recarga del
// canvas) se avisa solo si la sesión sigue siendo la pedida: un error de la
// versión espera la revalidación (si la cambia, ella avisa); un error tardío
// de una sesión que el usuario ya dejó no se muestra en la nueva.
describe('stillAskedSession', () => {
  const v403 = new ApiError('Invalid JSON response (HTTP 403)', 403, null, '/api/changesets/cs1/effective/projects');
  const KEY = 'editing|p|cs1';

  it('500 o red con la misma sesión: se avisa, sin esperar nada', async () => {
    let done = false;
    trackRevalidation(new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 20)));
    expect(await stillAskedSession(new ApiError('boom', 500, null, '/api/x'), 'cs1', KEY, () => KEY)).toBe(true);
    expect(done).toBe(false);                       // un error que no es de la versión no espera la revalidación
    await afterRevalidation();
  });

  it('403 de la versión y la revalidación cambia la sesión: se calla (ya avisó ella)', async () => {
    let key = KEY;
    trackRevalidation(new Promise<void>((r) => setTimeout(() => { key = 'readonly|p|'; r(); }, 20)));
    expect(await stillAskedSession(v403, 'cs1', KEY, () => key)).toBe(false);
  });

  it('403 de la versión y la sesión sigue igual (proxy solo en lecturas): se avisa, después de la revalidación', async () => {
    let done = false;
    trackRevalidation(new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 20)));
    expect(await stillAskedSession(v403, 'cs1', KEY, () => KEY)).toBe(true);
    expect(done).toBe(true);
  });

  it('error tardío de una sesión que el usuario ya dejó (abrió otra): se calla', async () => {
    expect(await stillAskedSession(new ApiError('timeout', 0, null, '/api/x'), 'cs1', KEY, () => 'editing|p|cs2')).toBe(false);
  });
});

// Una acción de varias escrituras (la inversa de un Undo, borrar una tabla) es
// de la sesión donde empezó. Los servicios toman la versión al llamarlos: si en
// el medio se abre otra versión (u otro modo), lo que falta se escribiría en
// ella. El pin corta antes de cada escritura.
describe('pinSession', () => {
  const open = (mode: 'editing' | 'readonly', changesetId?: string, projectId = 'p') =>
    useSessionStore.getState().openModel({ projectId, mode, changesetId });

  it('sostiene mientras la sesión no cambie', () => {
    open('editing', 'cs1');
    const pin = pinSession();
    expect(pin.holds()).toBe(true);
    expect(() => pin.check()).not.toThrow();
  });

  it.each([
    ['otra versión', () => open('editing', 'cs2')],
    ['otro modo (la revalidación la degradó)', () => open('readonly', 'cs1')],
    ['otro proyecto', () => open('editing', 'cs1', 'q')],
    ['sesión cerrada', () => useSessionStore.getState().closeModel()],
  ])('corta con SessionChangedError si la sesión cambia: %s', (_label, change) => {
    open('editing', 'cs1');
    const pin = pinSession();
    change();
    expect(pin.holds()).toBe(false);
    expect(() => pin.check()).toThrow(SessionChangedError);
  });

  it('también si la sesión cambia y vuelve a la misma (editar → solo lectura → editar)', () => {
    open('editing', 'cs1');
    const pin = pinSession();
    open('readonly', 'cs1');
    open('editing', 'cs1');
    expect(pin.holds()).toBe(false);
  });

  // El candado del Undo: la acción recuerda en qué canvas se hizo y qué había
  // visto de su versión al empezar (lo posterior que no sea suyo es ajeno).
  it('recuerda el canvas abierto al empezar (null sin canvas) y lo visto de la versión', () => {
    open('editing', 'cs1');
    forgetDraftSeqs();
    let canvas: string | null = 'sa1';
    setCanvasSource(() => canvas);
    try {
      noteSeen('cs1', 7);                        // la carga del canvas
      announceDraftWrite('cs1', [], 9);          // una escritura propia no recarga nada
      announceDraftWrite('cs1', [], undefined, true);
      const pin = pinSession();
      canvas = null;
      announceDraftWrite('cs1', [], 10);
      expect([pin.canvasId, pin.mark]).toEqual(['sa1', { seen: 7, unconfirmed: 0 }]);   // lo sin confirmar, desde la carga
      expect(pinSession().canvasId).toBeNull();
    } finally {
      setCanvasSource(() => null);
    }
  });

  it('sin versión abierta no hay marca', () => {
    useSessionStore.getState().closeModel();
    expect(pinSession().mark).toBeNull();
  });

  it('lo que no es la sesión de canvas (etiqueta de versión, actor) no cuenta', () => {
    open('editing', 'cs1');
    const pin = pinSession();
    useSessionStore.setState({ activeVersionLabel: 'v2' });
    useSessionStore.getState().setSessionUser({ id: 'ana', name: 'Ana', initials: 'A' });
    expect(pin.holds()).toBe(true);
  });
});

// El aviso del fallo de una escritura pedida desde un componente (agregar una
// vista al canvas, borrar una tabla, guardar…) sigue el patrón de
// DeleteProjectDialog: la sesión se toma al pedir; un 403/404/409 de su versión
// espera la revalidación y, si la sesión es otra (transferida, eliminada,
// enviada —la revalidación ya avisó— o el usuario abrió otra), calla.
describe('reportWriteError', () => {
  const v403 = new ApiError('Only the owner can edit this version.', 403, null, '/api/changesets/cs1/changes');
  const open = (mode: 'editing' | 'readonly', changesetId?: string) =>
    useSessionStore.getState().openModel({ projectId: 'p', mode, changesetId });

  it('versión recién transferida: espera la revalidación y calla (ya avisó ella)', async () => {
    open('editing', 'cs1');
    const report = vi.fn();
    const onError = reportWriteError(report);
    trackRevalidation(new Promise<void>((r) => setTimeout(() => { open('readonly', 'cs1'); r(); }, 10)));
    await onError(v403);
    expect(report).not.toHaveBeenCalled();
  });

  it('la sesión sigue igual (rol perdido): avisa el error, después de la revalidación', async () => {
    open('editing', 'cs1');
    let revalidated = false;
    const report = vi.fn(() => { expect(revalidated).toBe(true); });
    const onError = reportWriteError(report);
    trackRevalidation(new Promise<void>((r) => setTimeout(() => { revalidated = true; r(); }, 10)));
    await onError(v403);
    expect(report).toHaveBeenCalledWith(v403);
  });

  it('un error que no es de la versión (red, 500): avisa sin esperar', async () => {
    open('editing', 'cs1');
    let revalidated = false;
    trackRevalidation(new Promise<void>((r) => setTimeout(() => { revalidated = true; r(); }, 20)));
    const report = vi.fn();
    const boom = new ApiError('Internal server error.', 500, null, '/api/changesets/cs1/changes');
    await reportWriteError(report)(boom);
    expect(report).toHaveBeenCalledWith(boom);
    expect(revalidated).toBe(false);
    await afterRevalidation();
  });

  it('la sesión se toma al pedir: si el usuario abrió otra versión antes de que llegue el error, calla', async () => {
    open('editing', 'cs1');
    const report = vi.fn();
    const onError = reportWriteError(report);
    open('editing', 'cs2');
    await onError(new Error('sin red'));
    expect(report).not.toHaveBeenCalled();
  });
});
