// Doc 105 (ronda 4, 6b) — avisos con el sustantivo del modelo abierto (doc 85:
// Entity/Attribute en lógico, Table/Column en físico): pegar desde el menú de
// la columna decía «Table pasted as» aunque Ctrl+V (el canvas) ya decía
// «Entity/Table pasted as», y «Add existing» decía «Couldn't add the table…»
// también en lógico. Sin DOM: se revisa el fuente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { facetNouns } from '@/lib/facets';
import { PASTE_KEY_LABEL as K, copiedMessage, copiedTableMessage } from './ColumnContextMenu';

const code = (name: string) => readFileSync(join(__dirname, name), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('avisos con el sustantivo del modelo (doc 105, ronda 4)', () => {
  it('ColumnContextMenu › Paste table: como Ctrl+V, abre el popup que avisa con la faceta (doc 118)', () => {
    expect(code('ColumnContextMenu.tsx')).toMatch(/st\.setTablePasteOpen\(true\)/);
    expect(code('ModelerCanvas.tsx')).toMatch(/st\.setTablePasteOpen\(true\)/);
    const src = code('PasteTablePopup.tsx');
    expect(src).not.toMatch(/`Table pasted as/);
    expect(src).toMatch(/`\$\{n\.One\} pasted as \$\{name\}`/);
    expect(src).toMatch(/`Couldn't paste the \$\{n\.one\}`/);
  });

  it('NewTableModal › Add existing: «Couldn’t add the entity/table to this canvas»', () => {
    const src = code('NewTableModal.tsx');
    expect(src).not.toMatch(/"Couldn't add the table to this canvas"/);
    expect(src).toMatch(/`Couldn't add the \$\{n\.one\} to this canvas`/);
  });
});

// Doc 105 (ronda 5, R15-H9): copiar y pegar tablas en Lógico mezclaba facetas —
// «Copy attribute» junto a «Copy table», «Paste N columns», «Paste table (X as
// copy)», «Table X copied», «…columns copied», «Couldn't paste the table».
describe('copiar y pegar con los sustantivos de la faceta (doc 105, ronda 5)', () => {
  it('los avisos de copiar', () => {
    const L = facetNouns('logical'), P = facetNouns('physical');
    expect(copiedMessage(1, L)).toBe(`1 attribute copied — paste with ${K} on the target entity`);
    expect(copiedMessage(3, L)).toBe(`3 attributes copied — paste with ${K} on the target entity`);
    expect(copiedMessage(2, P)).toBe(`2 columns copied — paste with ${K} on the target table`);
    expect(copiedTableMessage('cliente', L)).toBe(`Entity cliente copied — paste with ${K}`);
    expect(copiedTableMessage('M_CLIENTE', P)).toBe(`Table M_CLIENTE copied — paste with ${K}`);
  });

  it('el menú: Copy / Paste con la faceta, y el nombre del clipboard según ella', () => {
    const src = code('ColumnContextMenu.tsx');
    expect(src).not.toMatch(/>\s*Copy table\s*</);
    expect(src).not.toMatch(/Paste table \(/);
    expect(src).toMatch(/`Copy \$\{n\.one\}`/);
    expect(src).toMatch(/`Paste \$\{clipCount\} \$\{clipCount === 1 \? n\.member : n\.members\}`/);
    expect(src).toMatch(/`Paste \$\{n\.one\} \$\{tblClipName\}…`/);
    expect(src).toMatch(/s\.viewMode === 'logical' \? t\.logicalName \|\| t\.physicalName : t\.physicalName/);
  });

  it('el canvas (Ctrl+C / Ctrl+V): los mismos avisos, con la faceta', () => {
    const src = code('ModelerCanvas.tsx');
    expect(src).toMatch(/copiedMessage\(n, facetNouns\(st\.viewMode\)\)/);
    expect(src).toMatch(/copiedTableMessage\(name, facetNouns\(st\.viewMode\)\)/);
    expect(src).not.toMatch(/"Couldn't paste the table"/);
  });
});

// Doc 105 (ronda 6, R17a-11): pegar COLUMNAS en Lógico mostraba nombres físicos
// («3 attributes pasted into T_CLIENTE», el subtítulo FÍSICO → FÍSICO) y el Undo
// decía «Paste N columns».
describe('pegar atributos/columnas con la faceta (doc 105, ronda 6)', () => {
  const src = code('PasteColumnsPopup.tsx');

  it('los nombres de origen y destino, según la faceta', () => {
    expect(src).toMatch(/const shown = \(t: \{ logicalName\?: string; physicalName: string \}\) => \(viewMode === 'logical' \? t\.logicalName \|\| t\.physicalName : t\.physicalName\);/);
    expect(src).toMatch(/pasted into \$\{shown\(table\)\}`/);
    expect(src).toMatch(/subtitle=\{`\$\{shown\(clipboard\.source\)\}\$\{fromName \? ` from «\$\{fromName\}»` : ''\} → \$\{shown\(table\)\}`\}/);
    expect(src).not.toMatch(/table\.physicalName\}`/);
  });

  it('el Undo y los textos del popup, con los sustantivos de la faceta', () => {
    expect(src).toMatch(/pushUndo\(`Paste \$\{cols\.length\} \$\{cols\.length === 1 \? n\.member : n\.members\}`/);
    expect(src).not.toMatch(/Each column is pasted/);
    expect(src).not.toMatch(/A column with the same logical name/);
    expect(src).not.toMatch(/Includes key columns/);
  });
});
