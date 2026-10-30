/**
 * Compuerta del modal Export DDL. El popup no exporta hasta tener las Output
 * settings del proyecto (cómo se escribe con «Use export settings») y la lista
 * de reglas (de ella sale con qué opción abre: con reglas activas, «Use export
 * rules»); así no se exporta con lo de un export anterior ni la opción cambia
 * después de exportar. Si la lista no llega no se exporta (con ninguna opción:
 * un proyecto que exporta con reglas no debe salir con la configuración sin
 * notarlo). Con «Use export rules» hace falta al menos una regla marcada. Pura.
 */
export type ExportMode = 'settings' | 'rules';

export interface ExportGateInput {
  settingsReady: boolean;
  /** La lista de reglas del proyecto ya llegó (o falló). */
  rulesReady: boolean;
  /** La lista no se pudo cargar: no se sabe con qué opción exportaría el proyecto. */
  rulesFailed: boolean;
  mode: ExportMode;
  rulesSelected: number;
}

export interface ExportGate {
  ready: boolean;
  /** Aviso para el usuario cuando no está listo. */
  note: string | null;
}

/** Con qué opción abre el popup: con reglas activas, «Use export rules». */
export const initialMode = (activeRules: number): ExportMode => (activeRules > 0 ? 'rules' : 'settings');

export function exportGate(i: ExportGateInput): ExportGate {
  if (!i.settingsReady || !i.rulesReady) return { ready: false, note: 'Loading the project settings…' };
  if (i.rulesFailed) return { ready: false, note: "Couldn't load the export rules — reopen the dialog to try again." };
  if (i.mode === 'rules' && i.rulesSelected === 0) return { ready: false, note: 'Select at least one export rule.' };
  return { ready: true, note: null };
}
