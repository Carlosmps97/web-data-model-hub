/**
 * rulesBridge — puente del Export DDL con las reglas de Data Standards
 * («Use export rules»).
 *
 * Las reglas corren en el backend y devuelven archivos. Acá se arma el payload
 * con lo que el popup exporta (drafts incluidos) y con el formato del generador
 * de la web: tipos (`ddlType`), proyecciones y FROM de las vistas
 * (`viewParts`) y la carpeta de cada objeto en el zip (`exportFolders`). Así
 * el formato de las vistas tiene una sola fuente. Con «Use export settings» el
 * export no pasa por acá.
 */
import { ApiError, apiGet, apiPost } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import type { View } from '@/services/views.service';

import {
  DEFAULT_DATABRICKS_OPTS, ddlType, exportTables, exportViews, sourceIdsOf, viewParts,
  type DatabricksDdlInput, type DdlColumn, type DdlTable,
} from './generators';
import { exportFolders } from './ddlExportBundle';
import { canvasDdlViews } from './canvasDdlViews';

const DDL_RULES = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}/ddl-rules`;

/** Una regla en la lista del popup (en el orden de Data Standards). */
export interface ExportRule {
  id: string;
  name: string;
  /** Qué hace la regla, en una línea (la escribe el autor en Data Standards). */
  description?: string | null;
  scope: 'table' | 'view';
  order: number;
  enabled: boolean;
}

/** De dónde salen los valores UDP del payload: el diagrama del canvas (o, en
 *  la vista previa de Data Standards, la tabla leída del catálogo). */
export interface RulesSource {
  subjectArea?: { name?: string; udpValues?: Record<string, string> | null } | null;
  tables: { id: string; udpValues?: Record<string, string> | null }[];
  columns: { id: string; udpValues?: Record<string, string> | null }[];
}

/** Lo que reciben las reglas (ver `engine/context.py` del backend). */
export interface RulesPayload {
  model: { name: string; udpValues: Record<string, string> };
  tables: {
    table: {
      id: string; physicalName: string; schema: string | null; description: string | null;
      udpValues: Record<string, string>; folder: string;
    };
    columns: {
      id: string; physicalName: string; dataType: string; ddlType: string; ordinal: number;
      isPrimaryKey: boolean; isNullable: boolean; isPartition: boolean; description: string | null;
      udpValues: Record<string, string>;
    }[];
  }[];
  views: {
    id: string; name: string; schema: string; showOnCanvas: boolean; sourceTableIds: string[]; folder: string;
    projections: { sql: string; alias: string | null; column: string | null; tableId: string | null; expression: boolean }[];
    from: string;
  }[];
}

export interface RenderedFile { path: string; content: string; rule: string; object: string; objectKind: 'table' | 'view'; }
/** `overridden`: una regla de más arriba escribió ese archivo para el mismo
 *  objeto; `empty`: el contenido salió vacío (no se genera); `renamed`: la ruta
 *  chocaba con la de otro objeto o tenía caracteres no válidos. */
export interface RenderLogEntry {
  rule: string; object: string; path: string; status: 'overridden' | 'empty' | 'renamed'; by?: string; to?: string;
}
export interface RenderedExport { files: RenderedFile[]; log: RenderLogEntry[]; rulesetVersion?: string; }

/** Reglas del proyecto (cada proyecto tiene las suyas), en orden. */
export const fetchExportRules = (projectId: string) => apiGet<ExportRule[]>(DDL_RULES(projectId));

/** Config de las reglas del proyecto: el popup toma de acá las Output settings. */
export const fetchDdlConfig = (projectId: string) =>
  apiGet<{ output?: Record<string, unknown> | null }>(`${DDL_RULES(projectId)}/config`);

/** Payload de las reglas: las tablas marcadas (en el orden del input) con sus
 *  columnas y valores UDP del diagrama, y las vistas que entran al export. Puro. */
export function buildRulesPayload({ diagram, input }: { diagram: RulesSource; input: DatabricksDdlInput }): RulesPayload {
  const tables = exportTables(input);
  const views = exportViews(input);
  const folders = exportFolders({
    tables: tables.map((t) => ({ id: t.id, physicalName: t.physicalName, schema: t.schema })),
    views: views.map((v) => ({ sourceTableIds: sourceIdsOf(v) })),
  });
  const tableUdp = new Map(diagram.tables.map((t) => [t.id, t.udpValues ?? {}]));
  const columnUdp = new Map(diagram.columns.map((c) => [c.id, c.udpValues ?? {}]));
  const tableById = new Map(input.tables.map((t) => [t.id, t]));
  return {
    model: { name: diagram.subjectArea?.name ?? input.modelName ?? '', udpValues: diagram.subjectArea?.udpValues ?? {} },
    tables: tables.map((t, i) => ({
      table: {
        // Esquema efectivo, como lo escribe el export (sin esquema ⇒ el por default).
        id: t.id, physicalName: t.physicalName, schema: t.schema?.trim() || DEFAULT_DATABRICKS_OPTS.defaultSchema,
        description: t.description?.trim() || null, udpValues: tableUdp.get(t.id) ?? {}, folder: folders.tables[i],
      },
      columns: input.columns.filter((c) => c.tableId === t.id).map((c) => ({
        id: c.id, physicalName: c.physicalName, dataType: c.dataType, ddlType: ddlType(c.dataType, 'lower'),
        ordinal: c.ordinal, isPrimaryKey: !!c.isPrimaryKey, isNullable: c.isNullable !== false,
        isPartition: !!c.isPartition,
        // El comentario que escribe el export: el físico (Comment de Erwin) o la definición.
        description: (c.physicalDescription ?? '').trim() || (c.description ?? '').trim() || null,
        udpValues: columnUdp.get(c.id) ?? {},
      })),
    })),
    views: views.map((v, i) => {
      const parts = viewParts(v, DEFAULT_DATABRICKS_OPTS, tableById);
      return {
        id: v.id, name: v.name, schema: parts.schema, showOnCanvas: v.showOnCanvas !== false,
        sourceTableIds: sourceIdsOf(v), folder: folders.views[i], projections: parts.projections, from: parts.from,
      };
    }),
  };
}

/** Payload de la vista previa de Data Standards: una tabla real con sus vistas,
 *  como si el popup exportara solo esa tabla (`otherTables`: las demás fuentes
 *  de sus vistas, solo para escribir el FROM). */
export function tablePreviewPayload(args: {
  table: DdlTable & { udpValues?: Record<string, string> | null };
  columns: (DdlColumn & { udpValues?: Record<string, string> | null })[];
  views: View[];
  otherTables: DdlTable[];
}): RulesPayload {
  return buildRulesPayload({
    diagram: { subjectArea: null, tables: [args.table], columns: args.columns },
    input: {
      tables: [args.table, ...args.otherTables], columns: args.columns, relationships: [],
      views: canvasDdlViews({ views: args.views }), tableIds: [args.table.id],
    },
  });
}

/** Corre las reglas elegidas sobre el export y devuelve sus archivos. */
export const renderWithRules = ({ projectId, diagram, input, ruleIds }: {
  projectId: string; diagram: RulesSource; input: DatabricksDdlInput; ruleIds: string[];
}) => apiPost<RenderedExport>(`${DDL_RULES(projectId)}/render`, { ruleIds, payload: buildRulesPayload({ diagram, input }) });

/** El SQL único (Copy / preview): los archivos en el orden de las reglas, una
 *  línea en blanco entre archivos, con el encabezado del export. */
export function rulesSql(rendered: RenderedExport, modelName: string, tableCount: number): string {
  const rules = new Set(rendered.files.map((f) => f.rule)).size;
  const header = `-- ${modelName || 'model'} · ${tableCount} table(s)\n`
    + `-- Generated by Data Model Hub\n`
    + `-- Export rules${rendered.rulesetVersion ? `: ${rendered.rulesetVersion}` : ''} · ${rules} applied\n`;
  return `${header}\n${rendered.files.map((f) => f.content).join('\n')}`.trimEnd() + '\n';
}

/** Una regla que falló al exportar (el 422 del backend trae regla, objeto,
 *  archivo y línea): «Rule <rule> failed on <object> (<file>, line <n>): <message>».
 *  Null si el error no es de una regla. */
export function ruleErrorText(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 422 || !err.detail || typeof err.detail !== 'object') return null;
  const d = err.detail as { message?: string; rule?: string | null; object?: string | null; file?: string | null; line?: number | null };
  if (!d.message || !('file' in d)) return null;
  const where = [d.file, d.line ? `line ${d.line}` : null].filter(Boolean).join(', ');
  const head = d.rule ? `Rule ${d.rule} failed${d.object ? ` on ${d.object}` : ''}` : 'The export rules failed';
  return `${head}${where ? ` (${where})` : ''}: ${d.message}`;
}
