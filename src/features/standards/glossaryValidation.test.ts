import { describe, it, expect } from 'vitest';
import { termsToValidate, conflictLines, impactTotal, impactSummary, impactSampleLines, impactNote } from './glossaryValidation';
import type { GlossaryValidation } from '@/services/naming.service';

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

  // Controller resolution (2026-07-11): el backend valida TAMBIÉN los términos
  // renombrados por texto (con exclude_id). Una fila existente cuyo `term`
  // cambió vs `_orig` (case/espacios-insensible) debe validarse.
  it('incluye filas existentes cuyo texto cambió vs el original', () => {
    const drafts = [
      { term: 'codigo nuevo', _orig: 'codigo viejo' },        // renombrada → valida
      { term: '  Codigo  ', _orig: 'codigo' },                // solo case/espacios → NO valida
      { term: 'sin cambios', _orig: 'sin cambios' },          // idéntica → NO valida
      { term: 'nueva', _new: true },                          // nueva → valida
      { term: 'renombrada borrada', _orig: 'orig', _deleted: true }, // borrada → NO valida
      { term: '   ', _orig: 'algo' },                         // renombrada a vacío → NO valida
    ];
    expect(termsToValidate(drafts)).toEqual(['codigo nuevo', 'nueva']);
  });
});

describe('conflictLines', () => {
  const base: GlossaryValidation = {
    ok: false,
    conflicts: {
      glossaryDuplicate: { id: 't1', term: 'codigo', abbrev: 'COD' },
      corpus: [
        { entity: 'table', tableName: 'CLIENTE', columnName: null, logicalName: 'codigo cliente' },
        { entity: 'column', tableName: 'CTA', columnName: 'CODIGOCTAPEN', logicalName: 'codigo cuenta en soles' },
      ],
      total: 3,
    },
  };

  it('lista duplicado + corpus distinguiendo tabla/columna', () => {
    expect(conflictLines(base)).toEqual([
      'Already in the glossary: codigo → COD',
      'Table CLIENTE · "codigo cliente"',
      'Column CTA.CODIGOCTAPEN · "codigo cuenta en soles"',
    ]);
  });

  it('sin duplicado no agrega la línea del glosario', () => {
    const v: GlossaryValidation = {
      ...base,
      conflicts: { ...base.conflicts, glossaryDuplicate: null, total: 2 },
    };
    expect(conflictLines(v)[0]).toBe('Table CLIENTE · "codigo cliente"');
  });

  it('agrega el remanente cuando la muestra viene capada (total > muestra)', () => {
    const v: GlossaryValidation = { ...base, conflicts: { ...base.conflicts, total: 60 } };
    const lines = conflictLines(v);
    // total 60 − 1 duplicado = 59 de corpus; muestra 2 → 57 más.
    expect(lines[lines.length - 1]).toBe('… and 57 more matches');
  });
});

// Doc 94 D7/D8 — el aviso del glosario solo con impacto real, con números.
describe('textos del impacto del glosario', () => {
  const none = { columns: 0, columnTables: 0, tables: 0, sample: [] };
  it('sin cambios de nombres ⇒ total 0 (se aplica sin aviso)', () => {
    expect(impactTotal(none)).toBe(0);
    expect(impactTotal({ ...none, columns: 2, tables: 1 })).toBe(3);
  });
  it('columnas (campos) y tablas por separado, en singular o plural', () => {
    expect(impactSummary({ ...none, columns: 2, columnTables: 1 })).toEqual(['2 column (field) names in 1 table']);
    expect(impactSummary({ ...none, columns: 1, columnTables: 1, tables: 3 }))
      .toEqual(['1 column (field) name in 1 table', '3 table names']);
    expect(impactSummary({ ...none, tables: 1 })).toEqual(['1 table name']);
    expect(impactSummary(none)).toEqual([]);
  });
  it('muestra legible: TABLA · antes → después (columnas) y Table antes → después', () => {
    expect(impactSampleLines({
      ...none, columns: 1, tables: 1,
      sample: [
        { entity: 'column', table: 'MAESTROCLIENTES', from: 'CODCLI', to: 'CODCLTE' },
        { entity: 'table', table: 'VIEJO', from: 'VIEJO', to: 'MAESTROCLIENTES' },
      ],
    })).toEqual(['MAESTROCLIENTES · CODCLI → CODCLTE', 'Table VIEJO → MAESTROCLIENTES']);
  });
  it('avisa cuántos más hay fuera de la muestra', () => {
    const sample = [{ entity: 'column' as const, table: 'T', from: 'A', to: 'B' }];
    expect(impactSampleLines({ ...none, columns: 5, columnTables: 1, sample }).at(-1)).toBe('… and 4 more');
  });
});

// Final review #10: la nota del diálogo depende del scope editado (y avisa si el
// otro scope también se re-deriva por nombres ya desfasados).
describe('impactNote', () => {
  const none = { columns: 0, columnTables: 0, tables: 0, sample: [] };
  it('términos de columna: nunca renombran tablas', () => {
    expect(impactNote('column', { ...none, columns: 2, columnTables: 1 }))
      .toBe('Column terms only rename column (field) names — never table names. You can roll back this version from the history.');
  });
  it('términos de tabla: nunca renombran columnas', () => {
    expect(impactNote('table', { ...none, tables: 1 }))
      .toBe('Table terms only rename table names — never column names. You can roll back this version from the history.');
  });
  it('si el otro scope también cambia, lo explica (nombres ya desfasados)', () => {
    expect(impactNote('column', { ...none, columns: 1, columnTables: 1, tables: 2 }))
      .toContain('Some table names that are already out of sync with the current rules are re-derived too.');
    expect(impactNote('table', { ...none, tables: 1, columns: 3, columnTables: 1 }))
      .toContain('Some column names that are already out of sync with the current rules are re-derived too.');
  });
});
