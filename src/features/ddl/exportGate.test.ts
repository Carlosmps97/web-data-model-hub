import { describe, expect, it } from 'vitest';
import { exportGate } from './exportGate';

// Final review #7/#15: el modal no exporta (ni se edita la pestaña Output) hasta
// tener lo que decide el DDL — las Output settings del proyecto y las defs UDP
// (particiones): sin ellas la física y la _rej podían salir con particiones distintas.
describe('exportGate', () => {
  const base = { settingsReady: true, udpDefsReady: true, udpDefsFailed: false, rulesSelected: 3 };
  it('todo cargado ⇒ listo', () => {
    expect(exportGate(base)).toEqual({ ready: true, note: null });
  });
  it('mientras carga settings o defs UDP ⇒ bloqueado con aviso', () => {
    expect(exportGate({ ...base, settingsReady: false }).ready).toBe(false);
    expect(exportGate({ ...base, udpDefsReady: false })).toEqual({ ready: false, note: 'Loading the project settings…' });
  });
  it('defs UDP fallidas: con reglas ⇒ bloqueado; sin reglas (export nativo) ⇒ listo', () => {
    const failed = { ...base, udpDefsFailed: true };
    expect(exportGate(failed).ready).toBe(false);
    expect(exportGate(failed).note).toMatch(/UDP definitions/);
    expect(exportGate({ ...failed, rulesSelected: 0 })).toEqual({ ready: true, note: null });
  });
});
