#!/usr/bin/env node
/**
 * Synthetic stress-model generator.
 *
 * Produces a JSON document shaped like a `DataModel` (see
 * `src/types/model.ts`) with N tables, average M columns each, and a
 * realistic web of FK relationships. The output can be:
 *
 *   1. Pasted into the DBML / SQL importer to seed a real Cosmos
 *      model for end-to-end perf testing.
 *   2. Loaded directly into the canvas via the `loadModel` store
 *      action (see `useModelStore.ts`) for in-memory benchmarking
 *      that bypasses the backend round-trip.
 *
 * Usage:
 *
 *   node scripts/generate-stress-model.mjs --tables=1000 --cols=10
 *
 * Options (all optional):
 *
 *   --tables    Number of tables (default 100). Common targets:
 *               100, 1000, 3000, 10000.
 *   --cols      Average columns per table (default 8). Each table
 *               gets `cols ± 2` columns randomly.
 *   --fk-rate   Fraction of tables that get an outgoing FK (default
 *               0.6). Higher = denser graph; ELK takes longer.
 *   --out       Output path (default ./stress-model.json).
 *   --engine    Database engine for the model header (default sqlserver).
 *   --seed      RNG seed so runs are reproducible (default 42).
 *
 * Determinism:
 *
 *   The generator uses a tiny LCG seeded by `--seed`, NOT
 *   `Math.random`. Same seed + same flags produce byte-identical
 *   output across runs and machines, which makes A/B perf
 *   comparisons reliable.
 *
 * Why this lives in `scripts/` (not `src/`):
 *
 *   It is a developer tool, never imported by the app. Keeping it
 *   out of `src/` keeps the production bundle clean and lets us
 *   ship it as a `.mjs` (Node-direct) without TypeScript build
 *   pipeline overhead.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { randomUUID } from 'node:crypto';

// ── Args ────────────────────────────────────────────────────────────
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

// ── Deterministic RNG (LCG) ─────────────────────────────────────────
let _rng = SEED >>> 0;
const rand = () => {
  // Numerical Recipes "minstd" — small, deterministic, plenty
  // uniform for synthetic data.
  _rng = (Math.imul(_rng, 1664525) + 1013904223) >>> 0;
  return _rng / 0x1_0000_0000;
};
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ── Vocabulary for plausible-looking schemas ────────────────────────
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
  // Stable, mostly-unique table names. We append an index for
  // uniqueness when N is very large.
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
    // Position omitted → cold-start placement kicks in (Issue #1).
  };
}

// ── Generate ────────────────────────────────────────────────────────
const tables = [];
for (let i = 0; i < N; i++) tables.push(buildTable(i));

const relationships = [];
for (let i = 0; i < N; i++) {
  if (rand() > FK_RATE) continue;
  // Each FK links to a previously-generated table so the graph is a
  // DAG (no cycles) — ELK handles cycles fine, but DAG layouts read
  // better and match real-world ER diagrams more closely.
  if (i === 0) continue;
  const targetIdx = randInt(0, i - 1);
  const src = tables[i];
  const tgt = tables[targetIdx];
  // Pick a non-PK column on the source as the FK side.
  const nonPkCols = src.columns.filter((c) => !c.isPrimaryKey);
  if (nonPkCols.length === 0) continue;
  const srcCol = pick(nonPkCols);
  const tgtCol = tgt.columns[0]; // PK
  // Mark the source column as FK so the canvas renders it correctly.
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

// ── Args parser ─────────────────────────────────────────────────────
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
