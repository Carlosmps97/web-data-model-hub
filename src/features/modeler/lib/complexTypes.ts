// Colapso visual de tipos complejos para el canvas (F4 #6, spec §6).
// Puro y sin dependencias — el nodo muestra `STRUCT<…>` con tooltip del tipo
// completo; el DDL (generators.ts) emite el tipo real verbatim.

/** `STRUCT<a:INT,b:STRING>` → `STRUCT<…>`; tipos simples quedan tal cual. */
export function collapseComplexType(dataType: string): string {
  const t = (dataType ?? '').trim();
  const lt = t.indexOf('<');
  if (lt === -1) return t;
  return `${t.slice(0, lt).trim().toUpperCase()}<…>`;
}

/** true si el tipo se colapsa (⇒ el nodo necesita tooltip con el tipo completo). */
export function isComplexType(dataType: string): boolean {
  return (dataType ?? '').includes('<');
}
