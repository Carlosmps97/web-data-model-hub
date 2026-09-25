import { describe, it, expect } from 'vitest';
import { crc32, buildZip } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);

describe('crc32', () => {
  it('matches the standard check vector', () => {
    // CRC-32 of "123456789" is 0xCBF43926 (well-known check value).
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });
  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('buildZip', () => {
  it('produces a well-formed STORE archive for multiple entries', async () => {
    const blob = buildZip([
      { path: 'CLIENTE/TABLE-CLIENTE.sql', content: 'CREATE TABLE cliente;' },
      { path: 'CLIENTE/VIEW_NEG-VW_X.sql', content: 'CREATE VIEW vw_x;' },
    ]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Local file header signature at the very start.
    expect(Array.from(buf.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // EOCD is the last 22 bytes (no archive comment).
    const eocd = buf.slice(buf.length - 22);
    expect(Array.from(eocd.slice(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(u16(eocd, 10)).toBe(2); // total entries
    // Both paths appear verbatim in the archive bytes.
    const whole = new TextDecoder().decode(buf);
    expect(whole).toContain('CLIENTE/TABLE-CLIENTE.sql');
    expect(whole).toContain('CLIENTE/VIEW_NEG-VW_X.sql');
    expect(whole).toContain('CREATE TABLE cliente;');
  });

  it('handles a single entry', async () => {
    const blob = buildZip([{ path: 'a/b.sql', content: 'x' }]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const eocd = buf.slice(buf.length - 22);
    expect(u16(eocd, 10)).toBe(1);
  });
});
