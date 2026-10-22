// Ningún flujo con escrituras termina escribiendo en otra versión: dentro de una
// función async, toda escritura que sigue a un `await` va precedida de un
// `.check()` del pin tomado al empezar (o pasa por `pinned(…)` /
// `pinnedViewDeps(…)`). Los servicios toman la versión al llamarlos: sin eso, si
// mientras se esperaba se abrió otra versión (o la revalidación la degradó), la
// escritura caería en ella. Revisión estática (TypeScript) de todos los
// componentes y del store, sin DOM.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORE_WRITE_ACTIONS, storeWriters, unpinnedWrites } from './pinnedFlows.testutil';

const check = (code: string) => unpinnedWrites('x.tsx', code).map((v) => `${v.fn}:${v.write}`);

describe('el análisis', () => {
  it('una escritura después de un await, sin check: falla; con el check en el medio: pasa', () => {
    expect(check('const f = async () => { await read(); await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); pin.check(); await gov.updateColumn(c); };')).toEqual([]);
    expect(check('const f = async () => { await read(); if (!pin.holds()) return; await gov.updateColumn(c); };')).toEqual([]);
    // un check previo al await no alcanza
    expect(check('const f = async () => { pin.check(); await read(); await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
  });

  it('la primera escritura (sin await previo) no necesita check; la segunda sí', () => {
    expect(check('const f = async () => { await gov.createColumn(c); await viewsSvc.updateView(v); };'))
      .toEqual(['f:viewsSvc.updateView']);
  });

  it('en un bucle que espera algo, la vuelta siguiente cuenta como después del await', () => {
    expect(check('const f = async () => { for (const r of rs) await deleteRelationship(r); };\nconst deleteRelationship = useModelerStore((s) => s.deleteRelationship);'))
      .toEqual(['f:deleteRelationship']);
    expect(check('const f = async () => { for (const r of rs) { pin.check(); await gov.deleteRelationship(r); } };')).toEqual([]);
  });

  it('ramas exclusivas y early return no cuentan', () => {
    expect(check('const f = async () => { if (a) await gov.createTable(t); else await gov.deleteTable(t.id); };')).toEqual([]);
    expect(check('const f = async () => { const x = a ? await viewsSvc.updateView(v) : await viewsSvc.createView(v); };')).toEqual([]);
    expect(check('const f = async () => { if (a) { await gov.recordChangesBulk(x); return; } await gov.updateColumn(c); };')).toEqual([]);
  });

  it('`pinned(pin, fn)(…)`, `pinnedViewDeps(pin)` y las funciones anidadas', () => {
    expect(check('const f = async () => { await read(); await pinned(pin, gov.updateColumn)(c); };')).toEqual([]);
    expect(check('const f = async () => { await read(); await syncRenamedColumnInViews(pinnedViewDeps(pin), t, a, b); };')).toEqual([]);
    expect(check('const f = async () => { await read(); setTimeout(async () => { await gov.updateColumn(c); }, 0); };')).toEqual([]);
    // `bestEffort` corre su callback ya: sin deps con pin, cuenta
    expect(check('const f = async () => { await read(); await bestEffort(() => syncRenamedColumnInViews({ listViews, updateView }, t, a, b)); };'))
      .toEqual(['f:bestEffort']);
    expect(check('const f = async () => { await read(); await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(pin), t, a, b)); };')).toEqual([]);
  });

  it('acciones del store (ligadas o por getState/get) y callbacks que escriben', () => {
    expect(check('const f = async () => { await read(); await useModelerStore.getState().addViewsToCanvas(ids); };'))
      .toEqual(['f:useModelerStore.getState().addViewsToCanvas']);
    expect(check('const f = async () => { await read(); await get().deleteTable(id); };')).toEqual(['f:get().deleteTable']);
    expect(check('const f = async () => { const saved = await viewsSvc.createView(b); onSaved(saved, true); };')).toEqual(['f:onSaved']);
  });
});

// Falsos negativos que el análisis cubre: callbacks que corren después de una
// promesa, callbacks que corren en el acto (su escritura es del flujo de
// afuera), accesos al store por alias, `csvc`, callbacks de props y helpers que
// escriben, y checks que no son del pin o que no protegen la escritura.
describe('falsos negativos del análisis', () => {
  it('`.then/.catch/.finally`: el callback corre después de la promesa — la escritura necesita su check adentro', () => {
    expect(check('const f = () => { read().then(() => gov.updateColumn(c)); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = () => { save().catch(() => gov.deleteTable(id)); };')).toEqual(['f:gov.deleteTable']);
    expect(check('const f = () => { save().finally(() => gov.deleteTable(id)); };')).toEqual(['f:gov.deleteTable']);
    expect(check('const f = () => { read().then(() => { pin.check(); return gov.updateColumn(c); }); };')).toEqual([]);
    // por referencia
    expect(check('const f = () => { read().then(saveAll); };\nconst saveAll = useModelerStore((s) => s.saveAll);')).toEqual(['f:saveAll']);
    // control: lo que va después del `.then(…)` (sin await) corre antes que su callback
    expect(check('const f = () => { read().then(() => null); gov.updateColumn(c); };')).toEqual([]);
  });

  it('callbacks síncronos (forEach/map/…) son parte del flujo', () => {
    expect(check('const f = async () => { await read(); xs.forEach((x) => gov.updateColumn(x)); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); await Promise.all(xs.map((x) => gov.deleteColumn(x))); };')).toEqual(['f:gov.deleteColumn']);
    expect(check('const f = async () => { await read(); pin.check(); await Promise.all(xs.map((x) => gov.deleteColumn(x))); };')).toEqual([]);
    expect(check('const f = async () => { await Promise.all(xs.map(async (x) => { await read(x); await gov.deleteColumn(x); })); };'))
      .toEqual(['f:gov.deleteColumn']);
    // control: el await de un callback async de forEach no frena lo de afuera
    expect(check('const f = async () => { xs.forEach(async (x) => { await read(x); }); await gov.updateColumn(c); };')).toEqual([]);
  });

  it('`runBlocking`, `run` y la IIFE corren su callback en el acto; los diferidos, aparte', () => {
    expect(check("const f = async () => { await read(); await runBlocking('x', async () => { await gov.updateColumn(c); }); };"))
      .toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); await run(async () => { await gov.updateColumn(c); }, "err"); };'))
      .toEqual(['f:gov.updateColumn']);
    expect(check("const f = async () => { await read(); await runBlocking('x', saveAll); };\nconst saveAll = useModelerStore((s) => s.saveAll);"))
      .toEqual(['f:saveAll']);
    expect(check('const f = async () => { await read(); void (async () => { await gov.updateColumn(c); })(); };')).toEqual(['f:gov.updateColumn']);
    expect(check("const f = async () => { await read(); pushUndo('x', async () => { await gov.updateColumn(c); }, pin); };")).toEqual([]);
    expect(check('const f = async () => { await read(); useEffect(() => { void gov.updateColumn(c); }, []); };')).toEqual([]);
  });

  it('acciones del store por alias o desestructuradas (`getState()` / `get()`)', () => {
    expect(check('const f = async () => { const st = useModelerStore.getState(); await read(); await st.deleteTable(id); };'))
      .toEqual(['f:st.deleteTable']);
    expect(check('const f = async () => { const { deleteTable } = useModelerStore.getState(); await read(); await deleteTable(id); };'))
      .toEqual(['f:deleteTable']);
    expect(check('const store = { act: async () => { const s = get(); await read(); await s.updateTable(t); } };')).toEqual(['act:s.updateTable']);
    // control: lo que no escribe
    expect(check('const f = async () => { const st = useModelerStore.getState(); await read(); await st.reload(); };')).toEqual([]);
  });

  it('`csvc.recordChange` / `csvc.recordChangesBulk`', () => {
    expect(check("const f = async () => { await read(); await csvc.recordChange(cs, 'views', id, 'delete'); };")).toEqual(['f:csvc.recordChange']);
    expect(check('const f = async () => { await read(); await csvc.recordChangesBulk(cs, xs); };')).toEqual(['f:csvc.recordChangesBulk']);
  });

  it('callbacks de props que escriben (y los que no)', () => {
    for (const cb of ['onAdd', 'onCreate', 'onSave', 'onApply', 'onCommit', 'onDrop']) {
      expect(check(`const f = async () => { await read(); ${cb}(x); };`)).toEqual([`f:${cb}`]);
    }
    expect(check('const f = async () => { await read(); onClose(); onError(e); onChange(v); };')).toEqual([]);
  });

  it('helpers que escriben: `placeUploadedObjects` (con el pin, no), `writeWireRoute` y los locales', () => {
    expect(check('const f = async () => { await read(); await placeUploadedObjects(ids, members, focus); };')).toEqual(['f:placeUploadedObjects']);
    expect(check('const f = async () => { await read(); await placeUploadedObjects(ids, members, focus, undefined, { pin, signal }); };')).toEqual([]);
    expect(check('const f = async () => { await read(); await writeWireRoute(sa, w, null); };')).toEqual(['f:writeWireRoute']);
    // un helper local que escribe: llamarlo tras un await es escribir (aunque él verifique su pin, tomado al llamarlo)
    expect(check('const save = async () => { await gov.updateColumn(c); };\nconst f = async () => { await read(); await save(); };')).toEqual(['f:save']);
    expect(check('const save = async () => { const pin = pinSession(); await read(); pin.check(); await gov.updateColumn(c); };\nconst f = async () => { await read(); await save(); };'))
      .toEqual(['f:save']);
    expect(check('const save = async () => { await gov.updateColumn(c); };\nconst f = async () => { await read(); pin.check(); await save(); };')).toEqual([]);
    // …salvo que reciba el pin del llamador, o verifique uno de afuera
    expect(check('const save = (pin) => { pin.check(); return gov.updateColumn(c); };\nconst f = async () => { await read(); await save(pin); };')).toEqual([]);
    expect(check('const f = async () => { const pin = pinSession(); const save = () => { pin.check(); return gov.updateColumn(c); }; await read(); await save(); };'))
      .toEqual([]);
    // transitivo
    expect(check('const a = () => gov.updateColumn(c);\nconst b = async () => { await a(); };\nconst f = async () => { await read(); await b(); };'))
      .toEqual(['f:b']);
  });

  it('cuenta solo el check/holds del pin, y el holds solo si protege la escritura', () => {
    expect(check('const f = async () => { await read(); validator.check(); await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); const ok = pin.holds(); await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); if (pin.holds()) console.log(1); await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); if (a) pin.check(); await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); if (!pin.holds() && a) return; await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); if (pin.holds() || a) await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    expect(check('const f = async () => { await read(); if (!pin.holds()) log(); await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    // los que sí protegen
    expect(check('const f = async () => { await read(); if (pin.holds()) await gov.updateColumn(c); };')).toEqual([]);
    expect(check('const f = async () => { await read(); if (!pin.holds() || a) return; await gov.updateColumn(c); };')).toEqual([]);
    expect(check('const f = async () => { await read(); pin.holds() && gov.updateColumn(c); };')).toEqual([]);
    expect(check('const f = async () => { await read(); if (!rowPin.holds()) { log(); return; } await gov.updateColumn(c); };')).toEqual([]);
    expect(check('const f = async () => { await read(); if (namePin.current.holds()) void onPatchRef.current(id, v); };')).toEqual([]);
    expect(check('const f = async () => { await read(); undo.check(); await gov.updateColumn(c); };')).toEqual([]);
    expect(check('const f = async () => { await read(); if (stillEditing(cs)) void struct.setSubjectAreaDrawings(sa, d); };')).toEqual([]);
  });

  it('un `catch` que espera y termina (return/throw) no precede a lo de después del try', () => {
    expect(check('const f = async () => { let d; try { d = read(); } catch (e) { await report(e); return; } await gov.updateColumn(c); };')).toEqual([]);
    expect(check('const f = async () => { let d; try { d = read(); } catch (e) { await report(e); throw e; } await gov.updateColumn(c); };')).toEqual([]);
    // sin terminar, sí
    expect(check('const f = async () => { let d; try { d = read(); } catch (e) { await report(e); } await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
    // un await del try que termina no: una excepción después del await sigue de largo por el catch
    expect(check('const f = async () => { try { await read(); return; } catch { log(); } await gov.updateColumn(c); };')).toEqual(['f:gov.updateColumn']);
  });

  // El confirm de un borrado con prelectura (conteos, impacto) se abre solo si
  // sigue la sesión de afuera, y su `action` corre la acción del store con ese
  // pin; si no, abriría en la sesión que hubiera al terminar la lectura, con el
  // pin de ese momento.
  it('un `action:` creado tras un await: el confirm solo en la sesión de afuera, y la acción con su pin', () => {
    const bound = '\nconst deleteTable = useModelerStore((s) => s.deleteTable);';
    const make = (guard: string, inner: string) =>
      `const f = async () => { const pin = pinSession(); const n = await count(); ${guard} await confirmDeleteTable({ impact: n, action: async () => { ${inner} await deleteTable(id); } }); };${bound}`;
    expect(check(make('', ''))).toEqual(['f:action', 'f:action:deleteTable']);
    expect(check(make('if (!pin.holds()) return;', ''))).toEqual(['f:action:deleteTable']);
    expect(check(make('', 'pin.check();'))).toEqual(['f:action']);
    expect(check(make('if (!pin.holds()) return;', 'pin.check();'))).toEqual([]);
    // con `pinned` adentro
    expect(check('const f = async () => { const pin = pinSession(); const i = await impact(); if (!pin.holds()) return; await confirmDeleteColumn({ impact: i, action: () => pinned(pin, deleteColumn)(id) }); };\nconst deleteColumn = useModelerStore((s) => s.deleteColumn);'))
      .toEqual([]);
    // un pin tomado dentro de la acción no sirve (es el de la sesión del clic)
    expect(check(`const f = async () => { const pin = pinSession(); const n = await count(); if (!pin.holds()) return; await confirmDeleteTable({ impact: n, action: async () => { const p2 = pinSession(); p2.check(); await deleteTable(id); } }); };${bound}`))
      .toEqual(['f:action:deleteTable']);
    // sin await previo (el confirm abre en el acto): no hace falta pin
    expect(check(`const f = async () => { await confirmDeleteTable({ impact: n, action: async () => { await deleteTable(id); } }); };${bound}`)).toEqual([]);
  });

  it('`reportWriteError(…)` creado tras un await toma la sesión de ese momento: necesita el pin de afuera', () => {
    expect(check('const f = async () => { const ok = await confirmDialog(x); const onError = reportWriteError(r); };')).toEqual(['f:reportWriteError']);
    expect(check('const f = async () => { const pin = pinSession(); const ok = await confirmDialog(x); if (!ok || !pin.holds()) return; const onError = reportWriteError(r); };')).toEqual([]);
    expect(check('const f = async () => { const onError = reportWriteError(r); const ok = await confirmDialog(x); };')).toEqual([]);
  });

  it('`for await`: cada vuelta llega después de un await', () => {
    expect(check('const f = async () => { for await (const x of xs) gov.updateColumn(x); };')).toEqual(['f:gov.updateColumn']);
  });
});

// La lista de acciones del store que escriben está al día: toda acción cuyo
// flujo escribe con la sesión del momento figura en ella (si no, llamarla tras
// un await pasaría sin check).
describe('STORE_WRITE_ACTIONS está completa', () => {
  it('toda acción del store que escribe está en la lista', () => {
    const f = join(resolve(__dirname, '../../..'), 'store/useModelerStore.ts');
    const writers = storeWriters(f, readFileSync(f, 'utf-8'));
    expect(writers.length).toBeGreaterThan(20);
    expect(writers.filter((w) => !STORE_WRITE_ACTIONS.has(w))).toEqual([]);
  });
});

describe('todos los flujos de escritura verifican el pin', () => {
  const SRC = resolve(__dirname, '../../..');
  // Toda la carpeta de la carga (el arrange de la carga vive fuera de components/).
  const dirs = ['features/modeler/components', 'features/upload', 'features/ddl/components', 'components'];
  const files = [
    ...dirs.flatMap((d) => readdirSync(join(SRC, d), { recursive: true, encoding: 'utf-8' })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.|testutil/.test(f))
      .map((f) => join(SRC, d, f))),
    join(SRC, 'store/useModelerStore.ts'),
  ];
  it('hay archivos que revisar (incluida la colocación de lo nuevo de la carga)', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain(join(SRC, 'features/upload/placeUploaded.ts'));
  });
  it('ninguna escritura después de un await sin su check', () => {
    const found = files.flatMap((f) => unpinnedWrites(f, readFileSync(f, 'utf-8'))
      .map((v) => `${relative(SRC, f)}:${v.line} [${v.fn}] ${v.write}`));
    expect(found).toEqual([]);
  });
});

// Escrituras diferidas (el análisis de arriba no ve timers): el cuerpo del panel
// de columna guarda con debounce lo tipeado y, al cerrarse, escribe lo
// pendiente; al cambiar de versión el panel se cierra y ese flush escribiría en
// la versión recién abierta. Van con el pin tomado al editar (`pinnedDebouncer`);
// el commit de los nombres (tras physicalize) mira el pin de la última edición.
describe('escrituras diferidas del panel de columna', () => {
  const code = readFileSync(join(__dirname, 'ColumnPropertiesPanel.tsx'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('debounce y flush por `pinnedDebouncer` (ningún timer escribe a mano)', () => {
    expect(code).toMatch(/pinnedDebouncer\(/);
    expect(code).not.toMatch(/setTimeout\([^;]*onPatch/);
    expect(code).not.toMatch(/Object\.values\(pendingDeb\.current\)/);
  });
  it('el commit de nombres escribe solo si sigue la sesión de la última edición', () => {
    expect(code).toMatch(/onCommit: \(fields\) => \{ if \(namePin\.current\.holds\(\)\)/);
  });
});

// El trazo de un wire movido con las flechas se graba tras una pausa
// (temporizador), con el pin del momento en que se movió: si al dispararse la
// sesión ya es otra, se descarta el borrador en vez de grabarlo.
describe('temporizador del nudge de wires', () => {
  it('el guardado diferido mira el pin tomado al soltar las flechas', () => {
    const src = readFileSync(join(__dirname, 'WireRouteHandles.tsx'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toMatch(/const pin = pinSession\(\);\s*nudgeTimer\.current = window\.setTimeout\(\(\) => \{[^}]*if \(!pin\.holds\(\)\)/);
  });
});
