import { describe, expect, it } from 'vitest';
import { foldComplexType } from './typeText';

describe('foldComplexType (doc 92 D6)', () => {
  it('pliega saltos de línea y tabulaciones a un espacio', () => {
    const erwin = 'Array \n<\n\tstruct <\n\tcodcampania: varchar(30),\n\tfecsolicitud: date\n\t>\n>';
    expect(foldComplexType(erwin)).toBe('Array < struct < codcampania: varchar(30), fecsolicitud: date > >');
  });
  it('deja intactos casing y espacios simples (verbatim F4 #6)', () => {
    expect(foldComplexType('array<struct<id:int, tags:map<string,string>>>')).toBe('array<struct<id:int, tags:map<string,string>>>');
    expect(foldComplexType('DECIMAL(10,2)')).toBe('DECIMAL(10,2)');
  });
  it('tolera vacío', () => {
    expect(foldComplexType('')).toBe('');
  });
});
