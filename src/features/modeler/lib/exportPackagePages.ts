// Doc 66: builders PUROS del export de subproyecto — sanitización de nombres,
// layout del ZIP, página por canvas e index. Sin imports de servicios ni del
// store (testeables en node); la red/ZIP viven en ../exportPackage.ts.

/** Caracteres prohibidos en nombres de archivo (Windows es el más estricto)
 *  + caracteres de control (rango intencional: nombres van a rutas de ZIP). */
// eslint-disable-next-line no-control-regex
const RESERVED = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;

/** Nombre seguro para archivo/carpeta del ZIP. Conserva acentos/espacios
 *  interiores; recorta puntos y espacios FINALES (inválidos en Windows). */
export function sanitizeFileName(raw: string): string {
  const s = raw.replace(RESERVED, '_').replace(/[. ]+$/g, '').trim();
  return s || 'untitled';
}

/** Resuelve colisiones case-insensitive dentro de una carpeta: `base`,
 *  `base_2`, `base_3`… MUTA `taken` registrando el nombre elegido. */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) { taken.add(base.toLowerCase()); return base; }
  for (let i = 2; ; i++) {
    const cand = `${base}_${i}`;
    if (!taken.has(cand.toLowerCase())) { taken.add(cand.toLowerCase()); return cand; }
  }
}

import type { Folder, SubjectArea } from '../services/modeler.service';

/** Una entrada del paquete: el canvas + su carpeta (segmentos saneados, ruta
 *  real del ZIP), su breadcrumb (nombres originales desde el nodo exportado)
 *  y su nombre de archivo único con extensión. */
export interface LayoutCanvas { sa: SubjectArea; dir: string[]; crumb: string[]; file: string }
export interface PackageLayout { rootName: string; canvases: LayoutCanvas[] }

/** Resuelve el SCOPE del export a rutas del ZIP. Espejo del orden del
 *  explorer (`buildProjectTree`, doc 92 D1): carpetas y canvases A–Z
 *  (case-insensitive; `order` sólo desempata). Carpetas sin canvases (directa o transitivamente) no generan
 *  entradas — un ZIP no tiene directorios vacíos. */
export function packageLayout(
  kind: 'project' | 'folder', nodeId: string, projectName: string,
  folders: Folder[], subjectAreas: SubjectArea[],
): PackageLayout {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const k = f.parentFolderId ?? null;
    const arr = byParent.get(k); if (arr) arr.push(f); else byParent.set(k, [f]);
  }
  const byFolder = new Map<string | null, SubjectArea[]>();
  for (const sa of subjectAreas) {
    const k = sa.folderId ?? null;
    const arr = byFolder.get(k); if (arr) arr.push(sa); else byFolder.set(k, [sa]);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b);
  const sortF = (a: Folder, b: Folder) => byName(a.name, b.name) || a.order - b.order;
  const sortC = (a: SubjectArea, b: SubjectArea) => byName(a.name, b.name);

  const out: LayoutCanvas[] = [];
  const walk = (folderId: string | null, dir: string[], crumb: string[]) => {
    const takenFiles = new Set<string>();
    for (const sa of [...(byFolder.get(folderId) ?? [])].sort(sortC)) {
      out.push({ sa, dir, crumb, file: `${uniqueName(sanitizeFileName(sa.name), takenFiles)}.html` });
    }
    const takenDirs = new Set<string>();
    for (const f of [...(byParent.get(folderId) ?? [])].sort(sortF)) {
      walk(f.id, [...dir, uniqueName(sanitizeFileName(f.name), takenDirs)], [...crumb, f.name]);
    }
  };

  if (kind === 'project') {
    walk(null, [], [projectName]);
    return { rootName: sanitizeFileName(projectName), canvases: out };
  }
  const root = folders.find((f) => f.id === nodeId);
  if (!root) throw new Error(`Folder ${nodeId} not found`);
  walk(nodeId, [], [root.name]);
  return { rootName: sanitizeFileName(root.name), canvases: out };
}

import { escapeHtml, jsStringLiteral } from './exportHtml';
import type { Diagram } from '../services/modeler.service';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { udpView, type Facet } from '@/lib/facets';
import { orderColumns } from './columnOrder';

export type UdpLevel = 'table' | 'column' | 'canvas' | 'view';
export interface ExportLookups {
  domainsById: Record<string, string>;
  /** `view` (doc 69): faceta de la def; ausente = physical. */
  udpDefsById: Record<string, { name: string; level: UdpLevel; view?: Facet }>;
}
export interface CanvasPageInput {
  title: string;
  breadcrumb: string[];
  indexHref: string | null;
  svgLogical: string;
  svgPhysical: string;
  diagram: Diagram;
  lookups: ExportLookups;
  fontCss?: string;
  /** Doc 96 D6: DDL generado de cada vista (id → texto), el que escribe el Export
   *  DDL. Sin él se muestra el SQL guardado. */
  viewDdl?: Record<string, string>;
}

const esc = escapeHtml;

/** Chips `Nombre: valor` de las UDP asignadas cuyo def exista y sea del nivel
 *  pedido (defs desconocidas se omiten). Doc 69: ambas facetas — físicas
 *  primero con el nombre plano; las lógicas (Entity/Attribute) marcadas. */
export function udpChipsHtml(values: Record<string, string> | undefined, level: UdpLevel, lk: ExportLookups): string {
  if (!values) return '';
  type Def = { name: string; level: UdpLevel; view?: Facet };
  const rank = (d: Def) => (udpView(d) === 'physical' ? 0 : 1);
  return Object.entries(values)
    .map(([defId, v]) => ({ def: lk.udpDefsById[defId], v }))
    .filter((x): x is { def: Def; v: string } => !!x.def && x.def.level === level && x.v !== '')
    .sort((a, b) => rank(a.def) - rank(b.def) || a.def.name.localeCompare(b.def.name))
    .map(({ def, v }) => (udpView(def) === 'logical'
      ? `<span class="chip logical" title="Logical UDP (Entity/Attribute)">L · ${esc(def.name)}: ${esc(v)}</span>`
      : `<span class="chip" title="UDP">${esc(def.name)}: ${esc(v)}</span>`))
    .join('');
}

/** Filas de columnas en el orden único (doc 94: PK primero, por `ordinal`);
 *  «PK #k» = posición de la PK en ese orden. */
function columnsRows(cols: CanonicalColumn[], lk: ExportLookups): string {
  let k = 0;
  return cols.map((c, i) => {
    const pk = c.isPrimaryKey ? `PK #${++k}` : '';
    return `<tr>
<td class="num">${i + 1}</td>
<td>${esc(c.logicalName)}</td>
<td><code>${esc(c.physicalName)}</code></td>
<td><code>${esc(c.dataType)}</code></td>
<td><code>${esc(c.logicalDataType ?? '')}</code></td>
<td>${c.parentDomainId && lk.domainsById[c.parentDomainId] ? esc(lk.domainsById[c.parentDomainId]) : '—'}</td>
<td class="flag">${pk}</td>
<td class="flag">${c.isForeignKey ? 'FK' : ''}</td>
<td class="flag">${c.isNullable === false ? 'NOT NULL' : 'NULL'}</td>
<td class="flag">${c.isPartition ? '✓' : ''}</td>
<td class="desc">${esc(c.description ?? '')}</td>
<td>${udpChipsHtml(c.udpValues, 'column', lk)}</td>
</tr>`;
  }).join('\n');
}

/** Cuerpo estático de la pestaña Tables: secciones por tabla (ancla
 *  `t-<physicalName>`), relaciones del canvas y vistas. Todo escapado. */
function tablesSectionHtml(diagram: Diagram, lk: ExportLookups, viewDdl?: Record<string, string>): string {
  const { tables, columns, relationships, views } = diagram;
  const tablesById = new Map<string, CanonicalTable>(tables.map((t) => [t.id, t]));
  const colsById = new Map<string, CanonicalColumn>(columns.map((c) => [c.id, c]));
  const colsByTable = new Map<string, CanonicalColumn[]>();
  for (const c of columns) {
    const arr = colsByTable.get(c.tableId); if (arr) arr.push(c); else colsByTable.set(c.tableId, [c]);
  }

  const sections = [...tables].sort((a, b) => a.physicalName.localeCompare(b.physicalName)).map((t) => {
    const cols = orderColumns(colsByTable.get(t.id) ?? []);
    return `<section class="tbl" id="t-${esc(t.physicalName)}">
<h2>${esc(t.logicalName)} <code class="phys">${esc(t.physicalName)}</code>${t.schema ? ` <span class="chip schema">${esc(t.schema)}</span>` : ''}${udpChipsHtml(t.udpValues, 'table', lk)}</h2>
${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
<div class="scroll"><table>
<thead><tr><th>#</th><th>Logical name</th><th>Physical name</th><th>Type</th><th>Logical type</th><th>Domain</th><th>PK</th><th>FK</th><th>Null</th><th>Partition</th><th>Description</th><th>UDPs</th></tr></thead>
<tbody>${columnsRows(cols, lk)}</tbody>
</table></div>
</section>`;
  }).join('\n');

  const relRows = relationships.map((r) => {
    const p = tablesById.get(r.parentTableId); const ch = tablesById.get(r.childTableId);
    const pairs = r.pairs.map((pr) => {
      const a = colsById.get(pr.parentColumnId); const b = colsById.get(pr.childColumnId);
      const role = pr.roleName ? ` <em>(${esc(pr.roleName)})</em>` : '';
      return `<code>${esc(a?.physicalName ?? pr.parentColumnId)} → ${esc(b?.physicalName ?? pr.childColumnId)}</code>${role}`;
    }).join('<br>');
    const flags = [r.identifying ? 'identifying' : '', r.subcategory ? 'subcategory' : ''].filter(Boolean)
      .map((f) => `<span class="chip">${f}</span>`).join('');
    const name = (t?: CanonicalTable) => t ? `<code>${esc(t.physicalName)}</code> <span class="dim">(${esc(t.logicalName)})</span>` : '—';
    return `<tr><td>${name(p)}</td><td>${name(ch)}</td><td>${esc(r.parentCardinality)} → ${esc(r.childCardinality)}</td><td>${flags}</td><td>${pairs}</td></tr>`;
  }).join('\n');

  const relSection = relationships.length ? `<section class="tbl">
<h2>Relationships</h2>
<div class="scroll"><table>
<thead><tr><th>Parent</th><th>Child</th><th>Cardinality</th><th>Flags</th><th>Key pairs</th></tr></thead>
<tbody>${relRows}</tbody>
</table></div>
</section>` : '';

  const viewCards = views.map((v) => {
    const srcs = (v.sourceTableIds ?? (v.tableId ? [v.tableId] : []))
      .map((id) => tablesById.get(id)?.physicalName ?? id).map((n) => `<code>${esc(n)}</code>`).join(', ');
    // Doc 96 D6: el SQL de la vista es el DDL generado de sus columnas; la
    // User-Defined SQL va aparte, marcada como informativa (no se exporta).
    const ddl = viewDdl?.[v.id] ?? v.sql ?? '(generated from sources)';
    const custom = v.customSql?.trim();
    const info = custom ? `\n<p class="dim">User-Defined SQL — informational, not exported</p>\n<pre>${esc(custom)}</pre>` : '';
    return `<div class="view">
<h3>${esc(v.name)}${v.schema ? ` <span class="chip schema">${esc(v.schema)}</span>` : ''}${udpChipsHtml(v.udpValues, 'view', lk)}</h3>
${srcs ? `<p class="dim">Sources: ${srcs}</p>` : ''}
<pre>${esc(ddl)}</pre>${info}
</div>`;
  }).join('\n');
  const viewSection = views.length ? `<section class="tbl"><h2>Views</h2>${viewCards}</section>` : '';

  return `<p class="summary">${tables.length} tables · ${columns.length} columns · ${relationships.length} relationships · ${views.length} views</p>
${sections}
${relSection}
${viewSection}`;
}

/** Página HTML autocontenida de UN canvas: visor pan/zoom del doc 58 con dos
 *  SVGs (Logical/Physical) + pestaña Tables estática. Offline: cero recursos
 *  externos (fuentes van embebidas vía fontCss). */
export function buildCanvasPage(input: CanvasPageInput): string {
  const title = esc(input.title);
  const crumb = input.breadcrumb.map((b) => esc(b)).join(' / ');
  const canvasChips = udpChipsHtml(input.diagram.subjectArea.udpValues, 'canvas', input.lookups);
  const indexLink = input.indexHref ? `<a class="idx-link" href="${esc(input.indexHref)}">&larr; Index</a>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${input.fontCss ?? ''}
:root { color-scheme: light; }
* { margin: 0; box-sizing: border-box; }
html, body { height: 100%; }
body { display: flex; flex-direction: column; overflow: hidden; background: #FBFCFD; color: #1C2436; font: 13px/1.45 'Geist Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
code { font-family: 'Geist Mono Variable', ui-monospace, monospace; font-size: 12px; }
header { display: flex; align-items: center; gap: 12px; padding: 8px 14px; background: #fff; border-bottom: 1px solid #E3E8F0; flex: 0 0 auto; flex-wrap: wrap; }
.crumb { color: #68738A; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttl { font-weight: 600; font-size: 14px; white-space: nowrap; }
.idx-link { color: #35507E; text-decoration: none; font-size: 12px; }
.idx-link:hover { text-decoration: underline; }
.tabs, .modes, .ctrl { display: flex; gap: 4px; }
.tabs { margin-left: auto; }
button { font: inherit; height: 26px; padding: 0 10px; border: 1px solid #D7DEE9; border-radius: 6px; background: #fff; color: inherit; cursor: pointer; }
button:hover { background: #F1F4F9; }
button.on { background: #1A2B4A; color: #fff; border-color: #1A2B4A; }
#zpct { min-width: 58px; font-variant-numeric: tabular-nums; }
#stage { flex: 1 1 auto; position: relative; overflow: hidden; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
#stage.drag { cursor: grabbing; }
#vp { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
#err { position: absolute; top: 16px; left: 16px; color: #B4232A; }
#tables { flex: 1 1 auto; overflow: auto; padding: 16px 22px 40px; }
.summary { color: #68738A; margin-bottom: 14px; }
.tbl { margin-bottom: 26px; }
.tbl h2 { font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tbl h3 { font-size: 13px; margin: 10px 0 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.phys { color: #35507E; }
.chip { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 9px; background: #EDF1F7; color: #35507E; border: 1px solid #D7DEE9; }
.chip.schema { background: #E3EBFF; }
.chip.logical { border-style: dashed; background: #F4EEFF; color: #5B3FA0; }
.desc { color: #444; margin: 4px 0 8px; max-width: 900px; }
.dim { color: #68738A; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; font-size: 12px; min-width: 720px; }
th, td { border: 1px solid #E3E8F0; padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: #F4F6FA; font-weight: 600; white-space: nowrap; }
td.num { color: #9AA3B2; text-align: right; }
td.flag { white-space: nowrap; }
td.desc { min-width: 220px; }
tbody tr:nth-child(even) { background: #FAFBFD; }
.view pre { background: #F4F6FA; border: 1px solid #E3E8F0; border-radius: 6px; padding: 10px; overflow-x: auto; font-size: 12px; margin-top: 4px; }
[hidden] { display: none !important; }
</style>
</head>
<body>
<header>
  ${indexLink}
  <span class="crumb">${crumb}</span>
  <span class="ttl">${title}</span>
  ${canvasChips}
  <div class="tabs">
    <button id="tab-d" data-tab="diagram" class="on">Diagram</button>
    <button id="tab-t" data-tab="tables">Tables</button>
  </div>
  <div class="modes" id="modes">
    <button id="m-l" data-mode="logical" class="on">Logical</button>
    <button id="m-p" data-mode="physical">Physical</button>
  </div>
  <div class="ctrl" id="ctrl">
    <button id="zo" title="Zoom out (-)">&minus;</button>
    <button id="zpct" title="Zoom to 100% (1)">100%</button>
    <button id="zi" title="Zoom in (+)">+</button>
    <button id="zfit" title="Fit to screen (0)">Fit</button>
  </div>
</header>
<div id="stage"><div id="vp"></div><div id="err" hidden>Couldn&#39;t render the embedded diagram.</div></div>
<div id="tables" hidden>
${tablesSectionHtml(input.diagram, input.lookups, input.viewDdl)}
</div>
<script>
(function () {
  'use strict';
  var SRC = { logical: ${jsStringLiteral(input.svgLogical)}, physical: ${jsStringLiteral(input.svgPhysical)} };
  var stage = document.getElementById('stage');
  var vp = document.getElementById('vp');
  var zpct = document.getElementById('zpct');
  var tablesEl = document.getElementById('tables');
  var mode = 'logical', tab = 'diagram';
  var W = 1, H = 1, MIN = 0.01, MAX = 64, k = 1, tx = 0, ty = 0, raf = 0, fitted = false;
  var cache = {};

  function parseSvg(which) {
    if (cache[which]) return cache[which];
    try {
      var doc = new DOMParser().parseFromString(SRC[which], 'image/svg+xml');
      if (!doc.querySelector('parsererror')) cache[which] = document.importNode(doc.documentElement, true);
    } catch (e) { /* cae al mensaje de error */ }
    return cache[which] || null;
  }
  function mount(which) {
    var svg = parseSvg(which);
    if (!svg) { document.getElementById('err').hidden = false; return; }
    document.getElementById('err').hidden = true;
    while (vp.firstChild) vp.removeChild(vp.firstChild);
    vp.appendChild(svg);
    svg.style.display = 'block';
    W = parseFloat(svg.getAttribute('width')) || 1;
    H = parseFloat(svg.getAttribute('height')) || 1;
    if (!fitted) { fitted = true; fit(); }
  }
  function apply() { raf = 0; vp.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')'; zpct.textContent = Math.round(k * 100) + '%'; }
  function schedule() { if (!raf) raf = requestAnimationFrame(apply); }
  function clampK(v) { return Math.min(MAX, Math.max(MIN, v)); }
  function zoomAt(cx, cy, f) { var nk = clampK(k * f); if (nk === k) return; f = nk / k; tx = cx - (cx - tx) * f; ty = cy - (cy - ty) * f; k = nk; schedule(); }
  function center(f) { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, f); }
  function fit() { var sw = stage.clientWidth, sh = stage.clientHeight; if (!sw || !sh) return; k = clampK(Math.min(sw / W, sh / H) * 0.95); tx = (sw - W * k) / 2; ty = (sh - H * k) / 2; schedule(); }

  function setMode(m) {
    mode = m;
    document.getElementById('m-l').className = m === 'logical' ? 'on' : '';
    document.getElementById('m-p').className = m === 'physical' ? 'on' : '';
    mount(m);
  }
  function setTab(t) {
    tab = t;
    var dia = t === 'diagram';
    document.getElementById('tab-d').className = dia ? 'on' : '';
    document.getElementById('tab-t').className = dia ? '' : 'on';
    stage.hidden = !dia; tablesEl.hidden = dia;
    document.getElementById('modes').hidden = !dia;
    document.getElementById('ctrl').hidden = !dia;
  }

  stage.addEventListener('wheel', function (e) { e.preventDefault(); var d = e.deltaY; if (e.deltaMode === 1) d *= 16; var b = stage.getBoundingClientRect(); zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-d * 0.0022)); }, { passive: false });
  var pid = null, lx = 0, ly = 0;
  stage.addEventListener('pointerdown', function (e) { if (e.button !== 0 && e.button !== 1) return; pid = e.pointerId; lx = e.clientX; ly = e.clientY; try { stage.setPointerCapture(pid); } catch (err) { /* opcional */ } stage.classList.add('drag'); });
  stage.addEventListener('pointermove', function (e) { if (pid === null || e.pointerId !== pid) return; tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY; schedule(); });
  function up(e) { if (pid === null || e.pointerId !== pid) return; pid = null; stage.classList.remove('drag'); }
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('dblclick', function (e) { var b = stage.getBoundingClientRect(); zoomAt(e.clientX - b.left, e.clientY - b.top, e.shiftKey ? 0.5 : 2); });
  document.getElementById('zi').addEventListener('click', function () { center(1.4); });
  document.getElementById('zo').addEventListener('click', function () { center(1 / 1.4); });
  document.getElementById('zfit').addEventListener('click', fit);
  zpct.addEventListener('click', function () { center(1 / k); });
  document.getElementById('tab-d').addEventListener('click', function () { setTab('diagram'); });
  document.getElementById('tab-t').addEventListener('click', function () { setTab('tables'); });
  document.getElementById('m-l').addEventListener('click', function () { setMode('logical'); });
  document.getElementById('m-p').addEventListener('click', function () { setMode('physical'); });
  window.addEventListener('keydown', function (e) {
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    if (tab !== 'diagram') return;
    if (e.key === '+' || e.key === '=') center(1.4);
    else if (e.key === '-' || e.key === '_') center(1 / 1.4);
    else if (e.key === '0') fit();
    else if (e.key === '1') center(1 / k);
    else return;
    e.preventDefault();
  });

  function goHash() {
    if (!location.hash) return;
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = location.hash.slice(1); }
    if (id.indexOf('t-') !== 0) return;
    var el = document.getElementById(id);
    if (!el) return;
    setTab('tables');
    el.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('hashchange', goHash);

  setMode('logical');
  goHash();
})();
</script>
</body>
</html>
`;
}

export interface IndexCanvasEntry {
  name: string;
  dir: string[];
  file: string;
  tables: { logical: string; physical: string }[];
}

/** Href relativo de una entrada (cada segmento URL-encoded — los nombres
 *  saneados aún pueden traer espacios/acentos). */
function entryHref(e: IndexCanvasEntry): string {
  return [...e.dir, e.file].map(encodeURIComponent).join('/');
}

/** Árbol anidado por `dir`: <details open> por carpeta, links por canvas.
 *  Carpetas derivadas de las entradas (una carpeta sin canvases no existe en
 *  el ZIP). */
function treeHtml(entries: IndexCanvasEntry[]): string {
  interface Node { dirs: Map<string, Node>; leaves: IndexCanvasEntry[] }
  const root: Node = { dirs: new Map(), leaves: [] };
  for (const e of entries) {
    let n = root;
    for (const seg of e.dir) {
      let next = n.dirs.get(seg);
      if (!next) { next = { dirs: new Map(), leaves: [] }; n.dirs.set(seg, next); }
      n = next;
    }
    n.leaves.push(e);
  }
  const render = (n: Node): string => {
    const leaves = n.leaves.map((e) => `<li><a href="${escapeHtml(entryHref(e))}">${escapeHtml(e.name)}</a> <span class="dim">· ${e.tables.length} tables</span></li>`).join('\n');
    const dirs = [...n.dirs.entries()].map(([seg, child]) =>
      `<li><details open><summary>${escapeHtml(seg)}</summary><ul>${render(child)}</ul></details></li>`).join('\n');
    return leaves + dirs;
  };
  return `<ul class="tree">${render(root)}</ul>`;
}

/** index.html de la raíz del ZIP: árbol espejo + filtro «contiene» (doc 57)
 *  sobre canvases y tablas (link directo al ancla `#t-…`). Autocontenido. */
export function buildIndexPage(input: { rootName: string; generatedAt: string; entries: IndexCanvasEntry[] }): string {
  const totalTables = input.entries.reduce((acc, e) => acc + e.tables.length, 0);
  const data = input.entries.map((e) => ({ name: e.name, href: entryHref(e), tables: e.tables }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.rootName)}</title>
<style>
:root { color-scheme: light; }
* { margin: 0; box-sizing: border-box; }
body { background: #FBFCFD; color: #1C2436; font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; padding: 26px 30px 60px; }
h1 { font-size: 19px; margin-bottom: 2px; }
.meta { color: #68738A; font-size: 12px; margin-bottom: 18px; }
#q { font: inherit; width: 100%; max-width: 460px; padding: 7px 11px; border: 1px solid #D7DEE9; border-radius: 7px; margin-bottom: 16px; }
ul.tree, ul.tree ul { list-style: none; padding-left: 18px; }
ul.tree { padding-left: 0; }
ul.tree li { margin: 3px 0; }
summary { cursor: pointer; font-weight: 600; }
a { color: #35507E; text-decoration: none; }
a:hover { text-decoration: underline; }
.dim { color: #9AA3B2; font-size: 12px; }
#results { display: none; list-style: none; }
#results li { margin: 4px 0; }
code { font-family: ui-monospace, monospace; font-size: 12px; }
.empty { color: #9AA3B2; }
</style>
</head>
<body>
<h1>${escapeHtml(input.rootName)}</h1>
<p class="meta">Generated ${escapeHtml(input.generatedAt)} · ${input.entries.length} canvases · ${totalTables} tables</p>
<input id="q" type="search" placeholder="Filter canvases and tables (contains)…" autocomplete="off">
<div id="tree">${treeHtml(input.entries)}</div>
<ul id="results"></ul>
<script>
(function () {
  'use strict';
  var DATA = JSON.parse(${jsStringLiteral(JSON.stringify(data))});
  var q = document.getElementById('q');
  var tree = document.getElementById('tree');
  var results = document.getElementById('results');
  function esc(s) { return s.replace(/[&<>"']/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'; }); }
  function contains(hay, needle) { return hay.toLowerCase().indexOf(needle) !== -1; }
  q.addEventListener('input', function () {
    var term = q.value.trim().toLowerCase();
    if (!term) { tree.style.display = ''; results.style.display = 'none'; results.innerHTML = ''; return; }
    var out = [];
    for (var i = 0; i < DATA.length; i++) {
      var c = DATA[i];
      if (contains(c.name, term)) out.push('<li><a href="' + esc(c.href) + '">' + esc(c.name) + '</a> <span class="dim">canvas</span></li>');
      for (var j = 0; j < c.tables.length; j++) {
        var t = c.tables[j];
        if (contains(t.physical, term) || contains(t.logical, term)) {
          out.push('<li><a href="' + esc(c.href) + '#t-' + encodeURIComponent(t.physical) + '"><code>' + esc(t.physical) + '</code></a> <span class="dim">(' + esc(t.logical) + ') — ' + esc(c.name) + '</span></li>');
        }
      }
    }
    results.innerHTML = out.length ? out.join('') : '<li class="empty">No matches</li>';
    tree.style.display = 'none';
    results.style.display = 'block';
  });
})();
</script>
</body>
</html>
`;
}
