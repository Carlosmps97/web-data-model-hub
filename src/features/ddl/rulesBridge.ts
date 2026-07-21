/**
 * rulesBridge — puente del Export DDL con las DDL Export Rules (doc 30 §8).
 *
 * El motor de reglas vive en el backend y es PURO: acá se arma el payload con
 * el estado EFECTIVO que el canvas está exportando (drafts incluidos) — cada
 * tabla con sus columnas (udpValues) y su CREATE base, cada vista con su SQL —
 * y el `.sql` final se ensambla con la respuesta + el sello de la versión de
 * reglas usada (la evidencia de por qué el DDL de marzo salió distinto al de
 * junio).
 *
 * Sin reglas seleccionadas el export NO pasa por acá: sale byte-idéntico al de
 * siempre.
 */
import { apiGet, apiPost } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import type { Diagram } from '@/features/modeler/services/modeler.service';

import {
  tableStatements, viewStatements,
  type DatabricksDdlInput, type DatabricksDdlOptions, type DdlView,
} from './generators';

const DDL_RULES = `${API_BASE}/api/ddl-rules`;

/** Vista liviana de una regla para el selector del modal. */
export interface ExportRule {
  id: string;
  name: string;
  kind: 'rule' | 'generator';
  priority: number;
  enabled: boolean;
  validationState: 'valid' | 'invalid' | 'stale';
  appliesTo: string[];
  action: Record<string, unknown>;
}

export interface RenderedStatement { artifact: string; schema?: string | null; name?: string | null; sql: string; }
export interface RenderLogEntry { rule?: string | null; status: 'applied' | 'skipped'; reason?: string; column?: string; artifact?: string; }
export interface RenderedExport {
  statements: RenderedStatement[];
  log: RenderLogEntry[];
  rulesetVersion: string;
  applied: number;
  skipped: number;
}

export const fetchExportRules = () => apiGet<ExportRule[]>(DDL_RULES);

/** Reglas seleccionables en el modal: habilitadas y no-inválidas (las stale
 *  corren igual — solo avisan). Default del modal: TODAS marcadas. */
export const selectableRules = (rules: ExportRule[]): ExportRule[] =>
  rules.filter((r) => r.enabled && r.validationState !== 'invalid');

/** Aplica las reglas seleccionadas al export y devuelve el `.sql` final. */
export async function renderWithRules(args: {
  diagram: Diagram;
  input: DatabricksDdlInput;         // el mismo input que recibe databricksDdl
  opts: DatabricksDdlOptions;
  ruleIds: string[];
  modelName: string;
}): Promise<{ sql: string; rendered: RenderedExport }> {
  const { diagram, input, opts, ruleIds, modelName } = args;
  const tables = tableStatements(input, opts);
  const views = opts.includeViews ? viewStatements(input, opts) : [];
  const colsByTable = new Map<string, typeof diagram.columns>();
  diagram.columns.forEach((c) => {
    (colsByTable.get(c.tableId) ?? colsByTable.set(c.tableId, []).get(c.tableId)!).push(c);
  });

  const payload = {
    ruleIds,
    model: { name: diagram.subjectArea?.name, udpValues: diagram.subjectArea?.udpValues ?? {} },
    // Opciones del modal: los artefactos generados (p.ej. la tabla _rej) salen
    // ESPEJO del CREATE físico — mismo casing, USING, particiones y LOCATION
    // (carpeta = nombre final con su sufijo).
    options: {
      identifierCase: opts.identifierCase,
      tableFormat: opts.tableFormat,
      external: opts.external,
      location: opts.location,
      includePartitions: opts.includePartitions,
    },
    tables: tables.map(({ table, sql }) => ({
      table: {
        id: table.id, physicalName: table.physicalName, schema: table.schema,
        description: table.description,
        udpValues: (diagram.tables.find((t) => t.id === table.id))?.udpValues ?? {},
      },
      columns: (colsByTable.get(table.id) ?? []).map((c) => ({
        physicalName: c.physicalName, dataType: c.dataType, ordinal: c.ordinal,
        isNullable: c.isNullable, isPrimaryKey: c.isPrimaryKey,
        // sin esto la _rej no hereda el PARTITIONED BY de la física
        isPartition: c.isPartition,
        parentDomainId: c.parentDomainId, description: c.description,
        udpValues: c.udpValues ?? {},
      })),
      baseSql: sql.trim(),
    })),
    views: views.map(({ view, sql }) => ({
      name: view.name,
      schema: view.schema ?? null,
      sql: sql.trim(),
      sourceTableIds: view.sourceTableIds?.length
        ? view.sourceTableIds
        : (view.tableId ? [view.tableId] : []),
      // Vista de NEGOCIO = "on canvas": solo esas se decoran con
      // ddl.vista_negocio; el resto pasa intacto (pedido owner 07-20).
      businessView: view.showOnCanvas !== false,
    })),
  };

  const rendered = await apiPost<RenderedExport>(`${DDL_RULES}/render`, payload);
  return { sql: assemble(rendered, modelName, tables.length), rendered };
}

/** Ensambla el archivo: header con el sello de reglas + statements en el orden
 *  del motor (por tabla: física → tags → generados; luego vistas). Los ALTER
 *  de tags consecutivos van compactos (una línea en blanco entre bloques). */
function assemble(rendered: RenderedExport, modelName: string, tableCount: number): string {
  const header = `-- ${modelName || 'model'} · Databricks · ${tableCount} table(s)\n`
    + `-- Generated by Data Model Hub\n`
    + `-- Export rules: ${rendered.rulesetVersion} · ${rendered.applied} applied`
    + (rendered.skipped ? ` · ${rendered.skipped} skipped` : '') + `\n`;
  const parts: string[] = [];
  let prevTags = false;
  for (const s of rendered.statements) {
    const isTags = s.artifact.endsWith('.tags');
    if (isTags && prevTags) parts.push(s.sql);           // tags consecutivos, compactos
    else parts.push((parts.length ? '\n' : '') + s.sql); // bloque nuevo
    prevTags = isTags;
  }
  return `${header}\n${parts.join('\n')}`.trimEnd() + '\n';
}
