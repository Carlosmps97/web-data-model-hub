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
  type DatabricksDdlInput, type DatabricksDdlOptions, type DdlColumn,
} from './generators';

const PROJECT = (pid: string) => `${API_BASE}/api/projects/${encodeURIComponent(pid)}`;
const DDL_RULES = (pid: string) => `${PROJECT(pid)}/ddl-rules`;

/** Vista liviana de una regla para el selector del modal. */
export interface ExportRule {
  id: string;
  name: string;
  /** Qué hace la regla, en una línea (la escribe el autor en Data Standards). */
  description?: string | null;
  kind: 'rule' | 'generator';
  /** Artefacto de ENTRADA — solo generadores; encadena la cascada (spec §7.3). */
  sourceArtifact?: string | null;
  priority: number;
  enabled: boolean;
  validationState: 'valid' | 'invalid' | 'stale';
  appliesTo: string[];
  action: Record<string, unknown>;
}

/** Artefactos que existen SIEMPRE: nadie los genera, son la entrada del motor. */
const ROOT_ARTIFACTS = new Set(['ddl.tabla_fisica', 'ddl.vista_negocio']);

/** El `emit` de un generador, tal como lo guarda el kit. */
interface EmitSpec { artifact?: string; type?: string; schema?: string; name?: string }
const emitOf = (rule: ExportRule): EmitSpec | null =>
  (rule.kind === 'generator' ? (rule.action.emit as EmitSpec | undefined) ?? null : null);

// Los placeholders del motor, en el lenguaje del modelador.
const PLACEHOLDERS: [RegExp, string][] = [
  [/\{tabla\.esquema\}/g, '<schema>'],
  [/\{tabla\.nombre\}/g, '<table>'],
];
const readable = (tpl: string) => PLACEHOLDERS.reduce((acc, [re, to]) => acc.replace(re, to), tpl);

/** Objeto que CREA un generador, legible: `{tabla.esquema}_v` + `{tabla.nombre}`
 *  ⇒ `<schema>_v.<table>`. Null si la regla no genera nada. */
export function emitTarget(rule: ExportRule): { type: 'table' | 'view'; label: string } | null {
  const emit = emitOf(rule);
  const name = (emit?.name ?? '').trim();
  if (!name) return null;
  const schema = (emit?.schema ?? '').trim();
  return {
    type: emit?.type === 'view' ? 'view' : 'table',
    label: readable(schema ? `${schema}.${name}` : name),
  };
}

/** Generador cuyo artefacto de ENTRADA lo produce otro generador que NO está
 *  seleccionado: la regla queda marcada pero no emite nada. Devuelve el nombre
 *  del generador que falta (null si no hay tal dependencia). */
export function missingSource(
  rule: ExportRule, rules: ExportRule[], selected: Set<string>,
): string | null {
  const src = rule.kind === 'generator' ? (rule.sourceArtifact ?? '') : '';
  if (!src || ROOT_ARTIFACTS.has(src)) return null;
  const producer = rules.find((r) => emitOf(r)?.artifact === src);
  return producer && !selected.has(producer.id) ? producer.name : null;
}

/** Def UDP mínima para resolver el UDP de orden de particiones por nombre. */
export interface UdpDefLite { id: string; name: string; level: string; view?: string | null; }

export interface RenderedStatement { artifact: string; schema?: string | null; name?: string | null; sql: string; }
export interface RenderLogEntry { rule?: string | null; status: 'applied' | 'skipped'; reason?: string; column?: string; artifact?: string; }
export interface RenderedExport {
  statements: RenderedStatement[];
  log: RenderLogEntry[];
  rulesetVersion: string;
  applied: number;
  skipped: number;
}

/** Reglas del PROYECTO (doc 75: cada proyecto tiene su ruleset). */
export const fetchExportRules = (projectId: string) => apiGet<ExportRule[]>(DDL_RULES(projectId));

/** Defs UDP del proyecto (para `withPartitionOrder`). */
export const fetchUdpDefs = (projectId: string) => apiGet<UdpDefLite[]>(`${PROJECT(projectId)}/udp`);

export interface ExportLayout {
  partitionsLast: boolean;
  /** Doc 76 D3: nombre del UDP de columna cuyos valores PART_nn ordenan las
   *  particiones (null = orden físico). */
  partitionOrderUdp: string | null;
}

/** Doc 73/76: layout de columnas dictado por el ruleset — reglas de TABLA
 *  seleccionadas sobre `ddl.tabla_fisica` con `action.layout`:
 *  `partitionColumns = 'last'` ⇒ el CREATE emite las particiones al final;
 *  `partitionOrderUdp` ⇒ ordenadas por el correlativo de ese UDP. Espejo de
 *  `layout_from_rules` del motor (el backend la registra como aplicada). */
export function layoutFromRules(rules: ExportRule[], selected: Iterable<string>): ExportLayout {
  const sel = new Set(selected);
  const out: ExportLayout = { partitionsLast: false, partitionOrderUdp: null };
  const ordered = [...rules]
    .filter((r) => sel.has(r.id) && r.kind === 'rule' && r.appliesTo.includes('ddl.tabla_fisica'))
    .sort((a, b) => b.priority - a.priority || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  for (const r of ordered) {
    const lay = r.action.layout as { partitionColumns?: string; partitionOrderUdp?: string } | undefined;
    if (!lay) continue;
    if (lay.partitionColumns === 'last') out.partitionsLast = true;
    const udp = (lay.partitionOrderUdp ?? '').trim();
    if (udp && !out.partitionOrderUdp) out.partitionOrderUdp = udp;
  }
  return out;
}

// Misma convención del kit y del motor: PART_01 → 1.
const PARTITION_RE = /^PART[_-]?(\d+)$/i;

/** Valor UDP → correlativo de partición; valores fuera de la convención
 *  ('No Definido', vacío) → null. */
export function partitionCorrelative(value: string | null | undefined): number | null {
  const m = PARTITION_RE.exec((value ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** Estampa `partitionOrder` en las columnas leyendo el UDP de columna (faceta
 *  física) que nombra la regla de layout. Sin UDP (o sin regla) las columnas
 *  vuelven intactas. Puro. */
export function withPartitionOrder<C extends { udpValues?: Record<string, string> | null; isPartition?: boolean }>(
  columns: C[], udpDefs: UdpDefLite[], udpName: string | null,
): (C & { partitionOrder?: number | null })[] {
  if (!udpName) return columns;
  const def = udpDefs.find((d) => d.level === 'column' && d.view !== 'logical' && d.name === udpName);
  if (!def) return columns;
  return columns.map((c) => (c.isPartition
    ? { ...c, partitionOrder: partitionCorrelative(c.udpValues?.[def.id]) }
    : c));
}

/** Reglas seleccionables en el modal: habilitadas y no-inválidas (las stale
 *  corren igual — solo avisan). Default del modal: TODAS marcadas. */
export const selectableRules = (rules: ExportRule[]): ExportRule[] =>
  rules.filter((r) => r.enabled && r.validationState !== 'invalid');

/** Aplica las reglas seleccionadas al export y devuelve el `.sql` final. */
export async function renderWithRules(args: {
  projectId: string;
  diagram: Diagram;
  input: DatabricksDdlInput;         // el mismo input que recibe databricksDdl
  opts: DatabricksDdlOptions;
  ruleIds: string[];
  modelName: string;
}): Promise<{ sql: string; rendered: RenderedExport }> {
  const { projectId, diagram, input, opts, ruleIds, modelName } = args;
  const tables = tableStatements(input, opts);
  const views = opts.includeViews ? viewStatements(input, opts) : [];
  const colsByTable = new Map<string, DdlColumn[]>();
  input.columns.forEach((c) => {
    (colsByTable.get(c.tableId) ?? colsByTable.set(c.tableId, []).get(c.tableId)!).push(c);
  });
  const udpOfColumn = new Map(diagram.columns.map((c) => [c.id, c]));

  const payload = {
    ruleIds,
    model: { name: diagram.subjectArea?.name, udpValues: diagram.subjectArea?.udpValues ?? {} },
    // Opciones del modal: los artefactos generados (p.ej. la tabla _rej) salen
    // ESPEJO del CREATE físico — mismo casing, USING, particiones y LOCATION
    // (carpeta = nombre final con su sufijo y el casing de carpeta).
    options: {
      identifierCase: opts.identifierCase,
      tableFormat: opts.tableFormat,
      external: opts.external,
      location: opts.location,
      locationFolderCase: opts.locationFolderCase ?? 'upper',
      includePartitions: opts.includePartitions,
      partitionsLast: !!opts.partitionsLast,       // doc 73: informativo (el motor lo deriva de las reglas)
    },
    tables: tables.map(({ table, sql }) => ({
      table: {
        id: table.id, physicalName: table.physicalName, schema: table.schema,
        description: table.description,
        udpValues: (diagram.tables.find((t) => t.id === table.id))?.udpValues ?? {},
      },
      // Orden FÍSICO explícito (doc 73 O2): el motor no depende del orden de llegada.
      columns: [...(colsByTable.get(table.id) ?? [])].sort((a, b) => a.ordinal - b.ordinal).map((c) => {
        const canon = udpOfColumn.get(c.id);
        return {
          physicalName: c.physicalName, dataType: c.dataType, ordinal: c.ordinal,
          isNullable: c.isNullable, isPrimaryKey: c.isPrimaryKey,
          // sin esto la _rej no hereda el PARTITIONED BY de la física
          isPartition: c.isPartition,
          parentDomainId: canon?.parentDomainId, description: c.description,
          udpValues: canon?.udpValues ?? {},
        };
      }),
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

  const rendered = await apiPost<RenderedExport>(`${DDL_RULES(projectId)}/render`, payload);
  return { sql: assemble(rendered, modelName, tables.length), rendered };
}

/** Anexos de un objeto (doc 76): `<artefacto>.tags` y `<artefacto>.extra`. */
export const isAddendum = (artifact: string): boolean => /\.(tags|extra)$/.test(artifact);

/** Ensambla el archivo: header con el sello de reglas + statements en el orden
 *  del motor (por tabla: física → tags → generados; luego vistas). Los ALTER
 *  de tags/extra consecutivos van compactos (una línea en blanco entre bloques). */
function assemble(rendered: RenderedExport, modelName: string, tableCount: number): string {
  const header = `-- ${modelName || 'model'} · Databricks · ${tableCount} table(s)\n`
    + `-- Generated by Data Model Hub\n`
    + `-- Export rules: ${rendered.rulesetVersion} · ${rendered.applied} applied`
    + (rendered.skipped ? ` · ${rendered.skipped} skipped` : '') + `\n`;
  const parts: string[] = [];
  let prevAddendum = false;
  for (const s of rendered.statements) {
    const addendum = isAddendum(s.artifact);
    if (addendum && prevAddendum) parts.push(s.sql);      // anexos consecutivos, compactos
    else parts.push((parts.length ? '\n' : '') + s.sql);  // bloque nuevo
    prevAddendum = addendum;
  }
  return `${header}\n${parts.join('\n')}`.trimEnd() + '\n';
}
