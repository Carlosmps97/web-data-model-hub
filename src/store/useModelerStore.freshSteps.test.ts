// Los pasos del historial que arman su contrario con lo que leen o escriben al
// correr (borrados en cascada, entrar o salir del canvas) van marcados con
// `freshStep`: sin la marca, el reintento de uno que falló a mitad dejaría un
// contrario incompleto (ver useUndoStore).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, 'useModelerStore.ts'), 'utf-8');

describe('pasos frescos del store', () => {
  it.each(['membersOut', 'membersIn', 'tablesOut', 'tablesDrop', 'columnsDrop', 'viewDrop', 'relDrop'])('%s va marcado', (name) => {
    expect(src).toMatch(new RegExp(`function ${name}\\([^)]*\\): HistoryStep \\{\\s*return freshStep\\(`));
  });

  it('deshacer un pegado (una tabla o un grupo) va marcado', () => {
    expect(src).toMatch(/function pasteUndo\([\s\S]*?\): HistoryStep \{\s*const store = \(\) => useModelerStore\.getState\(\);\s*const step: HistoryStep = freshStep\(/);
  });
});
