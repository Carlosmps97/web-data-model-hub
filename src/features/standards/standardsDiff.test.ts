// ¿El guardado de una pantalla de Data Standards cambia algo? Cinco pantallas
// habilitan su botón solo con un cambio real (un guardado sin diff registraría
// una versión vacía; el backend responde 422 «There are no changes to apply.»).
// Se compara lo que se enviaría contra lo vigente, normalizado igual que el envío.
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/services/http';
import { mergeOutputSettings } from '@/features/ddl';
import { revertForm } from './domainHistory';
import type { DdlRule, DdlRulesetConfig, DomainHistoryEntry, SnapshotDomain, UdpDefinition } from './standards.service';
import {
  applyErrorNotice, ddlConfigChanged, domainChanged, NO_CHANGES, outputChanged, ruleChanged, udpChanged,
  udpEditInput, udpFormOf,
} from './standardsDiff';

describe('aviso de un apply fallido', () => {
  it('el 422 «sin cambios» es un aviso neutro; cualquier otro error, rojo', () => {
    expect(applyErrorNotice(new ApiError(NO_CHANGES, 422), "Couldn't apply")).toEqual({ kind: 'info', text: 'There are no changes to apply.' });
    expect(applyErrorNotice(new ApiError('Every rule needs a name.', 422), "Couldn't apply")).toEqual({ kind: 'error', text: 'Every rule needs a name.' });
    expect(applyErrorNotice(new ApiError('There are no changes to apply.', 409), 'x')).toEqual({ kind: 'error', text: 'There are no changes to apply.' });
    expect(applyErrorNotice('boom', "Couldn't apply")).toEqual({ kind: 'error', text: "Couldn't apply" });
  });
});

describe('dominio', () => {
  const stored: SnapshotDomain = {
    id: 'd1', name: 'Codigo Clave', defaultDataType: 'INTEGER', logicalDataType: 'NUMBER', namingTerm: null,
    description: 'Clave del cliente', inheritsName: false, physicalName: null, physicalDescription: null,
    udpValues: { u1: 'DAC', u2: 'X' },
  };
  it('alta: siempre es un cambio', () => {
    expect(domainChanged({ ...stored, id: '' }, null)).toBe(true);
  });
  it('sin tocar, o tocado solo como lo normaliza el envío: no es un cambio', () => {
    expect(domainChanged({ ...stored }, stored)).toBe(false);
    expect(domainChanged({ ...stored, name: ' Codigo Clave ', defaultDataType: ' INTEGER ' }, stored)).toBe(false);
    expect(domainChanged({ ...stored, namingTerm: '', physicalName: '  ', physicalDescription: '' }, stored)).toBe(false);   // ausente ≡ vacío
    expect(domainChanged({ ...stored, logicalDataType: '' }, stored)).toBe(false);   // un tipo nunca se cascadea a vacío
    expect(domainChanged({ ...stored, udpValues: { u2: 'X', u1: 'DAC' } }, stored)).toBe(false);   // orden de claves
    expect(domainChanged({ ...stored, udpValues: null }, { ...stored, udpValues: {} })).toBe(false);
    // un UDP guardado vacío ≡ sin valor: UdpAssign borra la clave al vaciar
    expect(domainChanged({ ...stored }, { ...stored, udpValues: { u1: 'DAC', u2: 'X', u3: '' } })).toBe(false);
  });
  it('un cambio real en cualquier campo, o vaciar un texto guardado, sí lo es', () => {
    expect(domainChanged({ ...stored, name: 'Codigo Clave Cliente' }, stored)).toBe(true);
    expect(domainChanged({ ...stored, defaultDataType: 'BIGINT' }, stored)).toBe(true);
    expect(domainChanged({ ...stored, logicalDataType: 'TEXT' }, stored)).toBe(true);
    expect(domainChanged({ ...stored, description: '' }, stored)).toBe(true);   // lo limpia
    expect(domainChanged({ ...stored, namingTerm: 'Codigo' }, stored)).toBe(true);
    expect(domainChanged({ ...stored, physicalName: 'CODCLAVE' }, stored)).toBe(true);
    expect(domainChanged({ ...stored, inheritsName: true }, stored)).toBe(true);
    expect(domainChanged({ ...stored, udpValues: { u1: 'No DAC', u2: 'X' } }, stored)).toBe(true);
  });
  it('revertir a una versión igual a la vigente no es un cambio; a una distinta, sí', () => {
    const entry = (state: Partial<SnapshotDomain>): DomainHistoryEntry => ({
      seq: 3, label: 'v3', title: 't', author: 'ana', kind: 'domain', changed: [],
      state: { ...stored, ...state } as DomainHistoryEntry['state'],
    });
    expect(domainChanged(revertForm(stored, entry({})), stored)).toBe(false);
    expect(domainChanged(revertForm(stored, entry({ logicalDataType: null })), stored)).toBe(false);
    expect(domainChanged(revertForm(stored, entry({ defaultDataType: 'SMALLINT' })), stored)).toBe(true);
  });
});

describe('UDP', () => {
  const seg = { level: 'column' as const, view: 'physical' as const };
  const stored: UdpDefinition = {
    id: 'u1', name: 'Clasificacion', level: 'column', view: 'physical', dataType: 'list',
    defaultValue: 'No DAC', allowedValues: ['DAC', 'No DAC'], description: null,
  };
  it('alta: siempre es un cambio', () => {
    expect(udpChanged({ ...udpFormOf(stored), id: undefined }, seg, null)).toBe(true);
  });
  it('sin tocar, o con recortes y líneas vacías que el envío descarta: no es un cambio', () => {
    expect(udpChanged(udpFormOf(stored), seg, stored)).toBe(false);
    expect(udpChanged({ ...udpFormOf(stored), name: ' Clasificacion ', allowedValues: ['DAC ', '', ' No DAC', ''], description: '  ' }, seg, stored)).toBe(false);
  });
  it('nombre, tipo, valores, su orden, el default o la descripción: sí', () => {
    const f = udpFormOf(stored);
    expect(udpChanged({ ...f, name: 'Clasificación' }, seg, stored)).toBe(true);
    expect(udpChanged({ ...f, dataType: 'string' }, seg, stored)).toBe(true);
    expect(udpChanged({ ...f, allowedValues: ['No DAC', 'DAC'] }, seg, stored)).toBe(true);
    expect(udpChanged({ ...f, defaultValue: 'DAC' }, seg, stored)).toBe(true);
    expect(udpChanged({ ...f, description: 'Nivel de sensibilidad' }, seg, stored)).toBe(true);
  });
  it('vaciar un default o una descripción guardados viaja como "" (así se pueden limpiar)', () => {
    const cleared = { ...udpFormOf({ ...stored, description: 'algo' }), defaultValue: '', description: '' };
    expect(udpChanged(cleared, seg, { ...stored, description: 'algo' })).toBe(true);
    expect(udpEditInput(cleared, seg, { ...stored, description: 'algo' })).toMatchObject({ defaultValue: '', description: '' });
    // vacío y ya vacío: no viaja
    expect(udpEditInput({ ...udpFormOf(stored), description: '' }, seg, stored).description).toBeUndefined();
    expect(udpEditInput({ ...udpFormOf(stored), id: undefined }, seg, null)).toMatchObject({ id: undefined, name: 'Clasificacion', level: 'column', view: 'physical' });
  });
});

describe('regla de DDL', () => {
  const stored: DdlRule = {
    id: 'r1', name: 'tabla_fisica', description: null, scope: 'table', when: "tabla.udp['DAC'] == 'DAC'",
    files: [{ name: '{{ tabla.carpeta }}/TABLE-{{ tabla.nombre }}.sql', content: 'CREATE TABLE {{ tabla.nombre }};' }],
    order: 2, enabled: true, updatedBy: 'otro',
  };
  const draftOf = (r: DdlRule) => ({
    id: r.id, name: r.name, description: r.description ?? undefined, scope: r.scope, when: r.when,
    files: r.files.map((f) => ({ ...f })), order: r.order, enabled: r.enabled,
  });
  it('alta: siempre es un cambio', () => {
    expect(ruleChanged(draftOf(stored), null)).toBe(true);
  });
  it('sin tocar (quién guardó, descripción ausente ≡ vacía): no', () => {
    expect(ruleChanged(draftOf(stored), stored)).toBe(false);
    expect(ruleChanged({ ...draftOf(stored), description: '' }, { ...stored, updatedBy: 'ana' })).toBe(false);
  });
  it('nombre, para cada, cuándo, archivos, posición o estado: sí', () => {
    const d = draftOf(stored);
    expect(ruleChanged({ ...d, name: 'tabla_fisica_v2' }, stored)).toBe(true);
    expect(ruleChanged({ ...d, scope: 'view' }, stored)).toBe(true);
    expect(ruleChanged({ ...d, when: '' }, stored)).toBe(true);
    expect(ruleChanged({ ...d, files: [{ ...d.files[0], content: 'CREATE TABLE x;' }] }, stored)).toBe(true);
    expect(ruleChanged({ ...d, files: [...d.files, { name: 'b.sql', content: '' }] }, stored)).toBe(true);
    expect(ruleChanged({ ...d, order: 0 }, stored)).toBe(true);
    expect(ruleChanged({ ...d, enabled: false }, stored)).toBe(true);
  });
});

describe('piezas y variables', () => {
  const config: DdlRulesetConfig = { pieces: "{% set DAC = 'Clasificacion del Dato' %}", variables: { a: '1', b: '2' }, output: {} };
  it('sin tocar (otro orden de las variables): no es un cambio', () => {
    expect(ddlConfigChanged(config.pieces, { b: '2', a: '1' }, config)).toBe(false);
  });
  it('las piezas, un valor, una variable más o menos: sí', () => {
    expect(ddlConfigChanged(`${config.pieces}\n`, config.variables, config)).toBe(true);
    expect(ddlConfigChanged(config.pieces, { a: '1', b: '3' }, config)).toBe(true);
    expect(ddlConfigChanged(config.pieces, { a: '1' }, config)).toBe(true);
    expect(ddlConfigChanged(config.pieces, { ...config.variables, c: '' }, config)).toBe(true);
  });
});

describe('Output settings', () => {
  const stored = { identifierCase: 'lower', external: true, location: 's3://x/{schema}', fileNames: { nameCase: 'upper' } };
  it('lo guardado (con sus defaults) sin tocar no es un cambio; sin nada guardado, los defaults tampoco', () => {
    expect(outputChanged(mergeOutputSettings(stored), stored)).toBe(false);
    expect(outputChanged(mergeOutputSettings(null), undefined)).toBe(false);
  });
  it('cualquier ajuste (Databricks, Oracle, archivos o dialecto): sí', () => {
    const v = mergeOutputSettings(stored);
    expect(outputChanged({ ...v, identifierCase: 'upper' }, stored)).toBe(true);
    expect(outputChanged({ ...v, dialect: 'oracle' }, stored)).toBe(true);
    expect(outputChanged({ ...v, fileNames: { ...v.fileNames, nameCase: 'lower' } }, stored)).toBe(true);
    expect(outputChanged({ ...v, oracle: { ...v.oracle, includeComments: true } }, stored)).toBe(true);
  });
  it('un proyecto con el mapeo de tipos o el tamaño máximo guardados no aparece «con cambios» al abrirlo', () => {
    const viejo = { ...stored, oracle: { typeMap: [{ from: 'DATETIME', to: 'DATE' }], maxStringSize: 'extended' } };
    expect(outputChanged(mergeOutputSettings(viejo), viejo)).toBe(false);
  });
});
