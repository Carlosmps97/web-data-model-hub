import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_SETTINGS, mergeOutputSettings, splitOutputSettings } from './outputSettings';
import { DEFAULT_ORACLE_OPTS } from './oracle';

describe('mergeOutputSettings', () => {
  it('sin nada guardado ⇒ los defaults de la macro', () => {
    expect(mergeOutputSettings(undefined)).toEqual(DEFAULT_OUTPUT_SETTINGS);
    expect(mergeOutputSettings(null).fileNames).toEqual({
      table: 'TABLE', modeledView: 'VIEW_NEG', generatedView: 'VIEW_TEC', separator: '-', nameCase: 'upper', schema: 'when-needed',
    });
  });
  it('toma lo guardado y completa fileNames parciales', () => {
    const s = mergeOutputSettings({ viewTagsAs: 'view', includeKeys: true, location: 's3://x', fileNames: { modeledView: 'NEG' } });
    expect(s.viewTagsAs).toBe('view');
    expect(s.includeKeys).toBe(true);
    expect(s.location).toBe('s3://x');
    expect(s.fileNames).toMatchObject({ modeledView: 'NEG', table: 'TABLE' });
  });
  it('valores inválidos o desconocidos se ignoran sin romper', () => {
    const s = mergeOutputSettings({ typeCase: 'raro', external: 'yes', zzz: 1, fileNames: { nameCase: 'x' }, tblProperties: [{ key: 'a', value: 1 }, 'x'] });
    expect(s.typeCase).toBe('lower');
    expect(s.external).toBe(true);
    expect(s.fileNames.nameCase).toBe('upper');
    expect(s.tblProperties).toEqual([{ key: 'a', value: '1' }]);
    expect('zzz' in s).toBe(false);
  });
  it('mergeOutputSettings no comparte referencias con los defaults', () => {
    const s = mergeOutputSettings({});
    s.fileNames.table = 'X';
    expect(DEFAULT_OUTPUT_SETTINGS.fileNames.table).toBe('TABLE');
  });
  it('splitOutputSettings separa opciones del generador y nombres de archivo', () => {
    const { opts, fileNames } = splitOutputSettings(DEFAULT_OUTPUT_SETTINGS);
    expect(opts.createTable).toBe('or-replace');
    expect('fileNames' in opts).toBe(false);
    expect('dialect' in opts).toBe(false);
    expect('oracle' in opts).toBe(false);
    expect(fileNames.generatedView).toBe('VIEW_TEC');
  });
});

describe('mergeOutputSettings — dialecto y configuración Oracle', () => {
  it('sin nada guardado (o sin dialecto ni config Oracle): Databricks por default y Oracle con sus defaults', () => {
    const s = mergeOutputSettings({ typeCase: 'upper', includeKeys: true });
    expect(s.dialect).toBe('databricks');
    expect(s.oracle).toEqual(DEFAULT_ORACLE_OPTS);
    // la config de Databricks no contamina la de Oracle (ni al revés)
    expect(s.typeCase).toBe('upper');
    expect(DEFAULT_OUTPUT_SETTINGS.oracle.typeCase).toBe('upper');
    expect(mergeOutputSettings({ oracle: { typeCase: 'lower' } }).typeCase).toBe('lower');
  });
  it('toma el dialecto y la config Oracle guardados, clave a clave', () => {
    const s = mergeOutputSettings({
      dialect: 'oracle',
      oracle: { includeComments: true, identifierCase: 'as-is', defaultSchema: 'stg' },
    });
    expect(s.dialect).toBe('oracle');
    expect(s.oracle).toEqual({ ...DEFAULT_ORACLE_OPTS, includeComments: true, identifierCase: 'as-is', defaultSchema: 'stg' });
  });
  it('el mapeo de tipos y el tamaño máximo guardados en la config Oracle se ignoran', () => {
    const s = mergeOutputSettings({
      dialect: 'oracle',
      oracle: { typeCase: 'lower', typeMap: [{ from: 'DATETIME', to: 'DATE' }], maxStringSize: 'extended' },
    });
    expect(s.oracle).toEqual({ ...DEFAULT_ORACLE_OPTS, typeCase: 'lower' });
    expect('typeMap' in s.oracle || 'maxStringSize' in s.oracle).toBe(false);
  });
  it('valores inválidos se ignoran sin romper', () => {
    const s = mergeOutputSettings({
      dialect: 'postgres',
      oracle: { typeCase: 'raro', includeKeys: 'si', zzz: 1 },
    });
    expect(s.dialect).toBe('databricks');
    expect(s.oracle.typeCase).toBe('upper');
    expect(s.oracle.includeKeys).toBe(true);
    expect('zzz' in s.oracle).toBe(false);
    expect(mergeOutputSettings({ oracle: 'x' }).oracle).toEqual(DEFAULT_ORACLE_OPTS);
  });

  it('NOT NULL aparte y el esquema (sin / del modelo / elegido) se guardan; lo inválido cae a su default', () => {
    const ok = mergeOutputSettings({ oracle: { includeNotNull: true, schemaMode: 'custom', defaultSchema: 'stg' } });
    expect(ok.oracle).toEqual({ ...DEFAULT_ORACLE_OPTS, includeNotNull: true, schemaMode: 'custom', defaultSchema: 'stg' });
    const bad = mergeOutputSettings({ oracle: { includeNotNull: 'si', schemaMode: 'raro' } });
    expect(bad.oracle.includeNotNull).toBe(false);
    expect(bad.oracle.schemaMode).toBe('none');
  });
  it('no comparte referencias con los defaults de Oracle', () => {
    const s = mergeOutputSettings({});
    s.oracle.typeCase = 'lower';
    expect(DEFAULT_OUTPUT_SETTINGS.oracle.typeCase).toBe('upper');
    expect(DEFAULT_ORACLE_OPTS.typeCase).toBe('upper');
  });
});
