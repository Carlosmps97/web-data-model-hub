// Doc 133 §5: lo que empezó antes del Ctrl+Z termina y es lo que se deshace.
// Undo y Redo esperan el trabajo en vuelo; una acción con Undo solo cuenta
// entera (escrituras, refresco y su entrada en la pila) si corre dentro de
// `historyAction`. En todo el repo:
//  · cada `pushUndo(…)` está dentro de la función que recibe un
//    `historyAction(…)`;
//  · esa función no espera el trabajo en vuelo (se esperaría a sí misma) ni abre
//    diálogos (durante un Undo la pantalla no responde: la espera quedaría
//    colgada de un clic);
//  · ninguna función fuera de un `historyAction` espera algo (que no sea un
//    diálogo) antes de llamar a una acción con Undo: en esa espera no habría
//    nada en vuelo y un Ctrl+Z desharía la acción anterior.
// Se revisa el fuente con el AST de TypeScript (sin DOM: vitest corre en node);
// el comportamiento se prueba en `store/useUndoStore.test.ts`.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../..');
const files = readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/testutil/.test(f))
  .map((f) => join(SRC, f));

/** Llamadas que no pueden ir dentro de una acción con Undo. */
const FORBIDDEN = /^(?:draftWorkSettled|syncOtherTabs|undoLast|redoLast|runHistory|(?:confirm|prompt|ask)[A-Z]\w*)$/;

const parse = (file: string, code: string) =>
  ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const calleeName = (call: ts.CallExpression): string | null => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
};
const isHistoryAction = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'historyAction';

/** `pushUndo(…)` fuera de la función de un `historyAction(…)`: «archivo:línea». */
export function pushOutsideAction(file: string, code: string): string[] {
  const sf = parse(file, code);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && calleeName(n) === 'pushUndo' && ts.isIdentifier(n.expression)) {
      let inside = false;
      for (let child: ts.Node = n, p = n.parent; p; child = p, p = p.parent) {
        if (isHistoryAction(p) && p.arguments[0] === child) { inside = true; break; }
      }
      if (!inside) out.push(`${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Llamadas prohibidas dentro de la función de un `historyAction(…)`: «archivo:línea nombre». */
export function forbiddenInsideAction(file: string, code: string): string[] {
  const sf = parse(file, code);
  const out: string[] = [];
  const scan = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name && FORBIDDEN.test(name)) out.push(`${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${name}`);
    }
    ts.forEachChild(n, scan);
  };
  const visit = (n: ts.Node) => {
    if (isHistoryAction(n) && n.arguments[0]) { scan(n.arguments[0]); return; }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Servicios del front: sus funciones no son las acciones del store aunque se llamen igual. */
const SERVICES = /^(?:gov|struct|viewsSvc|svc|schemasSvc|csvc|gov\.bulk)$/;
/** Flujos que solo corren con un diálogo abierto: Undo y Redo no corren mientras
 *  tanto (el atajo y `runHistory` miran `modalOpen()`). Por lo mismo, el guardado
 *  del editor de vistas (`onSaved` → agregar al canvas) queda cubierto. */
const MODAL_ONLY = new Set(['features/modeler/components/ModelPropertiesModal.tsx save']);
/** Los diálogos (una espera de un clic, no de algo en vuelo). */
const DIALOGS = /^(?:confirmDialog|promptDialog|confirmDelete\w*|askDelete\w*|askRemove\w*)$/;
/** Callbacks que corren en el acto o al cumplirse una promesa: son parte del flujo que los llama. */
const FLOW_CALLBACKS = /^(?:then|catch|finally|forEach|map|flatMap|filter|some|every|reduce)$/;
/** Callbacks de las props de los paneles que terminan en una acción con Undo. */
const UNDO_PROPS = ['onPatch'];

const isFn = (n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
/** El nombre de lo que se llama: `x(…)`, `st.x(…)`, `get().x(…)`; null si es de un servicio. */
function calleeOf(sf: ts.SourceFile, call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && !SERVICES.test(e.expression.getText(sf))) return e.name.text;
  return null;
}

/** Las acciones con Undo del fuente: las funciones que son (o devuelven) una
 *  `historyAction`, y las que solo llaman a una de esas. Las de `const x = …` valen
 *  en su archivo (`local`); las propiedades de un objeto (las acciones del store),
 *  en todos (`global`). */
export function undoActionNames(sources: { file: string; code: string }[]):
  { local: Map<string, Set<string>>; global: Set<string> } {
  const local = new Map<string, Set<string>>();
  const global = new Set<string>();
  const parsed = sources.map(({ file, code }) => ({ file, sf: parse(file, code) }));
  for (const { file } of parsed) local.set(file, new Set());
  /** Lo que la función devuelve o es, en su nivel de arriba: las llamadas. */
  const results = (fn: ts.ArrowFunction | ts.FunctionExpression): ts.CallExpression[] => {
    if (!ts.isBlock(fn.body)) return ts.isCallExpression(fn.body) ? [fn.body] : [];
    return fn.body.statements.flatMap((st) => (ts.isReturnStatement(st) && st.expression && ts.isCallExpression(st.expression) ? [st.expression] : []));
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const { file, sf } of parsed) {
      const mine = local.get(file)!;
      const visit = (n: ts.Node) => {
        let name: string | null = null;
        let into: Set<string> | null = null;
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) { name = n.name.text; into = mine; }
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) { name = n.name.text; into = global; }
        const init = ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n) ? n.initializer : undefined;
        if (name && into && !into.has(name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const isUndo = results(init).some((c) => {
            const callee = calleeOf(sf, c);
            return callee === 'historyAction' || (!!callee && (mine.has(callee) || global.has(callee)));
          });
          if (isUndo) { into.add(name); changed = true; }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  return { local, global };
}

/** Funciones fuera de un `historyAction` que esperan algo (que no sea un diálogo)
 *  antes de llamar a una acción con Undo (o a `historyAction` misma): «archivo
 *  nombre → acción». Sigue los callbacks que corren en el acto o al cumplirse una
 *  promesa. */
export function awaitBeforeAction(file: string, code: string, names: ReturnType<typeof undoActionNames>): string[] {
  const sf = parse(file, code);
  const out: string[] = [];
  const isUndo = (name: string) => name === 'historyAction' || UNDO_PROPS.includes(name)
    || names.global.has(name) || !!names.local.get(file)?.has(name);
  const insideAction = (n: ts.Node) => { for (let p = n.parent; p; p = p.parent) if (isHistoryAction(p)) return true; return false; };
  const fnName = (fn: ts.Node): string => {
    const p = fn.parent;
    if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return p.name.getText(sf);
    return `(línea ${sf.getLineAndCharacterOfPosition(fn.getStart()).line + 1})`;
  };
  /** ¿Es un callback que corre como parte del flujo que lo llama? */
  const inFlow = (n: ts.Node) => ts.isCallExpression(n.parent) && n.parent.arguments.includes(n as ts.Expression)
    && ts.isPropertyAccessExpression(n.parent.expression) && FLOW_CALLBACKS.test(n.parent.expression.name.text);
  const check = (fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration) => {
    if (insideAction(fn) || !fn.body || inFlow(fn)) return;
    const ends: number[] = [];
    const calls: { pos: number; name: string }[] = [];
    const walk = (n: ts.Node) => {
      if (n !== fn && isFn(n) && !inFlow(n)) return;
      if (ts.isAwaitExpression(n)) {
        const awaited = ts.isCallExpression(n.expression) ? calleeOf(sf, n.expression) : null;
        if (!awaited || !DIALOGS.test(awaited)) ends.push(n.getEnd());
      }
      if (ts.isCallExpression(n)) {
        const name = calleeOf(sf, n);
        if (name && isUndo(name) && !(name === 'historyAction' && n === fn.body)) calls.push({ pos: n.getStart(), name });
      }
      ts.forEachChild(n, walk);
    };
    walk(fn.body);
    const hit = calls.find((c) => ends.some((end) => end <= c.pos));
    const id = `${relative(SRC, file)} ${fnName(fn)}`;
    if (hit && !MODAL_ONLY.has(id)) out.push(`${id} → ${hit.name}`);
  };
  const visit = (n: ts.Node) => { if (isFn(n)) check(n); ts.forEachChild(n, visit); };
  visit(sf);
  return out;
}

describe('el analizador', () => {
  it('ve un pushUndo fuera de historyAction y acepta uno adentro, también anidado', () => {
    const code = [
      "const a = () => historyAction(async () => { await w(); pushUndo('A', step, pin); });",
      "const b = async () => { await w(); pushUndo('B', step, pin); };",
      "const c = () => historyAction(async () => { const wrote = () => pushUndo('C', step, pin); await w(); wrote(); });",
      "const d = () => historyAction(() => runBlocking('x', async () => { pushUndo('D', step, pin); }));",
      "const e = () => other(async () => { pushUndo('E', step, pin); });",
    ].join('\n');
    expect(pushOutsideAction(join(SRC, 'x.ts'), code)).toEqual(['x.ts:2', 'x.ts:5']);
  });

  it('la lista sale del fuente: lo que es o devuelve una historyAction, y lo que solo llama a una de esas', () => {
    const code = [
      'const commitDomain = (f) => historyAction(async () => { await onPatch(id, f); });',
      'const wrapped = (x) => { const pin = p(); return historyAction(async () => { await w(x); }); };',
      'const alias = (x) => wrapped(x);',
      'const plain = async () => { await w(); };',
      'const store = { deleteColumns: (ids) => historyAction(async () => { await w(ids); }), deleteColumn: (id) => get().deleteColumns([id]), other: () => set({}) };',
    ].join('\n');
    const names = undoActionNames([{ file: join(SRC, 'x.ts'), code }]);
    expect([...names.local.get(join(SRC, 'x.ts'))!].sort()).toEqual(['alias', 'commitDomain', 'wrapped']);
    expect([...names.global].sort()).toEqual(['deleteColumn', 'deleteColumns']);
  });

  it('ve una espera antes de una acción con Undo fuera de historyAction: llamada, historyAction en línea, en un .then o un forEach', () => {
    const code = [
      'const commitDomain = (f) => historyAction(async () => { await onPatch(id, f); });',
      'const a = async () => { const p = await gov.physicalize(x); await commitDomain(p); };',
      'const b = async () => { await read(); await historyAction(async () => { await w(); }); };',
      'const c = async () => { await read(); void p.then(() => commitDomain(x)); };',
      'const d = async () => { await read(); ids.forEach((i) => commitDomain(i)); };',
      'const e = async () => { await st.deleteTable(id); await reload(); };',
      'const f = async () => { if (!(await confirmDialog({}))) return; await commitDomain(x); };',
      'const g = async () => { await confirmedNames(); await commitDomain(x); };',
      'const h = () => historyAction(async () => { const p = await gov.physicalize(x); await commitDomain(p); });',
    ].join('\n');
    const file = join(SRC, 'x.ts');
    const names = undoActionNames([{ file, code }]);
    expect(awaitBeforeAction(file, code, names)).toEqual([
      'x.ts a → commitDomain', 'x.ts b → historyAction', 'x.ts c → commitDomain', 'x.ts d → commitDomain', 'x.ts g → commitDomain',
    ]);
  });

  it('ve diálogos y esperas del trabajo en vuelo dentro de historyAction, no fuera', () => {
    const code = [
      'const a = () => historyAction(async () => { if (!(await confirmDialog({}))) return; await draftWorkSettled(); });',
      'const b = async () => { await confirmDialog({}); await draftWorkSettled(); };',
      'const c = () => historyAction(async () => { await askDeleteTable({}); await st.syncOtherTabs(); });',
      'const d = () => historyAction(async () => { await confirm(); });',
    ].join('\n');
    expect(forbiddenInsideAction(join(SRC, 'x.ts'), code)).toEqual([
      'x.ts:1 confirmDialog', 'x.ts:1 draftWorkSettled', 'x.ts:3 askDeleteTable', 'x.ts:3 syncOtherTabs',
    ]);
  });
});

describe('acciones con Undo enteras en historyAction', () => {
  it('todo pushUndo del repo apila dentro de una historyAction', () => {
    const outside = files.filter((f) => !f.endsWith(join('store', 'useUndoStore.ts')))
      .flatMap((f) => pushOutsideAction(f, readFileSync(f, 'utf-8')));
    expect(outside).toEqual([]);
  });

  it('ninguna historyAction espera el trabajo en vuelo ni abre un diálogo', () => {
    const found = files.flatMap((f) => forbiddenInsideAction(f, readFileSync(f, 'utf-8')));
    expect(found).toEqual([]);
  });

  it('nada espera fuera de una historyAction antes de llamar a una acción con Undo', () => {
    const sources = files.map((file) => ({ file, code: readFileSync(file, 'utf-8') }));
    const names = undoActionNames(sources);
    // La lista derivada ve las acciones del store y los guardados de los paneles.
    expect(['updateColumn', 'deleteColumns', 'deleteColumn', 'pasteTable'].every((n) => names.global.has(n))).toBe(true);
    expect(names.local.get(join(SRC, 'features/modeler/components/ColumnPropertiesPanel.tsx'))?.has('commitDomain')).toBe(true);
    const found = sources.flatMap(({ file, code }) => awaitBeforeAction(file, code, names));
    expect(found).toEqual([]);
  });

  // Con la fase 2, tipear y pulsar Undo deshace lo tipeado: el panel tiene que
  // dejar de mostrarlo (su estado local se siembra del modelo al montarse).
  it('el cuerpo del panel de columna se vuelve a sembrar al terminar cada Undo o Redo', () => {
    const code = readFileSync(join(SRC, 'features/modeler/components/ColumnPropertiesPanel.tsx'), 'utf-8');
    expect(code).toMatch(/const steps = useUndoStore\(\(s\) => s\.steps\);/);
    expect(code).toMatch(/<ColumnPropsBody\s+key=\{`\$\{col\.id\}:\$\{steps\}`\}/);
  });

  it('el panel de columna corre entero su guardado (re-apunta vistas después de updateColumn)', () => {
    const code = readFileSync(join(SRC, 'features/modeler/components/ColumnPropertiesPanel.tsx'), 'utf-8');
    expect(code).toMatch(/const patchCol = \(id: string, fields: Partial<CanonicalColumn>, opts\?: ColumnPatchOpts\) => historyAction\(async \(\) => \{/);
  });
});
