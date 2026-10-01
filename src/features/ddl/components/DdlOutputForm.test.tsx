// DdlOutputForm en Oracle (doc 106): el export sale con los tipos tal cual, así
// que el formulario ofrece solo el casing de los tipos — sin «Max string size»
// ni «Type mapping».
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DdlOutputForm from './DdlOutputForm';
import { mergeOutputSettings } from '../outputSettings';

const sections = (html: string) =>
  [...html.matchAll(/<span class="exd-section">([^<]*)/g)].map((m) => m[1].trim());

describe('formulario de Oracle', () => {
  it('ofrece: qué incluir, casing de identificadores, comillas, casing de tipos y nombres de archivo', () => {
    const html = renderToStaticMarkup(
      <DdlOutputForm value={mergeOutputSettings(null)} onChange={() => {}} dialect="oracle" />,
    );
    expect(sections(html)).toEqual(['Include', 'Identifier casing', 'Quote identifiers', 'Data types', 'File names']);
  });
});
