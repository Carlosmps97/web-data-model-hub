import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_SETTINGS, mergeOutputSettings, splitOutputSettings } from './outputSettings';

describe('mergeOutputSettings (doc 93 D1)', () => {
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
  it('valores inválidos o desconocidos se ignoran sin romper (Review Focus #5)', () => {
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
    expect(opts.partitionsLast).toBe(false);
    expect('fileNames' in opts).toBe(false);
    expect(fileNames.generatedView).toBe('VIEW_TEC');
  });
});
