#!/usr/bin/env node
/**
 * Generador de un modelo sintético para pruebas de estrés.
 *
 * Produce un documento JSON con forma de modelo de datos (tablas, columnas y
 * relaciones) con N tablas, un promedio de M columnas por tabla y una red
 * realista de relaciones FK, como insumo para medir el rendimiento con
 * modelos grandes.
 *
 * Uso:
 *
 *   node scripts/generate-stress-model.mjs --tables=1000 --cols=10
 *
 * Opciones (todas opcionales):
 *
 *   --tables    Cantidad de tablas (por defecto 100). Valores habituales:
 *               100, 1000, 3000, 10000.
 *   --cols      Promedio de columnas por tabla (por defecto 8). Cada tabla
 *               recibe `cols ± 2` columnas al azar.
 *   --fk-rate   Fracción de tablas con una FK saliente (por defecto 0.6).
 *               Más alta = grafo más denso; ELK tarda más.
 *   --out       Ruta de salida (por defecto ./stress-model.json).
 *   --engine    Motor de base de datos del encabezado del modelo (por defecto sqlserver).
 *   --seed      Semilla del RNG para que las corridas sean reproducibles (por defecto 42).
 *
 * Determinismo:
 *
 *   El generador usa un LCG pequeño sembrado con `--seed`, no
 *   `Math.random`. La misma semilla con los mismos flags produce una salida
 *   idéntica byte a byte entre corridas y máquinas, lo que vuelve confiables
 *   las comparaciones A/B de rendimiento.
 *
 * Por qué vive en `scripts/` (y no en `src/`):
 *
 *   Es una herramienta de desarrollo que la app nunca importa. Fuera de
 *   `src/` no entra al bundle de producción y corre como `.mjs` (Node
 *   directo), sin pasar por el build de TypeScript.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { randomUUID } from 'node:crypto';

// ── Argumentos ──────────────────────────────────────────────────────
const args = parseArgs(argv.slice(2));
const N = args.tables ?? 100;
const COLS_AVG = args.cols ?? 8;
const FK_RATE = args['fk-rate'] ?? 0.6;
const OUT = args.out ?? './stress-model.json';
const ENGINE = args.engine ?? 'sqlserver';
const SEED = args.seed ?? 42;

if (!Number.isFinite(N) || N <= 0) {
  console.error('--tables must be a positive integer');
  exit(2);
}

// ── RNG determinista (LCG) ──────────────────────────────────────────
let _rng = SEED >>> 0;
const rand = () => {
  // LCG de Numerical Recipes (1664525, 1013904223): pequeño, determinista y
  // suficientemente uniforme para datos sintéticos.
  _rng = (Math.imul(_rng, 1664525) + 1013904223) >>> 0;
  return _rng / 0x1_0000_0000;
};
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ── Vocabulario para esquemas verosímiles ───────────────────────────
const SCHEMA_NAMES = ['dbo', 'sales', 'inventory', 'hr', 'finance', 'marketing'];
const NOUNS = [
  'customer', 'order', 'invoice', 'product', 'category', 'supplier',
  'shipment', 'payment', 'address', 'employee', 'department', 'project',
  'task', 'event', 'asset', 'lead', 'campaign', 'channel', 'segment',
  'metric', 'report', 'dashboard', 'session', 'cart', 'wishlist',
  'review', 'rating', 'tag', 'comment', 'attachment', 'document',
];
const SUFFIXES = ['', '_log', '_history', '_summary', '_detail', '_event'];
const COLUMN_NAMES = [
  'id', 'name', 'description', 'created_at', 'updated_at', 'deleted_at',
  'status', 'amount', 'quantity', 'price', 'currency', 'rate',
  'start_date', 'end_date', 'due_date', 'is_active', 'is_default',
  'code', 'reference', 'external_id', 'notes', 'metadata',
];
const TYPES_NUM = ['INT', 'BIGINT', 'DECIMAL(10,2)', 'NUMERIC(18,4)'];
const TYPES_STR = ['VARCHAR(50)', 'VARCHAR(100)', 'VARCHAR(255)', 'TEXT'];
const TYPES_DATE = ['DATETIME', 'DATE', 'TIMESTAMP'];
const TYPES_BOOL = ['BIT', 'BOOLEAN'];

function nameForTable(i) {
  // Nombres de tabla estables; el índice al final garantiza la unicidad
  // cuando N es muy grande.
  const base = pick(NOUNS);
  const suffix = pick(SUFFIXES);
  return `${base}${suffix}_${i}`;
}

function buildColumn(idx, isPk = false) {
  const name = isPk ? 'id' : pick(COLUMN_NAMES);
  let dataType;
  if (isPk || name === 'id' || name.endsWith('_id')) dataType = 'BIGINT';
  else if (name.includes('date') || name.includes('_at')) dataType = pick(TYPES_DATE);
  else if (name.startsWith('is_')) dataType = pick(TYPES_BOOL);
  else if (['amount', 'price', 'rate', 'quantity'].includes(name)) dataType = pick(TYPES_NUM);
  else dataType = pick(TYPES_STR);
  return {
    id: randomUUID(),
    name: idx === 0 || isPk ? 'id' : `${name}_${idx}`,
    dataType,
    isPrimaryKey: isPk,
    isNullable: !isPk && rand() > 0.3,
  };
}

function buildTable(i) {
  const cols = Math.max(2, COLS_AVG + randInt(-2, 2));
  const columns = [buildColumn(0, true)];
  for (let k = 1; k < cols; k++) columns.push(buildColumn(k, false));
  return {
    id: randomUUID(),
    schema: pick(SCHEMA_NAMES),
    name: nameForTable(i),
    columns,
    // Sin posición: las tablas no traen coordenadas y el layout queda a cargo
    // de quien consuma el modelo.
  };
}

// ── Generación ──────────────────────────────────────────────────────
const tables = [];
for (let i = 0; i < N; i++) tables.push(buildTable(i));

const relationships = [];
for (let i = 0; i < N; i++) {
  if (rand() > FK_RATE) continue;
  // Cada FK apunta a una tabla ya generada, así el grafo es un DAG
  // (sin ciclos): ELK maneja ciclos sin problema, pero el layout de un DAG
  // se lee mejor y se parece más a los diagramas ER reales.
  if (i === 0) continue;
  const targetIdx = randInt(0, i - 1);
  const src = tables[i];
  const tgt = tables[targetIdx];
  // Una columna no PK del origen hace de lado FK.
  const nonPkCols = src.columns.filter((c) => !c.isPrimaryKey);
  if (nonPkCols.length === 0) continue;
  const srcCol = pick(nonPkCols);
  const tgtCol = tgt.columns[0]; // PK
  // La columna de origen se marca como FK para que el canvas la dibuje como tal.
  srcCol.isForeignKey = true;
  srcCol.foreignKeyRef = { table: tgt.name, column: tgtCol.name };
  relationships.push({
    id: randomUUID(),
    sourceTable: src.id,
    sourceColumn: srcCol.id,
    targetTable: tgt.id,
    targetColumn: tgtCol.id,
    type: rand() > 0.85 ? 'many-to-many' : rand() > 0.4 ? 'one-to-many' : 'one-to-one',
  });
}

const dataModel = {
  id: randomUUID(),
  projectId: 'stress-project',
  name: `Stress Model · ${N} tables`,
  description: `Auto-generated by scripts/generate-stress-model.mjs (seed=${SEED}, fk-rate=${FK_RATE})`,
  engine: ENGINE,
  tables,
  relationships,
  views: [],
  domainCatalog: [],
};

writeFileSync(resolve(OUT), JSON.stringify(dataModel, null, 2), 'utf8');

console.log(
  `Generated ${tables.length} tables, ${relationships.length} relationships → ${OUT} ` +
    `(${(JSON.stringify(dataModel).length / 1024).toFixed(1)} KB JSON).`,
);

// ── Parser de argumentos ────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const raw = eq === -1 ? 'true' : a.slice(eq + 1);
    if (raw === 'true') out[key] = true;
    else if (raw === 'false') out[key] = false;
    else if (/^-?\d+(?:\.\d+)?$/.test(raw)) out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}
