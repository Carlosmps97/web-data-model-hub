/**
 * Hooks de React de mentira para probar componentes sin DOM ni renderer (vitest
 * corre en node). El componente se llama como función: cada `useState` devuelve
 * su valor inicial (o el que decida `fake.override`) y un setter que solo anota
 * lo que recibe; `useEffect` guarda el efecto para correrlo a mano. Con eso se
 * disparan los handlers reales del árbol de elementos que devuelve.
 * Para un ciclo de vida (montar → datos → re-render): `nextStates()` da el estado
 * siguiente, `resetFake(…, { keepRefs: true })` re-renderiza el mismo componente
 * (mismas refs) y `runEffects()` corre solo los efectos cuyas deps cambiaron,
 * limpiando primero su run anterior; `unmount()` corre todas las limpiezas.
 *
 * Uso (en cada archivo de test; el mock se iza):
 *   vi.mock('react', async (orig) => (await import('./fakeReact.testutil')).fakeReact(await orig<object>()));
 *
 * Sin imports de React: este módulo se carga dentro del mock de 'react'.
 */
type Effect = () => void | (() => void);
type Deps = readonly unknown[] | undefined;

export const fake = {
  /** Valor que devuelve el `useState` número `index` en lugar de `init` (null = el inicial). */
  override: null as null | ((init: unknown, index: number) => unknown),
  states: [] as { value: unknown; calls: unknown[] }[],
  /** Setter de cada `useState` (en orden): estable entre re-renders, como en React —
   *  anota en el render que esté vigente cuando se llama. */
  setters: [] as ((next: unknown) => void)[],
  /** Montaje vigente: cada `resetFake()` sin `keepRefs` es un montaje nuevo. */
  mount: 0,
  /** Llamadas de setters de un montaje anterior (p. ej. un intervalo que no se
   *  soltó al desmontar): se anotan aparte, nunca en el render vigente. */
  stale: [] as { index: number; next: unknown }[],
  /** Efectos de este render, en orden; `due` = primer run o deps distintas al run anterior. */
  effects: [] as { fn: Effect; deps: Deps; due: boolean }[],
  /** Refs por orden de llamada: como en React, sobreviven a un re-render (`keepRefs`). */
  refs: [] as { current: unknown }[],
  refCursor: 0,
  /** Por efecto (en orden): deps y limpieza de su último run (sobreviven con `keepRefs`). */
  ran: [] as ({ deps: Deps; cleanup?: () => void } | undefined)[],
  /** `useMemo`/`useCallback` (en orden): el valor se conserva mientras no cambien sus deps. */
  memos: [] as ({ deps: Deps; value: unknown } | undefined)[],
  memoCursor: 0,
  /** `useId`: estable por posición del hook (como en React). */
  idCursor: 0,
};

/** Deja el estado de los hooks listo para un render nuevo; con `keepRefs` es un
 *  re-render del mismo componente montado (mismas refs y efectos ya corridos). */
export function resetFake(override: typeof fake.override = null, { keepRefs = false } = {}): void {
  fake.override = override;
  fake.states = [];
  fake.effects = [];
  fake.refCursor = 0;
  fake.memoCursor = 0;
  fake.idCursor = 0;
  if (!keepRefs) {
    fake.refs = [];
    fake.ran = [];
    fake.memos = [];
    fake.setters = [];
    fake.stale = [];
    fake.mount += 1;
  }
}

const sameDeps = (a: Deps, b: Deps) => !!a && !!b && a.length === b.length && a.every((d, i) => Object.is(d, b[i]));

const memo = (make: () => unknown, deps: Deps) => {
  const i = fake.memoCursor++;
  const prev = fake.memos[i];
  if (prev && sameDeps(prev.deps, deps)) return prev.value;
  const value = make();
  fake.memos[i] = { deps, value };
  return value;
};

/** Estado del próximo render: cada `useState` con sus setters aplicados en orden
 *  (un valor sustituye al anterior; una función recibe el último valor), como la cola de React. */
export function nextStates(): unknown[] {
  return fake.states.map(({ value, calls }) =>
    calls.reduce((v, c) => (typeof c === 'function' ? (c as (p: unknown) => unknown)(v) : c), value));
}

/** Corre los efectos de este render cuyas deps cambiaron (primero, la limpieza de
 *  su run anterior); devuelve las limpiezas nuevas (el «desmontar» de estos). */
export function runEffects(): (() => void)[] {
  const out: (() => void)[] = [];
  fake.effects.forEach(({ fn, deps, due }, i) => {
    if (!due) return;
    fake.ran[i]?.cleanup?.();
    const c = fn();
    const cleanup = typeof c === 'function' ? c : undefined;
    fake.ran[i] = { deps, cleanup };
    if (cleanup) out.push(cleanup);
  });
  return out;
}

/** Desmonta: corre la limpieza del último run de cada efecto. */
export function unmount(): void {
  fake.ran.forEach((r) => r?.cleanup?.());
  fake.ran = [];
}

export function fakeReact<T extends object>(actual: T) {
  return {
    ...actual,
    useState: (init: unknown) => {
      const initial = typeof init === 'function' ? (init as () => unknown)() : init;
      const index = fake.states.length;
      const value = fake.override ? fake.override(initial, index) : initial;
      fake.states.push({ value, calls: [] });
      const mount = fake.mount;
      fake.setters[index] ??= (next: unknown) => {
        if (mount !== fake.mount) fake.stale.push({ index, next });   // setter de un montaje anterior
        else fake.states[index]?.calls.push(next);
      };
      return [value, fake.setters[index]];
    },
    useEffect: (fn: Effect, deps?: Deps) => {
      fake.effects.push({ fn, deps, due: !sameDeps(fake.ran[fake.effects.length]?.deps, deps) });
    },
    useMemo: (fn: () => unknown, deps?: Deps) => memo(fn, deps),
    useCallback: <F>(fn: F, deps?: Deps) => memo(() => fn, deps) as F,
    useId: () => `:fk${fake.idCursor++}:`,
    useRef: (current: unknown) => {
      const i = fake.refCursor++;
      if (!fake.refs[i]) fake.refs[i] = { current };
      return fake.refs[i];
    },
  };
}

export interface El { type: unknown; props: Record<string, unknown> }
const isEl = (n: unknown): n is El => !!n && typeof n === 'object' && '$$typeof' in n && 'props' in n;

/** Recorre el árbol (children y props que son elementos, p. ej. `footer`) sin invocar componentes. */
export function* walk(node: unknown): Generator<El> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (!isEl(node)) return;
  yield node;
  for (const [key, v] of Object.entries(node.props)) {
    if (key === 'children' || isEl(v) || Array.isArray(v)) yield* walk(v);
  }
}

/** Texto visible de un nodo (sin invocar componentes). */
export const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isEl(node) ? textOf(node.props.children) : '';
};

/** Elemento con ese texto exacto o, si no hay, el primero cuyo texto empieza con
 *  `text` (`type`: etiqueta HTML, o null = cualquiera — p. ej. un <Button>). */
export function byText(tree: unknown, type: string | null, text: string): El {
  const all = [...walk(tree)].filter((el) => type === null || el.type === type);
  const hit = all.find((el) => textOf(el) === text) ?? all.find((el) => textOf(el).startsWith(text));
  if (!hit) throw new Error(`no element «${text}»`);
  return hit;
}
