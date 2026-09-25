/**
 * Zero-dependency ZIP writer — STORE method (no compression) + CRC-32.
 *
 * Enough to bundle a folder tree of small text files (the DDL export) into a
 * single downloadable archive. No compression keeps the code tiny and fast;
 * the payload is text and small (a canvas exports a few MB at most). Filenames
 * are UTF-8 (general-purpose bit 11). A fixed DOS timestamp makes the output
 * deterministic (stable tests, reproducible downloads).
 */
const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (poly 0xEDB88320) of a byte buffer, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, `/`-separated (e.g. `CLIENTE/TABLE-CLIENTE.sql`). */
  path: string;
  content: string;
}

const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01, the DOS epoch — fixed for determinism.

/** Build a STORE (uncompressed) ZIP archive from text entries. */
export function buildZip(entries: ZipEntry[]): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.path);
    const data = enc.encode(e.content);
    const crc = crc32(data);
    const size = data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true);         // version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true);     // flags: bit 11 = UTF-8 names
    lv.setUint16(8, 0, true);          // compression method: 0 = store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);      // compressed size (= uncompressed for store)
    lv.setUint32(22, size, true);      // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);         // extra field length
    local.set(name, 30);
    parts.push(local, data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header signature
    cv.setUint16(4, 20, true);         // version made by
    cv.setUint16(6, 20, true);         // version needed
    cv.setUint16(8, 0x0800, true);     // flags
    cv.setUint16(10, 0, true);         // method
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);         // extra length
    cv.setUint16(32, 0, true);         // comment length
    cv.setUint16(34, 0, true);         // disk number start
    cv.setUint16(36, 0, true);         // internal attributes
    cv.setUint32(38, 0, true);         // external attributes
    cv.setUint32(42, offset, true);    // relative offset of local header
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);   // end of central directory signature
  ev.setUint16(4, 0, true);            // number of this disk
  ev.setUint16(6, 0, true);            // disk with central dir
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);      // offset of central directory
  ev.setUint16(20, 0, true);           // comment length

  return new Blob([...parts, ...central, eocd] as BlobPart[], { type: 'application/zip' });
}
