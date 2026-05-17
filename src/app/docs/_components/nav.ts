// ─────────────────────────────────────────────────────────────────────────────
// Docs navigation manifest.
//
// Single source of truth for the docs page index. Both the sidebar and the
// section files import `SectionId` from here so renames are caught at compile
// time. Adding a new topic means: (1) add the id below, (2) add the entry to
// `NAV`, (3) create a `_sections/<NewSection>.tsx` file that wraps a
// `<SectionTitle id="<the-id>">…</SectionTitle>`, (4) mount it in `page.tsx`.
// ─────────────────────────────────────────────────────────────────────────────

export type SectionId =
  // Inicio
  | 'getting-started'
  | 'model-editor'
  // Modelado
  | 'adding-tables'
  | 'logical-physical'
  | 'domains'
  | 'views'
  | 'relationships'
  // Canvas
  | 'canvas-view'
  | 'canvas-tools'
  | 'auto-arrange'
  // Agente IA
  | 'ai-agent'
  | 'guidelines'
  // Flujos
  | 'list-view'
  | 'ddl-export'
  | 'save'
  // Referencia
  | 'schemas-partitioning'
  | 'engine-capabilities'
  | 'dbml-reference'
  | 'technical-overview';

export interface NavItem {
  id: SectionId;
  label: string;
  group: string;
}

export const NAV: NavItem[] = [
  // ── Inicio ────────────────────────────────────────────────────────────────
  { id: 'getting-started',      label: 'Primeros Pasos',           group: 'Inicio' },
  { id: 'model-editor',         label: 'Editor de Modelos',        group: 'Inicio' },
  // ── Modelado ──────────────────────────────────────────────────────────────
  { id: 'adding-tables',        label: 'Tablas y Columnas',        group: 'Modelado' },
  { id: 'logical-physical',     label: 'Nombres Lógico / Físico',  group: 'Modelado' },
  { id: 'domains',              label: 'Dominios y Subdominios',   group: 'Modelado' },
  { id: 'views',                label: 'Vistas SQL',               group: 'Modelado' },
  { id: 'relationships',        label: 'Relaciones (FK)',          group: 'Modelado' },
  // ── Canvas ────────────────────────────────────────────────────────────────
  { id: 'canvas-view',          label: 'Diagrama ER (Canvas)',     group: 'Canvas' },
  { id: 'canvas-tools',         label: 'Herramientas del Canvas',  group: 'Canvas' },
  { id: 'auto-arrange',         label: 'Distribución Automática',  group: 'Canvas' },
  // ── Agente IA ─────────────────────────────────────────────────────────────
  { id: 'ai-agent',             label: 'Agente IA — Chat',         group: 'Agente IA' },
  { id: 'guidelines',           label: 'Guidelines',               group: 'Agente IA' },
  // ── Flujos ────────────────────────────────────────────────────────────────
  { id: 'list-view',            label: 'Vista de Lista',           group: 'Flujos' },
  { id: 'ddl-export',           label: 'Exportar DDL',             group: 'Flujos' },
  { id: 'save',                 label: 'Guardar',                  group: 'Flujos' },
  // ── Referencia ────────────────────────────────────────────────────────────
  { id: 'schemas-partitioning', label: 'Esquemas y Partición',     group: 'Referencia' },
  { id: 'engine-capabilities',  label: 'Capacidades por Motor',    group: 'Referencia' },
  { id: 'dbml-reference',       label: 'Referencia DBML',          group: 'Referencia' },
  { id: 'technical-overview',   label: 'Arquitectura Técnica',     group: 'Referencia' },
];

/**
 * Distinct group names in the order they first appear in NAV.
 * Used by the sidebar to render group headers.
 */
export const NAV_GROUPS: string[] = Array.from(new Set(NAV.map((n) => n.group)));
