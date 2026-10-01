// TagEditor (doc 105, ronda 5): la UI va en inglés — sus placeholders por
// defecto decían «clave» / «valor».
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TagEditor from './TagEditor';

describe('placeholders por defecto', () => {
  it('«key» y «value»', () => {
    const html = renderToStaticMarkup(<TagEditor value={[]} onChange={() => {}} />);
    expect(html).toContain('placeholder="key"');
    expect(html).toContain('placeholder="value"');
    expect(html).not.toMatch(/placeholder="(clave|valor)"/);
  });
});
