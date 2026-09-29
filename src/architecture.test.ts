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
