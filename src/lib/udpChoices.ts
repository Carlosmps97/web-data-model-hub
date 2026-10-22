/**
 * Opciones de un UDP que se elige (lista o booleano). El booleano se elige, no
 * se tipea como texto libre: así no aparecen «Sí», «yes», «1»… (el Reporting
 * los normaliza al filtrar, pero GROUP BY agrupa por grafía). Un valor guardado
 * que no está entre las opciones (un booleano guardado como texto libre, un
 * valor que salió de la lista) se sigue viendo, en lugar de un «—» con un valor
 * presente. Lo usan el panel de valores (UdpAssign) y el default de la
 * definición (Data Standards → UDP).
 */
export interface ChoosableUdp { dataType: string; allowedValues: string[] }

export function udpChoices(d: ChoosableUdp, value: string): string[] {
  const base = d.dataType === 'boolean' ? ['true', 'false'] : d.allowedValues;
  return value && !base.includes(value) ? [...base, value] : base;
}
