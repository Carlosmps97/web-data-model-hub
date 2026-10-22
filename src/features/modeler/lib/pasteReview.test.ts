import { describe, expect, it } from 'vitest';
import type { CanonicalColumn, CanonicalTable, ParentDomain } from '@/services/governance.service';
import type { UdpDefinition } from '@/features/standards/standards.service';
import type { DbSchema } from '../services/schemas.service';
import { ALL_COPY, reviewPaste, type PasteTarget } from './pasteReview';

const udp = (id: string, name: string, level: 'table' | 'column', view: 'logical' | 'physical'): UdpDefinition =>
  ({ id, name, level, view, dataType: 'list', allowedValues: ['Si', 'No'] });
const UDPS = [
  udp('ut-p', 'Tipo de Carga', 'table', 'physical'), udp('ut-l', 'Universal', 'table', 'logical'),
  udp('uc-p', 'Particion', 'column', 'physical'), udp('uc-l', 'Clasificacion del Dato', 'column', 'logical'),
];
const DOMAIN: ParentDomain = { id: 'd1', name: 'Fecha', defaultDataType: 'DATE', logicalDataType: 'DATE', physicalName: 'FEC' };
const SCHEMAS: DbSchema[] = [
  { id: 's1', name: 'Core', kind: 'tables' }, { id: 's2', name: 'VU', kind: 'views' },
  { id: 's3', name: 'Mixto', kind: 'both' },   // contiene tablas y vistas
];
const TARGET: PasteTarget = {
  udpDefs: UDPS, domains: [DOMAIN], themes: [{ id: 'th1', name: 'Azul', color: '#0070C0' }], schemas: SCHEMAS,
  naming: { column: { separator: '', case: 'upper', maxLength: 20 }, table: { separator: '', case: 'upper', maxLength: 30 } },
};
const TABLE: CanonicalTable = {
  id: 't1', physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1', schema: 'core', color: 'theme:th1',
  udpValues: { 'ut-p': 'Si', 'ut-l': 'No', gone: 'x' },
};
const col = (over: Partial<CanonicalColumn>): CanonicalColumn => ({
  id: 'c', tableId: 't1', physicalName: 'COD', logicalName: 'Cod', dataType: 'STRING', typeOverridden: false, ordinal: 0, ...over,
});
const COLS = [
  col({
    id: 'c1', physicalName: 'fec_alta', logicalName: 'Fecha Alta', dataType: 'TIMESTAMP', logicalDataType: 'DATE',
    typeOverridden: true, parentDomainId: 'd1', isPrimaryKey: true, isForeignKey: true,
    udpValues: { 'uc-p': 'Si', 'uc-l': 'Fuera de la lista', gone: 'y' },
  }),
  col({ id: 'c2', physicalName: 'COD', parentDomainId: 'deleted', typeOverridden: true, logicalTypeOverridden: true }),
];
const review = (over: Partial<Parameters<typeof reviewPaste>[0]> = {}) => reviewPaste({
  table: TABLE, cols: COLS, source: TARGET, target: TARGET, sameProject: true, options: ALL_COPY, ...over,
});

describe('reviewPaste — mismo proyecto', () => {
  it('los UDP que existen viajan tal cual (también un valor fuera de la lista); los de una definición borrada no', () => {
    const r = review();
    expect(r.payload.table?.udpValues).toEqual({ 'ut-p': 'Si', 'ut-l': 'No' });
    expect(r.payload.cols[0].udpValues).toEqual({ 'uc-p': 'Si', 'uc-l': 'Fuera de la lista' });
    expect(r.warnings).toContain("2 UDP values belong to UDPs that no longer exist or don't apply here — they won't be copied.");
  });

  it('un valor que no es texto viaja como texto (el backend solo acepta texto), también 0 y false', () => {
    const r = review({ cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'uc-p': 7 as unknown as string } })] });
    expect(r.payload.cols[0].udpValues).toEqual({ 'uc-p': '7' });
    const zero = review({ cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'uc-p': 0 as unknown as string, 'uc-l': false as unknown as string } })] });
    expect(zero.payload.cols[0].udpValues).toEqual({ 'uc-p': '0', 'uc-l': 'false' });
    const empty = review({ cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'uc-p': '', 'uc-l': null as unknown as string } })] });
    expect(empty.payload.cols[0].udpValues).toBeUndefined();
  });

  it('cada faceta tiene su check: sin UDPs lógicos viajan solo los físicos (y al revés)', () => {
    const noLogical = review({ options: { ...ALL_COPY, logicalUdps: false } });
    expect(noLogical.payload.table?.udpValues).toEqual({ 'ut-p': 'Si' });
    expect(noLogical.payload.cols[0].udpValues).toEqual({ 'uc-p': 'Si' });
    expect(noLogical.table?.udps.find((u) => u.defId === 'ut-l')?.status).toBe('off');
    const noPhysical = review({ options: { ...ALL_COPY, physicalUdps: false } });
    expect(noPhysical.payload.table?.udpValues).toEqual({ 'ut-l': 'No' });
    expect(noPhysical.payload.cols[0].udpValues).toEqual({ 'uc-l': 'Fuera de la lista' });
  });

  it('dominio: el vigente viaja con sus overrides; uno borrado se quita, con los overrides en false', () => {
    const r = review();
    expect(r.payload.cols[0]).toMatchObject({ parentDomainId: 'd1', typeOverridden: true });
    expect(r.payload.cols[1].parentDomainId).toBeUndefined();
    expect(r.payload.cols[1]).toMatchObject({ typeOverridden: false, logicalTypeOverridden: false });
    expect(r.columns[1].domain?.status).toBe('missing');
    expect(r.warnings).toContain('1 column points to a parent domain that no longer exists — it is pasted without it.');
  });

  it('sin el check de dominios, ninguna columna lo lleva y sus overrides quedan en false', () => {
    const r = review({ options: { ...ALL_COPY, domains: false } });
    expect(r.payload.cols.every((c) => c.parentDomainId === undefined && !c.typeOverridden && !c.logicalTypeOverridden)).toBe(true);
    expect(r.columns[0].domain).toMatchObject({ name: 'Fecha', physicalName: 'FEC', status: 'off' });
  });

  it('la marca FK no viaja; la PK sí', () => {
    const [c1] = review().payload.cols;
    expect(c1.isForeignKey).toBeUndefined();
    expect(c1.isPrimaryKey).toBe(true);
  });

  it('color: el theme vigente viaja; uno borrado se quita con aviso; un color fijo viaja', () => {
    expect(review().payload.table?.color).toBe('theme:th1');
    const gone = review({ table: { ...TABLE, color: 'theme:zz' } });
    expect(gone.payload.table?.color).toBeNull();
    expect(gone.warnings).toContain('The table color uses a theme that no longer exists — it is pasted without color.');
    expect(review({ table: { ...TABLE, color: '#ABCDEF' } }).payload.table?.color).toBe('#ABCDEF');
  });

  it('esquema: el existente con la grafía del destino; uno nuevo se crea; uno de vistas se usa con aviso', () => {
    expect(review().table?.schema).toEqual({ name: 'Core', create: false, viewsKind: false });
    expect(review().payload.table?.schema).toBe('Core');
    const nuevo = review({ table: { ...TABLE, schema: 'stg_nuevo' } });
    expect(nuevo.table?.schema).toEqual({ name: 'stg_nuevo', create: true, viewsKind: false });
    expect(nuevo.payload.createSchema).toEqual({ name: 'stg_nuevo' });
    const vistas = review({ table: { ...TABLE, schema: 'vu' } });
    expect(vistas.table?.schema).toEqual({ name: 'VU', create: false, viewsKind: true });
    expect(vistas.warnings).toContain('Schema «VU» exists in this project as a views schema — the table goes into it.');
    expect(review({ table: { ...TABLE, schema: '  ' } }).table?.schema).toBeNull();
    // Un esquema que contiene tablas y vistas recibe la tabla sin aviso.
    const mixto = review({ table: { ...TABLE, schema: 'MIXTO' } });
    expect(mixto.table?.schema).toEqual({ name: 'Mixto', create: false, viewsKind: false });
    expect(mixto.warnings.some((w) => w.includes('views schema'))).toBe(false);
  });

  it('un esquema que no es un nombre válido no se crea: la tabla lo conserva como texto, con aviso', () => {
    const r = review({ table: { ...TABLE, schema: 'stg-legado' } });
    expect(r.table?.schema).toEqual({ name: 'stg-legado', create: false, viewsKind: false });
    expect(r.payload.createSchema).toBeUndefined();
    expect(r.payload.table?.schema).toBe('stg-legado');
    expect(r.warnings).toContain("«stg-legado» isn't a valid schema name — the table keeps it, but it isn't created as a schema.");
  });

  it('el físico de las columnas sale con el case del destino', () => {
    const r = review();
    expect(r.payload.cols[0].physicalName).toBe('FEC_ALTA');
    expect(r.columns[0]).toMatchObject({ physicalName: 'FEC_ALTA', caseChanged: true });
    expect(r.columns[1].caseChanged).toBe(false);
  });

  it('nombres sobre el tope del destino bloquean (0 = sin tope; cuenta caracteres, no bytes)', () => {
    const long = review({ table: { ...TABLE, physicalName: 'T'.repeat(31) }, cols: [col({ physicalName: 'C'.repeat(21) })] });
    expect(long.blockers).toEqual([
      "The table name «TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT» has 31 characters, over this project's 30-character limit. "
        + 'Shorten it in the source and copy it again, or raise the limit in Data Standards · Glossary.',
      "1 column name is over this project's 20-character limit: CCCCCCCCCCCCCCCCCCCCC. "
        + 'Shorten it in the source and copy it again, or raise the limit in Data Standards · Glossary.',
    ]);
    // 20 caracteres que en JS ocupan 40 unidades: el tope cuenta caracteres, como el backend.
    expect(review({ cols: [col({ physicalName: String.fromCodePoint(0x1F600).repeat(20) })] }).blockers).toEqual([]);
    const off = { ...TARGET, naming: { column: { separator: '' as const, case: 'upper' as const, maxLength: 0 }, table: { separator: '' as const, case: 'upper' as const, maxLength: 0 } } };
    expect(review({ target: off, table: { ...TABLE, physicalName: 'T'.repeat(99) } }).blockers).toEqual([]);
  });

  it('dos columnas que quedan con el mismo físico tras el case bloquean', () => {
    const r = review({ cols: [col({ id: 'a', physicalName: 'cod' }), col({ id: 'b', physicalName: 'COD' })] });
    expect(r.blockers).toEqual(['Columns end up with the same physical name: COD.']);
  });

  it('los checks cuentan los UDPs y dominios distintos que se reutilizan', () => {
    expect(review().counts).toEqual({ logicalUdps: 2, physicalUdps: 2, domains: 1 });
    const twice = review({ cols: [COLS[0], { ...COLS[0], id: 'c9', physicalName: 'OTRA' }] });
    expect(twice.counts).toEqual({ logicalUdps: 2, physicalUdps: 2, domains: 1 });   // mismo UDP y dominio en 2 columnas
  });

  it('sin tabla (pegar columnas) no hay sección de tabla ni payload de tabla', () => {
    const r = review({ table: undefined });
    expect(r.table).toBeNull();
    expect(r.payload.table).toBeUndefined();
    expect(r.payload.cols).toHaveLength(2);
  });

  it('pegar columnas: las omitidas (nombre que ya existe en el destino) se listan pero no viajan ni cuentan', () => {
    const r = review({ table: undefined, skip: new Set(['c2']), cols: [COLS[0], col({ id: 'c2', physicalName: 'C'.repeat(25), parentDomainId: 'deleted' })] });
    expect(r.columns.map((c) => [c.sourceId, c.skipped])).toEqual([['c1', false], ['c2', true]]);
    expect(r.payload.cols.map((c) => c.id)).toEqual(['c1']);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => w.includes('parent domain'))).toBe(false);
    expect(r.counts.domains).toBe(1);
  });
});

describe('reviewPaste — entre proyectos', () => {
  const list = (id: string, name: string, level: 'table' | 'column', view: 'logical' | 'physical', allowedValues: string[]): UdpDefinition =>
    ({ id, name, level, view, dataType: 'list', allowedValues });
  const text = (id: string, name: string): UdpDefinition => ({ id, name, level: 'column', view: 'physical', dataType: 'string', allowedValues: [] });
  const SOURCE = {
    udpDefs: [
      list('ut-p', 'Tipo de Carga', 'table', 'physical', ['Full', 'Delta']), list('ut-l', 'Universal', 'table', 'logical', ['Si', 'No']),
      list('uc-p', 'Particion', 'column', 'physical', ['Si', 'No']), list('uc-l', 'Clasificacion del Dato', 'column', 'logical', ['Interno']),
      text('uc-o', 'Owner'),
    ],
    domains: [
      { id: 'd-fec', name: 'Fecha', defaultDataType: 'DATE', logicalDataType: 'DATE', physicalName: 'FEC' },
      { id: 'd-cod', name: 'Codigo', defaultDataType: 'VARCHAR(30)', logicalDataType: 'VARCHAR(20)' },
    ],
    themes: [{ id: 'th-azul', name: 'Azul', color: '#0070c0' }, { id: 'th-rojo', name: 'Rojo', color: '#C00000' }],
  };
  const DEST: PasteTarget = {
    udpDefs: [
      list('B-ut-p', '  tipo de  carga ', 'table', 'physical', ['FULL', 'Delta']), list('B-ut-l', 'Universal', 'table', 'logical', ['Si', 'No']),
      list('B-uc-p', 'Particion', 'column', 'physical', ['S', 'N']), text('B-o1', 'Owner'), text('B-o2', 'owner'),
    ],
    domains: [{ id: 'B-cod', name: 'codigo', defaultDataType: 'VARCHAR(40)', logicalDataType: 'VARCHAR(20)' }],
    themes: [{ id: 'B-rojo', name: 'rojo', color: '#AA0000' }],
    schemas: [],
    naming: { column: { separator: '_', case: 'lower', maxLength: 30 }, table: { separator: '_', case: 'upper', maxLength: 40 } },
  };
  const T: CanonicalTable = {
    id: 't1', physicalName: 'T_CLIENTE', logicalName: 'Cliente', schema: 'stg', color: 'theme:th-azul',
    udpValues: { 'ut-p': 'full', 'ut-l': 'Si' },
  };
  const C = [
    col({ id: 'c1', physicalName: 'COD_CLIENTE', dataType: 'VARCHAR(30)', logicalDataType: 'VARCHAR(20)', parentDomainId: 'd-cod',
      udpValues: { 'uc-p': 'No', 'uc-l': 'Interno', 'uc-o': 'Juan' } }),
    col({ id: 'c2', physicalName: 'FEC_ALTA', dataType: 'TIMESTAMP', logicalDataType: 'DATE', parentDomainId: 'd-fec', typeOverridden: true }),
  ];
  const cross = (over: Partial<Parameters<typeof reviewPaste>[0]> = {}) => reviewPaste({
    table: T, cols: C, source: SOURCE, target: DEST, sameProject: false, options: ALL_COPY, ...over,
  });

  it('UDP por nombre + nivel + faceta, con el valor validado y escrito como el destino', () => {
    const r = cross();
    expect(r.payload.table?.udpValues).toEqual({ 'B-ut-p': 'FULL', 'B-ut-l': 'Si' });
    expect(r.payload.cols[0].udpValues).toBeUndefined();   // «No» no está en S/N, Clasificacion no existe, Owner es ambiguo
    expect(r.warnings).toEqual(expect.arrayContaining([
      "UDPs that don't exist in this project won't be copied: Clasificacion del Dato (Logical).",
      "UDPs that exist more than once in this project won't be copied: Owner.",
      "Values not allowed in this project won't be copied: Particion = «No».",
    ]));
  });

  it('el emparejamiento respeta la faceta: el mismo nombre en la otra faceta no lo vuelve ambiguo', () => {
    const dest = { ...DEST, udpDefs: [...DEST.udpDefs, list('B-ut-l-fis', 'Universal', 'table', 'physical', ['Si', 'No'])] };
    expect(cross({ target: dest }).payload.table?.udpValues).toEqual({ 'B-ut-p': 'FULL', 'B-ut-l': 'Si' });
  });

  it('un valor de UDP de tabla puesto en una columna no viaja (no aplica a ese nivel)', () => {
    const r = cross({ cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'ut-p': 'full' } })] });
    expect(r.payload.cols[0].udpValues).toBeUndefined();
    expect(r.warnings).toContain("1 UDP value belongs to a UDP that no longer exists or doesn't apply here — it won't be copied.");
  });

  it('con el check de la faceta apagado no se avisa lo que de todos modos no viajaba', () => {
    const r = cross({ options: { ...ALL_COPY, logicalUdps: false, physicalUdps: false } });
    expect(r.payload.table?.udpValues).toBeUndefined();
    expect(r.warnings.some((w) => w.startsWith('UDPs') || w.startsWith('Values'))).toBe(false);
  });

  it('dominio por nombre: el del destino viaja con los overrides recalculados contra él; el que no existe se quita', () => {
    const r = cross();
    expect(r.payload.cols[0]).toMatchObject({ parentDomainId: 'B-cod', typeOverridden: true, logicalTypeOverridden: false });
    expect(r.payload.cols[1]).toMatchObject({ parentDomainId: undefined, typeOverridden: false, logicalTypeOverridden: false });
    expect(r.columns[0].domain).toMatchObject({ id: 'B-cod', name: 'codigo', status: 'copy' });
    expect(r.warnings).toEqual(expect.arrayContaining([
      "Parent domains that don't exist in this project: Fecha — those columns are pasted without a domain.",
      'Parent domain «codigo» exists here with another type (VARCHAR(40)) — the copied columns keep their own type.',
    ]));
  });

  it('un dominio que existe dos veces en el destino no se elige: la columna va sin dominio', () => {
    const dest = { ...DEST, domains: [...DEST.domains, { id: 'B-cod2', name: 'CODIGO ', defaultDataType: 'VARCHAR(30)' }] };
    const r = cross({ target: dest });
    expect(r.payload.cols[0]).toMatchObject({ parentDomainId: undefined, typeOverridden: false });
    expect(r.warnings).toContain('Parent domains that exist more than once in this project: Codigo — those columns are pasted without a domain.');
  });

  it('theme por nombre; si no existe, el mismo color como color fijo', () => {
    const azul = cross();
    expect(azul.payload.table?.color).toBe('#0070C0');
    expect(azul.warnings).toContain("Theme «Azul» doesn't exist in this project — the table gets its color as a fixed color (#0070C0).");
    expect(cross({ table: { ...T, color: 'theme:th-rojo' } }).payload.table?.color).toBe('theme:B-rojo');
    expect(cross({ table: { ...T, color: 'theme:gone' } }).payload.table?.color).toBeNull();
  });

  it('esquema y nombres con las reglas del destino', () => {
    const r = cross();
    expect(r.payload.createSchema).toEqual({ name: 'stg' });
    expect(r.payload.cols.map((c) => c.physicalName)).toEqual(['cod_cliente', 'fec_alta']);
  });

  it('los checks cuentan lo que existe en el destino', () => {
    expect(cross().counts).toEqual({ logicalUdps: 1, physicalUdps: 1, domains: 1 });
  });

  it('si no se pueden leer los estándares del origen, solo viaja lo que no los necesita', () => {
    const r = cross({ sourceUnavailable: true, sourceName: 'Modelo A', table: { ...T, color: '#123456' } });
    expect(r.payload.table?.udpValues).toBeUndefined();
    expect(r.payload.table?.color).toBe('#123456');
    expect(r.payload.cols.every((c) => !c.parentDomainId && !c.udpValues)).toBe(true);
    expect(r.warnings).toEqual(["The standards of «Modelo A» can't be read — its UDPs, parent domains and theme colors won't be copied."]);
  });

  it('dos UDP del origen que caen en el mismo del destino con valores distintos: no viaja ninguno y se avisa', () => {
    const source = { ...SOURCE, udpDefs: [...SOURCE.udpDefs, text('uc-o2', 'OWNER')] };
    const dest = { ...DEST, udpDefs: DEST.udpDefs.filter((d) => d.id !== 'B-o2') };   // un solo «Owner» en B
    const r = cross({ source, target: dest, cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'uc-o': 'Juan', 'uc-o2': 'Pedro' } })] });
    expect(r.payload.cols[0].udpValues).toBeUndefined();
    expect(r.warnings).toContain("UDPs of the source that match the same UDP here with different values won't be copied: Owner.");
    const off = cross({ source, target: dest, options: { ...ALL_COPY, physicalUdps: false },
      cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'uc-o': 'Juan', 'uc-o2': 'Pedro' } })] });
    expect(off.warnings.some((w) => w.includes('different values'))).toBe(false);   // su check apagado: no se avisa
    expect(off.counts).toEqual(r.counts);                                            // ni cambian los conteos
  });

  it('dos UDP del origen que caen en el mismo del destino con el mismo valor: viaja una vez', () => {
    const source = { ...SOURCE, udpDefs: [...SOURCE.udpDefs, text('uc-o2', 'OWNER')] };
    const dest = { ...DEST, udpDefs: DEST.udpDefs.filter((d) => d.id !== 'B-o2') };
    const r = cross({ source, target: dest, cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'uc-o': 'Juan', 'uc-o2': 'Juan' } })] });
    expect(r.payload.cols[0].udpValues).toEqual({ 'B-o1': 'Juan' });
    expect(r.columns[0].udps.filter((u) => u.status === 'copy')).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('different values'))).toBe(false);
  });

  it('un valor que el destino no admite no cuenta aunque su check esté apagado: los conteos no cambian al tocarlo', () => {
    const on = cross();
    const off = cross({ options: { ...ALL_COPY, physicalUdps: false } });
    expect(off.counts.physicalUdps).toBe(on.counts.physicalUdps);
    expect(off.columns[0].udps.find((u) => u.name === 'Particion')?.status).toBe('missing');
    expect(off.warnings.some((w) => w.startsWith('Values'))).toBe(false);
  });

  it('un theme que existe dos veces en el destino no se elige: va su color fijo, con aviso', () => {
    const source = { ...SOURCE, themes: [{ id: 'th-ac', name: 'Azul Claro', color: '#9DC3E6' }] };
    const dest = { ...DEST, themes: [{ id: 'B-ac1', name: 'Azul  Claro', color: '#111111' }, { id: 'B-ac2', name: 'azul claro', color: '#222222' }] };
    const r = cross({ source, target: dest, table: { ...T, color: 'theme:th-ac' } });
    expect(r.payload.table?.color).toBe('#9DC3E6');
    expect(r.warnings).toContain('Theme «Azul Claro» exists more than once in this project — the table gets its color as a fixed color (#9DC3E6).');
  });

  it('el aviso de «otro tipo» compara el dominio de los dos proyectos, no la columna', () => {
    // «Codigo» VARCHAR(30) en A y en B; la columna, VARCHAR(50) con su override.
    const dest = { ...DEST, domains: [{ id: 'B-cod', name: 'codigo', defaultDataType: 'VARCHAR(30)', logicalDataType: 'VARCHAR(20)' }] };
    const r = cross({ target: dest, cols: [col({ id: 'c9', physicalName: 'COD_X', dataType: 'VARCHAR(50)', parentDomainId: 'd-cod', typeOverridden: true })] });
    expect(r.payload.cols[0]).toMatchObject({ parentDomainId: 'B-cod', typeOverridden: true });
    expect(r.warnings.some((w) => w.includes('exists here with another type'))).toBe(false);
  });

  it('el aviso de «otro tipo» nombra la faceta que difiere', () => {
    const logical = { ...DEST, domains: [{ id: 'B-cod', name: 'codigo', defaultDataType: 'VARCHAR(30)', logicalDataType: 'VARCHAR(25)' }] };
    expect(cross({ target: logical }).warnings)
      .toContain('Parent domain «codigo» exists here with another type (logical VARCHAR(25)) — the copied columns keep their own type.');
    const both = { ...DEST, domains: [{ id: 'B-cod', name: 'codigo', defaultDataType: 'VARCHAR(40)', logicalDataType: 'VARCHAR(25)' }] };
    expect(cross({ target: both }).warnings)
      .toContain('Parent domain «codigo» exists here with another type (VARCHAR(40), logical VARCHAR(25)) — the copied columns keep their own type.');
    const noLogical = { ...DEST, domains: [{ id: 'B-cod', name: 'codigo', defaultDataType: 'VARCHAR(30)' }] };
    expect(cross({ target: noLogical }).warnings)
      .toContain('Parent domain «codigo» exists here with another type (no logical type) — the copied columns keep their own type.');
  });

  it('los nombres se emparejan sin tildes, como la carga Excel (`norm_name`)', () => {
    const dest = {
      ...DEST,
      udpDefs: [...DEST.udpDefs, list('B-uc-l', 'Clasificación del dato', 'column', 'logical', ['INTERNO'])],
      domains: [{ id: 'B-fec', name: 'Fécha', defaultDataType: 'DATE', logicalDataType: 'DATE' }, ...DEST.domains],
      themes: [{ id: 'B-az', name: 'AZÚL', color: '#000000' }],
    };
    const r = cross({ target: dest });
    expect(r.payload.cols[0].udpValues).toEqual({ 'B-uc-l': 'INTERNO' });
    expect(r.payload.cols[1].parentDomainId).toBe('B-fec');
    expect(r.payload.table?.color).toBe('theme:B-az');
  });

  it('un valor de UDP que no es texto se valida como texto, sin romper', () => {
    const dest = { ...DEST, udpDefs: DEST.udpDefs.filter((d) => d.id !== 'B-o2') };
    const r = cross({ target: dest, cols: [col({ id: 'c9', physicalName: 'X', udpValues: { 'uc-o': 7 as unknown as string } })] });
    expect(r.payload.cols[0].udpValues).toEqual({ 'B-o1': '7' });
  });

  it('sin los estándares del origen no se busca su theme en lo que se pase como origen', () => {
    // Los popups pasan los del destino como origen cuando no hay del origen.
    const r = cross({ sourceUnavailable: true, sourceName: 'Modelo A', source: DEST, table: { ...T, color: 'theme:B-rojo' } });
    expect(r.payload.table?.color).toBeNull();
    expect(r.warnings).toEqual(["The standards of «Modelo A» can't be read — its UDPs, parent domains and theme colors won't be copied."]);
  });
});
