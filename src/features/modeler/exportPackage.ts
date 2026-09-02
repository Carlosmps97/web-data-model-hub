// Doc 66: orquestación del export HTML de subproyecto. Resuelve el scope
// (packageLayout), baja cada diagrama con loadDiagram (headless y
// changeset-aware — patrón doc 55), construye las páginas (builders puros de
// lib/exportPackagePages) y empaqueta con fflate. Los módulos pesados
// (escena/SVG/fuentes/fflate) cargan lazy, patrón del Toolbar (doc 59).
import { listFolders, listSubjectAreas, loadDiagram } from './services/modeler.service';
import type { Diagram } from './services/modeler.service';
import type { ReportCanvasInput } from './lib/reportPdf';
import { listDomains } from '@/features/governance/services/governance.service';
import { getUdpDefs } from '@/features/standards/standards.service';
import {
  buildCanvasPage, buildIndexPage, packageLayout, sanitizeFileName,
  type ExportLookups, type IndexCanvasEntry, type LayoutCanvas,
} from './lib/exportPackagePages';

export interface ExportProgress { done: number; total: number; current: string }
export interface ExportOutcome { exported: number; total: number; failed: string[]; cancelled: boolean }
/** Flag mutable compartido con la UI: ponerlo en true aborta entre canvases. */
export interface CancelFlag { cancelled: boolean }

const FETCH_CONCURRENCY = 3;

/** Descarga por Blob (mismo patrón del Toolbar, doc 59 — sin data URLs). */
function domDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = filename;
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Pool simple: N carriles que van tomando items en orden. El worker es
 *  responsable de capturar sus propios errores. */
async function runPool<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

/** Catálogos para labels (dominios / UDP defs). Si fallan, el export sigue
 *  con labels vacíos — mejor un reporte sin nombres de dominio que ninguno. */
async function fetchLookups(): Promise<ExportLookups> {
  const [domains, defs] = await Promise.all([
    listDomains().catch(() => []),
    getUdpDefs().catch(() => []),
  ]);
  return {
    domainsById: Object.fromEntries(domains.map((d) => [d.id, d.name])),
    udpDefsById: Object.fromEntries(defs.map((d) => [d.id, { name: d.name, level: d.level }])),
  };
}

interface PageBuilders {
  buildDiagramScene: typeof import('./lib/exportScene').buildDiagramScene;
  buildDiagramSvg: typeof import('./lib/sceneSvg').buildDiagramSvg;
  fontCss: string;
}

async function loadBuilders(): Promise<PageBuilders> {
  const [{ buildDiagramScene }, { buildDiagramSvg }, { EXPORT_FONT_CSS }] = await Promise.all([
    import('./lib/exportScene'), import('./lib/sceneSvg'), import('./lib/exportFonts'),
  ]);
  return { buildDiagramScene, buildDiagramSvg, fontCss: EXPORT_FONT_CSS };
}

/** Página completa de un canvas: dos escenas (logical/physical) → dos SVGs →
 *  HTML con tabs. Los drawings persistidos del canvas entran a la escena. */
function canvasHtml(
  b: PageBuilders, diagram: Diagram, lookups: ExportLookups,
  breadcrumb: string[], indexHref: string | null,
): string {
  const drawings = diagram.subjectArea.drawings ?? [];
  const svgLogical = b.buildDiagramSvg(b.buildDiagramScene({ diagram, drawings, viewMode: 'logical' }), { fontCss: b.fontCss });
  const svgPhysical = b.buildDiagramSvg(b.buildDiagramScene({ diagram, drawings, viewMode: 'physical' }), { fontCss: b.fontCss });
  return buildCanvasPage({
    title: diagram.subjectArea.name, breadcrumb, indexHref,
    svgLogical, svgPhysical, diagram, lookups, fontCss: b.fontCss,
  });
}

export async function exportNodeHtml(opts: {
  kind: 'project' | 'folder' | 'canvas';
  nodeId: string;
  projectId: string;
  projectName: string;
  onProgress?: (p: ExportProgress) => void;
  cancel?: CancelFlag;
  /** Inyectable para tests (vitest corre en node, sin DOM). Default: <a download>. */
  download?: (blob: Blob, filename: string) => void;
}): Promise<ExportOutcome> {
  const download = opts.download ?? domDownload;
  const cancelled = () => opts.cancel?.cancelled === true;
  const [builders, lookups] = await Promise.all([loadBuilders(), fetchLookups()]);

  // ── Canvas suelto: un solo HTML, sin ZIP ──
  if (opts.kind === 'canvas') {
    const outcome: ExportOutcome = { exported: 0, total: 1, failed: [], cancelled: false };
    opts.onProgress?.({ done: 0, total: 1, current: '' });
    const diagram = await loadDiagram(opts.nodeId);
    if (cancelled()) return { ...outcome, cancelled: true };
    const html = canvasHtml(builders, diagram, lookups, [opts.projectName], null);
    download(new Blob([html], { type: 'text/html' }), `${sanitizeFileName(diagram.subjectArea.name)}.html`);
    opts.onProgress?.({ done: 1, total: 1, current: diagram.subjectArea.name });
    return { ...outcome, exported: 1 };
  }

  // ── Folder / proyecto: scope fresco → páginas → ZIP ──
  const [folders, sas] = await Promise.all([listFolders(opts.projectId), listSubjectAreas(opts.projectId)]);
  const layout = packageLayout(opts.kind, opts.nodeId, opts.projectName, folders, sas);
  const total = layout.canvases.length;
  const outcome: ExportOutcome = { exported: 0, total, failed: [], cancelled: false };
  if (cancelled()) return { ...outcome, cancelled: true };

  const pages = new Array<{ path: string; html: string; index: IndexCanvasEntry } | null>(total).fill(null);
  let done = 0;

  await runPool(layout.canvases, FETCH_CONCURRENCY, async (entry: LayoutCanvas, i: number) => {
    if (cancelled()) return;
    opts.onProgress?.({ done, total, current: entry.sa.name });
    try {
      const diagram = await loadDiagram(entry.sa.id);
      if (cancelled()) return;
      const indexHref = `${'../'.repeat(entry.dir.length)}index.html`;
      // El crumb del caso project YA arranca en el proyecto; en folder se
      // antepone para que el breadcrumb siempre lea Proyecto / …carpetas….
      const breadcrumb = opts.kind === 'project' ? entry.crumb : [opts.projectName, ...entry.crumb];
      const html = canvasHtml(builders, diagram, lookups, breadcrumb, indexHref);
      pages[i] = {
        path: [layout.rootName, ...entry.dir, entry.file].join('/'),
        html,
        index: {
          name: entry.sa.name, dir: entry.dir, file: entry.file,
          tables: diagram.tables.map((t) => ({ logical: t.logicalName, physical: t.physicalName })),
        },
      };
      outcome.exported += 1;
    } catch {
      outcome.failed.push(entry.sa.name);
    } finally {
      done += 1;
      opts.onProgress?.({ done, total, current: entry.sa.name });
    }
  });

  if (cancelled()) return { ...outcome, cancelled: true };

  const built = pages.filter((p): p is NonNullable<typeof p> => p !== null);
  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const indexHtml = buildIndexPage({ rootName: layout.rootName, generatedAt, entries: built.map((p) => p.index) });

  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = { [`${layout.rootName}/index.html`]: strToU8(indexHtml) };
  for (const p of built) files[p.path] = strToU8(p.html);
  const zipped = zipSync(files, { level: 6 });
  download(new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }), `${layout.rootName}.zip`);
  return outcome;
}

// ── Doc 67: export PDF = REPORTE completo estilo Erwin ────────────────────
// Portada · TOC · Subject Areas · por canvas (diagramas L+P vectoriales +
// Table(s) + Column(s)) · Index alfabético · bookmarks jerárquicos.
// Reemplaza al multipágina de solo-diagramas del doc 66 r3.
export async function exportNodePdf(opts: {
  kind: 'project' | 'folder' | 'canvas';
  nodeId: string;
  projectId: string;
  projectName: string;
  onProgress?: (p: ExportProgress) => void;
  cancel?: CancelFlag;
  download?: (blob: Blob, filename: string) => void;
}): Promise<ExportOutcome> {
  const download = opts.download ?? domDownload;
  const cancelled = () => opts.cancel?.cancelled === true;
  const [{ buildReportPdf }, { buildModelReport }, { zlibSync }, lookups] = await Promise.all([
    import('./lib/scenePdf'), import('./lib/reportPdf'), import('fflate'), fetchLookups(),
  ]);

  // r2: el reporte ya no lleva diagramas — no se construyen escenas.
  const canvasInput = (diagram: Diagram, location: string): ReportCanvasInput =>
    ({ name: diagram.subjectArea.name, location, diagram });
  const downloadReport = (rootName: string, canvases: ReportCanvasInput[]) => {
    const { pages, bookmarks } = buildModelReport({ rootName, canvases, domainsById: lookups.domainsById });
    const pdf = buildReportPdf(pages, bookmarks, { compress: zlibSync });
    download(new Blob([pdf as unknown as BlobPart], { type: 'application/pdf' }), `${sanitizeFileName(rootName)}.pdf`);
  };

  // ── Canvas suelto: reporte del canvas (portada + TOC + su sección + index) ──
  if (opts.kind === 'canvas') {
    const outcome: ExportOutcome = { exported: 0, total: 1, failed: [], cancelled: false };
    opts.onProgress?.({ done: 0, total: 1, current: '' });
    const diagram = await loadDiagram(opts.nodeId);
    if (cancelled()) return { ...outcome, cancelled: true };
    downloadReport(diagram.subjectArea.name, [canvasInput(diagram, '')]);
    opts.onProgress?.({ done: 1, total: 1, current: diagram.subjectArea.name });
    return { ...outcome, exported: 1 };
  }

  // ── Folder / proyecto ──
  const [folders, sas] = await Promise.all([listFolders(opts.projectId), listSubjectAreas(opts.projectId)]);
  const layout = packageLayout(opts.kind, opts.nodeId, opts.projectName, folders, sas);
  const total = layout.canvases.length;
  const outcome: ExportOutcome = { exported: 0, total, failed: [], cancelled: false };
  if (cancelled()) return { ...outcome, cancelled: true };

  const byIndex = new Array<ReportCanvasInput | null>(total).fill(null);
  let done = 0;
  await runPool(layout.canvases, FETCH_CONCURRENCY, async (entry: LayoutCanvas, i: number) => {
    if (cancelled()) return;
    opts.onProgress?.({ done, total, current: entry.sa.name });
    try {
      const diagram = await loadDiagram(entry.sa.id);
      if (cancelled()) return;
      // Location = ruta de carpetas RELATIVA al nodo exportado.
      byIndex[i] = canvasInput(diagram, entry.crumb.slice(1).join(' / '));
      outcome.exported += 1;
    } catch {
      outcome.failed.push(entry.sa.name);
    } finally {
      done += 1;
      opts.onProgress?.({ done, total, current: entry.sa.name });
    }
  });

  if (cancelled()) return { ...outcome, cancelled: true };
  const canvases = byIndex.filter((c): c is ReportCanvasInput => c !== null);
  if (!canvases.length) return outcome;   // nada exportable (todo falló o folder vacío)
  downloadReport(layout.rootName, canvases);
  return outcome;
}
