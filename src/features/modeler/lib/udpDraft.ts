/**
 * Lógica pura del guardado de UDPs por blur (doc 40).
 *
 * Los inputs de texto/número/fecha de UdpAssign commitean al SALIR del campo
 * (blur) en vez de por tecla — antes cada carácter disparaba un upsert + reload
 * del diagrama y el input, atado al prop del server, perdía teclas al tipear
 * rápido. Como el reload demora, un commit posterior armado sobre el prop
 * STALE pisaría lo recién guardado en otro campo: `pending` es el overlay de
 * commits que el server todavía no refleja. En `pending`, cadena vacía = delete.
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

/** Mapa siguiente tras commitear UN campo ('' elimina la key → rige el default). */
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
