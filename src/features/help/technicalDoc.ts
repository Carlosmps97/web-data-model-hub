/**
 * "Docs técnicas (PDF)" — genera un documento FUNCIONAL completo (todo el detalle
 * de las funcionalidades de la web, no la arquitectura de implementación) y abre
 * el diálogo de impresión del navegador para guardarlo como PDF. Sin dependencias:
 * arma un HTML con estilos de impresión (@page A4) en una ventana nueva.
 */
import { CONCEPTS, MODULES, STEPS, SUPPORT, UI, type Lang } from './helpContent';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function openTechnicalDocPdf(lang: Lang): boolean {
  const es = lang === 'es';
  const t = es ? UI.es : UI.en;
  const pick = (en: string, esv: string) => (es ? esv : en);

  const conceptsHtml = CONCEPTS.map((c) =>
    `<div class="concept"><span class="ctitle">${esc(pick(c.titleEn, c.titleEs))}</span> — ${esc(pick(c.bodyEn, c.bodyEs))}</div>`,
  ).join('');

  const stepsHtml = STEPS.map((s, i) =>
    `<li><strong>${esc(pick(s.titleEn, s.titleEs))}.</strong> ${esc(pick(s.bodyEn, s.bodyEs))}</li>`,
  ).join('');

  const modulesHtml = MODULES.map((m) => {
    const sections = m.deep.sections.map((sec) => {
      const items = (es ? sec.itemsEs : sec.itemsEn) ?? [];
      const list = items.length ? `<ul>${items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul>` : '';
      return `<div class="sec"><h3>${esc(pick(sec.subEn, sec.subEs))}</h3><p>${esc(pick(sec.bodyEn, sec.bodyEs))}</p>${list}</div>`;
    }).join('');
    return `<section class="module"><h2>${esc(pick(m.deep.headingEn, m.deep.headingEs))}</h2>${sections}</section>`;
  }).join('');

  const genLabel = es ? 'Documento funcional' : 'Functional document';
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>Data Model Hub — ${esc(t.title)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1A2B4A; line-height: 1.55; font-size: 11.5px; margin: 0; }
  .cover { padding: 40px 0 26px; border-bottom: 3px solid #0E8C6A; margin-bottom: 26px; }
  .cover .kicker { color: #0E8C6A; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 11px; }
  .cover h1 { font-size: 30px; margin: 8px 0 6px; letter-spacing: -.01em; }
  .cover .sub { color: #56607A; font-size: 13px; max-width: 640px; }
  h2 { font-size: 17px; color: #1A2B4A; margin: 0 0 4px; border-left: 4px solid #0E8C6A; padding-left: 10px; }
  h3 { font-size: 13px; color: #2A3650; margin: 16px 0 3px; }
  p { margin: 4px 0 8px; color: #3A4658; }
  ul { margin: 4px 0 10px; padding-left: 20px; }
  li { margin: 2px 0; color: #3A4658; }
  .block { margin-bottom: 22px; }
  .concept { margin: 4px 0; color: #3A4658; }
  .concept .ctitle { font-weight: 700; color: #1A2B4A; }
  .module { margin-top: 8px; padding-top: 18px; page-break-inside: avoid; }
  .module + .module { border-top: 1px solid #EAEDF2; }
  .sec { page-break-inside: avoid; }
  .toc { columns: 2; font-size: 12px; color: #3A4658; margin: 8px 0 4px; }
  .foot { margin-top: 30px; padding-top: 14px; border-top: 1px solid #EAEDF2; color: #8A93A5; font-size: 10.5px; }
  @media print { a { color: inherit; text-decoration: none; } }
</style></head>
<body>
  <div class="cover">
    <div class="kicker">Data Model Hub · ${esc(genLabel)}</div>
    <h1>${esc(t.title)}</h1>
    <div class="sub">${esc(t.hero)}</div>
  </div>

  <div class="block">
    <h2>${esc(t.firstSteps)}</h2>
    <ol>${stepsHtml}</ol>
  </div>

  <div class="block">
    <h2>${esc(t.concepts)}</h2>
    ${conceptsHtml}
  </div>

  <div class="block">
    <h2>${esc(t.modules)}</h2>
    ${modulesHtml}
  </div>

  <div class="foot">
    ${esc(es ? 'Soporte' : 'Support')}: ${esc(SUPPORT.name)} · ${esc(SUPPORT.email)}
  </div>
</body></html>`;

  // Imprimir desde un IFRAME OCULTO (no un popup): los bloqueadores de pop-ups no
  // lo afectan y `print()` no requiere una ventana nueva. El usuario elige
  // "Guardar como PDF" en el diálogo de impresión del navegador.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    const cleanup = () => setTimeout(() => iframe.remove(), 800);
    win.addEventListener('afterprint', cleanup, { once: true });
    try {
      win.focus();
      win.print();
    } catch { cleanup(); }
    setTimeout(cleanup, 60000); // respaldo si afterprint no dispara
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  return true;
}
