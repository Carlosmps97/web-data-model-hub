/**
 * Compuerta del modal Export DDL. El DDL depende de dos cargas del proyecto:
 * las Output settings (cómo se escribe) y las defs UDP (qué columnas son
 * partición). Mientras no llegan, el modal no exporta ni se edita la pestaña
 * Output; si no, la física (front) y la _rej (motor) podrían salir con
 * particiones distintas, o una edición temprana quedaría pisada. Si las defs UDP
 * fallan, el export nativo (sin reglas) sigue; con reglas no. Tampoco se exporta
 * hasta tener la lista de reglas del proyecto: así no se exporta con la selección
 * de un export anterior ni con una regla que no se ve ni se puede desmarcar. Si
 * la lista no llega, el export Databricks se bloquea con aviso. Pura.
 */
export interface ExportGateInput {
  settingsReady: boolean;
  udpDefsReady: boolean;
  udpDefsFailed: boolean;
  /** La lista de reglas del proyecto ya llegó (o falló). */
  rulesReady: boolean;
  /** La lista de reglas no se pudo cargar: no se sabe qué correría. */
  rulesFailed: boolean;
  rulesSelected: number;
}

export interface ExportGate {
  ready: boolean;
  /** Aviso para el usuario cuando no está listo. */
  note: string | null;
}

export function exportGate(i: ExportGateInput): ExportGate {
  if (!i.settingsReady || !i.udpDefsReady || !i.rulesReady) return { ready: false, note: 'Loading the project settings…' };
  if (i.rulesFailed) return { ready: false, note: "Couldn't load the export rules — reopen the dialog to try again." };
  if (i.udpDefsFailed && i.rulesSelected > 0) {
    return { ready: false, note: "Couldn't load the UDP definitions — the export rules can't run. Reopen the dialog, or unselect the rules." };
  }
  return { ready: true, note: null };
}
