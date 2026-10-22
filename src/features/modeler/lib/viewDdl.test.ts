// El DDL de una vista sale de sus columnas: el mismo texto en Properties, el
// Inspector y el export HTML.
import { describe, expect, it } from 'vitest';
import { generatedViewDdl } from './viewDdl';

const tables = [
  { id: 't1', physicalName: 'CLIENTE', schema: 'core' },
  { id: 't2', physicalName: 'CUENTA', schema: null },
];
const view = {
  id: 'v', name: 'v_cc', schema: 'core', tableId: 't1', sourceTableIds: ['t1', 't2'],
  sources: [{ tableId: 't1', column: 'ID' }, { tableId: 't2', column: 'SALDO' }],
  customSql: 'CREATE VIEW core.otra AS SELECT 1 FROM x JOIN y ON 1=1 WHERE secreto = 1',
};

describe('generatedViewDdl', () => {
  it('sale de las columnas: FROM t1, t2 sin JOIN y sin la query informativa', () => {
    const ddl = generatedViewDdl(view, tables);
    expect(ddl).toMatch(/FROM\s+core\.cliente\s+t1,/i);
    expect(ddl).not.toContain('secreto');
    expect(ddl).not.toMatch(/\bJOIN\b/i);
  });
});
