// Avisos de error de WorkspaceScreen, Toolbar y PropertiesPanel, y también del
// Object Inspector, el panel de vista y los popups que apilan inversas (ahí el
// error original no debe salir después del aviso de la revalidación). Sin DOM
// (vitest en node) se revisa el fuente, como `architecture.test.ts`:
//  · el fallo de una escritura del canvas se avisa por `reportWriteError`
//    (sessionGuard): con la versión recién transferida, la revalidación avisa y
//    el componente calla (un solo aviso). Cada `pushToast(…, 'err')` va dentro
//    de `reportWriteError(`, salvo los que no son de una escritura (lista
//    explícita).
//  · el aviso de agregar una vista nueva al canvas dice qué falló.
//  · WorkspaceScreen no carga los proyectos al montar (lo hace
//    `refreshExplorer` con la sesión; sin sesión nadie los lee).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(__dirname, file), 'utf-8');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Avisos de error (`pushToast(…, 'err')` o `toast.error(…)`) que no pasan por `reportWriteError`. */
const unguarded = (code: string) => stripComments(code).split('\n')
  .filter((l) => ((/pushToast\(/.test(l) && /'err'\)/.test(l)) || /toast\.error\(/.test(l)) && !/reportWriteError\(/.test(l))
  .map((l) => l.trim());

/** Avisos que no son de una escritura del canvas: validaciones, lecturas,
 *  export, el Undo (undoLast calla por su cuenta si la sesión es otra) y los de
 *  la propia revalidación. */
const NOT_A_WRITE = [
  /"Couldn't undo"/, /'Nothing to export'/, /"Couldn't export the diagram"/,
  /"Couldn't derive the physical name"/, /"A primary key column can't go below/, /pushToast\(fate\.message, 'err'\)/,
  /"Couldn't open the canvas"/, /'Type the role name'/,
  // WorkspaceScreen: el propio `pushToast`, la carga del Explorer (lectura:
  // `stillAskedSession`) y la revisión de la versión (la revalidación misma).
  /k === 'err' \? toast\.error\(m\)/, /`Couldn't load the explorer: /, /`Couldn't check this version: /,
  // Lecturas (con su propia guardia), validaciones y el export local.
  /"Couldn't load the project"/, /"Couldn't export"/, /'Could not load the tables'/, /'Could not load the columns of that table'/,
  /'Table name is required'/, /'Pick at least one column'/, /'Open the model in edit mode to paste/, /`Select the target /,
  /"The model is read-only: relationships can't be created"/, /'Open the model in edit mode to create relationships'/,
  /has no primary key — define/,
  /is already a subtype in another subcategory group/, /'Arm "Draw relationship" in the toolbar/,
  // Las validaciones del gesto llevan el sustantivo del modelo (entity/table).
  /`A subtype must be \$\{facetNouns\(st\.viewMode\)\.a\} on this canvas`/,
  /`\$\{capitalize\(facetNouns\(st\.viewMode\)\.a\)\} cannot be a subtype of itself`/,
  /`\$\{capitalize\(facetNouns\(st\.viewMode\)\.a\)\} cannot have an identifying relationship with itself`/,
];

describe('avisos de escrituras del canvas: esperan la revalidación', () => {
  it('detecta un aviso sin guardia, y no uno guardado ni un comentario', () => {
    expect(unguarded("void addViewsToCanvas([id]).catch(() => pushToast(\"Couldn't add the view\", 'err'));")).toHaveLength(1);
    expect(unguarded("void addViewsToCanvas([id]).catch(reportWriteError((e) => pushToast(failureText(\"Couldn't add\", e), 'err')));")).toEqual([]);
    expect(unguarded("// antes: .catch(() => pushToast(\"x\", 'err'))")).toEqual([]);
  });

  it.each([
    'WorkspaceScreen.tsx', 'Toolbar.tsx', 'PropertiesPanel.tsx',
    'ObjectInspector.tsx', 'ViewPropertiesPanel.tsx', 'PasteColumnsPopup.tsx', 'RelationshipCreatePopup.tsx',
    'SubcategoryCreatePopup.tsx', 'RelationshipPopup.tsx',
    // Flujos con varias escrituras: también estos.
    'ColumnPropertiesPanel.tsx', 'SubcategoryPopup.tsx', 'ViewEditor.tsx', '../../../components/layout/TopNav.tsx',
    // Resto de componentes con avisos de escritura.
    'TableNode.tsx', 'ModelerCanvas.tsx', 'ColumnContextMenu.tsx', 'ModelExplorer.tsx', 'CtasModal.tsx',
    'ModelPropertiesModal.tsx', 'NewTableModal.tsx',
    // El pegado de tabla se graba desde su popup.
    'PasteTablePopup.tsx',
  ])('%s', (file) => {
    const rest = unguarded(source(file)).filter((l) => !NOT_A_WRITE.some((re) => re.test(l)));
    expect(rest).toEqual([]);
  });
});

describe('agregar la vista nueva al canvas dice qué falló', () => {
  it.each(['Toolbar.tsx', 'PropertiesPanel.tsx'])('%s', (file) => {
    expect(source(file)).toMatch(
      /addViewsToCanvas\(\[v\.id\]\)\s*\.catch\(reportWriteError\(\(e\) => pushToast\(failureText\("Couldn't add the view to this canvas", e\), 'err'\)\)\)/);
  });
});

describe('WorkspaceScreen no carga los proyectos al montar', () => {
  it('sin `loadProjects`: el refresco de la sesión los trae (y avisa una sola vez si falla)', () => {
    expect(stripComments(source('WorkspaceScreen.tsx'))).not.toMatch(/\bloadProjects\b/);
  });
});

describe('el diálogo de borrar tabla cuenta sin tragar errores', () => {
  it('PropertiesPanel usa readTableDeleteCounts (null = no se pudo contar), no `.catch(() => [])`', () => {
    const code = stripComments(source('PropertiesPanel.tsx'));
    expect(code).toMatch(/readTableDeleteCounts\(table\.id\)/);
    expect(code).not.toMatch(/listViews\(table\.id\)\.catch\(\(\) => \[\]\)/);
  });
});

describe('ningún guardado deja un rechazo sin manejar', () => {
  it('NewTableModal · Import existing (`addOne`) captura el fallo', () => {
    const add = /const addOne = async \(id: string\) => \{([\s\S]*?)\n {2}\};/.exec(stripComments(source('NewTableModal.tsx')))?.[1] ?? '';
    expect(add).toMatch(/catch \(e\) \{ await onError\(e\); \}/);
  });
});

// El botón Refresh del Explorer no avisa su error si la sesión es otra (un 403
// de la versión recién transferida: la revalidación ya avisó); mismo criterio
// que la carga al entrar a Model.
describe('Refresh del Explorer: el aviso espera la revalidación', () => {
  it('usa stillAskedSession con la sesión tomada al pulsar', () => {
    const src = stripComments(source('ExplorerPanel.tsx'));
    expect(src).toMatch(/refreshExplorer\(\)\.catch\(async \(e: unknown\) => \{\s*if \(!\(await stillAskedSession\(/);
  });
});

// Abrir un canvas del Explorer que falla espera la revalidación (calla si la
// sesión es otra) y dice por qué: con la versión recién transferida o
// eliminada, un aviso inmediato saldría junto al de la revalidación.
describe('abrir un canvas del Explorer que falla', () => {
  it('ModelExplorer: con `reportWriteError` y el motivo', () => {
    expect(stripComments(source('ModelExplorer.tsx')))
      .toMatch(/selectSubjectArea\(sa\.id, projectId\)\.catch\(reportWriteError\(\(e\) => pushToast\(failureText\("Couldn't open the canvas", e\), 'err'\)\)\)/);
  });
});
