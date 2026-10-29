// Lo que esta pestaña sabe del contador de escrituras de su versión
// (`writeSeq`): el candado del Undo lo usa para saber si alguien más escribió
// después de que empezó la acción que se quiere deshacer.
import { beforeEach, describe, expect, it } from 'vitest';
import { announceDraftWrite } from './changeset.service';
import { foreignWrites, forgetDraftSeqs, markDraft, noteSeen, unconfirmedSince } from './draftSeqs';

const CS = 'cs1';

beforeEach(() => forgetDraftSeqs());

describe('draftSeqs', () => {
  it('los números de las escrituras avisadas son de esta pestaña: no cuentan como ajenos', () => {
    announceDraftWrite(CS, [], 4);
    announceDraftWrite(CS, [], 5);
    expect(foreignWrites(CS, 3, 5)).toEqual([]);
  });

  it('un número que esta pestaña no escribió es ajeno', () => {
    announceDraftWrite(CS, [], 4);
    expect(foreignWrites(CS, 3, 6)).toEqual([5, 6]);
  });

  it('solo cuenta lo posterior a la base, hasta el contador leído', () => {
    expect(foreignWrites(CS, 6, 6)).toEqual([]);
    expect(foreignWrites(CS, 5, 7)).toEqual([6, 7]);
  });

  // «Visto» = lo que trae una carga del diagrama: sus datos están en pantalla. Una
  // escritura propia o una lectura del contador no recargan nada.
  it('la marca guarda lo más alto que trajo una carga; las escrituras propias no lo suben', () => {
    expect(markDraft(CS)).toEqual({ seen: null, unconfirmed: 0, first: null });
    noteSeen(CS, 10);
    announceDraftWrite(CS, [], 12);
    noteSeen(CS, 9);    // una carga más vieja no baja lo visto
    noteSeen(CS, undefined);
    expect(markDraft(CS)?.seen).toBe(10);
  });

  it('sin nada visto, cuenta desde la primera escritura propia de la sesión', () => {
    announceDraftWrite(CS, [], 20);
    expect(foreignWrites(CS, null, 22)).toEqual([21, 22]);
    expect(markDraft(CS)).toEqual({ seen: null, unconfirmed: 0, first: 20 });
  });

  it('una escritura sin respuesta no da un primer número (no se sabe cuál fue)', () => {
    announceDraftWrite(CS, [], undefined, true);
    expect(markDraft(CS)).toEqual({ seen: null, unconfirmed: 0, first: null });
  });

  it('sin base (nada visto al empezar la acción), cuenta desde lo primero visto en la sesión', () => {
    noteSeen(CS, 20);
    noteSeen(CS, 25);
    expect(foreignWrites(CS, null, 22)).toEqual([21, 22]);
  });

  it('sin base y sin nada visto antes, solo cuenta lo que se ve en esa lectura (nada)', () => {
    expect(foreignWrites(CS, null, 9)).toEqual([]);
  });

  it('cada versión lleva lo suyo', () => {
    announceDraftWrite('otra', [], 5);
    expect(foreignWrites(CS, 4, 5)).toEqual([5]);
  });

  it('una escritura sin respuesta cuenta como sin confirmar; una rechazada (sin número) no', () => {
    const before = markDraft(CS);
    announceDraftWrite(CS, [], undefined, true);
    announceDraftWrite(CS, [], undefined);
    expect(unconfirmedSince(CS, before)).toBe(1);
    expect(unconfirmedSince(CS, null)).toBe(1);
  });

  // El candado mira lo escrito desde la última carga: las escrituras sin
  // respuesta se cuentan desde ahí también (no desde que empezó la acción).
  it('la marca cuenta lo sin confirmar desde la última carga', () => {
    noteSeen(CS, 5);
    announceDraftWrite(CS, [], undefined, true);       // después de la carga, antes de la acción
    expect(unconfirmedSince(CS, markDraft(CS))).toBe(1);
    noteSeen(CS, 7);                                    // una carga nueva lo incluye
    expect(unconfirmedSince(CS, markDraft(CS))).toBe(0);
  });

  it('forgetDraftSeqs lo olvida todo (cambio de sesión)', () => {
    announceDraftWrite(CS, [], 3);
    announceDraftWrite(CS, [], undefined, true);
    forgetDraftSeqs();
    expect(markDraft(CS)).toEqual({ seen: null, unconfirmed: 0, first: null });
    expect(foreignWrites(CS, 2, 3)).toEqual([3]);
  });

  it('sin versión no hay marca', () => {
    expect(markDraft(null)).toBeNull();
    expect(markDraft(undefined)).toBeNull();
  });
});
