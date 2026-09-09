// Estado puro del editor de perfiles (doc 78 §8).
import { describe, expect, it } from 'vitest';
import {
  emptyProfile, localProblems, mergeSuggestions, problemsByPath, problemsOfMapping, removeRule, ruleOf, toBody, upsertRule,
} from './profileDraft';
import type { ProfileMapping, UploadProfile } from '../upload.service';

describe('profileDraft', () => {
  it('mergeSuggestions adds new headers without touching mapped ones (by headerKey)', () => {
    const sheet = { name: 'T', required: true, headerRow: 5, mappings: [{ header: 'TABLA_LOGICO', target: { kind: 'field' as const, field: 'logicalName' }, rules: [] }] };
    const out = mergeSuggestions(sheet, [
      { header: 'Tabla Lógico', target: { kind: 'ignore' }, matched: null },
      { header: 'ESQUEMA', target: { kind: 'field', field: 'schema' }, matched: 'field' },
      { header: 'UDP_Universal', target: { kind: 'udp', udpIds: ['u1', 'u2'] }, matched: 'udp' },
      { header: '  ', target: { kind: 'ignore' }, matched: null },
    ]);
    expect(out.mappings.map((m) => m.header)).toEqual(['TABLA_LOGICO', 'ESQUEMA', 'UDP_Universal']);
    expect(out.mappings[0].target.field).toBe('logicalName');
    expect(out.mappings[2].target.udpIds).toEqual(['u1', 'u2']);
    expect(sheet.mappings).toHaveLength(1);       // puro
  });

  it('upsertRule replaces by type, removeRule drops it, ruleOf finds it', () => {
    const m: ProfileMapping = { header: 'X', target: { kind: 'ignore' }, rules: [{ type: 'required', severity: 'error' }] };
    const m2 = upsertRule(m, { type: 'required', severity: 'warning' });
    expect(m2.rules).toEqual([{ type: 'required', severity: 'warning' }]);
    const m3 = upsertRule(m2, { type: 'maxLength', value: 80, severity: 'error' });
    expect(ruleOf(m3, 'maxLength')?.value).toBe(80);
    expect(removeRule(m3, 'required').rules).toEqual([{ type: 'maxLength', value: 80, severity: 'error' }]);
  });

  it('localProblems catches the structural issues before hitting the server', () => {
    const p = emptyProfile();
    p.sheets.tables.name = 'Hoja'; p.sheets.columns.name = ' hoja ';
    p.sheets.tables.mappings = [
      { header: '', target: { kind: 'ignore' }, rules: [] },
      { header: 'A', target: { kind: 'ignore' }, rules: [] },
      { header: 'a', target: { kind: 'udp', udpIds: [] }, rules: [] },
    ];
    p.sheets.tables.headerRow = 0;
    const problems = localProblems(p);
    expect(problems.map((x) => x.code).sort()).toEqual(['header-duplicate', 'header-empty', 'header-row-invalid', 'name-empty', 'sheet-names-equal', 'udp-empty']);
    expect(problemsByPath(problems).get('sheets.tables.mappings[0].header')?.[0].code).toBe('header-empty');
    expect(problemsOfMapping(problems, 'tables', 2).map((x) => x.code).sort()).toEqual(['header-duplicate', 'udp-empty']);
    expect(problemsOfMapping(problems, 'columns', 0)).toEqual([]);
  });

  it('a well-formed profile has no local problems', () => {
    const p = emptyProfile();
    p.name = 'P'; p.sheets.tables.name = 'Cargar_Tablas'; p.sheets.columns.name = 'Cargar_Campos'; p.sheets.tables.headerRow = null;
    p.sheets.tables.mappings = [{ header: 'TABLA_LOGICO', target: { kind: 'field', field: 'logicalName' }, rules: [] }];
    expect(localProblems(p)).toEqual([]);
  });

  it('toBody deep-copies a stored profile and fills missing blocks', () => {
    const doc = {
      id: 'a', projectId: 'p', origin: 'user', name: 'N', description: null, isDefault: true,
      sheets: { tables: { name: 'T', required: true, headerRow: 5, mappings: [{ header: 'H', target: { kind: 'udp', udpIds: ['u'] }, rules: [{ type: 'allowedValues', value: ['x'], severity: 'error' }] }] } },
      policies: { onExistingTable: 'reject' },
    } as unknown as UploadProfile;
    const body = toBody(doc);
    expect(body.description).toBe('') ;
    expect(body.sheets.columns).toEqual({ name: '', required: true, headerRow: 1, mappings: [] });
    expect(body.policies).toEqual({ onExistingTable: 'reject', onExistingColumn: 'update', unknownHeaders: 'warn' });
    body.sheets.tables.mappings[0].target.udpIds!.push('v');
    (body.sheets.tables.mappings[0].rules[0].value as string[]).push('y');
    expect(doc.sheets.tables.mappings[0].target.udpIds).toEqual(['u']);
    expect(doc.sheets.tables.mappings[0].rules[0].value).toEqual(['x']);
  });
});
