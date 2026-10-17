// Doc 105 (ronda 3, R7-B) — la carga es de la versión donde se pidió: la
// colocación de lo nuevo (doc 113: ya no el arrange completo) corre con su
// pin, y lo que sigue — vaciar la pila de
// Undo, refrescar el Explorer, avisar «Uploaded…» — no toca la sesión que se
// abrió después. (Ronda 4: cerrar el popup ya no la corta; ver abajo.) Sin
// DOM: se revisa el fuente de `upload()`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, 'UploadModal.tsx'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const upload = /const upload = async \(\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? '';

describe('la carga no escribe ni avisa en otra versión (doc 105, R7-B)', () => {
  it('toma el pin al empezar; la colocación corre con el de la VERSIÓN de la carga (ronda 7: A → B → A no salta canvases)', () => {
    expect(upload).toMatch(/const pin = pinSession\(\);/);
    expect(upload).toMatch(/placeUploadedObjects\([^;]*\{ pin: inVersion \}\)/);
    expect(upload).toMatch(/const inVersion: SessionPin = \{\s*holds: \(\) => ours\(\) && sameUser\(\),/);
  });
  it('vaciar el Undo, refrescar y avisar sólo si sigue la sesión de la carga', () => {
    // la guarda que sigue al arrange (ronda 5: la de antes era la de `fail`;
    // ronda 6: por VERSIÓN — `ours()` —, no por la época de la sesión)
    const arranged = upload.indexOf('await placeUploadedObjects(');
    const gate = upload.indexOf('if (!ours()) {', arranged);
    expect(arranged).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(arranged);
    for (const step of ['useUndoStore.getState().clear()', 'await refresh()', 'pushToast(`Uploaded']) {
      expect(upload.indexOf(step, gate)).toBeGreaterThan(gate);
    }
  });
});

// Doc 105 (ronda 4) — desmontar el popup (Logical/Physical cierra los modales;
// salir por el TopNav) cortaba el polling del apply y el arrange aunque la
// sesión no cambiara: canvases sin arreglar (y sin Undo vaciado ni aviso). La
// carga ya pedida sigue: sólo se corta si cambió la sesión (el pin), y lo que
// no se arregló se avisa con un toast cuando el popup no lo muestra.
describe('cerrar el popup no corta una carga ya pedida (doc 105, ronda 4)', () => {
  it('ni el polling del apply ni el arrange van con el abort del popup', () => {
    expect(upload).not.toMatch(/abortRef\.current = /);
    expect(upload).not.toMatch(/signal/);
  });
  it('el job queda marcado «applying» ANTES del POST: desmontar en ese instante no lo descarta', () => {
    const mark = upload.indexOf("jobRef.current = { ...j, status: 'applying' };");
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(upload.indexOf('await applyUpload('));
  });
  it('si la versión cambió a mitad, avisa qué canvases quedaron sin arreglar', () => {
    // ronda 6: la guarda es por VERSIÓN (`ours()`) y la lista, `missing` (fallidos + sin arreglar)
    expect(upload).toMatch(/const missing = \[\.\.\.failed, \.\.\.skipped\];/);
    expect(upload).toMatch(/if \(!ours\(\)\) \{[^}]*pushToast\(notPlacedNotice\(missing, canvasName, \{ version: versionLabel \}\), 'err'\)/);
  });
  it('con el popup ya cerrado, los que fallaron se avisan con un toast', () => {
    expect(upload).toMatch(/if \(!mounted\.current && missing\.length\) pushToast\(notPlacedNotice\(missing, canvasName\), 'err'\);/);
    expect(src).toMatch(/useEffect\(\(\) => \{ mounted\.current = true; return \(\) => \{ mounted\.current = false; \}; \}, \[\]\);/);
  });
});
