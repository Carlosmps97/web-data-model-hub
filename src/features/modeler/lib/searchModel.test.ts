// Doc 70 §11: lógica pura del buscador del Model.
import { describe, expect, it } from 'vitest';
import { columnPath, folderChain, pickTargetCanvas, snippet, splitHighlight } from './searchModel';

const CANV = [
  { id: 'b', name: 'Banking', projectId: 'p' },
  { id: 'a', name: 'Analytics', projectId: 'p' },
];

describe('searchModel', () => {
  it('pickTargetCanvas: el activo si contiene la tabla; si no, el primero por nombre; sin canvases → null', () => {
    expect(pickTargetCanvas(CANV, 'b')?.id).toBe('b');
    expect(pickTargetCanvas(CANV, 'zzz')?.id).toBe('a');
    expect(pickTargetCanvas(CANV, null)?.id).toBe('a');
    expect(pickTargetCanvas([], 'b')).toBeNull();
  });

  it('splitHighlight: tramos resaltados CI, texto sin match intacto', () => {
    expect(splitHighlight('Codigo del Cliente titular', 'cliente')).toEqual([
      { text: 'Codigo del ', hit: false }, { text: 'Cliente', hit: true }, { text: ' titular', hit: false },
    ]);
    expect(splitHighlight('aXbXc', 'x')).toEqual([
      { text: 'a', hit: false }, { text: 'X', hit: true }, { text: 'b', hit: false }, { text: 'X', hit: true }, { text: 'c', hit: false },
    ]);
    expect(splitHighlight('sin match', 'zz')).toEqual([{ text: 'sin match', hit: false }]);
    expect(splitHighlight('texto', '')).toEqual([{ text: 'texto', hit: false }]);
  });

  it('snippet: recorta alrededor de la primera ocurrencia y normaliza espacios', () => {
    const long = `${'a'.repeat(100)} cliente ${'b'.repeat(100)}`;
    const s = snippet(long, 'cliente', 10);
    // radio 10 a cada lado del match — los espacios cuentan dentro del radio
    expect(s).toBe(`…${'a'.repeat(9)} cliente ${'b'.repeat(9)}…`);
    expect(snippet('  corto\n  con  saltos ', 'zz')).toBe('corto con saltos');
    expect(snippet('', 'x')).toBe('');
  });

  it('columnPath: schema.TABLE · COLUMN con esquema opcional', () => {
    expect(columnPath({ schema: 'core', tableName: 'M_CLIENTE', physicalName: 'CODCLI' })).toBe('core.M_CLIENTE · CODCLI');
    expect(columnPath({ schema: null, tableName: 'T', physicalName: 'C' })).toBe('T · C');
  });

  it('folderChain: de la raíz al canvas; raíz del proyecto → []; ciclos cortados', () => {
    const folders = [
      { id: 'sub', parentFolderId: null }, { id: 'dom', parentFolderId: 'sub' }, { id: 'deep', parentFolderId: 'dom' },
      { id: 'a', parentFolderId: 'b' }, { id: 'b', parentFolderId: 'a' },
    ];
    expect(folderChain(folders, 'deep').map((f) => f.id)).toEqual(['sub', 'dom', 'deep']);
    expect(folderChain(folders, 'sub').map((f) => f.id)).toEqual(['sub']);
    expect(folderChain(folders, null)).toEqual([]);
    expect(folderChain(folders, 'missing')).toEqual([]);
    expect(folderChain(folders, 'a').map((f) => f.id)).toEqual(['b', 'a']);
  });
});
