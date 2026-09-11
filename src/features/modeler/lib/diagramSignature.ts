/**
 * Firma ESTRUCTURAL de un diagrama (doc 88 §2): cambia cuando cambia lo que el
 * Explorer dibuja — identidad, nombres y esquema de tablas y vistas, y el nº de
 * columnas por tabla — y NO con descripciones, UDPs, flags de columna ni layout.
 * El store la compara en cada `reload()` del canvas activo y, si difiere, sube
 * `explorerTick`: el catálogo del Explorer (inventario cacheado, doc 72) se
 * invalida y se vuelve a pedir SOLO si hay una rama abierta. Tiempo real sin
 * polling ni websockets. Puro.
 */
export interface SignatureDiagram {
  tables: { id: string; physicalName: string; logicalName?: string | null; schema?: string | null }[];
  columns: { tableId: string }[];
  views?: { id: string; name: string; schema?: string | null; customSql?: string | null }[] | null;
}

export function diagramSignature(d: SignatureDiagram | null | undefined): string {
  if (!d) return '';
  const counts = new Map<string, number>();
  for (const c of d.columns) counts.set(c.tableId, (counts.get(c.tableId) ?? 0) + 1);
  const tables = d.tables
    .map((t) => `${t.id}|${t.physicalName}|${t.logicalName ?? ''}|${t.schema ?? ''}|${counts.get(t.id) ?? 0}`)
    .sort();
  const views = (d.views ?? [])
    .map((v) => `${v.id}|${v.name}|${v.schema ?? ''}|${(v.customSql ?? '').trim() ? 1 : 0}`)
    .sort();
  return `T:${tables.join(';')}#V:${views.join(';')}`;
}
