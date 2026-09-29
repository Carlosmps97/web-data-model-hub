import { beforeEach, describe, expect, it } from 'vitest';
import { canvasClock, forgetCanvasWrites, noteCanvasWrite, writtenSince } from './canvasWrites';

const doc = (over: Record<string, unknown> = {}) => ({
  layout: { t1: { x: 1, y: 2 } }, routes: { r1: [{ x: 5, y: 6 }] }, ...over,
});

beforeEach(() => forgetCanvasWrites());

describe('canvasWrites — lo último grabado de cada canvas', () => {
  it('sin escrituras no hay nada más nuevo que un diagrama', () => {
    expect(writtenSince('cs1', 'sa1', canvasClock())).toBeNull();
    expect(writtenSince('cs1', 'sa1', 0)).toBeNull();
  });

  it('una escritura terminada DESPUÉS de pedir el diagrama lo deja viejo', () => {
    const asked = canvasClock();
    noteCanvasWrite('cs1', 'sa1', doc());
    expect(writtenSince('cs1', 'sa1', asked)).toEqual(doc());
  });

  it('un diagrama pedido después de la escritura ya la trae', () => {
    noteCanvasWrite('cs1', 'sa1', doc());
    expect(writtenSince('cs1', 'sa1', canvasClock())).toBeNull();
  });

  it('cuenta la ÚLTIMA escritura del canvas', () => {
    const asked = canvasClock();
    noteCanvasWrite('cs1', 'sa1', doc());
    noteCanvasWrite('cs1', 'sa1', doc({ routes: {} }));
    expect(writtenSince('cs1', 'sa1', asked)).toEqual(doc({ routes: {} }));
  });

  it('cada canvas y cada working copy por separado', () => {
    const asked = canvasClock();
    noteCanvasWrite('cs1', 'sa1', doc());
    expect(writtenSince('cs1', 'sa2', asked)).toBeNull();
    expect(writtenSince('cs2', 'sa1', asked)).toBeNull();
    expect(writtenSince(null, 'sa1', asked)).toBeNull();
  });

  it('un canvas borrado deja de contar', () => {
    const asked = canvasClock();
    noteCanvasWrite('cs1', 'sa1', doc());
    noteCanvasWrite('cs1', 'sa1', null);
    expect(writtenSince('cs1', 'sa1', asked)).toBeNull();
  });

  it('sin `layout` o sin `routes` en lo grabado devuelve mapas vacíos', () => {
    const asked = canvasClock();
    noteCanvasWrite('cs1', 'sa1', {});
    expect(writtenSince('cs1', 'sa1', asked)).toEqual({ layout: {}, routes: {} });
  });

  it('no guarda referencia a lo que recibió', () => {
    const asked = canvasClock();
    const written = doc();
    noteCanvasWrite('cs1', 'sa1', written);
    written.layout.t1.x = 999;
    (written.routes as Record<string, unknown>).r9 = [];
    expect(writtenSince('cs1', 'sa1', asked)).toEqual(doc());
  });
});
