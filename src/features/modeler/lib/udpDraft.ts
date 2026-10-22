/**
 * Lógica pura del guardado de UDPs por blur.
 *
 * Los inputs de texto/número/fecha de UdpAssign commitean al salir del campo
 * (blur) y no por tecla: un commit por carácter dispararía un upsert + reload
 * del diagrama por cada tecla, y el input, atado al prop del server, perdería
 * teclas al tipear rápido. Como el reload demora, un commit posterior armado
 * sobre el prop desactualizado pisaría lo recién guardado en otro campo:
 * `pending` es el overlay de commits que el server no refleja aún. En
 * `pending`, cadena vacía = delete.
 */

export type UdpValues = Record<string, string>;

/** Base efectiva: el prop del server con los commits pendientes encima. */
export function applyPending(values: UdpValues, pending: UdpValues): UdpValues {
  const eff = { ...values };
  for (const [k, v] of Object.entries(pending)) {
    if (v === '') delete eff[k]; else eff[k] = v;
  }
  return eff;
}

/** Mapa siguiente tras commitear un campo ('' elimina la key → rige el default). */
export function commitValue(base: UdpValues, id: string, v: string): UdpValues {
  const next = { ...base };
  if (v === '') delete next[id]; else next[id] = v;
  return next;
}

/** Poda los pendientes que el prop nuevo ya refleja (llegó el reload). */
export function prunePending(values: UdpValues, pending: UdpValues): UdpValues {
  const next: UdpValues = {};
  for (const [k, v] of Object.entries(pending)) {
    if ((values[k] ?? '') !== v) next[k] = v;
  }
  return next;
}

/** Lo que la ficha modificó respecto de cómo se abrió ('' = quitar). Se graba
 *  solo eso, sobre los valores vigentes del canvas: si mientras tanto aterrizó
 *  otro guardado, la ficha abierta con los valores previos no lo pisa. */
export function udpChanges(initial: UdpValues, values: UdpValues): UdpValues {
  const out: UdpValues = {};
  for (const k of new Set([...Object.keys(initial), ...Object.keys(values)])) {
    const v = values[k] ?? '';
    if (v !== (initial[k] ?? '')) out[k] = v;
  }
  return out;
}
