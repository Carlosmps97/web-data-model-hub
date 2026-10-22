import { describe, it, expect } from 'vitest';
import { crc32, buildZip } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);

describe('crc32', () => {
  it('coincide con el valor de verificación estándar', () => {
    // El CRC-32 de "123456789" es 0xCBF43926 (valor de verificación conocido).
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });
  it('es 0 para una entrada vacía', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('buildZip', () => {
  it('produce un archivo STORE bien formado con varias entradas', async () => {
    const blob = buildZip([
      { path: 'CLIENTE/TABLE-CLIENTE.sql', content: 'CREATE TABLE cliente;' },
      { path: 'CLIENTE/VIEW_NEG-VW_X.sql', content: 'CREATE VIEW vw_x;' },
    ]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Firma del encabezado de archivo local al inicio.
    expect(Array.from(buf.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // El EOCD son los últimos 22 bytes (sin comentario de archivo).
    const eocd = buf.slice(buf.length - 22);
    expect(Array.from(eocd.slice(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(u16(eocd, 10)).toBe(2); // total de entradas
    // Las dos rutas aparecen tal cual en los bytes del archivo.
    const whole = new TextDecoder().decode(buf);
    expect(whole).toContain('CLIENTE/TABLE-CLIENTE.sql');
    expect(whole).toContain('CLIENTE/VIEW_NEG-VW_X.sql');
    expect(whole).toContain('CREATE TABLE cliente;');
  });

  it('maneja una sola entrada', async () => {
    const blob = buildZip([{ path: 'a/b.sql', content: 'x' }]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const eocd = buf.slice(buf.length - 22);
    expect(u16(eocd, 10)).toBe(1);
  });
});
