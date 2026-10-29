/**
 * Análisis estático de los flujos de escritura de un componente: dentro de una
 * función async, toda escritura que sigue a un `await` ya cumplido tiene que ir
 * precedida de un `.check()` (o un `.holds()` que la descarte) del pin, sin
 * otro `await` en el medio, o pasar por `pinned(…)` / `pinnedViewDeps(…)`. Los
 * servicios toman la versión al llamarlos: sin eso, si la sesión cambia
 * mientras se espera, la escritura cae en la versión que se abrió después.
 * Lo usa el test de fuente de los componentes (sin DOM); no corre en la app.
 *
 * «Sigue a un await» se mira por el flujo, no solo por el texto:
 *  · un `await` en otra rama exclusiva (if/else, `c ? a : b`, otro `case`) no
 *    precede a la escritura;
 *  · tampoco uno dentro de una rama que termina con `return`/`throw` (early
 *    return) si la escritura va después de ese `if`;
 *  · en un bucle cuyo cuerpo espera algo, la vuelta siguiente llega después de
 *    ese `await`: cuenta como uno al principio del cuerpo (en `for await`,
 *    siempre).
 *
 * Además:
 *  · el flujo sigue por los callbacks que corren en el acto (`forEach`/`map`/…,
 *    `runBlocking`, `run`, `historyAction`, la IIFE): su escritura es del flujo de afuera; un
 *    `await` de adentro solo precede a lo que sigue adentro;
 *  · el callback de `.then/.catch/.finally` (y el de `persistReorder`) corre
 *    después de una promesa: cuenta un await al empezar;
 *  · los diferidos (timers, efectos, handlers, `action:` de un objeto, las
 *    pasos del historial) se analizan aparte;
 *  · acciones del store por alias (`st = useModelerStore.getState()`, `get()`)
 *    o desestructuradas; `csvc`; callbacks de props y helpers que escriben,
 *    también los locales: llamar a una función del archivo que escribe es
 *    escribir, aunque ella verifique su pin (lo toma al llamarla), salvo que
 *    reciba el pin del llamador o verifique uno de afuera;
 *  · solo cuenta el `.check()`/`.holds()` de un pin (`pin`, `…Pin`, `undo`, `redo`) y
 *    el `.holds()` solo si protege la escritura (`if (!pin.holds()) return;`
 *    delante, o la escritura dentro de `if (pin.holds())` / `pin.holds() && …`);
 *    un check en una rama, un bucle o un callback no cubre lo que sigue afuera.
 *
 * El confirm de un borrado con prelectura:
 *  · un `action:` (callback diferido de un confirm) creado después de un await
 *    necesita un check del pin de afuera antes de crearlo (el confirm no abre
 *    en otra sesión) y sus escrituras, uno de un pin de afuera (al clic, la
 *    acción del store tomaría el pin de ese momento);
 *  · `reportWriteError(…)` toma la sesión al crearse: creado tras un await sin
 *    el pin de afuera, avisaría errores de la sesión recién abierta (p. ej.
 *    «read-only» encima del aviso de la revalidación).
 */
import ts from 'typescript';

/** Escrituras de modelo (servicios changeset-aware). */
const SERVICE_WRITES = new Set([
  'gov.recordChangesBulk', 'gov.createTable', 'gov.deleteTable', 'gov.createColumn', 'gov.updateColumn',
  'gov.deleteColumn', 'gov.updateRelationship', 'gov.deleteRelationship',
  'viewsSvc.createView', 'viewsSvc.updateView', 'viewsSvc.deleteView',
  'schemasSvc.createSchema', 'schemasSvc.createSchemaInVersion', 'schemasSvc.renameSchema', 'schemasSvc.setSchemaKind',
  'schemasSvc.deleteSchema',
  'setSubjectAreaUdp', 'patchSubjectAreaUdp',
  // Estructura (canvas, carpetas, proyecto) — el store los llama como `struct.*`.
  'struct.addToCanvas', 'struct.removeFromCanvas', 'struct.setSubjectAreaLayout', 'struct.setSubjectAreaDrawings',
  'struct.arrangeSubjectArea', 'struct.setWireRoute', 'struct.setSubjectAreaUdp', 'struct.patchSubjectAreaUdp', 'struct.createFolder',
  'struct.renameFolder', 'struct.moveFolder', 'struct.deleteFolderTree', 'struct.createSubjectArea',
  'struct.updateSubjectArea', 'struct.deleteSubjectArea', 'struct.renameProject', 'struct.deleteProject',
  'struct.reviveProject', 'struct.setCanvasColors',
  // El ledger de la versión, directo.
  'csvc.recordChange', 'csvc.recordChangesBulk',
]);
/** Sync de vistas: escriben por `deps.updateView`. */
const VIEW_SYNCS = /^sync(New|Removed|Renamed)\w*$/;
/** Acciones del store que escriben con la sesión del momento (cada una toma su
 *  pin al empezar: llamarla después de un `await` también necesita el check
 *  del flujo). Los dibujos agendan su guardado con la sesión del momento. */
export const STORE_WRITE_ACTIONS = new Set([
  'addColumn', 'updateColumn', 'deleteColumn', 'deleteColumns', 'reorderColumns', 'applyCanvasDrop', 'updateRelationship',
  'deleteRelationship', 'createTable', 'updateTable', 'deleteTable', 'addExistingTables', 'addViewsToCanvas',
  'removeViewFromCanvas', 'deleteView', 'removeTableFromArea', 'removeTablesFromArea', 'deleteTables', 'saveLayout', 'saveNodePositions', 'saveAllLayout',
  'autoOrganize', 'setWireRoute', 'pasteTable', 'pasteTables', 'createTableFromSources', 'createSubjectArea', 'createFolder',
  'renameFolder', 'moveFolder', 'deleteFolder', 'createCanvas', 'renameCanvas', 'deleteCanvas', 'moveCanvas', 'renameProject',
  'deleteProject', 'undoProjectDeletion', 'saveAll',
  'addDrawing', 'updateDrawing', 'deleteDrawing', 'persistDrawings',
  'setBoxColors', 'setObjectColor',
  'applyCanvasColors',
]);
/** Callbacks que escriben (del padre): el cuerpo de columna (`onPatch`), el
 *  editor de vistas (`onSaved`: el llamador suma la vista al canvas), el alta
 *  de columna y de tabla (`onAdd`, `onCreate`), la fila de fuentes de una vista
 *  (`onSave`), las frases (`onApply`), el trazo de un wire y el nombre en el
 *  Explorer (`onCommit`) y soltar una columna arrastrada (`onDrop`). */
const WRITE_CALLBACKS = new Set([
  'onPatch', 'onPatchRef.current', 'onSaved', 'deleteViewVersioned',
  'onAdd', 'onCreate', 'onSave', 'onApply', 'onCommit', 'onDrop',
]);
/** Helpers de otros módulos que escriben con la sesión del momento; con un pin
 *  entre sus argumentos, escriben con ese. */
const WRITE_HELPERS = new Set(['placeUploadedObjects', 'writeWireRoute']);

/** Llamadas cuyo callback corre en el acto (parte del flujo que las llama). */
const INLINE_METHODS = /^(forEach|map|flatMap|filter|some|every|reduce|reduceRight|find|findIndex|findLast|findLastIndex|sort|toSorted)$/;
const INLINE_RUNNERS = new Set(['runBlocking', 'run', 'historyAction', 'Array.from']);
/** Llamadas cuyo callback corre después de una promesa. */
const CONT_METHODS = /^(then|catch|finally)$/;
const CONT_RUNNERS = new Set(['persistReorder']);
/** Receptor de un pin: `pin`, `undo`/`redo` (los pasos del historial), `…Pin`, `….current`. */
const PIN_RECEIVER = /^(?:[\w$]+\.)*(?:pin|undo|redo|\w+Pin)(?:\.current)?$/;
/** Un pin entre los argumentos de un helper (`save(pin)`, `{ pin, signal }`). */
const PIN_ARG = /\b(?:pin|undo|redo|\w+Pin)\b/;

export interface Violation { fn: string; line: number; write: string }

type Fn = ts.FunctionLikeDeclaration;
/** `scope`: la función del flujo que lo contiene (la raíz o un callback en el acto / de continuación). */
interface Await { end: number; node: ts.Node; scope: ts.Node }
interface Guard { node: ts.Node; kind: 'check' | 'holds'; receiver: string }
interface Write { node: ts.Node; name: string; pinned: boolean }
interface Flow {
  fn: Fn; awaits: Await[]; guards: Guard[]; writes: Write[]; ownPins: Set<string>;
  /** Lo que toma la sesión al crearse (`reportWriteError`, un `action:` diferido). */
  bound: { node: ts.Node; name: string }[];
  actions: Fn[];
}

function analyze(fileName: string, code: string) {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const text = (n: ts.Node) => n.getText(sf);
  const within = (outer: ts.Node, n: ts.Node) => n.getStart(sf) >= outer.getStart(sf) && n.getEnd() <= outer.getEnd();
  const isFn = (n: ts.Node): n is Fn =>
    ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);

  // ── Acciones del store: alias (`st = useModelerStore.getState()` / `get()`) y ligadas a un nombre ──
  const storeAliases = new Set<string>();
  const bound = new Set<string>();
  const isStoreRef = (t: string) => t === 'useModelerStore.getState()' || t === 'get()' || storeAliases.has(t);
  const collectAliases = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isStoreRef(text(n.initializer))) storeAliases.add(n.name.text);
    ts.forEachChild(n, collectAliases);
  };
  collectAliases(sf);
  const collectBound = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const init = n.initializer;
      if (ts.isIdentifier(n.name)) {
        // `const x = useModelerStore((s) => s.deleteTable)`
        if (ts.isCallExpression(init) && text(init.expression) === 'useModelerStore') {
          const m = /\.\s*(\w+)\s*\)?$/.exec(init.arguments[0] ? text(init.arguments[0]) : '');
          if (m && STORE_WRITE_ACTIONS.has(m[1])) bound.add(n.name.text);
        }
        // `const x = useModelerStore.getState().deleteTable`
        const m = /^(.+)\.(\w+)$/.exec(text(init));
        if (m && isStoreRef(m[1]) && STORE_WRITE_ACTIONS.has(m[2])) bound.add(n.name.text);
      } else if (ts.isObjectBindingPattern(n.name) && isStoreRef(text(init))) {
        // `const { deleteTable } = useModelerStore.getState()`
        for (const el of n.name.elements) {
          const prop = text(el.propertyName ?? el.name);
          if (STORE_WRITE_ACTIONS.has(prop) && ts.isIdentifier(el.name)) bound.add(el.name.text);
        }
      }
    }
    ts.forEachChild(n, collectBound);
  };
  collectBound(sf);

  // ── Qué corre dónde ──
  const callKind = (call: ts.CallExpression): 'inline' | 'cont' | null => {
    const e = call.expression;
    if (ts.isPropertyAccessExpression(e)) {
      if (CONT_METHODS.test(e.name.text)) return 'cont';
      if (INLINE_METHODS.test(e.name.text)) return 'inline';
    }
    const t = text(e);
    if (INLINE_RUNNERS.has(t)) return 'inline';
    if (CONT_RUNNERS.has(t)) return 'cont';
    return null;
  };
  const fnKind = (fn: Fn): 'inline' | 'cont' | 'root' => {
    const p = fn.parent;
    if (ts.isParenthesizedExpression(p) && ts.isCallExpression(p.parent) && p.parent.expression === p) return 'inline';   // IIFE
    if (ts.isCallExpression(p) && p.arguments.some((a) => a === fn)) return callKind(p) ?? 'root';
    return 'root';
  };
  /** Nombre para el reporte. */
  const fnName = (fn: Fn): string => {
    if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return text(fn.name);
    if (ts.isPropertyAssignment(fn.parent)) return text(fn.parent.name);
    return localName(fn) ?? '(anónima)';
  };
  /** Nombre con el que se la llama en el archivo (`const x = …`, `function x`, `const x = useCallback(…)`). */
  const localName = (fn: Fn): string | null => {
    if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
    let p: ts.Node = fn.parent;
    if (ts.isCallExpression(p) && text(p.expression) === 'useCallback') p = p.parent;
    return ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? p.name.text : null;
  };

  // ── Escrituras ──
  let localWriters = new Set<string>();
  const writeNameOf = (t: string): string | null => {
    if (t === 'bestEffort') return t;   // corre su callback de inmediato: sin deps con pin, cuenta
    if (SERVICE_WRITES.has(t) || WRITE_CALLBACKS.has(t) || WRITE_HELPERS.has(t)) return t;
    if (VIEW_SYNCS.test(t.split('.').pop() ?? '')) return t;
    if (bound.has(t) || localWriters.has(t)) return t;
    const m = /^(.+)\.(\w+)$/.exec(t);
    if (m && isStoreRef(m[1]) && STORE_WRITE_ACTIONS.has(m[2])) return t;
    return null;
  };
  const writeOf = (call: ts.CallExpression): Write | null => {
    const callee = text(call.expression);
    const name = writeNameOf(callee);
    if (!name) return null;
    const args = call.arguments.map(text).join(',');
    const pinned = /pinnedViewDeps\(|pinned\(/.test(args)
      || ((WRITE_HELPERS.has(callee) || localWriters.has(callee)) && PIN_ARG.test(args));
    return { node: call, name, pinned };
  };
  const guardOf = (call: ts.CallExpression): Guard | null => {
    const e = call.expression;
    if (ts.isPropertyAccessExpression(e) && !e.questionDotToken && (e.name.text === 'check' || e.name.text === 'holds')
        && PIN_RECEIVER.test(text(e.expression))) return { node: call, kind: e.name.text, receiver: text(e.expression) };
    // «¿La sesión sigue editando `cs`?» (tomada previamente): cuenta como un holds.
    if (text(e) === 'stillEditing') return { node: call, kind: 'holds', receiver: call.arguments[0] ? text(call.arguments[0]) : '' };
    // `pinned(pin, fn)(…)` verifica al llamar
    if (ts.isCallExpression(e) && text(e.expression) === 'pinned') return { node: call, kind: 'check', receiver: e.arguments[0] ? text(e.arguments[0]) : '' };
    return null;
  };

  // ── El flujo de una función raíz ──
  const buildFlow = (fn: Fn): Flow => {
    const flow: Flow = { fn, awaits: [], guards: [], writes: [], ownPins: new Set(), bound: [], actions: [] };
    const walk = (n: ts.Node, scope: ts.Node): void => {
      if (isFn(n)) {
        const k = fnKind(n);
        if (k === 'root') {   // otra función: se analiza aparte
          // …salvo que sea el `action:` de un confirm: se crea acá.
          if (ts.isPropertyAssignment(n.parent) && text(n.parent.name) === 'action') flow.actions.push(n);
          return;
        }
        if (k === 'cont') flow.awaits.push({ end: n.getStart(sf), node: n, scope: n });
        ts.forEachChild(n, (c) => walk(c, n));
        return;
      }
      if (ts.isAwaitExpression(n)) flow.awaits.push({ end: n.getEnd(), node: n, scope });
      // Pines tomados en el flujo (`pinSession()`, `explorerRequest()`): los del momento.
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(n.initializer)
          && /^(pinSession|explorerRequest)$/.test(text(n.initializer.expression))) {
        if (ts.isIdentifier(n.name)) flow.ownPins.add(n.name.text);
        else if (ts.isObjectBindingPattern(n.name)) for (const el of n.name.elements) if (ts.isIdentifier(el.name)) flow.ownPins.add(el.name.text);
      }
      if (ts.isCallExpression(n)) {
        const g = guardOf(n);
        if (g) flow.guards.push(g);
        if (text(n.expression) === 'reportWriteError') flow.bound.push({ node: n, name: 'reportWriteError' });
        const w = writeOf(n);
        if (w) flow.writes.push(w);
        // Una escritura pasada por referencia a un callback en el acto / de continuación.
        const k = callKind(n);
        if (k) for (const a of n.arguments) {
          if (isFn(a)) continue;
          const name = writeNameOf(text(a));
          if (!name) continue;
          if (k === 'cont') flow.awaits.push({ end: a.getStart(sf), node: a, scope: a });
          flow.writes.push({ node: a, name, pinned: false });
        }
      }
      ts.forEachChild(n, (c) => walk(c, scope));
    };
    if (fn.body) walk(fn.body, fn);
    return flow;
  };

  // ── ¿Qué awaits preceden a la escritura? ──
  /** ¿`a` y `b` están en ramas exclusivas de un mismo if / condicional / switch? */
  const exclusive = (a: ts.Node, b: ts.Node): boolean => {
    for (let p: ts.Node | undefined = a.parent; p; p = p.parent) {
      const inside = (x: ts.Node | undefined, n: ts.Node) => !!x && within(x, n);
      if (ts.isIfStatement(p)) {
        if ((inside(p.thenStatement, a) && inside(p.elseStatement, b)) || (inside(p.elseStatement, a) && inside(p.thenStatement, b))) return true;
      } else if (ts.isConditionalExpression(p)) {
        if ((inside(p.whenTrue, a) && inside(p.whenFalse, b)) || (inside(p.whenFalse, a) && inside(p.whenTrue, b))) return true;
      } else if (ts.isCaseClause(p) || ts.isDefaultClause(p)) {
        if (inside(p, a) && !inside(p, b) && inside(p.parent, b)) return true;
      }
    }
    return false;
  };
  const terminates = (s: ts.Statement): boolean => {
    const last = ts.isBlock(s) ? s.statements[s.statements.length - 1] : s;
    return !!last && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
  };
  /** ¿`a` está en una rama de un `if` (o en un `catch`) que
   *  termina con return/throw y `b` va después de ese if / try? (Un await del
   *  bloque `try` no: una excepción posterior sigue de largo por el catch.) */
  const earlyReturn = (a: ts.Node, b: ts.Node): boolean => {
    for (let p: ts.Node | undefined = a.parent; p; p = p.parent) {
      if (ts.isCatchClause(p)) {
        if (b.getStart(sf) >= p.parent.getEnd() && terminates(p.block)) return true;
        continue;
      }
      if (!ts.isIfStatement(p) || b.getStart(sf) < p.getEnd()) continue;
      for (const branch of [p.thenStatement, p.elseStatement]) {
        if (branch && within(branch, a) && terminates(branch)) return true;
      }
    }
    return false;
  };
  const isLoop = (n: ts.Node): n is ts.IterationStatement =>
    ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n);
  /** Posición del último await que se cumple antes de la escritura en algún camino (-1: ninguno). */
  const lastAwaitBefore = (flow: Flow, w: ts.Node): number => {
    const pos = w.getStart(sf);
    const before = flow.awaits
      .filter((a) => a.end <= pos && within(a.scope, w) && !exclusive(a.node, w) && !earlyReturn(a.node, w))
      .map((a) => a.end);
    // Bucles que la contienen y esperan algo (en su mismo flujo): la vuelta siguiente llega después.
    for (let p: ts.Node | undefined = w.parent; p && p !== flow.fn; p = p.parent) {
      if (!isLoop(p) || !within(p.statement, w)) continue;
      const loop = p;
      if ((ts.isForOfStatement(loop) && loop.awaitModifier)
          || flow.awaits.some((a) => within(loop.statement, a.node) && within(a.scope, loop))) before.push(loop.statement.getStart(sf));
    }
    return before.length ? Math.max(...before) : -1;
  };

  // ── ¿Un check/holds protege la escritura? ──
  /** ¿`from` se ejecuta en todo camino hacia `w` (no está en una rama, un bucle, un catch o un callback que no la contiene)? */
  const unconditional = (from: ts.Node, w: ts.Node): boolean => {
    for (let child: ts.Node = from, p: ts.Node | undefined = from.parent; p; child = p, p = p.parent) {
      if (isFn(p)) return false;   // un check dentro de un callback no cubre lo de afuera
      if (ts.isIfStatement(p) && child !== p.expression) return false;
      if (ts.isConditionalExpression(p) && child !== p.condition) return false;
      if (ts.isBinaryExpression(p) && child === p.right && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) return false;
      if (isLoop(p) && child === p.statement && !ts.isDoStatement(p)) return false;
      if (ts.isForStatement(p) && (child === p.condition || child === p.incrementor)) return false;
      if (ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isCatchClause(p)) return false;
      if (ts.isTryStatement(p) && child === p.tryBlock) return false;
      if (within(p, w)) return true;
    }
    return false;
  };
  /** ¿El `holds()` protege a `w`? — `if (!pin.holds()) return;` delante, o `w` dentro de `if (pin.holds())` / `pin.holds() && w` / `pin.holds() ? w : …`. */
  const holdsGuards = (h: ts.Node, w: ts.Node): boolean => {
    let node: ts.Node = h;
    let negated = false;
    for (let p: ts.Node | undefined = h.parent; p; node = p, p = p.parent) {
      if (ts.isParenthesizedExpression(p)) continue;
      if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) { negated = !negated; continue; }
      if (ts.isBinaryExpression(p)) {
        const op = p.operatorToken.kind;
        if (op === ts.SyntaxKind.AmpersandAmpersandToken && !negated) {
          if (node === p.left && within(p.right, w)) return true;
          continue;   // (holds && x) verdadero ⇒ holds
        }
        if (op === ts.SyntaxKind.BarBarToken && negated) continue;   // (!holds || x) falso ⇒ holds
        return false;
      }
      if (ts.isIfStatement(p) && node === p.expression) {
        if (!negated) return within(p.thenStatement, w);
        return w.getStart(sf) >= p.getEnd() && terminates(p.thenStatement) && unconditional(p, w);
      }
      if (ts.isConditionalExpression(p) && node === p.condition) return within(negated ? p.whenFalse : p.whenTrue, w);
      return false;
    }
    return false;
  };
  const covers = (g: Guard, w: ts.Node, lastAwait: number): boolean => {
    const at = g.node.getStart(sf);
    if (at <= lastAwait || at > w.getStart(sf)) return false;
    return g.kind === 'check' ? unconditional(g.node, w) : holdsGuards(g.node, w);
  };
  const rootIdent = (receiver: string) => receiver.split('.')[0];

  // ── Funciones raíz: las que no corren dentro del flujo de otra ──
  const roots: Fn[] = [];
  const enclosed = (fn: Fn) => { for (let p = fn.parent; p; p = p.parent) if (isFn(p)) return true; return false; };
  const collectRoots = (n: ts.Node): void => {
    if (isFn(n) && (fnKind(n) === 'root' || !enclosed(n))) roots.push(n);
    ts.forEachChild(n, collectRoots);
  };
  collectRoots(sf);

  /** ¿La función escribe con la sesión del momento? Sí, si alguna escritura suya
   *  no la protege un pin de afuera (parámetro o clausura): o no la protege nada,
   *  o solo el pin que ella misma toma al empezar. */
  const uncoveredWrite = (flow: Flow): Write | undefined => flow.writes.find((w) => {
    if (w.pinned) return false;
    const last = lastAwaitBefore(flow, w.node);
    return !flow.guards.some((g) => !flow.ownPins.has(rootIdent(g.receiver)) && covers(g, w.node, last));
  });
  const isWriter = (flow: Flow): boolean => !!uncoveredWrite(flow);

  // Punto fijo: llamar a una función local que escribe es escribir.
  let flows = roots.map(buildFlow);
  for (;;) {
    const next = new Set(flows.filter(isWriter).map((f) => localName(f.fn)).filter((n): n is string => !!n));
    if (next.size === localWriters.size && [...next].every((n) => localWriters.has(n))) break;
    localWriters = next;
    flows = roots.map(buildFlow);
  }

  const violations: Violation[] = [];
  const flowOf = new Map(flows.map((f) => [f.fn, f]));
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  for (const flow of flows) {
    // Lo que toma la sesión al crearse, creado tras un await, necesita el pin de afuera.
    for (const b of [...flow.bound, ...flow.actions.map((a) => ({ node: a as ts.Node, name: 'action' }))]) {
      const last = lastAwaitBefore(flow, b.node);
      if (last >= 0 && !flow.guards.some((g) => covers(g, b.node, last))) violations.push({ fn: fnName(flow.fn), line: lineOf(b.node), write: b.name });
    }
    // …y la acción diferida, sus escrituras con un pin de afuera (no el del clic).
    for (const a of flow.actions) {
      const af = flowOf.get(a);
      const w = af && lastAwaitBefore(flow, a) >= 0 ? uncoveredWrite(af) : undefined;
      if (w) violations.push({ fn: fnName(flow.fn), line: lineOf(w.node), write: `action:${w.name}` });
    }
    for (const w of flow.writes) {
      if (w.pinned) continue;
      const last = lastAwaitBefore(flow, w.node);
      if (last < 0) continue;
      if (flow.guards.some((g) => covers(g, w.node, last))) continue;
      violations.push({ fn: fnName(flow.fn), line: sf.getLineAndCharacterOfPosition(w.node.getStart(sf)).line + 1, write: w.name });
    }
  }
  return { sf, flows, isWriter, violations };
}

/** Escrituras que siguen a un `await` sin un `.check()` de pin en el medio. */
export function unpinnedWrites(fileName: string, code: string): Violation[] {
  return analyze(fileName, code).violations;
}

/** Acciones del store (`useModelerStore = create(…)((set, get) => ({ … }))`)
 *  que escriben con la sesión del momento, para verificar `STORE_WRITE_ACTIONS`. */
export function storeWriters(fileName: string, code: string): string[] {
  const { sf, flows, isWriter } = analyze(fileName, code);
  let actions: ts.ObjectLiteralExpression | null = null;
  const find = (n: ts.Node): void => {
    if (actions) return;
    if (ts.isArrowFunction(n) && ts.isParenthesizedExpression(n.body) && ts.isObjectLiteralExpression(n.body.expression)) {
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (ts.isVariableDeclaration(p) && p.name.getText(sf) === 'useModelerStore') { actions = n.body.expression; return; }
      }
    }
    ts.forEachChild(n, find);
  };
  find(sf);
  if (!actions) return [];
  const props = new Set((actions as ts.ObjectLiteralExpression).properties);
  return flows
    .filter((f) => (ts.isPropertyAssignment(f.fn.parent) && props.has(f.fn.parent)) || (ts.isMethodDeclaration(f.fn) && props.has(f.fn)))
    .filter(isWriter)
    .map((f) => (ts.isMethodDeclaration(f.fn) ? f.fn.name : (f.fn.parent as ts.PropertyAssignment).name).getText(sf));
}
