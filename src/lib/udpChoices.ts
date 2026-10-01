/**
 * Opciones de un UDP que se ELIGE (lista o booleano). Doc 105 (ronda 5): el
 * booleano se tipeaba como texto libre y quedaban «Sí», «yes», «1»… (el
 * Reporting los normaliza al filtrar, pero GROUP BY agrupaba por grafía). Un
 * valor guardado que no está entre las opciones (un booleano legado, un valor
 * que salió de la lista) se sigue viendo: antes el select mostraba «—» con un
 * valor presente. Lo usan el panel de valores (UdpAssign) y el default de la
 * definición (Data Standards → UDP).
 */
export interface ChoosableUdp { dataType: string; allowedValues: string[] }

export function udpChoices(d: ChoosableUdp, value: string): string[] {
  const base = d.dataType === 'boolean' ? ['true', 'false'] : d.allowedValues;
  return value && !base.includes(value) ? [...base, value] : base;
}
