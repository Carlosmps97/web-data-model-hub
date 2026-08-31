// Doc 58: export interactivo a HTML.
//
// El .svg exportado se queda NITIDO a cualquier escala, pero abierto suelto en
// el navegador el zoom de pagina topa en ~500% — en modelos grandes eso no
// alcanza para leer una columna. Este modulo construye un HTML AUTOCONTENIDO
// (cero recursos externos, funciona offline) que embebe el mismo SVG vectorial
// y le pone un visor pan/zoom propio: rueda = zoom al cursor hasta 64x,
// arrastre = pan, doble click = acercar. El zoom es transform translate+scale
// sobre SVG inline (mismo mecanismo que React Flow): render vectorial en cada
// frame, sin perder nitidez.
//
// El SVG NO se inyecta crudo en el body: el markup del generador (doc 59) es
// XML con tags auto-cerrados (`<rect/>`) que el parser HTML re-interpreta
// como tags ABIERTOS y rompe el anidado. Se embebe como literal JS y se
// parsea en runtime con DOMParser (XML real), que si los respeta.

/** Escapa texto para interpolarlo en HTML (titulo del documento). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ));
}

/**
 * String como literal JS seguro DENTRO de un `<script>` inline: JSON.stringify
 * + neutralizar `</script` y `<!--`, las DOS secuencias que el parser HTML
 * honra dentro de script data. `<\/` y `<\!--` valen lo mismo en runtime.
 */
export function jsStringLiteral(s: string): string {
  return JSON.stringify(s).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
}

/** Documento HTML autocontenido con el SVG embebido y el visor pan/zoom. */
export function buildInteractiveHtml(opts: { title: string; svgMarkup: string }): string {
  const title = escapeHtml(opts.title);
  const payload = jsStringLiteral(opts.svgMarkup);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light; }
* { margin: 0; box-sizing: border-box; }
html, body { height: 100%; }
body { display: flex; flex-direction: column; overflow: hidden; background: #FBFCFD; color: #1C2436; font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
header { display: flex; align-items: center; gap: 14px; padding: 8px 14px; background: #fff; border-bottom: 1px solid #E3E8F0; flex: 0 0 auto; }
.ttl { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hint { color: #68738A; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: auto; }
.ctrl { display: flex; gap: 4px; }
.ctrl button { font: inherit; min-width: 32px; height: 26px; padding: 0 8px; border: 1px solid #D7DEE9; border-radius: 6px; background: #fff; color: inherit; cursor: pointer; }
.ctrl button:hover { background: #F1F4F9; }
#zpct { min-width: 58px; font-variant-numeric: tabular-nums; }
#stage { flex: 1 1 auto; position: relative; overflow: hidden; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
#stage.drag { cursor: grabbing; }
#vp { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
#err { position: absolute; top: 16px; left: 16px; color: #B4232A; }
</style>
</head>
<body>
<header>
  <div class="ttl" title="${title}">${title}</div>
  <div class="hint">Scroll to zoom &middot; drag to pan &middot; double-click to zoom in (Shift: out) &middot; keys + &minus; 0 1</div>
  <div class="ctrl">
    <button id="zo" title="Zoom out (-)">&minus;</button>
    <button id="zpct" title="Zoom to 100% (1)">100%</button>
    <button id="zi" title="Zoom in (+)">+</button>
    <button id="zfit" title="Fit to screen (0)">Fit</button>
  </div>
</header>
<div id="stage"><div id="vp"></div><div id="err" hidden>Couldn&#39;t render the embedded diagram.</div></div>
<script>
(function () {
  'use strict';
  var SRC = ${payload};
  var stage = document.getElementById('stage');
  var vp = document.getElementById('vp');
  var zpct = document.getElementById('zpct');
  var svg = null;
  try {
    var doc = new DOMParser().parseFromString(SRC, 'image/svg+xml');
    if (!doc.querySelector('parsererror')) svg = document.importNode(doc.documentElement, true);
  } catch (e) { /* cae al mensaje de error */ }
  if (!svg) { document.getElementById('err').hidden = false; return; }
  vp.appendChild(svg);
  svg.style.display = 'block';
  var W = parseFloat(svg.getAttribute('width')) || 0;
  var H = parseFloat(svg.getAttribute('height')) || 0;
  if (!W || !H) {
    var vb = (svg.getAttribute('viewBox') || '').split(/[\\s,]+/);
    W = parseFloat(vb[2]) || 0; H = parseFloat(vb[3]) || 0;
  }
  if (!W || !H) { var r = svg.getBoundingClientRect(); W = r.width || 1; H = r.height || 1; }
  var MIN = 0.01, MAX = 64, k = 1, tx = 0, ty = 0, raf = 0;
  function apply() { raf = 0; vp.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')'; zpct.textContent = Math.round(k * 100) + '%'; }
  function schedule() { if (!raf) raf = requestAnimationFrame(apply); }
  function clampK(v) { return Math.min(MAX, Math.max(MIN, v)); }
  function zoomAt(cx, cy, f) { var nk = clampK(k * f); if (nk === k) return; f = nk / k; tx = cx - (cx - tx) * f; ty = cy - (cy - ty) * f; k = nk; schedule(); }
  function center(f) { zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, f); }
  function fit() { var sw = stage.clientWidth, sh = stage.clientHeight; if (!sw || !sh) return; k = clampK(Math.min(sw / W, sh / H) * 0.95); tx = (sw - W * k) / 2; ty = (sh - H * k) / 2; schedule(); }
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
  window.addEventListener('keydown', function (e) {
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') center(1.4);
    else if (e.key === '-' || e.key === '_') center(1 / 1.4);
    else if (e.key === '0') fit();
    else if (e.key === '1') center(1 / k);
    else return;
    e.preventDefault();
  });
  fit();
})();
</script>
</body>
</html>
`;
}
