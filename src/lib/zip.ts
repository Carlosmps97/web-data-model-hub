/**
 * Escritor de ZIP sin dependencias: método STORE (sin compresión) + CRC-32.
 *
 * Alcanza para empaquetar un árbol de carpetas de archivos de texto pequeños
 * (el export DDL) en un solo archivo descargable. Sin compresión el código es
 * pequeño y rápido; el contenido es texto y pequeño (un canvas exporta a lo
 * sumo unos MB). Los nombres de archivo van en UTF-8 (bit 11 de propósito
 * general). Una marca de tiempo DOS fija hace la salida determinista (pruebas
 * estables, descargas reproducibles).
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

/** CRC-32 (polinomio 0xEDB88320) de un buffer de bytes, como número de 32 bits sin signo. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Ruta dentro del archivo, separada por `/` (p. ej. `CLIENTE/TABLE-CLIENTE.sql`). */
  path: string;
  content: string;
}

const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01, la época DOS: fija para que la salida sea determinista.

/** Arma un archivo ZIP STORE (sin compresión) a partir de entradas de texto. */
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
    lv.setUint32(0, 0x04034b50, true); // firma del encabezado de archivo local
    lv.setUint16(4, 20, true);         // versión necesaria para extraer (2.0)
    lv.setUint16(6, 0x0800, true);     // flags: bit 11 = nombres en UTF-8
    lv.setUint16(8, 0, true);          // método de compresión: 0 = store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);      // tamaño comprimido (= sin comprimir en store)
    lv.setUint32(22, size, true);      // tamaño sin comprimir
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);         // longitud del campo extra
    local.set(name, 30);
    parts.push(local, data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); // firma del encabezado del directorio central
    cv.setUint16(4, 20, true);         // versión que lo creó
    cv.setUint16(6, 20, true);         // versión necesaria
    cv.setUint16(8, 0x0800, true);     // flags
    cv.setUint16(10, 0, true);         // método
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);         // longitud del campo extra
    cv.setUint16(32, 0, true);         // longitud del comentario
    cv.setUint16(34, 0, true);         // disco inicial
    cv.setUint16(36, 0, true);         // atributos internos
    cv.setUint32(38, 0, true);         // atributos externos
    cv.setUint32(42, offset, true);    // offset relativo del encabezado local
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);   // firma del fin del directorio central
  ev.setUint16(4, 0, true);            // número de este disco
  ev.setUint16(6, 0, true);            // disco con el directorio central
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);      // offset del directorio central
  ev.setUint16(20, 0, true);           // longitud del comentario

  return new Blob([...parts, ...central, eocd] as BlobPart[], { type: 'application/zip' });
}
