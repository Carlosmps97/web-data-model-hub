import { describe, it, expect } from 'vitest';
import { applyTitle, conflictMessage, conflictRows, gapToast, highlightParts, impactNote, impactSummary, incompleteMessage, incompleteRows, maxLengthLabel, needsConfirm, outOfSyncReason, termEdited, termGap, termsToUpsert, termsToValidate } from './glossaryValidation';
import type { GlossaryImpact, GlossaryImpactRow, GlossaryValidation } from '@/services/naming.service';

describe('termsToValidate', () => {
  it('devuelve solo filas nuevas, vivas y con texto (trim aplicado)', () => {
    const drafts = [
      { term: ' codigo ', _new: true },
      { term: 'borrado', _new: true, _deleted: true },
      { term: '   ', _new: true },
      { term: 'existente' },
    ];
    expect(termsToValidate(drafts)).toEqual(['codigo']);
  });

  it('lista vacía → sin validaciones', () => {
    expect(termsToValidate([])).toEqual([]);
  });

  it('incluye filas existentes cuyo texto cambió vs el original', () => {
    const drafts = [
      { term: 'codigo nuevo', _orig: 'codigo viejo' },
      { term: '  Codigo  ', _orig: 'codigo' },
      { term: 'sin cambios', _orig: 'sin cambios' },
      { term: 'nueva', _new: true },
      { term: 'renombrada borrada', _orig: 'orig', _deleted: true },
      { term: '   ', _orig: 'algo' },
    ];
    expect(termsToValidate(drafts)).toEqual(['codigo nuevo', 'nueva']);
  });
});

// Doc 95 D1 — el popup de conflictos dice QUÉ se bloquea y lista todo.
describe('popup de conflictos', () => {
  const base: GlossaryValidation = {
    ok: false,
    conflicts: {
      glossaryDuplicate: null,
      corpus: [
        { entity: 'column', tableName: 'HM_A', columnName: 'NUMXBCONSOLIDADO', logicalName: 'Numero XB Consolidado' },
        { entity: 'column', tableName: 'HM_A', columnName: 'FLGCONSOLIDADO', logicalName: 'Flag Consolidado' },
        { entity: 'column', tableName: 'HM_B', columnName: 'COLCONSOLIDADO', logicalName: 'Coleccion Consolidado' },
      ],
      total: 3,
    },
  };

  it('filas completas: tabla · columna · nombre lógico', () => {
    expect(conflictRows(base)).toHaveLength(3);
    expect(conflictRows(base)[0]).toEqual({ table: 'HM_A', column: 'NUMXBCONSOLIDADO', logical: 'Numero XB Consolidado' });
  });

  it('dice que son COLUMNAS, cuántas, en cuántas tablas y que no se permite', () => {
    expect(conflictMessage(base, 'column')).toEqual([
      "It already appears in the logical name of 3 columns in 2 tables. Adding it would change their physical names, so it's not allowed.",
      'Column terms only look at column names — tables are never renamed.',
    ]);
  });

  it('duplicado en el glosario', () => {
    const v: GlossaryValidation = { ok: false, conflicts: { glossaryDuplicate: { id: 't1', term: 'Consolidado', abbrev: 'CONS' }, corpus: [], total: 1 } };
    expect(conflictMessage(v, 'column')).toEqual(["It's already in the glossary: Consolidado → CONS."]);
  });

  it('término de tabla: habla de tablas', () => {
    const v: GlossaryValidation = { ok: false, conflicts: { glossaryDuplicate: null, total: 1,
      corpus: [{ entity: 'table', tableName: 'HM_CONSOLIDADO', columnName: null, logicalName: 'hm consolidado' }] } };
    expect(conflictMessage(v, 'table')).toEqual([
      "It already appears in the logical name of 1 table. Adding it would change their physical names, so it's not allowed.",
    ]);
  });

  it('marca la frase completa en el nombre lógico, sin mayúsculas y no dentro de otra palabra', () => {
    expect(highlightParts('Numero XB Cliente Score Covid Consolidado', 'consolidado')).toEqual([
      { text: 'Numero XB Cliente Score Covid ', hit: false }, { text: 'Consolidado', hit: true }]);
    expect(highlightParts('Consolidados totales', 'consolidado')).toEqual([{ text: 'Consolidados totales', hit: false }]);
  });
});

// Doc 95 D3 — renombres del borrador vs nombres ya desfasados.
describe('popup de apply', () => {
  const col = (table: string, from: string, to: string, tableId = table): GlossaryImpactRow =>
    ({ entity: 'column', tableId, table, from, to });
  const none: GlossaryImpact = { renamed: [], outOfSync: [] };

  it('sin filas no hay nada que confirmar', () => {
    expect(needsConfirm(none)).toBe(false);
    expect(needsConfirm({ ...none, outOfSync: [col('T', 'A\u00a0', 'A')] })).toBe(true);
  });

  it('resume columnas (por tabla) y tablas, en singular o plural', () => {
    expect(impactSummary([col('T1', 'A', 'B'), col('T1', 'C', 'D')])).toEqual(['2 column (field) names in 1 table']);
    expect(impactSummary([col('T1', 'A', 'B'), { entity: 'table', tableId: 't9', table: 'X', from: 'X', to: 'Y' }]))
      .toEqual(['1 column (field) name in 1 table', '1 table name']);
    expect(impactSummary([])).toEqual([]);
  });

  it('título: renombra o solo aplica', () => {
    expect(applyTitle({ renamed: [col('T', 'A', 'B')], outOfSync: [] })).toBe('Rename 1 physical name?');
    expect(applyTitle({ renamed: [], outOfSync: [col('T', 'A\u00a0', 'A')] })).toBe('Apply glossary changes?');
  });

  it('explica el desfase: carácter invisible o regla distinta', () => {
    expect(outOfSyncReason(col('T', 'DESGRUPOPRODUCTORBMPER\u00a0', 'DESGRUPOPRODUCTORBMPER')))
      .toBe('Invisible character (U+00A0 no-break space)');
    expect(outOfSyncReason(col('T', 'VIEJO', 'NUEVO'))).toBe('Differs from the naming rules');
  });

  it('nota según el scope', () => {
    expect(impactNote('column')).toBe('Column terms only rename column (field) names — never table names. You can roll back this version from the history.');
    expect(impactNote('table')).toBe('Table terms only rename table names — never column names. You can roll back this version from the history.');
  });
});

describe('filas incompletas (doc 102)', () => {
  const before = new Map([['e1', { term: 'codigo', abbrev: 'COD' }], ['e2', { term: 'viejo', abbrev: '' }]]);
  it('termGap', () => {
    expect(termGap({ term: 'a', abbrev: 'A' })).toBeNull();
    expect(termGap({ term: 'a', abbrev: '   ' })).toBe('abbrev');
    expect(termGap({ term: ' ', abbrev: 'A' })).toBe('term');
    expect(termGap({ term: '', abbrev: '' })).toBe('both');
  });
  it('cuenta nuevas y editadas vivas; no las borradas ni las no tocadas', () => {
    const drafts = [
      { id: 'n1', term: 'monto', abbrev: '', _new: true },            // nueva sin abreviatura
      { id: 'n2', term: '', abbrev: '', _new: true },                 // nueva vacía
      { id: 'n3', term: 'ok', abbrev: 'OK', _new: true },
      { id: 'e1', term: 'codigo', abbrev: ' ' },                      // editada: borró la abreviatura
      { id: 'e2', term: 'viejo', abbrev: '' },                        // incompleta de antes, sin tocar
      { id: 'e3', term: 'x', abbrev: '', _deleted: true },
    ];
    expect(incompleteRows(drafts, before).map((d) => d.id)).toEqual(['n1', 'n2', 'e1']);
  });
  it('mensajes', () => {
    expect(incompleteMessage(1)).toBe('1 row needs a term and an abbreviation.');
    expect(incompleteMessage(3)).toBe('3 rows need a term and an abbreviation.');
    expect(gapToast('abbrev')).toBe('Type the abbreviation before validating');
    expect(gapToast('term')).toBe('Type the term before validating');
    expect(gapToast('both')).toBe('Type the term and the abbreviation before validating');
  });
});

// Doc 105 (P1-bis): la edición se compara RECORTADA — «SUC␠» sobre «SUC» contaba
// como cambio, viajaba idéntico y registraba una versión sin cambios reales
// (y re-derivaba los físicos de todo el proyecto).
describe('ediciones recortadas (doc 105 P1-bis)', () => {
  const before = new Map([['1', { term: 'SUC', abbrev: 'SC' }], ['2', { term: 'monto', abbrev: 'MTO' }]]);

  it('un blanco alrededor no es una edición; un cambio de texto o de mayúsculas sí', () => {
    expect(termEdited({ term: 'SUC ', abbrev: ' SC' }, before.get('1')!)).toBe(false);
    expect(termEdited({ term: 'SUC', abbrev: 'SC' }, before.get('1')!)).toBe(false);
    expect(termEdited({ term: 'SUCURSAL', abbrev: 'SC' }, before.get('1')!)).toBe(true);
    expect(termEdited({ term: 'SUC', abbrev: 'SUC' }, before.get('1')!)).toBe(true);
    expect(termEdited({ term: 'suc', abbrev: 'SC' }, before.get('1')!)).toBe(true);
    // un original con blancos (dato viejo) sin tocar tampoco cuenta
    expect(termEdited({ term: 'SUC ', abbrev: 'SC' }, { term: 'SUC ', abbrev: 'SC' })).toBe(false);
  });

  it('viajan sólo las filas nuevas o editadas de verdad, recortadas', () => {
    const drafts = [
      { id: '1', term: 'SUC ', abbrev: 'SC', scope: 'column' as const },                    // blanco: no viaja
      { id: '2', term: ' monto', abbrev: 'MNT ', scope: 'column' as const },                // editada: viaja recortada
      { id: 'new-1', term: ' tasa ', abbrev: ' TS', scope: 'column' as const, _new: true }, // nueva: sin id
      { id: '9', term: 'x', abbrev: 'X', scope: 'column' as const, _deleted: true },        // borrada: va por termsDelete
      { id: '7', term: 'otro', abbrev: 'OT', scope: 'column' as const },                    // sin original: viaja
    ];
    expect(termsToUpsert(drafts, before, 'column')).toEqual([
      { id: '2', term: 'monto', abbrev: 'MNT', scope: 'column' },
      { id: undefined, term: 'tasa', abbrev: 'TS', scope: 'column' },
      { id: '7', term: 'otro', abbrev: 'OT', scope: 'column' },
    ]);
  });

  it('una fila incompleta de antes, tocada sólo con blancos, no bloquea el guardado', () => {
    const b = new Map([['1', { term: 'SUC', abbrev: '' }]]);
    expect(incompleteRows([{ id: '1', term: 'SUC ', abbrev: ' ' }], b)).toEqual([]);
    expect(incompleteRows([{ id: '1', term: 'SUCURSAL', abbrev: '' }], b)).toHaveLength(1);
  });
});

describe('maxLengthLabel (doc 105, ronda 4)', () => {
  it('0 es límite DESACTIVADO (así lo aplica el motor): «No limit», no «0 chars»', () => {
    expect(maxLengthLabel(0)).toBe('No limit');
    expect(maxLengthLabel(150)).toBe('150 chars');
    expect(maxLengthLabel(1)).toBe('1 char');
  });
});
