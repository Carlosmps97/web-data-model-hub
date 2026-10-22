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
  applyErrorNotice, ddlConfigChanged, domainChanged, lookupRow, NO_CHANGES, outputChanged, ruleChanged, udpChanged,
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
    id: 'r1', name: 'tag_dac', description: null, kind: 'rule', target: 'column', sourceArtifact: null,
    condition: "columna.udp[\"Clasificacion\"] LIKE 'DAC-%'", udpRefs: [{ udpId: 'u1', level: 'column' }],
    action: { tags: { clasificacion: '{udp:Clasificacion}', dominio: 'X' } }, appliesTo: ['ddl.tabla', 'ddl.vista_negocio'],
    priority: 100, enabled: true, validationState: 'valid', validationReport: {},
  };
  const draftOf = (r: DdlRule) => ({
    id: r.id, name: r.name, description: r.description ?? undefined, kind: r.kind, target: r.target ?? undefined,
    sourceArtifact: r.sourceArtifact ?? undefined, condition: r.condition, udpRefs: r.udpRefs, action: r.action,
    appliesTo: r.appliesTo, priority: r.priority, enabled: r.enabled,
  });
  it('alta: siempre es un cambio', () => {
    expect(ruleChanged(draftOf(stored), null)).toBe(true);
  });
  it('sin tocar (orden de claves, destinos reordenados, udpRefs del servidor, descripción ausente ≡ vacía): no', () => {
    expect(ruleChanged(draftOf(stored), stored)).toBe(false);
    expect(ruleChanged({ ...draftOf(stored), action: { tags: { dominio: 'X', clasificacion: '{udp:Clasificacion}' } } }, stored)).toBe(false);
    expect(ruleChanged({ ...draftOf(stored), appliesTo: ['ddl.vista_negocio', 'ddl.tabla'] }, stored)).toBe(false);
    expect(ruleChanged({ ...draftOf(stored), udpRefs: [], description: '' }, stored)).toBe(false);
  });
  it('condición, acción, destinos, prioridad o estado: sí', () => {
    const d = draftOf(stored);
    expect(ruleChanged({ ...d, condition: "columna.udp[\"Clasificacion\"] = 'DAC'" }, stored)).toBe(true);
    expect(ruleChanged({ ...d, action: { tags: { clasificacion: '{udp:Clasificacion}' } } }, stored)).toBe(true);
    expect(ruleChanged({ ...d, appliesTo: ['ddl.tabla'] }, stored)).toBe(true);
    expect(ruleChanged({ ...d, priority: 50 }, stored)).toBe(true);
    expect(ruleChanged({ ...d, enabled: false }, stored)).toBe(true);
    expect(ruleChanged({ ...d, name: 'tag_dac_v2' }, stored)).toBe(true);
  });
  it('guardada invalid/stale y sin tocar: re-guardarla sí es un cambio (el backend graba la validación recalculada)', () => {
    // Caso: reglas del seed/one-shot grabadas sin que el proyecto tuviera sus
    // UDPs. Hoy validan, pero el export las salta: re-guardarlas es la salida.
    expect(ruleChanged(draftOf(stored), { ...stored, validationState: 'invalid' })).toBe(true);
    expect(ruleChanged(draftOf(stored), { ...stored, validationState: 'stale' })).toBe(true);
  });
});

describe('lookups y funciones', () => {
  const config: DdlRulesetConfig = {
    lookups: {
      nivel: { fromUdpId: 'u1', fromLevel: 'column', values: { DAC: 'sha2', 'No DAC': null }, default: null },
      pais: { fromUdpId: 'u2', fromLevel: 'table', values: {}, default: 'PE' },
    },
    functions: [{ name: 'mask', params: ['col', 'nivel'], body: 'CASE WHEN 1 THEN {col} END' }],
    output: {},
  };
  const clone = () => structuredClone(config);
  it('sin tocar, u «output vacío» escrito como null o como ausente (sin default): no es un cambio', () => {
    expect(ddlConfigChanged(clone().lookups, clone().functions, config)).toBe(false);
    const l = clone().lookups;
    l.nivel.values = { DAC: 'sha2' };                        // default null: null ≡ ausente (ninguno emite)
    l.pais = { values: {}, default: 'PE', fromLevel: 'table', fromUdpId: 'u2' };   // otro orden de claves
    expect(ddlConfigChanged({ pais: l.pais, nivel: l.nivel }, clone().functions, config)).toBe(false);
    // un default ausente ≡ null (el backend lee `lk.get("default")`)
    const noDefault = clone().lookups.nivel;
    delete noDefault.default;
    expect(ddlConfigChanged({ ...clone().lookups, nivel: noDefault }, clone().functions, config)).toBe(false);
  });
  it('con default, «nada» (null) no es «sin mapear»: el valor deja de emitir el default (backend `_resolve_lookup`)', () => {
    const l = () => clone().lookups;
    // es un cambio: el botón no queda en «No changes to apply»
    expect(ddlConfigChanged({ ...l(), pais: { ...l().pais, values: { X: null } } }, clone().functions, config)).toBe(true);
    // y al revés: lo guardado mapeado a «nada» que vuelve a heredar el default
    const pinned: DdlRulesetConfig = { ...config, lookups: { ...l(), pais: { ...l().pais, values: { X: null } } } };
    expect(ddlConfigChanged(l(), clone().functions, pinned)).toBe(true);
    // '' se emite (vacío), null no: tampoco son lo mismo, ni en un valor ni en el default
    expect(ddlConfigChanged({ ...l(), nivel: { ...l().nivel, values: { DAC: 'sha2', X: '' } } }, clone().functions, config)).toBe(true);
    expect(ddlConfigChanged({ ...l(), nivel: { ...l().nivel, default: '' } }, clone().functions, config)).toBe(true);
  });
  it('un valor, el default, el UDP de origen, una alta/baja de lookup o una función distinta: sí', () => {
    const l = () => clone().lookups;
    expect(ddlConfigChanged({ ...l(), nivel: { ...l().nivel, values: { DAC: 'md5' } } }, clone().functions, config)).toBe(true);
    expect(ddlConfigChanged({ ...l(), pais: { ...l().pais, default: null } }, clone().functions, config)).toBe(true);
    expect(ddlConfigChanged({ ...l(), nivel: { ...l().nivel, fromUdpId: 'u9' } }, clone().functions, config)).toBe(true);
    expect(ddlConfigChanged({ nivel: l().nivel }, clone().functions, config)).toBe(true);
    expect(ddlConfigChanged(l(), [], config)).toBe(true);
    expect(ddlConfigChanged(l(), [{ ...clone().functions[0], body: 'CASE WHEN 2 THEN {col} END' }], config)).toBe(true);
  });
});

describe('lookupRow: qué dice cada fila del editor de lookups (espejo de `_resolve_lookup`)', () => {
  const lk = (values: Record<string, string | null>, dflt: string | null = 'PE') =>
    ({ fromUdpId: 'u1', fromLevel: 'table' as const, values, default: dflt });
  it('con default: sin mapear emite el default (y se puede pasar a «nada»); «nada» no emite (y se puede des-mapear)', () => {
    expect(lookupRow(lk({}), 'A')).toEqual({ placeholder: '— default (PE)', action: 'nothing' });
    expect(lookupRow(lk({ A: null }), 'A')).toEqual({ placeholder: '— nothing (not emitted)', action: 'unmap' });
    expect(lookupRow(lk({ A: 'X' }), 'A').action).toBe('unmap');
    expect(lookupRow(lk({ A: '' }), 'A')).toEqual({ placeholder: "— empty value ('')", action: 'unmap' });
  });
  it('sin default: sin mapear y «nada» no emiten (son lo mismo) — no se ofrece una acción que no cambia nada', () => {
    expect(lookupRow(lk({}, null), 'A')).toEqual({ placeholder: '— nothing (not emitted)', action: null });
    expect(lookupRow(lk({ A: null }, null), 'A')).toEqual({ placeholder: '— nothing (not emitted)', action: null });
    expect(lookupRow(lk({ A: 'X' }, null), 'A').action).toBe('unmap');
  });
  it('un valor como «constructor» no se confunde con el prototipo', () => {
    expect(lookupRow(lk({}), 'constructor')).toEqual({ placeholder: '— default (PE)', action: 'nothing' });
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
