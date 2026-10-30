/**
 * ddlRuleReference — lo que se puede usar dentro de una regla del Export DDL:
 * los datos de la tabla o la vista (nombres del contexto del motor,
 * `engine/context.py`), las funciones de la plataforma (`engine/jinja_env.py`)
 * y lo básico de Jinja. Alimenta el panel «Reference» y el autocompletado del
 * editor. Puro.
 */
export interface RefEntry {
  label: string;
  detail: string;
  /** Lo que escribe el autocompletado (por defecto, `label`); null = solo ayuda. */
  insert?: string | null;
}
export interface RefGroup { title: string; items: RefEntry[] }

export const RULE_REFERENCE: RefGroup[] = [
  {
    title: 'Table · tabla',
    items: [
      { label: 'tabla.nombre', detail: 'Physical name' },
      { label: 'tabla.esquema', detail: 'Schema' },
      { label: 'tabla.comentario', detail: 'Definition' },
      { label: 'tabla.carpeta', detail: 'Folder of the table in the .zip' },
      { label: "tabla.udp['…']", detail: 'UDP value (physical facet); empty if it has none', insert: "tabla.udp['" },
      { label: 'tabla.columnas', detail: 'Columns: primary key first, then by order' },
    ],
  },
  {
    title: 'Column · c in tabla.columnas',
    items: [
      { label: 'c.nombre', detail: 'Physical name' },
      { label: 'c.tipo', detail: 'Data type as in the model' },
      { label: 'c.tipo_ddl', detail: 'Data type as the export writes it: char(20), int, complex types as is' },
      { label: 'c.pk', detail: 'Part of the primary key' },
      { label: 'c.nulable', detail: 'Accepts nulls' },
      { label: 'c.particion', detail: 'Partition flag of the model' },
      { label: 'c.orden', detail: 'Order of the column' },
      { label: 'c.comentario', detail: 'Comment (physical comment or definition)' },
      { label: "c.udp['…']", detail: 'UDP value; empty if it has none', insert: "c.udp['" },
    ],
  },
  {
    title: 'View · vista',
    items: [
      { label: 'vista.nombre', detail: 'Name' },
      { label: 'vista.esquema', detail: 'Schema' },
      { label: 'vista.en_canvas', detail: '"Show on canvas" of the view (business view)' },
      { label: 'vista.carpeta', detail: 'Folder in the .zip (the one of its first exported table)' },
      { label: 'vista.tablas', detail: 'Exported source tables, in order' },
      { label: 'vista.proyecciones', detail: 'Columns of the SELECT, in order' },
      { label: 'vista.from_sql', detail: 'FROM as the export writes it (a t1, b t2 with 2+ tables)' },
    ],
  },
  {
    title: 'Projection · p in vista.proyecciones',
    items: [
      { label: 'p.sql', detail: 'Column or expression without its alias: t1.codcli, CAST(codcli AS int)' },
      { label: 'p.alias', detail: 'Alias (always for columns; for expressions, the typed one)' },
      { label: 'p.columna', detail: 'Source column, with its UDPs (empty for an expression)' },
      { label: 'p.tabla', detail: 'Source table' },
      { label: 'p.expresion', detail: 'It is a free expression' },
    ],
  },
  {
    title: 'Model and variables',
    items: [
      { label: 'modelo.nombre', detail: 'Name of the canvas' },
      { label: "modelo.udp['…']", detail: 'UDP value of the canvas', insert: "modelo.udp['" },
      { label: 'variables.…', detail: 'Variables of the project (Pieces & variables)', insert: 'variables.' },
    ],
  },
  {
    title: 'Platform functions',
    items: [
      { label: 'ident', detail: 'Filter: backticks only when the name needs them · c.nombre | lower | ident' },
      { label: 'mapear_tipo', detail: "Filter: changes the base type and keeps the length · c.tipo_ddl | mapear_tipo(CHAR='VARCHAR')" },
      { label: 'particiones', detail: "Filter: columns with PART_01, PART_02… in a UDP, in that order · tabla.columnas | particiones('Particion')" },
      { label: 'sin_particiones', detail: "Filter: the other columns · tabla.columnas | sin_particiones('Particion')" },
      { label: 'like', detail: "Test: SQL LIKE with % and _ · c.udp['Clasificacion del Dato'] is like('DAC-%')" },
    ],
  },
  {
    title: 'Jinja',
    items: [
      { label: '{% if … %} … {% elif … %} … {% else %} … {% endif %}', detail: 'Condition', insert: null },
      { label: '{% for c in tabla.columnas if … %} … {% endfor %}', detail: 'Loop with filter · loop.first, loop.last, loop.index', insert: null },
      { label: '{% set x = … %}', detail: 'Variable', insert: null },
      { label: '{% macro nombre(t) %} … {% endmacro %}', detail: 'Reusable piece (write it in Pieces)', insert: null },
      { label: "'a' if … else 'b'", detail: 'Inline condition', insert: null },
      { label: '~', detail: "Joins texts · tabla.nombre ~ '_rej'", insert: null },
      { label: 'lower · upper · replace · join · trim · default · length', detail: 'Jinja filters', insert: null },
    ],
  },
];

/** Una opción del autocompletado: lo que se ve, su ayuda y lo que escribe. */
export interface RuleCompletion { label: string; detail?: string; apply?: string }

const MACRO_RX = /\{%-?\s*macro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
const CONST_RX = /\{%-?\s*set\s+([A-Za-z_]\w*)\s*=\s*('[^']*'|"[^"]*")\s*-?%\}/g;

/** Opciones del autocompletado: datos y funciones (`RULE_REFERENCE`), las
 *  macros y constantes de las piezas y las variables del proyecto. Puro. */
export function ruleCompletions(pieces: string, variables: Record<string, string>): RuleCompletion[] {
  const out: RuleCompletion[] = RULE_REFERENCE.flatMap((g) => g.items)
    .filter((i) => i.insert !== null)
    .map((i) => ({ label: i.label, detail: i.detail, apply: i.insert ?? i.label }));
  for (const m of pieces.matchAll(MACRO_RX)) out.push({ label: `${m[1]}(${m[2].trim()})`, detail: 'Macro of the pieces', apply: `${m[1]}(` });
  for (const m of pieces.matchAll(CONST_RX)) out.push({ label: m[1], detail: `Constant of the pieces = ${m[2]}`, apply: m[1] });
  for (const [k, v] of Object.entries(variables)) out.push({ label: `variables.${k}`, detail: v, apply: `variables.${k}` });
  return out;
}
