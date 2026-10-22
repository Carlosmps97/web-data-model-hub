// El Undo es de la sesión donde nació. En todo el repo:
//  · cada `pushUndo(…)` apila con el pin de su acción (tercer argumento): una
//    acción que termina después de abrir otra versión no deja su inversa en la
//    pila de la recién abierta;
//  · las inversas de varias escrituras que arman los componentes se detienen
//    antes de cada escritura si la sesión es otra: las de pegar columnas, crear
//    una relación y crear una subcategoría usan `undoColumnsBatch`; ningún
//    componente que apila inversas arma deps de vistas sin pin.
// El comportamiento se prueba en `lib/pinnedWrites.test.ts` y en los tests del
// store; acá se revisa el fuente (sin DOM: vitest corre en node).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../..');
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const files = readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/testutil/.test(f))
  .map((f) => join(SRC, f));

/** Las llamadas `pushUndo(…)` del fuente, completas (paréntesis balanceados;
 *  el contenido de strings y template literals no cuenta). */
export function pushUndoCalls(code: string): string[] {
  const out: string[] = [];
  let i = code.indexOf('pushUndo(');
  while (i !== -1) {
    let depth = 0;
    let quote: string | null = null;
    let j = i + 'pushUndo'.length;
    for (; j < code.length; j += 1) {
      const ch = code[j];
      if (quote) {
        if (ch === '\\') j += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push(code.slice(i, j + 1));
    i = code.indexOf('pushUndo(', j + 1);
  }
  return out;
}
/** ¿El último argumento es un pin (`pin`, `actionPin`, …)? */
const endsWithPin = (call: string) => /,\s*[A-Za-z_$][\w$]*[Pp]in\s*\)$/.test(call) || /,\s*pin\s*\)$/.test(call);

describe('el extractor de llamadas', () => {
  it('toma la llamada entera y reconoce el pin final', () => {
    const code = "pushUndo(`Paste ${n} column${n === 1 ? '' : 's'}`, async () => { await f(')'); }, pin);\nx();";
    const [call] = pushUndoCalls(code);
    expect(call.endsWith(', pin)')).toBe(true);
    expect(endsWithPin(call)).toBe(true);
    expect(endsWithPin("pushUndo('a', async () => { await g(pin); })")).toBe(false);
  });
});

describe('cada pushUndo apila con el pin de su acción', () => {
  const sites = files.flatMap((f) => pushUndoCalls(stripComments(readFileSync(f, 'utf-8')))
    .map((call) => ({ where: relative(SRC, f), call })));
  it('hay sitios que revisar (store y componentes)', () => {
    expect(sites.length).toBeGreaterThan(25);
    expect(new Set(sites.map((s) => s.where)).size).toBeGreaterThan(5);
  });
  it('ninguno sin pin', () => {
    expect(sites.filter((s) => !endsWithPin(s.call)).map((s) => `${s.where}: ${s.call.slice(0, 70)}…`)).toEqual([]);
  });
});

describe('inversas de varias escrituras en los componentes', () => {
  const comp = (name: string) => stripComments(readFileSync(join(__dirname, name), 'utf-8'));
  it.each(['PasteColumnsPopup.tsx', 'RelationshipCreatePopup.tsx', 'SubcategoryCreatePopup.tsx'])(
    '%s: su inversa es `undoColumnsBatch` (corta con el pin del Undo)', (name) => {
      const undo = pushUndoCalls(comp(name));
      expect(undo).toHaveLength(1);
      expect(undo[0]).toMatch(/undoColumnsBatch\(/);
    });
  it('ObjectInspector: la inversa de reordenar (tandas de escrituras) corta con el pin del Undo', () => {
    const reorder = pushUndoCalls(comp('ObjectInspector.tsx')).filter((c) => c.startsWith("pushUndo('Reorder columns'"));
    expect(reorder).toHaveLength(1);
    expect(reorder[0]).toMatch(/async \(undo\) => \{[^}]*pinned\(undo, gov\.updateColumn\)/);
  });
  it.each(['PasteColumnsPopup.tsx', 'RelationshipCreatePopup.tsx', 'SubcategoryCreatePopup.tsx', 'ObjectInspector.tsx'])(
    '%s: sin deps de vistas sin pin (`updateView: viewsSvc.updateView`)', (name) => {
      expect(comp(name)).not.toMatch(/updateView:\s*viewsSvc\.updateView/);
    });
});
