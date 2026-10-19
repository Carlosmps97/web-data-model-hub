/**
 * Estándares del proyecto de ORIGEN de un pegado entre proyectos (doc 118): sus
 * UDP, dominios y themes en una lectura (`standards/snapshot`). null si ese
 * proyecto ya no existe o no se puede ver (404/403): la revisión lo avisa y pega
 * lo que no los necesita. Otra falla (red, timeout, 5xx) sube: el popup la
 * muestra con Retry en vez de pegar sin ellos.
 */
import { getSnapshot } from '@/features/standards/standards.service';
import { ApiError } from '@/services/http';
import type { PasteStandards } from '../lib/pasteReview';

export async function loadSourceStandards(projectId: string): Promise<PasteStandards | null> {
  try {
    const snap = await getSnapshot(projectId);
    return { udpDefs: snap.udp ?? [], domains: snap.domains ?? [], themes: snap.themes ?? [] };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}
