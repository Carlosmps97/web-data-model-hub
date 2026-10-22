import { describe, expect, it } from 'vitest';
import { domainEditInput } from './domainForm';
import type { SnapshotDomain } from './standards.service';

const form: SnapshotDomain = {
  id: 'd1', name: ' Codigo Clave ', defaultDataType: ' INTEGER ', logicalDataType: '', namingTerm: '', description: '',
  inheritsName: false, physicalName: null, physicalDescription: null, udpValues: null,
};
const stored: SnapshotDomain = { ...form, name: 'Codigo Clave', description: 'agregada después', namingTerm: 'Codigo' };

describe('domainEditInput (el revert aplica lo que muestra el formulario)', () => {
  it('un texto que el formulario vació viaja como "" y lo limpia (el backend ignora los ausentes)', () => {
    expect(domainEditInput({ ...form, description: null, namingTerm: '' }, stored)).toMatchObject({
      id: 'd1', name: 'Codigo Clave', defaultDataType: 'INTEGER', description: '', namingTerm: '',
      physicalName: '', physicalDescription: '', udpValues: {}, inheritsName: false,
    });
  });
  it('vacío en el formulario y ya vacío guardado: no viaja (no convierte null en "" ni ensucia el historial)', () => {
    const out = domainEditInput(form, { ...stored, description: null, namingTerm: null });
    expect(out.description).toBeUndefined();
    expect(out.namingTerm).toBeUndefined();
  });
  it('un texto con valor viaja tal cual', () => {
    expect(domainEditInput({ ...form, description: 'nueva', namingTerm: ' Cod ' }, stored))
      .toMatchObject({ description: 'nueva', namingTerm: 'Cod' });
  });
  it('el tipo lógico vacío no viaja: un tipo nunca se cascadea a vacío', () => {
    expect(domainEditInput(form, stored).logicalDataType).toBeUndefined();
    expect(domainEditInput({ ...form, logicalDataType: ' NUMBER ' }, stored).logicalDataType).toBe('NUMBER');
  });
  it('al crear (sin dominio guardado) no manda id ni textos vacíos', () => {
    const out = domainEditInput(form, null);
    expect(out.id).toBeUndefined();
    expect(out.description).toBeUndefined();
  });
});
