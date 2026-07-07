/**
 * Contenido de la Guía de uso in-app (Screen 12). Todo BILINGÜE (en/es) — el
 * usuario cambia el idioma solo en esta sección. `MODULES` = doc funcional por
 * módulo (generada leyendo el código real). CONCEPTS/STEPS/FAQ/UI = estáticos.
 */
export type Lang = 'en' | 'es';

export interface ModuleSection {
  subEn: string; subEs: string;
  bodyEn: string; bodyEs: string;
  itemsEn?: string[]; itemsEs?: string[];
}
export interface ModuleDoc {
  id: string;
  card: { titleEn: string; titleEs: string; blurbEn: string; blurbEs: string; bulletsEn: string[]; bulletsEs: string[] };
  deep: { headingEn: string; headingEs: string; sections: ModuleSection[] };
}

// Doc funcional por módulo (EN+ES) — generada leyendo el código real; ver
// helpModules.generated.ts. Se re-exporta acá para que todo el contenido de la
// guía se consuma desde un único módulo.
export { MODULES } from './helpModules.generated';

// ── Conceptos clave ──────────────────────────────────────────────────────────
export const CONCEPTS: { titleEn: string; titleEs: string; bodyEn: string; bodyEs: string }[] = [
  { titleEn: 'Project', titleEs: 'Proyecto',
    bodyEn: 'Groups the models of a domain (e.g. Core Banking). A table can belong to several projects at once.',
    bodyEs: 'Agrupa los modelos de un dominio (p. ej. Core Banking). Una tabla puede pertenecer a varios proyectos a la vez.' },
  { titleEn: 'Version', titleEs: 'Versión',
    bodyEn: 'A snapshot of the model in time: Historical, In review or Production. Only one version is in production.',
    bodyEs: 'Una foto del modelo en el tiempo: Historical, In review o Production. Solo una versión está en producción.' },
  { titleEn: 'Subject Area (Canvas)', titleEs: 'Subject Area (Canvas)',
    bodyEn: 'A thematic view of the model that groups related tables so you can see and report on them together.',
    bodyEs: 'Vista temática del modelo que agrupa tablas relacionadas para verlas y reportarlas juntas.' },
  { titleEn: 'Glossary', titleEs: 'Glosario',
    bodyEn: 'Terms and abbreviations used to derive standardized physical names from logical names.',
    bodyEs: 'Términos y abreviaturas que se usan para derivar nombres físicos estandarizados a partir de los lógicos.' },
  { titleEn: 'Parent domain', titleEs: 'Dominio padre',
    bodyEn: 'A reusable data-type template. When you change it, the change can cascade to the columns that use it (respecting manual overrides).',
    bodyEs: 'Plantilla de tipo de dato reutilizable. Al cambiarla, el cambio puede propagarse en cascada a las columnas que la usan (respetando los overrides manuales).' },
  { titleEn: 'UDP', titleEs: 'UDP',
    bodyEn: 'User-Defined Property: custom key–value metadata you attach to tables or columns (text, list or number), defined in Data Standards.',
    bodyEs: 'Propiedad definida por el usuario: metadata clave–valor propia que agregás a tablas o columnas (texto, lista o número), definida en Data Standards.' },
  { titleEn: 'Request / Changeset', titleEs: 'Solicitud / Changeset',
    bodyEn: 'A change proposal over a snapshot that a reviewer approves or rejects before it is published.',
    bodyEs: 'Una propuesta de cambio sobre un snapshot que un revisor aprueba o rechaza antes de publicarse.' },
  { titleEn: 'Editing session', titleEs: 'Sesión de edición',
    bodyEn: 'Your working context over a version: it groups your pending changes until you save or send them to review.',
    bodyEs: 'Tu contexto de trabajo sobre una versión: agrupa tus cambios pendientes hasta que los guardás o los envías a revisión.' },
];

// ── Primeros pasos ───────────────────────────────────────────────────────────
export const STEPS: { titleEn: string; titleEs: string; bodyEn: string; bodyEs: string; accent?: boolean }[] = [
  { titleEn: 'Enter the Hub', titleEs: 'Entra al Hub',
    bodyEn: 'Review the workspace summary, your projects and the change requests assigned to you.',
    bodyEs: 'Revisa el resumen del workspace, tus proyectos y las solicitudes de cambio asignadas a ti.' },
  { titleEn: 'Open a version', titleEs: 'Abre una versión',
    bodyEn: 'In Model, pick an existing version or create a new one from a snapshot.',
    bodyEs: 'En Model, elige una versión existente o crea una nueva a partir de un snapshot.' },
  { titleEn: 'Model', titleEs: 'Modela',
    bodyEn: 'Create tables, columns and relationships. Document each element in its properties panel.',
    bodyEs: 'Crea tablas, columnas y relaciones. Documenta cada elemento en su panel de propiedades.' },
  { titleEn: 'Publish', titleEs: 'Publica',
    bodyEn: 'Send your version to review. Once approved, it goes to production for the whole team.',
    bodyEs: 'Envía tu versión a revisión. Una vez aprobada, pasa a producción para todo el equipo.', accent: true },
];

// ── Preguntas frecuentes ─────────────────────────────────────────────────────
export const FAQ: { qEn: string; qEs: string; aEn: string; aEs: string }[] = [
  { qEn: 'Can I edit the production version directly?', qEs: '¿Puedo editar la versión en producción?',
    aEn: 'No. Create a new version from a snapshot and publish it after review.',
    aEs: 'No directamente. Crea una versión nueva desde un snapshot y publícala tras la revisión.' },
  { qEn: 'Can a table belong to several projects?', qEs: '¿Una tabla puede estar en varios proyectos?',
    aEn: 'Yes. Assign it to every project and subject area that needs it.',
    aEs: 'Sí. Asígnala a todos los proyectos y áreas temáticas que la necesiten.' },
  { qEn: 'How do I document a column?', qEs: '¿Cómo documento una columna?',
    aEn: 'Select it and fill its functional definition and UDPs in the properties panel.',
    aEs: 'Selecciónala y completa su definición funcional y sus UDPs en el panel de propiedades.' },
  { qEn: 'How do I filter the report by a UDP?', qEs: '¿Cómo filtro el reporte por un UDP?',
    aEn: 'Open Reporting → Design report. Any UDP you define becomes a filterable/groupable column, in the visual builder or the SQL box.',
    aEs: 'Entra a Reporting → Design report. Cualquier UDP que definas se vuelve una columna filtrable/agrupable, en el builder visual o en la caja SQL.' },
];

// ── Textos de UI (estáticos) ─────────────────────────────────────────────────
export const UI = {
  en: {
    badge: 'Help center', title: 'How to use Data Model Hub',
    hero: 'Data Model Hub is the collaborative space to design, document and publish your organization’s data models. This guide walks you through everything you can do — from opening a version of the model to creating tables, documenting properties and exporting the metadata.',
    startNow: 'Start now', firstSteps: 'First steps', firstStepsSub: 'Four steps to go from zero to your first published change.',
    concepts: 'Key concepts', modules: 'What you can do in each module', modulesSub: 'Each card links to the matching screen.',
    faq: 'Frequently asked questions', search: 'Search the guide…',
    tocStart: 'Get started', tocFirst: 'First steps', tocConcepts: 'Key concepts', tocModules: 'Modules',
    supportTitle: 'Need more help?', supportBlurb: 'Reach out to the data governance team or open the full functional documentation.',
    contact: 'Contact support', techDocs: 'Technical docs (PDF)', lang: 'Language', close: 'Close',
    inThisSection: 'In this section', details: 'Details', downloadHint: 'Opens a print-ready functional document you can save as PDF.',
  },
  es: {
    badge: 'Centro de ayuda', title: 'Cómo usar Data Model Hub',
    hero: 'Data Model Hub es el espacio colaborativo para diseñar, documentar y publicar los modelos de datos de tu organización. Esta guía te lleva paso a paso por todo lo que puedes hacer: desde abrir una versión del modelo hasta crear tablas, documentar propiedades y exportar la metadata.',
    startNow: 'Empezar ahora', firstSteps: 'Primeros pasos', firstStepsSub: 'Cuatro pasos para pasar de cero a tu primer cambio publicado.',
    concepts: 'Conceptos clave', modules: 'Qué puedes hacer en cada módulo', modulesSub: 'Cada tarjeta enlaza a la pantalla correspondiente.',
    faq: 'Preguntas frecuentes', search: 'Buscar en la guía…',
    tocStart: 'Empezar', tocFirst: 'Primeros pasos', tocConcepts: 'Conceptos clave', tocModules: 'Módulos',
    supportTitle: '¿Necesitas más ayuda?', supportBlurb: 'Escribe al equipo de gobierno de datos o abre la documentación funcional completa.',
    contact: 'Contactar soporte', techDocs: 'Docs técnicas (PDF)', lang: 'Idioma', close: 'Cerrar',
    inThisSection: 'En esta sección', details: 'Detalle', downloadHint: 'Abre un documento funcional listo para imprimir que podés guardar como PDF.',
  },
} as const;

// Contacto de soporte.
export const SUPPORT = {
  name: 'Carlos Manuel Perez Salcedo',
  email: 'carlosperez@empresa.com.pe',
};
