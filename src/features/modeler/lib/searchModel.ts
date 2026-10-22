// Buscador del Model — lógica pura del popup: a qué canvas ir con
// un hit, y cómo resaltar/recortar el texto que matchea. Sin React ni red.
import type { ModelSearchCanvas } from '@/services/governance.service';

/** Canvas destino de un hit: el activo si contiene la tabla (sin redirigir);
 *  si no, el primero por nombre; sin canvases → null (la tabla existe en el
 *  catálogo pero no está dibujada en ningún canvas). */
export function pickTargetCanvas(canvases: ModelSearchCanvas[], activeSaId: string | null): ModelSearchCanvas | null {
  if (!canvases.length) return null;
  const here = activeSaId ? canvases.find((c) => c.id === activeSaId) : undefined;
  if (here) return here;
  return [...canvases].sort((a, b) => a.name.localeCompare(b.name))[0];
}

export interface HighlightPart { text: string; hit: boolean }

/** Parte `text` en tramos normales/resaltados por cada ocurrencia de `q`
 *  (contiene, case-insensitive). `q` vacío → un solo tramo sin resaltar. */
export function splitHighlight(text: string, q: string): HighlightPart[] {
  const needle = q.trim().toLowerCase();
  if (!needle || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: HighlightPart[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at < 0) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    i = at + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/** Recorte de una definición larga alrededor de la primera ocurrencia de `q`
 *  (`radius` caracteres a cada lado, con elipsis). Sin ocurrencia: el inicio. */
export function snippet(text: string, q: string, radius = 60): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const needle = q.trim().toLowerCase();
  const at = needle ? t.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return t.length > radius * 2 ? `${t.slice(0, radius * 2)}…` : t;
  const start = Math.max(0, at - radius);
  const end = Math.min(t.length, at + needle.length + radius);
  return `${start > 0 ? '…' : ''}${t.slice(start, end)}${end < t.length ? '…' : ''}`;
}

/** Rótulo de un hit de columna: «schema.TABLE · COLUMN» (esquema opcional). */
export function columnPath(h: { schema?: string | null; tableName: string; physicalName: string }): string {
  return `${h.schema ? `${h.schema}.` : ''}${h.tableName} · ${h.physicalName}`;
}

/** Cadena de carpetas de un canvas, de la raíz hacia abajo: [sub-proyecto,
 *  dominio, …] (sirve para pre-llenar los filtros con el canvas abierto).
 *  Canvas en la raíz del proyecto → []. Corta ciclos. Pura. */
export function folderChain<F extends { id: string; parentFolderId: string | null }>(
  folders: F[], folderId: string | null | undefined,
): F[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: F[] = [];
  const seen = new Set<string>();
  let cur = folderId ? byId.get(folderId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined;
  }
  return chain;
}

