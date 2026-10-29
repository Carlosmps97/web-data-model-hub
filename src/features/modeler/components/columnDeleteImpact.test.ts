// Borrar una columna: si no se puede leer su impacto (relaciones donde es
// extremo), el panel de columna y el Object Inspector no ofrecen el borrado: se
// avisa y no se abre el diálogo. Tragar el error haría que el diálogo dijera
// «will be removed» y se borrara con `relIds = []`, dejando relaciones con pares
// hacia una columna borrada. Sin DOM: se revisa el fuente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (name: string) => readFileSync(join(__dirname, name), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('sin el impacto de la columna no se ofrece el borrado', () => {
  it.each(['ColumnPropertiesPanel.tsx', 'ObjectInspector.tsx'])('%s', (file) => {
    const src = code(file);
    expect(src).not.toMatch(/columnImpact\([^)]*\);\s*\}\s*catch\s*\{\s*\}/);     // tragado
    expect(src).toMatch(/columnImpact\([^)]*\);\s*\}\s*catch \(e\) \{[^}]*\breturn;\s*\}/);   // avisa y corta
    expect(src).toMatch(/Couldn't check the relationships of this \$\{[^}]+\}: nothing was deleted\. Try again\./);
  });
});

// El aviso del borrado dice el motivo, como Properties y el Inspector: el
// «…nothing was deleted. Try again.» de una lectura previa caída
// (NothingDoneError) o un 409.
describe('el panel de columna avisa el motivo del borrado fallido', () => {
  it('ColumnPropertiesPanel.removeCol: e.message, y si no hay, qué no se borró', () => {
    const body = /const removeCol = async \(\) => \{([\s\S]*?)\n {2}\};/.exec(code('ColumnPropertiesPanel.tsx'))?.[1] ?? '';
    const onError = /const onError = reportWriteError\(([^;]*)\);/.exec(body)?.[1] ?? '';
    expect(onError).toMatch(/\(e\) => pushToast\(e instanceof Error && e\.message \? e\.message : `Couldn't delete the \$\{noun\}`, 'err'\)/);
  });
});

// El panel de columna pasa la columna al store (la vigente, si un paso la
// renombró mientras se leía el impacto), como el Inspector: si al confirmar ya no
// está dibujada (el canvas se recargó o se cerró), la cascada (relaciones
// recortadas, FK, vistas, Undo) se resuelve igual.
describe('el panel de columna pasa la columna al store', () => {
  it('ColumnPropertiesPanel.removeCol', () => {
    const body = /const removeCol = async \(\) => \{([\s\S]*?)\n {2}\};/.exec(code('ColumnPropertiesPanel.tsx'))?.[1] ?? '';
    expect(body).toMatch(/deleteColumn\(cur\.id, relIds, \{ col: cur \}\)/);
  });
});

// El diálogo de borrar una columna avisa qué vistas quedan sin columnas: el
// panel y el Inspector las leen junto con el impacto (empiezan antes de esperar
// `columnImpact`, sin sumar una ida y vuelta) y se las pasan al diálogo.
describe('borrar una columna avisa las vistas que quedan sin columnas', () => {
  it.each([
    ['ColumnPropertiesPanel.tsx', /const removeCol = async \(\) => \{([\s\S]*?)\n {2}\};/],
    ['ObjectInspector.tsx', /const askDeleteColumn = async \(c: CanonicalColumn\) => \{([\s\S]*?)\n {2}\};/],
  ])('%s', (file, fn) => {
    const body = fn.exec(code(file))?.[1] ?? '';
    const read = body.indexOf('readEmptiedViews(');
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(body.indexOf('columnImpact('));
    expect(body).toMatch(/confirmDeleteColumn\(\{[^}]*\bemptiedViews\b/);
  });
});
