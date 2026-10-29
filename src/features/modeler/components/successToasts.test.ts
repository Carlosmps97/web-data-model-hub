// Un aviso de éxito es de la sesión donde se pidió la acción: «Table created
// from sources» (CTAS) no sale sobre una versión que se abrió mientras el store
// recargaba el canvas. (Pegar una tabla: el store no devuelve el nombre si la
// sesión es otra; lo cubre `useModelerStore.pasteSession.test`.) Sin DOM: se
// revisa el fuente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (name: string) => readFileSync(join(__dirname, name), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('los avisos de éxito, solo en la sesión donde se pidió', () => {
  it('CtasModal › Create: el pin se toma al pedirlo y el aviso mira que siga', () => {
    const body = /const create = async \(\) => \{([\s\S]*?)\n {2}\};/.exec(code('CtasModal.tsx'))?.[1] ?? '';
    const pinAt = body.indexOf('const pin = pinSession();');
    expect(pinAt).toBeGreaterThan(-1);
    expect(pinAt).toBeLessThan(body.indexOf('await createTableFromSources('));
    expect(body).toMatch(/if \(pin\.holds\(\)\) pushToast\('Table created from sources'\);/);
  });

  it('PasteColumnsPopup › Paste: el aviso mira que la sesión siga', () => {
    const body = /const confirm = \(\) => historyAction\(async \(\) => \{([\s\S]*?)\n {2}\}\);/.exec(code('PasteColumnsPopup.tsx'))?.[1] ?? '';
    expect(body.indexOf('const pin = pinSession();')).toBeGreaterThan(-1);
    expect(body).toMatch(/if \(pin\.holds\(\)\) pushToast\(`\$\{cols\.length\}/);
  });
});
