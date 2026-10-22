import { describe, expect, it } from 'vitest';
import { udpValueFor } from './udpValue';

const def = (dataType: string, allowedValues: string[] = []) => ({ dataType, allowedValues });

describe('udpValueFor — la regla de la carga Excel (bulk_upload/standards.udp_value)', () => {
  it('lista: sin bordes, espacios internos colapsados y sin mayúsculas → la grafía del destino', () => {
    const d = def('list', ['FULL', 'Delta Diaria']);
    expect(udpValueFor(d, 'full')).toBe('FULL');
    expect(udpValueFor(d, '  delta   DIARIA ')).toBe('Delta Diaria');
    expect(udpValueFor(d, 'Incremental')).toBeNull();
    expect(udpValueFor(def('list', []), 'x')).toBeNull();
  });

  it('número: finito y en su forma canónica', () => {
    expect(udpValueFor(def('number'), ' 10.50 ')).toBe('10.5');
    expect(udpValueFor(def('number'), '007')).toBe('7');
    expect(udpValueFor(def('number'), '1e3')).toBe('1000');
    for (const bad of ['abc', 'nan', 'inf', '1_000', '']) expect(udpValueFor(def('number'), bad)).toBeNull();
  });

  it('fecha: ISO real; de una fecha-hora, solo la fecha', () => {
    expect(udpValueFor(def('date'), '2024-02-29')).toBe('2024-02-29');
    expect(udpValueFor(def('date'), '2024-03-01T10:30')).toBe('2024-03-01');
    expect(udpValueFor(def('date'), '2024-03-01 10:30:59')).toBe('2024-03-01');
    for (const bad of ['2023-02-29', '31/01/2024', '2024-13-01', '2024-03-01T25:00']) expect(udpValueFor(def('date'), bad)).toBeNull();
    expect(udpValueFor(def('date'), '0050-06-15')).toBe('0050-06-15');   // los años 0001-0099 también
    expect(udpValueFor(def('date'), '0000-01-01')).toBeNull();            // el año 0 no existe
  });

  it('un valor o una opción que no son texto (dato guardado con otro tipo) se tratan como texto', () => {
    expect(udpValueFor(def('number'), 12 as unknown as string)).toBe('12');
    expect(udpValueFor(def('list', [1 as unknown as string, 'B']), '1')).toBe('1');
    expect(udpValueFor(def('string'), 5 as unknown as string)).toBe('5');
  });

  it('booleano: las grafías reconocidas → «true»/«false»', () => {
    for (const yes of ['true', 'Sí', 'si', ' YES ', '1', 'verdadero']) expect(udpValueFor(def('boolean'), yes)).toBe('true');
    for (const no of ['false', 'No', '0', 'falso']) expect(udpValueFor(def('boolean'), no)).toBe('false');
    expect(udpValueFor(def('boolean'), 'quizás')).toBeNull();
  });

  it('texto (o tipo desconocido): tal cual', () => {
    expect(udpValueFor(def('string'), '  Juan  ')).toBe('  Juan  ');
    expect(udpValueFor({ dataType: undefined as never, allowedValues: [] }, 'x')).toBe('x');
  });
});
