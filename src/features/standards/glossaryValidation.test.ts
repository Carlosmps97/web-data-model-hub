import { describe, it, expect } from 'vitest';
import { termsToValidate, conflictLines } from './glossaryValidation';
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
