/**
 * Compuerta del modal Export DDL (final review #7/#15). El DDL depende de dos
 * cargas del proyecto: las Output settings (cómo se escribe) y las defs UDP
 * (qué columnas son partición). Mientras no llegan, el modal no exporta ni se
 * edita la pestaña Output — si no, la física (front) y la _rej (motor) podían
 * salir con particiones distintas, o una edición temprana quedaba pisada. Si
 * las defs UDP fallan, el export nativo (sin reglas) sigue; con reglas no. Pura.
 */
export interface ExportGateInput {
  settingsReady: boolean;
  udpDefsReady: boolean;
  udpDefsFailed: boolean;
  rulesSelected: number;
}

export interface ExportGate {
  ready: boolean;
  /** Aviso para el usuario cuando no está listo. */
  note: string | null;
}

export function exportGate(i: ExportGateInput): ExportGate {
  if (!i.settingsReady || !i.udpDefsReady) return { ready: false, note: 'Loading the project settings…' };
  if (i.udpDefsFailed && i.rulesSelected > 0) {
    return { ready: false, note: "Couldn't load the UDP definitions — the export rules can't run. Reopen the dialog, or unselect the rules." };
  }
  return { ready: true, note: null };
}
