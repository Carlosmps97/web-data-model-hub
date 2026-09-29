/**
 * Frases de relación (doc 98, Erwin: Parent-to-Child / Child-To-Parent
 * Phrase): la etiqueta que el canvas y el export dibujan sobre el wire.
 * Lógica PURA — la consumen CrowFootEdge, exportScene, los popups de relación
 * y los paneles de Links.
 */
import type { Relationship } from '@/services/governance.service';

/** Tope de ESCRITURA de cada frase (caja de texto de los popups). */
export const PHRASE_MAX = 120;
/** Tope de DIBUJO por frase en el canvas/export: lo que excede se corta con
 *  «…» (el texto completo vive en el popup). El real más largo de los XML
 *  tiene 77 caracteres. */
export const PHRASE_DRAW_MAX = 80;

/** Ancho de la etiqueta (px de canvas). Cuando el texto no cabe, PARTE LÍNEA:
 *  una etiqueta más ancha que el hueco entre dos bloques taparía la línea y
 *  sus marcadores, y quedaría cortada bajo los propios bloques. */
export const LABEL_MAX_W = 260;
export const LABEL_MIN_W = 72;
/** Aire que se deja libre en CADA extremo: marcador crow's-foot (22) + margen. */
const MARKER_CLEARANCE = 28;
/** Separación entre el bloque y la etiqueta de una relación recursiva. */
const RECURSIVE_LIFT = 8;

export type PhraseKey = 'parentToChildPhrase' | 'childToParentPhrase';
export const PHRASE_KEYS: readonly PhraseKey[] = ['parentToChildPhrase', 'childToParentPhrase'];
export type RelationshipPhrases = Pick<Relationship, PhraseKey>;

/** Frase limpia: recortada; vacío ≡ sin frase (espejo de `clean_phrase` del
 *  backend). */
export function cleanPhrase(raw: string | null | undefined): string | null {
  return (raw ?? '').trim() || null;
}

/** Corta a `max` CARACTERES (no unidades UTF-16: un emoji no se parte). Un
 *  tope sin sentido (NaN, < 2) no corta. */
function clip(s: string, max: number): string {
  if (!(max >= 2)) return s;
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : s;
}

/** Etiqueta del wire en formato Erwin: «padre→hijo / hijo→padre» en una
 *  línea; con una sola frase, solo esa; sin frases, null (no se dibuja). */
export function relationshipLabel(rel: RelationshipPhrases, max: number = PHRASE_DRAW_MAX): string | null {
  const parts = PHRASE_KEYS
    .map((k) => cleanPhrase(rel[k]))
    .filter((p): p is string => p != null)
    .map((p) => clip(p, max));
  return parts.length ? parts.join(' / ') : null;
}

/** Ancho máximo de la etiqueta según el HUECO horizontal entre los dos bloques
 *  (deja libres los marcadores de ambos extremos). Sin hueco — bloques
 *  apilados — usa el ancho por defecto. */
export function labelMaxWidth(gap: number): number {
  if (!(gap > 0)) return LABEL_MAX_W;
  return Math.max(LABEL_MIN_W, Math.min(LABEL_MAX_W, Math.floor(gap - 2 * MARKER_CLEARANCE)));
}

export interface LabelPlacement {
  x: number;
  y: number;
  maxWidth: number;
  /** `center`: (x, y) es el centro de la etiqueta · `bottom`: su borde inferior. */
  anchor: 'center' | 'bottom';
}

/**
 * Dónde va la etiqueta y cuánto puede medir — la MISMA regla para el canvas y
 * el export. Normal: centrada en el punto medio del wire, con el ancho que deja
 * el hueco entre los bloques. Recursiva (padre = hijo): el wire corre por
 * debajo del propio bloque, así que la etiqueta va ENCIMA del bloque, centrada.
 * `sx`/`tx` = bordes por donde el wire sale del padre y entra al hijo.
 */
export function labelPlacement(a: {
  recursive: boolean;
  facesRight: boolean;
  sx: number; tx: number;
  midX: number; midY: number;
  box: { x: number; y: number; w: number };
}): LabelPlacement {
  if (a.recursive) {
    return {
      x: a.box.x + a.box.w / 2, y: a.box.y - RECURSIVE_LIFT,
      maxWidth: Math.max(LABEL_MIN_W, Math.min(LABEL_MAX_W, Math.floor(a.box.w))),
      anchor: 'bottom',
    };
  }
  const gap = a.facesRight ? a.tx - a.sx : a.sx - a.tx;
  return { x: a.midX, y: a.midY, maxWidth: labelMaxWidth(gap), anchor: 'center' };
}

/** Parte la etiqueta en líneas de a lo más `maxChars` caracteres, por
 *  palabras (una palabra más larga que el tope se corta dura). Lo usa el
 *  export, que no tiene un navegador que parta el texto por él. */
export function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!(maxChars >= 1)) return [words.join(' ')];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    let rest = [...word];
    while (rest.length > maxChars) {                    // palabra que no entra ni sola
      if (line) { lines.push(line); line = ''; }
      lines.push(rest.slice(0, maxChars).join(''));
      rest = rest.slice(maxChars);
    }
    const piece = rest.join('');
    if (!line) line = piece;
    else if ([...line].length + 1 + rest.length <= maxChars) line = `${line} ${piece}`;
    else { lines.push(line); line = piece; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** null = el borrador no cambia la frase vigente; si cambia, la frase LIMPIA
 *  a grabar (null la borra). */
export function phraseChange(current: string | null | undefined, draft: string): { value: string | null } | null {
  const value = cleanPhrase(draft);
  return value === cleanPhrase(current) ? null : { value };
}

/** Apply del popup de edición: las frases que REALMENTE cambian respecto de
 *  la relación, limpias, para grabarlas en UN solo guardado. null = nada que
 *  grabar (cero requests). */
export function phraseEdits(
  rel: RelationshipPhrases, drafts: Partial<Record<PhraseKey, string>>,
): Partial<Record<PhraseKey, string | null>> | null {
  const out: Partial<Record<PhraseKey, string | null>> = {};
  for (const key of PHRASE_KEYS) {
    const draft = drafts[key];
    if (draft === undefined) continue;
    const change = phraseChange(rel[key], draft);
    if (change) out[key] = change.value;
  }
  return Object.keys(out).length ? out : null;
}
