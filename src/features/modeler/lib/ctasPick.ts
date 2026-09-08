import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import type { DbSchema } from '../services/schemas.service';
import { matchesColumn } from './columnSearch';

/**
 * ctasPick (doc 43) — lógica PURA del popup CTAS: esquemas con tablas y
 * armado de las columnas candidatas a heredar. La lista de tablas fuente NO
 * se filtra acá: es server-side paginada (`searchTables`, patrón del Import
 * existing). Extraída del componente para testearla sin DOM (política sin
 * dependencias nuevas).
 */

/** Esquemas que REALMENTE contienen tablas (combobox de esquema de CTAS y
 *  New table): derivarlos del pool deja fuera los solo-de-vistas sin tocar
 *  la colección `views`. */
export function distinctTableSchemas(pool: CanonicalTable[]): string[] {
  return [...new Set(pool.map((t) => (t.schema ?? '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

/** Fast-path del `kind` (doc 44): si TODO el catálogo está clasificado, los
 *  esquemas de tablas salen del propio catálogo (bajada chica) sin tocar el
 *  pool. Con catálogo vacío o algún esquema sin `kind` devuelve null y el
 *  caller cae al distinct del pool — las tablas pueden referenciar esquemas
 *  legacy que no están en el catálogo. */
export function tableSchemasFromCatalog(catalog: DbSchema[]): string[] | null {
  if (!catalog.length) return null;
  if (catalog.some((s) => s.kind !== 'tables' && s.kind !== 'views')) return null;
  return catalog.filter((s) => s.kind === 'tables').map((s) => s.name);
}

/** Candidatas a heredar: concatena las columnas de las fuentes EN ORDEN DE
 *  SELECCIÓN (ordinal físico dentro de cada tabla) y dedup-ea por physicalName
 *  — la primera fuente seleccionada gana, como el dedup del CTAS original.
 *  Una fuente cuyas columnas aún no llegaron simplemente no aporta. */
export function buildCandidates(sourceIds: string[], colsByTable: ReadonlyMap<string, CanonicalColumn[]>): CanonicalColumn[] {
  const seen = new Set<string>();
  const out: CanonicalColumn[] = [];
  for (const id of sourceIds) {
    const cols = colsByTable.get(id);
    if (!cols) continue;
    for (const c of [...cols].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))) {
      if (seen.has(c.physicalName)) continue;
      seen.add(c.physicalName);
      out.push(c);
    }
  }
  return out;
}

/** Buscador de candidatas: contiene CI sobre lógico O físico (doc 42). */
export function filterColumns(cands: CanonicalColumn[], q: string): CanonicalColumn[] {
  return q.trim() ? cands.filter((c) => matchesColumn(c, q)) : cands;
}
