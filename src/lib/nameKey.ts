/** Clave de un nombre, como `norm_name` de la carga Excel: sin bordes, sin tildes,
 *  espacios internos colapsados y sin mayúsculas. */
export const nameKey = (s: string): string =>
  String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').trim().split(/\s+/).join(' ').toLowerCase();
