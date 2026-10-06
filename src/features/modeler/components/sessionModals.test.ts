// Doc 105 (ronda 3, R7-A) — los diálogos con `backdrop="canvas"` dejan el
// Toolbar y el TopNav clicables: con SchemaManagerModal, CtasModal o el editor
// de vistas abiertos se podía abrir OTRA versión y, al confirmar, grabar en B
// lo armado en A (el Toolbar sólo los cerraba al cambiar Logical/Physical).
// Al cambiar la sesión de canvas (proyecto, modo o versión) se cierran todos:
// los del Toolbar, los popups del canvas y el Publish del panel de borrado. Sin
// DOM (vitest en node): se revisa el fuente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (name: string) => readFileSync(join(__dirname, name), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Cuerpos de los `useEffect(() => { … }, [deps])` cuyas deps incluyen `dep`. */
function effectsOn(src: string, dep: string): string[] {
  const out: string[] = [];
  const re = /useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) if (m[2].split(',').map((d) => d.trim()).includes(dep)) out.push(m[1]);
  return out;
}
const closesAll = (bodies: string[], setters: string[]) =>
  setters.filter((s) => !bodies.some((b) => new RegExp(`\\b${s}\\((null|false)\\)`).test(b)));

describe('cambiar de sesión cierra los diálogos del canvas (doc 105, R7-A)', () => {
  it('Toolbar: New table, CTAS, vistas, esquemas, carga, Publish, Export DDL, Model properties, export, arrange', () => {
    const src = code('Toolbar.tsx');
    expect(src).toMatch(/const sessionKey = useSessionStore\(\(s\) => canvasSessionKey\(s\)\)/);
    expect(closesAll(effectsOn(src, 'sessionKey'), [
      'setModal', 'setPublishOpen', 'setDdlOpen', 'setExportOpen', 'setArrangeAsk',
    ])).toEqual([]);
    // Doc 112: Model properties vive en el store (también la abre Properties);
    // el store la cierra solo al cambiar de sesión o de canvas, y el Toolbar igual.
    expect(effectsOn(src, 'sessionKey').some((b) => /\bcloseModelProps\(\)/.test(b))).toBe(true);
  });

  it('Toolbar: Model properties no queda abierta al salir del Model (doc 112, revisión)', () => {
    // El estado vive en el store (también la abre Properties): sin esto, volver
    // al Model la montaba de nuevo un instante (foco y una lectura de UDPs).
    expect(code('Toolbar.tsx')).toMatch(/useEffect\(\(\) => \(\) => closeModelProps\(\), \[closeModelProps\]\)/);
  });

  it('ModelerCanvas: relación, subcategoría (alta y gestión) y editor de vistas', () => {
    const src = code('ModelerCanvas.tsx');
    expect(src).toMatch(/const sessionKey = useSessionStore\(\(s\) => canvasSessionKey\(s\)\)/);
    expect(closesAll(effectsOn(src, 'sessionKey'), [
      'setEditRelId', 'setRelDraft', 'setSubcatDraft', 'setSubcatManage', 'setEditViewId',
    ])).toEqual([]);
  });

  it('WorkspaceScreen: el Publish abierto desde el panel de borrado', () => {
    expect(closesAll(effectsOn(code('WorkspaceScreen.tsx'), 'sessionKey'), ['setPublishFromPanel'])).toEqual([]);
  });
});
