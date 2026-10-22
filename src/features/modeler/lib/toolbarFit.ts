/**
 * La barra de herramientas del canvas en anchos menores (laptops, navegador al
 * 125 %): queda siempre en una fila, sin scroll horizontal que esconda Save y
 * Publish ni filas desparejas, y se compacta por pasos, en un orden fijo (como
 * la cinta de Office: primero lo que menos se usa), hasta que entra; al
 * ensancharse vuelve atrás. Nada se quita: lo compactado de un grupo queda en
 * un menú con su nombre, en el mismo lugar.
 * Puro: el hook (`useToolbarFit`) mide y aplica.
 */

/** Pasos en orden; el nivel N aplica los N primeros:
 *  · open: «Open model» solo con su ícono;
 *  · drawing: las 8 formas, en el menú «Drawing»;
 *  · pill: la píldora de la versión sin el proyecto (está en el Explorer);
 *  · compact: sin los rótulos de grupo, botones de 34 px — la barra baja de alto;
 *  · ends: las cardinalidades Parent/Child, en un menú que muestra las elegidas;
 *  · actions: Auto-arrange y los dos Export, en «More actions» (Undo queda);
 *  · structure: CTAS, Create view, Schemas y la carga Excel, en un menú (New queda);
 *  · primary: Save y Publish solo con su ícono;
 *  · rel: el resto de Relationships (dibujar, subcategoría, etiquetas), en su menú. */
export const TOOLBAR_STEPS = ['open', 'drawing', 'pill', 'compact', 'ends', 'actions', 'structure', 'primary', 'rel'] as const;
export type ToolbarStep = (typeof TOOLBAR_STEPS)[number];

/** ¿El paso está activo en el nivel `level`? */
export const stepOn = (level: number, step: ToolbarStep): boolean => level > TOOLBAR_STEPS.indexOf(step);

/** Margen para volver un paso atrás: el nivel anterior tiene que entrar con aire
 *  (si no, un píxel de diferencia lo haría rebotar). */
const HYSTERESIS = 8;

/** Próximo nivel. `content`: ancho del contenido en el nivel actual; si no entra
 *  en `available`, sube un paso y anota ese ancho en `need[level]` (lo que pide
 *  ese nivel). Si entra, baja un paso cuando el nivel anterior —según lo que
 *  pedía— también entra. Muta `need`. */
export function fitLevel(level: number, m: { available: number; content: number }, need: Record<number, number>, max: number): number {
  if (m.content > m.available + 0.5) {
    if (level >= max) return level;
    need[level] = m.content;
    return level + 1;
  }
  const before = need[level - 1];
  return level > 0 && before !== undefined && m.available >= before + HYSTERESIS ? level - 1 : level;
}
