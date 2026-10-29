/**
 * Lo que esta pestaña sabe del contador de escrituras de cada versión
 * (`writeSeq`, doc 125): los números de sus escrituras, el más alto que trajo
 * una carga del diagrama («visto»: sus datos están en pantalla; una escritura
 * propia o una lectura del contador no recargan nada), el primero que conoció
 * en la sesión y cuántas escrituras suyas quedaron sin respuesta (pudieron
 * grabarse sin que se sepa su número).
 *
 * Lo usa el candado del Undo: solo el dueño escribe en su versión, así que un
 * número que no es de esta pestaña es de otra pestaña o equipo suyo. Se olvida
 * al cambiar de sesión (`forgetDraftSeqs`).
 */
import { onDraftWrite } from '@/services/changeset.service';

interface Seqs {
  own: Set<number>;
  seen: number | null;
  first: number | null;
  unconfirmed: number;
  /** `unconfirmed` cuando se cargó `seen`: lo sin confirmar se cuenta desde ahí. */
  unconfirmedAtSeen: number;
}
const byVersion = new Map<string, Seqs>();
const of = (cs: string): Seqs => {
  let s = byVersion.get(cs);
  if (!s) {
    s = { own: new Set(), seen: null, first: null, unconfirmed: 0, unconfirmedAtSeen: 0 };
    byVersion.set(cs, s);
  }
  return s;
};

/** Lo que una acción sabe de su versión al empezar (va en su pin): el contador
 *  más alto que trajo una carga, las escrituras propias sin respuesta hasta esa
 *  carga (el candado mira lo escrito desde ahí) y, si no hubo carga, el primer
 *  número que conoció la sesión (el candado mira desde él; sin ninguno, no se
 *  sabe desde dónde). */
export interface DraftMark {
  seen: number | null;
  unconfirmed: number;
  first: number | null;
}

export function markDraft(cs: string | null | undefined): DraftMark | null {
  if (!cs) return null;
  const s = byVersion.get(cs);
  return { seen: s?.seen ?? null, unconfirmed: s?.unconfirmedAtSeen ?? 0, first: s?.first ?? null };
}

/** El contador que trajo una carga del diagrama ya instalada. */
export function noteSeen(cs: string, seq: number | null | undefined): void {
  if (seq == null) return;
  const s = of(cs);
  if (s.seen == null || seq > s.seen) {
    s.seen = seq;
    s.unconfirmedAtSeen = s.unconfirmed;
  }
  if (s.first == null) s.first = seq;
}

onDraftWrite((cs, _changes, seq, unconfirmed) => {
  const s = of(cs);
  if (seq != null) {
    s.own.add(seq);
    if (s.first == null) s.first = seq;
  } else if (unconfirmed) s.unconfirmed += 1;
});

/** Los números de las escrituras posteriores a `from` y hasta `upTo` (el
 *  contador leído) que esta pestaña no hizo. Sin `from` (la acción empezó sin
 *  nada cargado), desde lo primero que conoció la sesión. */
export function foreignWrites(cs: string, from: number | null, upTo: number): number[] {
  const s = byVersion.get(cs);
  const lo = from ?? s?.first ?? upTo;
  const out: number[] = [];
  for (let n = lo + 1; n <= upTo; n += 1) if (!s?.own.has(n)) out.push(n);
  return out;
}

/** Cuántas escrituras propias quedaron sin respuesta desde la carga de `mark`. */
export function unconfirmedSince(cs: string, mark: DraftMark | null | undefined): number {
  return (byVersion.get(cs)?.unconfirmed ?? 0) - (mark?.unconfirmed ?? 0);
}

export function forgetDraftSeqs(): void {
  byVersion.clear();
}
