import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = (p: string) => resolve(__dirname, p);

describe('legado retirado (doc 75 D14)', () => {
  it.each([
    'features/governance', 'components/layout/AppLayout.tsx', 'components/layout/Header.tsx', 'components/layout/Sidebar.tsx',
    'store/useChangesetStore.ts', 'store/sessionChangesetBridge.ts', 'store/useIdentityStore.ts',
    'services/identity.service.ts', 'types/identity.ts', 'hooks',
  ])('%s no existe', (rel) => {
    expect(existsSync(src(rel))).toBe(false);
  });
});

// Doc 85 — bug de pantalla en blanco en Data Standards → Domains: la página
// usaba un componente del canvas que resolvía el proyecto con
// `sessionProjectId()` (throw sin proyecto activo) dentro de un useEffect ⇒ React
// desmontaba TODO el árbol. Data Standards es EXPLÍCITO por proyecto (recibe
// `projectId`): jamás depende del proyecto de la sesión ni del servicio de
// governance (atado al changeset/sesión); usa `naming.service`/`standards.service`.
describe('Data Standards es explícito por proyecto (doc 85)', () => {
  const dir = src('features/standards');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
  it('hay archivos que revisar', () => { expect(files.length).toBeGreaterThan(0); });
  it.each(files)('%s no importa governance.service ni sessionProjectId', (file) => {
    const code = readFileSync(file, 'utf-8');
    expect(code).not.toMatch(/services\/governance\.service/);
    expect(code).not.toMatch(/sessionProjectId/);
  });
});

// Popups lentos en Model (2026-09-29): el fondo de los popups del canvas
// llevaba `backdrop-filter: blur`, que obliga al navegador a volver a difuminar
// toda el área del canvas en cada cuadro (cada tecla, clic, hover o parpadeo del
// cursor). Sin aceleración por GPU (escritorio remoto, política corporativa,
// driver bloqueado) eso saturaba el proceso de composición de TODO el navegador
// (medido: 52–67 % de CPU tipeando con el popup vs ~2 % sin blur). El fondo solo
// oscurece, como los popups de Reporting y Standards.
describe('fondos de popup sin backdrop-filter', () => {
  const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Cualquier selector que toque un fondo de popup: simple, compuesto, descendiente o modificador.
  const BACKDROP = /\.dmh-(dialog-)?backdrop(--canvas|--top)?(?![\w-])/;
  /** Selectores de las reglas que difuminan un fondo de popup (vacío = bien). */
  const blurredBackdrops = (css: string) => [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => BACKDROP.test(m[1]) && /backdrop-filter/.test(m[2]))
    .map((m) => m[1].trim());
  it('detecta un fondo difuminado en cualquier forma de selector', () => {
    for (const css of [
      '.dmh-backdrop { backdrop-filter: blur(2px) }',
      '.a, .dmh-backdrop{-webkit-backdrop-filter:blur(2px)}',
      '.dmh-dialog-backdrop.dmh-dialog-backdrop--canvas { backdrop-filter: blur(2px) }',
      'body .dmh-backdrop { backdrop-filter: blur(2px) }',
      '.dmh-backdrop--top { backdrop-filter: blur(1px) }',
      '@media (min-width: 1px) { .dmh-dialog-backdrop--canvas { backdrop-filter: blur(2px) } }',
    ]) expect(blurredBackdrops(css), css).toHaveLength(1);
    // Ni otra clase ni un comentario cuentan (los overlays de espera conservan su blur: owner).
    expect(blurredBackdrops('.dmh-backdropx { backdrop-filter: blur(2px) } .dmh-busy-overlay { backdrop-filter: blur(1px) }')).toEqual([]);
    expect(blurredBackdrops('/* .dmh-backdrop { backdrop-filter: blur(2px) } */')).toEqual([]);
  });
  const cssFiles = readdirSync(src('.'), { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.css'))
    .map((f) => join(src('.'), f));
  it('hay hojas de estilo que revisar', () => { expect(cssFiles.length).toBeGreaterThan(3); });
  it.each(cssFiles)('%s no difumina fondos de popup', (file) => {
    expect(blurredBackdrops(readFileSync(file, 'utf-8'))).toEqual([]);
  });
  it.each(['components/ui/Dialog.tsx', 'components/ui/Modal.tsx', 'components/ui/ConfirmDialog.tsx', 'components/ui/dialogs.tsx'])(
    '%s no difumina con estilos inline', (rel) => {
      expect(readFileSync(src(rel), 'utf-8')).not.toMatch(/backdropFilter|WebkitBackdropFilter/);
    });
  const css = ['styles/ui.css', 'styles/components.css']
    .map((f) => readFileSync(src(f), 'utf-8'))
    .join('\n');
  const rules = (selector: string) => [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].split(',').some((s) => s.trim() === selector))
    .map((m) => m[2]);
  it('los fondos siguen oscureciendo', () => {
    expect(rules('.dmh-backdrop').join('')).toMatch(/background:/);
    expect(rules('.dmh-dialog-backdrop').join('')).toMatch(/background:/);
  });
});

// Doc 105 (C3c): el Export DDL exporta las vistas MIEMBRO del canvas
// (`canvasDdlViews(diagram)`, doc 102), nunca «todas las vistas de sus tablas».
// Nada impedía volver a `listViewsForTables` (lo que hacía el modal antes del
// doc 102): el export volvería a sumar vistas que el canvas no muestra.
describe('Export DDL: vistas del canvas, no las de sus tablas (doc 105)', () => {
  const stripTsComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const readsViewsByTables = (code: string) => /\blistViewsForTables\b/.test(stripTsComments(code));
  it('detecta la lectura por tablas (import o llamada), no un comentario', () => {
    expect(readsViewsByTables("import { listViewsForTables } from '@/services/views.service';")).toBe(true);
    expect(readsViewsByTables('const vs = await viewsSvc.listViewsForTables(ids);')).toBe(true);
    expect(readsViewsByTables('// antes: listViewsForTables(ids)')).toBe(false);
    expect(readsViewsByTables('/* listViewsForTables */ const views = canvasDdlViews(diagram);')).toBe(false);
  });
  const dir = src('features/ddl');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f));
  it('el modal del Export DDL está entre los archivos revisados', () => {
    expect(files.some((f) => f.endsWith(join('components', 'ExportDdlModal.tsx')))).toBe(true);
  });
  it.each(files)('%s no lee las vistas por tablas', (file) => {
    expect(readsViewsByTables(readFileSync(file, 'utf-8'))).toBe(false);
  });
});

// Doc 107 — botones que parecían texto (pedido owner 2026-10-01): «Remove from
// this canvas», «Delete table…» o «Manage templates…» eran texto suelto o un
// enlace azul. Toda acción con texto se ve como BOTÓN: `rd-btn-secondary` /
// `<Button variant="secondary">` (borde, azul al pasar el mouse) o
// `rd-btn-danger` si borra. `rd-btn-ghost` queda solo para botones de ícono
// suelto y los «← All columns» de los paneles (navegación); las clases de enlace
// que se usaban como botón se retiraron. No cubre estilos inline sueltos.
/** ¿Un `/` en `i` abre un literal regex (y no es una división)? Mira el carácter previo. */
const regexStart = (code: string, i: number): boolean => {
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j])) j -= 1;
  return j < 0 || '(,=:[!&|?{};'.includes(code[j]);
};
/** Índice del `>` que cierra la etiqueta JSX que abre en `start`: salta strings,
 *  comentarios, literales regex y expresiones `{…}` (con sus `=>`). -1 si no cierra. */
const tagEnd = (code: string, start: number): number => {
  let depth = 0;
  for (let i = start + 1; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += depth > 0 && code[j] === '\\' ? 2 : 1;
      i = j;
    } else if (ch === '/' && code[i + 1] === '/') {
      i = code.indexOf('\n', i);
      if (i < 0) return -1;
    } else if (ch === '/' && code[i + 1] === '*') {
      i = code.indexOf('*/', i + 2) + 1;
      if (i <= 0) return -1;
    } else if (ch === '/' && depth > 0 && regexStart(code, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < code.length && (inClass || code[j] !== '/')) {
        if (code[j] === '\\') j += 1;
        else if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        j += 1;
      }
      i = j;
    } else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i;
  }
  return -1;
};
interface JsxButton { start: number; end: number; line: number; open: string; kids: string }
/** Los `<button>`/`<Button>` del código: etiqueta de apertura y contenido. */
const jsxButtons = (code: string): JsxButton[] => {
  const out: JsxButton[] = [];
  for (const m of code.matchAll(/<(button|Button)\b/g)) {
    const start = m.index ?? 0;
    const end = tagEnd(code, start);
    if (end < 0) continue;
    const selfClosing = code[end - 1] === '/';
    const kids = selfClosing ? '' : code.slice(end + 1, code.indexOf(`</${m[1]}>`, end)).trim();
    out.push({ start, end, line: code.slice(0, start).split('\n').length, open: code.slice(start, end + 1), kids });
  }
  return out;
};
/** ¿El contenido es UN solo elemento JSX autocerrado (un ícono)? */
const loneIcon = (kids: string) => kids.startsWith('<') && tagEnd(kids, 0) === kids.length - 1 && kids[kids.length - 2] === '/';
/** Variantes de `rd-btn` que se ven como botón (fondo o borde). `icon` es solo tamaño. */
const RD_LOOK = /\brd-btn-(primary|secondary|danger|ghost)\b/;
/** Un `style` inline que le da al botón su propio fondo (no transparente). */
const OWN_BG = /background:\s*(?!['"](?:transparent|none)['"])\S/;
const short = (kids: string) => kids.replace(/\s+/g, ' ').slice(0, 40);
/** Botones con texto que se verían como texto (vacío = bien): `rd-btn-ghost` que no
 *  sea de ícono suelto ni un «← All columns» (cualquier otro contenido —texto o una
 *  expresión— cuenta como texto), `<Button variant="ghost">` (o una variante que
 *  pueda ser ghost) con contenido y `rd-btn` sin variante visible salvo que traiga
 *  su propio fondo. */
const buttonIssues = (code: string): string[] => {
  const out: string[] = [];
  const list = jsxButtons(code);
  for (const m of code.matchAll(/rd-btn-ghost/g)) {
    const at = m.index ?? 0;
    const q0 = Math.max(code.lastIndexOf('"', at), code.lastIndexOf("'", at), code.lastIndexOf('`', at));
    if (q0 < 0) continue;
    const classes = code.slice(q0 + 1, code.indexOf(code[q0], at));
    if (!/^[\w\- ]*$/.test(classes.replace(/\$\{[^}]*\}/g, ''))) continue;   // no es una lista de clases (p. ej. un comentario)
    if (/\brd-btn-icon\b/.test(classes)) continue;
    const b = list.find((x) => x.start < at && at < x.end);
    if (!b) { out.push(`${code.slice(0, at).split('\n').length}: rd-btn-ghost fuera de un <button>`); continue; }
    if (loneIcon(b.kids) || /^<ArrowLeft[\s/>]/.test(b.kids)) continue;
    out.push(`${b.line}: ghost con texto «${short(b.kids)}»`);
  }
  for (const b of list) {
    if (!b.kids || loneIcon(b.kids)) continue;
    const v = /variant=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/.exec(b.open);
    if (v && /ghost/.test(v[1] ?? v[2] ?? v[3] ?? '')) out.push(`${b.line}: <Button variant="ghost"> con texto «${short(b.kids)}»`);
    const cls = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/.exec(b.open);
    const c = cls ? (cls[1] ?? cls[2] ?? cls[3] ?? '') : '';
    if (/\brd-btn\b/.test(c) && !RD_LOOK.test(c) && !OWN_BG.test(b.open)) out.push(`${b.line}: rd-btn sin variante «${short(b.kids)}»`);
  }
  return out;
};
describe('botones con texto se ven como botón (doc 107)', () => {
  const sample = (open: string, kids: string) => `<button ${open}>${kids}</button>`;
  it('detecta ghost con texto —también si el texto sale de una expresión— y deja pasar íconos y «← All columns»', () => {
    const ghost = 'type="button" className="rd-btn rd-btn-ghost rd-btn-sm"';
    expect(buttonIssues(sample(`${ghost} onClick={() => go(a > b)}`, '<Table2 size={12} /> Remove from this canvas'))).toHaveLength(1);
    expect(buttonIssues(sample(`${ghost} onClick={onCancel}`, '{cancelLabel}'))).toHaveLength(1);
    expect(buttonIssues(sample(`${ghost} onClick={() => onOpen(u)}`, "<Crosshair size={12} /> {here ? 'Center' : 'Open'}"))).toHaveLength(1);
    expect(buttonIssues(sample(`${ghost} title="Parent > child" onClick={() => x('{')}`, '<Eye size={12} />'))).toEqual([]);
    expect(buttonIssues(sample(ghost, '<ArrowLeft size={12} /> All {nouns.members}'))).toEqual([]);
    expect(buttonIssues("const iconBtn = 'rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm';")).toEqual([]);
    expect(buttonIssues("const cls = 'rd-btn rd-btn-ghost rd-btn-sm';")).toHaveLength(1);       // clase suelta: no se puede verificar
  });
  it('detecta <Button variant="ghost"> con texto y `rd-btn` sin variante (salvo con fondo propio)', () => {
    expect(buttonIssues('<Button variant="ghost" onClick={x}>Clear</Button>')).toHaveLength(1);
    expect(buttonIssues('<Button variant="ghost" icon={X} aria-label="Close" />')).toEqual([]);
    expect(buttonIssues(sample('className="rd-btn rd-btn-sm" onClick={x}', 'Apply'))).toHaveLength(1);
    expect(buttonIssues(sample("className=\"rd-btn rd-btn-sm\" style={{ background: PURPLE, color: '#fff' }}", 'Save'))).toEqual([]);
    expect(buttonIssues(sample('className="rd-btn rd-btn-secondary rd-btn-sm" onClick={x}', '{label}'))).toEqual([]);
  });
  it('revisión 2: lo que dejaba pasar', () => {
    const ghost = 'type="button" className="rd-btn rd-btn-ghost rd-btn-sm"';
    expect(buttonIssues(sample(ghost, '<ArrowLeftRight size={12} /> Swap tables'))).toHaveLength(1);
    expect(buttonIssues(sample("className=\"rd-btn rd-btn-sm\" style={{ background: 'transparent' }}", 'Apply'))).toHaveLength(1);
    expect(buttonIssues(sample('className="rd-btn rd-btn-success"', 'Approve'))).toHaveLength(1);      // no existe
    expect(buttonIssues(sample('className="rd-btn rd-btn-icon"', 'Delete'))).toHaveLength(1);          // solo tamaño
    expect(buttonIssues(sample('className="rd-btn rd-btn-icon" title="Delete"', '<Trash2 size={12} />'))).toEqual([]);
    expect(buttonIssues("<Button variant={c ? 'ghost' : 'secondary'} onClick={x}>Clear</Button>")).toHaveLength(1);
    expect(buttonIssues(sample('className={`rd-btn rd-btn-sm ${x}`}', 'Apply'))).toHaveLength(1);
    expect(buttonIssues(sample("className={`rd-btn ${on ? 'rd-btn-primary' : 'rd-btn-secondary'}`}", 'Apply'))).toEqual([]);
    expect(buttonIssues(sample('className={`rd-btn rd-btn-ghost ${x}`}', 'Apply'))).toHaveLength(1);
  });
  it('revisión 2: lo que marcaba de más', () => {
    expect(buttonIssues("<button\n  // it's an icon\n  className=\"rd-btn rd-btn-ghost\"><X /></button>")).toEqual([]);
    expect(buttonIssues("<button className=\"rd-btn rd-btn-ghost\" onClick={() => setQ(q.replace(/'/g, ''))}><X /></button>")).toEqual([]);
    expect(buttonIssues("// rd-btn-ghost queda solo para íconos\nconst a = 1;")).toEqual([]);
  });
  const tsxFiles = readdirSync(src('.'), { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f))
    .map((f) => join(src('.'), f));
  it('hay componentes que revisar', () => { expect(tsxFiles.length).toBeGreaterThan(50); });
  it.each(tsxFiles)('%s: ningún botón con texto se ve como texto', (file) => {
    expect(buttonIssues(readFileSync(file, 'utf-8'))).toEqual([]);
  });
  const allCss = readdirSync(src('.'), { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(src('.'), f), 'utf-8'))
    .join('\n');
  const allTsx = tsxFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');
  it.each(['dmh-rep-link', 'exd-tablesx-link', 'dmh-openmodel-newlink', 'up-file-replace',
    'dmh-home-projects-more', 'dmh-home-projects-clear', 'dmh-rep-clear'])(
    'la clase de enlace %s ya no se usa como botón', (cls) => {
      expect(allTsx).not.toMatch(new RegExp(`\\b${cls}\\b`));
      expect(allCss).not.toMatch(new RegExp(`\\.${cls}\\b`));
    });
});
