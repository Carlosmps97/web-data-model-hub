// Lógica pura del selector de tipos y dominios. El combobox de "Type override"
// no es texto libre (evita errores de tipeo): catálogo cerrado en mayúsculas
// (convención de los modelos, y los defaults de dominio se comparan por string
// exacto), búsqueda "contiene" case-insensitive, y tipos parametrizados
// editados por argumentos puntuales.
import { COLUMN_DATA_TYPES } from '@/types/model';
import { parseComplexType } from './complexTypes';

/** ¿`text` contiene `query`? (case-insensitive; una query vacía siempre matchea).
 *  Es el criterio de búsqueda de todas las listas buscables del módulo Model. */
export function containsCI(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

/** Catálogo del combobox: canónico en mayúsculas, orden alfabético. Incluye
 *  STRUCT/ARRAY/MAP (elegirlos abre el builder). */
export const TYPE_OPTIONS: string[] = [...COLUMN_DATA_TYPES]
  .map((t) => t.toUpperCase())
  .sort();

// Tipos que reciben argumentos y sus etiquetas, en orden posicional (todos
// opcionales). Espejo de `ARG_SPECS` del back (cantidad máxima por tipo).
const ARG_SPECS: Record<string, string[]> = {
  DECIMAL: ['precision', 'scale'],
  NUMERIC: ['precision', 'scale'],
  NUMBER: ['precision', 'scale'],   // dominios Oracle (NUMBER(22,3))
  VARCHAR: ['length'],
  CHAR: ['length'],
  NVARCHAR: ['length'],
  VARBINARY: ['length'],
  VARCHAR2: ['length'],             // dominios Oracle (VARCHAR2(10))
  // Oracle / SQL Server / Databricks
  NVARCHAR2: ['length'],
  NCHAR: ['length'],
  RAW: ['length'],
  UROWID: ['length'],
  BINARY: ['length'],
  FLOAT: ['precision'],
  TIMESTAMP: ['precision'],
  TIME: ['precision'],
  DATETIME2: ['precision'],
  DATETIMEOFFSET: ['precision'],
  VECTOR: ['dimensions', 'format'],
  GEOGRAPHY: ['srid'],
  GEOMETRY: ['srid'],
};

/** Etiquetas de argumentos del tipo (case-insensitive) o null si no lleva. */
export function argSpecFor(base: string): string[] | null {
  return ARG_SPECS[(base ?? '').trim().toUpperCase()] ?? null;
}

/** `DECIMAL(18,2)` → {base: 'DECIMAL', args: ['18','2']} (base normalizada a
 *  mayúsculas, tolerante a espacios/minúsculas). Solo bases del catálogo; los
 *  complejos (`<`) y los tipos fuera de catálogo devuelven null — el caller
 *  los muestra tal cual como opción extra (patrón SchemaSelect: un valor
 *  fuera de catálogo no rompe la edición). La base puede tener varias palabras
 *  (`TIMESTAMP WITH TIME ZONE`). */
export function parseParamType(value: string): { base: string; args: string[] } | null {
  const t = (value ?? '').trim();
  if (!t || t.includes('<')) return null;
  // Base con dígitos (VARCHAR2) y de varias palabras — espejo de `_SIMPLE_RE` del back.
  const m = /^([A-Za-z][A-Za-z0-9_]*(?:\s+[A-Za-z][A-Za-z0-9_]*)*)\s*(?:\(([^)]*)\))?$/.exec(t);
  if (!m) return null;
  const base = m[1].split(/\s+/).join(' ').toUpperCase();
  if (!TYPE_OPTIONS.includes(base)) return null;
  if (m[2] === undefined) return { base, args: [] };
  // La misma gramática que el back (`_simple`): entre paréntesis, de 1 a N
  // argumentos válidos (N = los del tipo). `INT(11)`, `DECIMAL()` o
  // `DECIMAL(10.5)` no son del catálogo: se muestran tal cual.
  const args = m[2].split(',').map((a) => a.trim());
  if (args.length > (ARG_SPECS[base]?.length ?? 0) || !args.every(isTypeArg)) return null;
  return { base, args };
}

// Un argumento es un número o una palabra (`MAX`, `*`, `-2`, `FLOAT32`) con una
// unidad opcional que es una palabra (`30 CHAR`; `18 2` no) — espejo de
// `_ARG_RE` del back. Nada que rompa el texto del tipo ni el DDL (`--` es un
// comentario SQL). Solo ASCII. No valida por motor.
const TYPE_ARG = /^-?[A-Za-z0-9_*]+(?: [A-Za-z][A-Za-z0-9_]*)?$/;
const normArg = (a: string): string => (a ?? '').trim().split(/\s+/).join(' ');

/** ¿`a` es un argumento válido de un tipo? (espacios de más no importan). */
export function isTypeArg(a: string): boolean {
  return TYPE_ARG.test(normArg(a));
}

/** Arma el tipo desde base + argumentos: toma el prefijo de argumentos válidos
 *  (un scale sin precision no tiene sentido; uno vacío o inválido corta), a lo
 *  sumo los que el tipo admite, y omite el paréntesis si no queda nada. Cada
 *  argumento sale en mayúscula y con un solo espacio (`30 char` → `30 CHAR`,
 *  `max` → `MAX`), como el back. */
export function composeParamType(base: string, args: string[]): string {
  const max = ARG_SPECS[base.toUpperCase()]?.length ?? 0;
  const take: string[] = [];
  for (const a of args.slice(0, max)) {
    if (!isTypeArg(a)) break;
    take.push(normArg(a).toUpperCase());
  }
  return take.length ? `${base}(${take.join(',')})` : base;
}

/** Borrador de las cajas tras tipear `raw` en la caja `i`: exactamente una caja
 *  por argumento del tipo — nada de un tipo anterior queda oculto. */
export function editTypeArg(spec: string[], draft: string[], i: number, raw: string): string[] {
  return spec.map((_, j) => (j === i ? raw : (draft[j] ?? '')));
}

// ── Homologación del default de un parent domain ──────────────────────────
// Espejo en el front de `canonicalize_default_type` (app/core/datatypes.py):
// la BD puede traer dominios con la grafía cruda del XML de Erwin (`Array`,
// `BIG INTEGER`, `decimal (22,4)`) si el script de homologación no corrió con
// --apply; el front homologa al consumir el default (elegir el dominio,
// comparar override, mostrarlo en el combobox) para que `Array` herede
// `ARRAY<>` y abra el builder, igual que elegir ARRAY en la lista.

/** Sinónimos de dialecto → base del catálogo (solo para homologar defaults;
 *  espejo de `_BASE_ALIASES` del back). `INT` y `DOUBLE PRECISION` son del
 *  catálogo (quedan tal cual). */
const BASE_ALIASES: Record<string, string> = {
  BIGINTEGER: 'BIGINT', BOOL: 'BOOLEAN',
};
const normKey = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Canónico del interior de un complejo (espejo de `_canonical` del back:
 *  sin aliases ni expansión de pelados — si algo no se reconoce, el complejo
 *  entero queda verbatim). */
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

/** Default de dominio → grafía canónica de la plataforma. Reglas en orden
 *  (mismas del back): 1) `ARRAY`/`MAP`/`STRUCT` "pelados" (o `<>` vacío) →
 *  `X<>` — lo mismo que emite el combobox al elegirlos; 2) complejo con
 *  contenido → recompone canónico (o verbatim si algo no parsea); 3) simple
 *  del catálogo → base en mayúscula + argumentos compactos (`decimal (22,4)` →
 *  `DECIMAL(22,4)`); 4) sinónimos (`BIG INTEGER` → `BIGINT`) y reintento;
 *  5) sin reconocer → verbatim recortado (jamás se inventa un tipo). */
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
