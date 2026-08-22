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

// ── Builder estructurado de tipos complejos (ColumnEditor) ────────────────
// Parse/compose PUROS del texto del tipo. Las "subcolumnas" de un STRUCT no
// son columnas reales: el tipo sigue siendo un string (el DDL lo emite
// verbatim); esto solo permite editarlo campo a campo en vez de tipear la
// estructura lineal a mano. Round-trip estable: parse(compose(s)) == s.

export type ComplexSpec =
  | { kind: 'struct'; fields: Array<{ name: string; type: string }> }
  | { kind: 'array'; element: string }
  | { kind: 'map'; key: string; value: string };

/** Corta `inner` por `sep` de PROFUNDIDAD 0 (respeta <> y () anidados). */
function splitTop(inner: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '<' || ch === '(') depth += 1;
    else if (ch === '>' || ch === ')') depth -= 1;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * `STRUCT<a:INT,b:STRING>` / `ARRAY<INT>` / `MAP<STRING,INT>` → spec editable.
 * `null` si el texto no es un complejo bien formado (se sigue editando como
 * texto). Interior vacío (`STRUCT<>`) es válido: estructura recién iniciada.
 */
export function parseComplexType(text: string): ComplexSpec | null {
  const t = (text ?? '').trim();
  const m = /^(STRUCT|ARRAY|MAP)\s*<([\s\S]*)>$/i.exec(t);
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const inner = m[2].trim();
  // El interior debe quedar balanceado (STRUCT<a:INT> sí; STRUCT<a:INT>> no).
  let depth = 0;
  for (const ch of inner) {
    if (ch === '<' || ch === '(') depth += 1;
    else if (ch === '>' || ch === ')') depth -= 1;
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;

  if (kind === 'ARRAY') return { kind: 'array', element: inner };
  if (kind === 'MAP') {
    if (inner === '') return { kind: 'map', key: '', value: '' };
    const parts = splitTop(inner, ',').map((s) => s.trim());
    if (parts.length !== 2) return null;
    return { kind: 'map', key: parts[0], value: parts[1] };
  }
  // STRUCT: campos `nombre:tipo` (el tipo puede ser a su vez complejo).
  if (inner === '') return { kind: 'struct', fields: [] };
  const fields: Array<{ name: string; type: string }> = [];
  for (const part of splitTop(inner, ',')) {
    const p = part.trim();
    if (!p) continue;
    const idx = splitTop(p, ':')[0].length;   // 1er ':' de profundidad 0
    if (idx >= p.length) fields.push({ name: p, type: '' });
    else fields.push({ name: p.slice(0, idx).trim(), type: p.slice(idx + 1).trim() });
  }
  return { kind: 'struct', fields };
}

/** true si el texto ARRANCA como complejo (candidato al builder visual). */
export function isComplexTypeStart(t: string): boolean {
  return /^\s*(STRUCT|ARRAY|MAP)\s*</i.test(t ?? '');
}

/** Spec → texto canónico del tipo (compacto, sin espacios). */
export function composeComplexType(spec: ComplexSpec): string {
  if (spec.kind === 'array') return `ARRAY<${spec.element.trim()}>`;
  if (spec.kind === 'map') return `MAP<${spec.key.trim()},${spec.value.trim()}>`;
  return `STRUCT<${spec.fields.map((f) => `${f.name.trim()}:${f.type.trim()}`).join(',')}>`;
}
