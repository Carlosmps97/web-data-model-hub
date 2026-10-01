// Doc 105 (ronda 4, 6c) — un aviso de ÉXITO es de la sesión donde se pidió la
// acción: «Table created from sources» (CTAS) salía sobre la versión que se
// abrió mientras el store recargaba el canvas. (Pegar una tabla: el store ya no
// devuelve el nombre si la sesión cambió — `useModelerStore.pasteSession.test`.)
// Sin DOM: se revisa el fuente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (name: string) => readFileSync(join(__dirname, name), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('los avisos de éxito, sólo en la sesión donde se pidió (doc 105, ronda 4)', () => {
  it('CtasModal › Create: el pin se toma al pedirlo y el aviso mira que siga', () => {
    const body = /const create = async \(\) => \{([\s\S]*?)\n {2}\};/.exec(code('CtasModal.tsx'))?.[1] ?? '';
    const pinAt = body.indexOf('const pin = pinSession();');
    expect(pinAt).toBeGreaterThan(-1);
    expect(pinAt).toBeLessThan(body.indexOf('await createTableFromSources('));
    expect(body).toMatch(/if \(pin\.holds\(\)\) pushToast\('Table created from sources'\);/);
  });
});
