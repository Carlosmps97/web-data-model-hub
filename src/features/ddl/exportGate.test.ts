import { describe, expect, it } from 'vitest';
import { exportGate, initialMode } from './exportGate';

// El popup no exporta hasta tener las Output settings y la lista de reglas (de
// ella sale con qué opción abre); con «Use export rules», al menos una marcada.
describe('exportGate', () => {
  const base = { settingsReady: true, rulesReady: true, rulesFailed: false, mode: 'rules' as const, rulesSelected: 3 };
  it('todo cargado ⇒ listo', () => {
    expect(exportGate(base)).toEqual({ ready: true, note: null });
    expect(exportGate({ ...base, mode: 'settings', rulesSelected: 0 })).toEqual({ ready: true, note: null });
  });
  it('mientras cargan las settings o la lista de reglas ⇒ bloqueado con aviso', () => {
    for (const i of [{ ...base, settingsReady: false }, { ...base, rulesReady: false }, { ...base, mode: 'settings' as const, rulesReady: false }]) {
      expect(exportGate(i)).toEqual({ ready: false, note: 'Loading the project settings…' });
    }
  });
  it('si la lista de reglas no llegó ⇒ bloqueado con aviso, con cualquier opción', () => {
    for (const mode of ['rules', 'settings'] as const) {
      expect(exportGate({ ...base, mode, rulesFailed: true }))
        .toEqual({ ready: false, note: "Couldn't load the export rules — reopen the dialog to try again." });
    }
  });
  it('«Use export rules» sin ninguna regla marcada ⇒ bloqueado con aviso', () => {
    expect(exportGate({ ...base, rulesSelected: 0 })).toEqual({ ready: false, note: 'Select at least one export rule.' });
  });
});

describe('initialMode', () => {
  it('con reglas activas abre en «Use export rules»; sin reglas, en «Use export settings»', () => {
    expect(initialMode(2)).toBe('rules');
    expect(initialMode(0)).toBe('settings');
  });
});
