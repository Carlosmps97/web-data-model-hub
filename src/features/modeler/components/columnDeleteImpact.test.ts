// Doc 105 (ronda 3) — borrar una COLUMNA: si no se pudo leer su impacto
// (relaciones donde es extremo), el panel de columna y el Object Inspector
// tragaban el error, el diálogo decía «will be removed» y se borraba con
// `relIds = []` — quedaban relaciones con pares hacia una columna borrada.
// Ahora, sin el impacto no se ofrece el borrado: se avisa y no se abre el
// diálogo. Sin DOM: se revisa el fuente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (name: string) => readFileSync(join(__dirname, name), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('sin el impacto de la columna no se ofrece el borrado (doc 105, ronda 3)', () => {
  it.each(['ColumnPropertiesPanel.tsx', 'ObjectInspector.tsx'])('%s', (file) => {
    const src = code(file);
    expect(src).not.toMatch(/columnImpact\([^)]*\);\s*\}\s*catch\s*\{\s*\}/);     // tragado
    expect(src).toMatch(/columnImpact\([^)]*\);\s*\}\s*catch \(e\) \{[^}]*\breturn;\s*\}/);   // avisa y corta
    expect(src).toMatch(/Couldn't check the relationships of this \$\{[^}]+\}: nothing was deleted\. Try again\./);
  });
});

// Doc 105 (ronda 4, 6a): el aviso del borrado dice el MOTIVO — como Properties
// y el Inspector: el «…nothing was deleted. Try again.» de una lectura previa
// caída (NothingDoneError) o un 409. Antes el panel de columna decía sólo
// «Couldn't delete».
describe('el panel de columna avisa el motivo del borrado fallido (doc 105, ronda 4)', () => {
  it('ColumnPropertiesPanel.removeCol: e.message, y si no hay, qué no se borró', () => {
    const body = /const removeCol = async \(\) => \{([\s\S]*?)\n {2}\};/.exec(code('ColumnPropertiesPanel.tsx'))?.[1] ?? '';
    const onError = /const onError = reportWriteError\(([^;]*)\);/.exec(body)?.[1] ?? '';
    expect(onError).toMatch(/\(e\) => pushToast\(e instanceof Error && e\.message \? e\.message : `Couldn't delete the \$\{noun\}`, 'err'\)/);
  });
});
