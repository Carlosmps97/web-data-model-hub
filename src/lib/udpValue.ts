/**
 * Valor de un UDP según la definición del destino (al pegar entre proyectos,
 * el mismo UDP puede tener otro tipo u otra lista). Acepta lo mismo que la
 * carga Excel del backend (`bulk_upload/standards.udp_value` con
 * `app/core/udp_values.py`): lista contra `allowedValues` sin bordes, espacios
 * internos colapsados y sin mayúsculas (`norm_enum`), con la grafía del destino;
 * número finito, escrito como lo graba la UI (`canonicalNumberText`: igual que
 * el backend en las grafías comunes); fecha ISO real (de una fecha-hora, solo la
 * fecha); booleano a «true»/«false»; texto tal cual. Un valor que no es texto
 * (un dato guardado con otro tipo) se lee como texto. Devuelve lo que se graba,
 * o null si el valor no vale para esa definición. Pura.
 */
import { canonicalNumberText } from './udpNumber';

const TRUE = /^\s*(true|1|s[iíIÍ]|yes|verdadero)\s*$/i;
const FALSE = /^\s*(false|0|no|falso)\s*$/i;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

const listKey = (v: string) => v.replace(/\r\n?/g, '\n').trim().split(/\s+/).filter(Boolean).join(' ').toUpperCase();

/** «YYYY-MM-DD» de una fecha (o fecha-hora sin zona) ISO que existe; null si no. */
function isoDate(text: string): string | null {
  const m = ISO_DATETIME.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  if (+y < 1) return null;   // como `date.fromisoformat`: el año 0 no existe
  const day = new Date(0);
  day.setUTCFullYear(+y, +mo - 1, +d);   // literal: `Date.UTC` lleva los años 0-99 a 19xx
  if (day.getUTCFullYear() !== +y || day.getUTCMonth() !== +mo - 1 || day.getUTCDate() !== +d) return null;
  if (hh !== undefined && (+hh > 23 || +mm > 59 || +(ss ?? 0) > 59)) return null;
  return `${y}-${mo}-${d}`;
}

export function udpValueFor(def: { dataType?: string | null; allowedValues?: string[] | null }, raw: string): string | null {
  const value = String(raw ?? '');
  switch (def.dataType) {
    case 'list': {
      const key = listKey(value);
      const hit = (def.allowedValues ?? []).find((v) => listKey(String(v ?? '')) === key);
      return hit === undefined ? null : String(hit);
    }
    case 'number': {
      const text = value.trim();
      return NUMBER.test(text) && Number.isFinite(Number(text)) ? canonicalNumberText(text) : null;
    }
    case 'date':
      return isoDate(value);
    case 'boolean':
      return TRUE.test(value) ? 'true' : FALSE.test(value) ? 'false' : null;
    default:
      return value;
  }
}
