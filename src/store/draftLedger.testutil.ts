/**
 * Contador de escrituras de una versión para los tests del Redo, como lo lleva
 * el backend (`writeSeq`). El test mockea `@/services/changeset.service` con
 * `withDraftLedger`: los avisos de escritura (`onDraftWrite`) pasan por acá y
 * `writeSeqOf` responde el contador.
 *  · `write`: una escritura de esta pestaña — sube el contador y se avisa con su número;
 *  · `lost`: una que falló sin respuesta — se avisa sin número y sin confirmar (pudo llegar);
 *  · `foreign`: una que esta pestaña no ve (otra pestaña, un endpoint sin aviso) — solo sube.
 *
 * Uso: `vi.mock('@/services/changeset.service', async (orig) =>
 *   (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()));`
 */
import { vi } from 'vitest';
import type * as Csvc from '@/services/changeset.service';

type Listener = Parameters<typeof Csvc.onDraftWrite>[0];
const listeners = new Set<Listener>();
let seq = 0;

export const draftLedger = {
  write(cs: string, changes: Csvc.BulkChange[] = []): number {
    seq += 1;
    for (const l of listeners) l(cs, changes, seq);
    return seq;
  },
  lost(cs: string, changes: Csvc.BulkChange[] = []): void {
    for (const l of listeners) l(cs, changes, undefined, true);
  },
  foreign(): number {
    seq += 1;
    return seq;
  },
  get seq(): number { return seq; },
};

export const withDraftLedger = (actual: typeof Csvc): typeof Csvc => ({
  ...actual,
  onDraftWrite: (l: Listener) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  writeSeqOf: vi.fn(async () => ({ writeSeq: seq })),
});
