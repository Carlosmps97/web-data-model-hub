// Lógica pura del selector de tipos y dominios (doc 41). El combobox de
// "Type override" dejó de ser texto libre (fuente de errores según los
// modeladores): catálogo cerrado en MAYÚSCULAS (convención del DDV, y los
// defaults de dominio se comparan por string exacto), búsqueda "contiene"
// case-insensitive, y tipos parametrizados editados por argumentos puntuales.
import { COLUMN_DATA_TYPES } from '@/types/model';
import { composeComplexType, parseComplexType } from './complexTypes';

/** ¿`text` contiene `query`? (case-insensitive; query vacía matchea todo).
 *  "Contiene" desde 2026-08-30 (pedido del owner) — reemplaza al "empieza
 *  por" original del doc 41 en TODAS las listas buscables del módulo Model. */
export function containsCI(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

/** Catálogo del combobox: canónico en MAYÚSCULAS, orden alfabético. Incluye
 *  STRUCT/ARRAY/MAP (elegirlos abre el builder — ya no van como botones). */
export const TYPE_OPTIONS: string[] = [...COLUMN_DATA_TYPES]
  .map((t) => t.toUpperCase())
  .sort();

// Tipos que reciben argumentos y sus etiquetas, en orden posicional.
const ARG_SPECS: Record<string, string[]> = {
  DECIMAL: ['precision', 'scale'],
  NUMERIC: ['precision', 'scale'],
  NUMBER: ['precision', 'scale'],   // doc 62: dominios Oracle (NUMBER(22,3))
  VARCHAR: ['length'],
  CHAR: ['length'],
  NVARCHAR: ['length'],
  VARBINARY: ['length'],
  VARCHAR2: ['length'],             // doc 62: dominios Oracle (VARCHAR2(10))
};

/** Etiquetas de argumentos del tipo (case-insensitive) o null si no lleva. */
export function argSpecFor(base: string): string[] | null {
  return ARG_SPECS[(base ?? '').trim().toUpperCase()] ?? null;
}

/** `DECIMAL(18,2)` → {base: 'DECIMAL', args: ['18','2']} (base normalizada a
 *  MAYÚSCULAS, tolerante a espacios/minúsculas). Solo bases del catálogo; los
 *  complejos (`<`) y los tipos fuera de catálogo devuelven null — el caller
 *  los muestra tal cual como opción extra (patrón SchemaSelect: un valor
 *  legacy no rompe la edición). */
export function parseParamType(value: string): { base: string; args: string[] } | null {
  const t = (value ?? '').trim();
  if (!t || t.includes('<')) return null;
  // Base con dígitos (VARCHAR2) — espejo de `_SIMPLE_RE` del back (doc 62).
  const m = /^([A-Za-z][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?$/.exec(t);
  if (!m) return null;
  const base = m[1].toUpperCase();
  if (!TYPE_OPTIONS.includes(base)) return null;
  const args = (m[2] ?? '').trim() === ''
    ? []
    : (m[2] as string).split(',').map((a) => a.trim()).filter((a) => a !== '');
  return { base, args };
}

/** Arma el tipo desde base + argumentos: toma el PREFIJO no vacío (un scale
 *  sin precision no tiene sentido) y omite el paréntesis si no queda nada. */
export function composeParamType(base: string, args: string[]): string {
  const take: string[] = [];
  for (const a of args) {
    const v = (a ?? '').trim();
    if (v === '') break;
    take.push(v);
  }
  return take.length ? `${base}(${take.join(',')})` : base;
}

// ── Homologación del default de un PARENT DOMAIN (doc 64 r2) ──────────────
// Espejo FRONT de `canonicalize_default_type` (app/core/datatypes.py, doc 62):
// la BD todavía puede traer dominios con la grafía CRUDA del XML de Erwin
// (`Array`, `BIG INTEGER`, `decimal (22,4)`) mientras el script de
// homologación no corra con --apply — el front homologa AL CONSUMIR el
// default (elegir el dominio, comparar override, mostrarlo en el combobox)
// para que `Array` herede `ARRAY<>` y abra el builder, igual que elegir
// ARRAY en la lista.

/** Sinónimos de dialecto → base del catálogo (solo para homologar defaults;
 *  espejo de `_BASE_ALIASES` del back). */
const BASE_ALIASES: Record<string, string> = {
  BIGINTEGER: 'BIGINT', INT: 'INTEGER', BOOL: 'BOOLEAN', DOUBLEPRECISION: 'DOUBLE',
};
const normKey = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Canónico del INTERIOR de un complejo (espejo de `_canonical` del back:
 *  sin aliases ni expansión de pelados — si algo no se reconoce, el complejo
 *  ENTERO queda verbatim). */
function canonicalInner(t: string): string | null {
  const s = t.trim();
  if (!s) return null;
  if (s.includes('<') || s.includes('>')) {
    const spec = parseComplexType(s);
    if (!spec) return null;
    if (spec.kind === 'array') {
      const e = canonicalInner(spec.element);
      return e ? `ARRAY<${e}>` : null;
    }
    if (spec.kind === 'map') {
      const k = canonicalInner(spec.key);
      const v = canonicalInner(spec.value);
      return k && v ? `MAP<${k},${v}>` : null;
    }
    const fields: string[] = [];
    for (const f of spec.fields) {
      const name = f.name.trim();
      const ftype = canonicalInner(f.type);
      if (!ftype || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
      fields.push(`${name}:${ftype}`);
    }
    return fields.length ? `STRUCT<${fields.join(',')}>` : null;
  }
  const p = parseParamType(s);
  return p ? composeParamType(p.base, p.args) : null;
}

/** Default de dominio → grafía canónica de la plataforma. Reglas EN ORDEN
 *  (mismas del back): 1) `ARRAY`/`MAP`/`STRUCT` "pelados" (o `<>` vacío) →
 *  `X<>` — lo mismo que emite el combobox al elegirlos; 2) complejo con
 *  contenido → recompone canónico (o verbatim si algo no parsea); 3) simple
 *  del catálogo → base MAYÚSCULA + argumentos compactos (`decimal (22,4)` →
 *  `DECIMAL(22,4)`); 4) sinónimos (`BIG INTEGER` → `BIGINT`) y reintento;
 *  5) sin reconocer → VERBATIM recortado (jamás se inventa un tipo). */
export function canonicalDefaultType(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  const bare = /^(STRUCT|ARRAY|MAP)\s*(?:<\s*>)?$/i.exec(t);
  if (bare) return `${bare[1].toUpperCase()}<>`;
  if (t.includes('<') || t.includes('>')) {
    return canonicalInner(t) ?? t;
  }
  const parsed = parseParamType(t);
  if (parsed) return composeParamType(parsed.base, parsed.args);
  const i = t.indexOf('(');
  const basePart = i === -1 ? t : t.slice(0, i);
  const alias = BASE_ALIASES[normKey(basePart)];
  if (alias) {
    const retry = parseParamType(alias + (i === -1 ? '' : t.slice(i)));
    if (retry) return composeParamType(retry.base, retry.args);
  }
  return t;
}
