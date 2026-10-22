/**
 * Regla de case del físico tipeado — espejo de
 * `app/core/naming/engine.apply_case` (el backend es autoritativo: la aplica
 * en el choke point de changesets a todo upsert de columna).
 *
 * `naming_config[column].case` rige tanto al derivar el físico del lógico
 * (physicalize) como al tipear el físico directo (popup New column en modo
 * Physical, panel Properties). El front aplica la misma regla para que la UI
 * muestre lo que se va a persistir.
 *
 *  - 'upper' / 'lower': sobre el string completo.
 *  - 'camel': re-segmenta por `_` / `-` / espacios con el mismo armado del
 *    motor; sin separadores deja lo tipeado tal cual (no hay cómo re-segmentar
 *    «mtoDeu» sin perderlo).
 *  - regla ausente/desconocida ⇒ 'upper' (default sembrado por el backend).
 * Idempotente; no abrevia ni toca el lógico.
 */
export type NamingCase = 'upper' | 'lower' | 'camel';

const SEGMENT_SPLIT = /[_\-\s]+/;

export function applyNamingCase(physical: string, mode: string | null | undefined): string {
  const m: NamingCase = mode === 'lower' || mode === 'camel' ? mode : 'upper';
  if (m === 'upper') return physical.toUpperCase();
  if (m === 'lower') return physical.toLowerCase();
  const segments = physical.split(SEGMENT_SPLIT).filter(Boolean);
  if (segments.length <= 1) return physical;
  const [head, ...tail] = segments;
  return head.toLowerCase() + tail.map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join('');
}
