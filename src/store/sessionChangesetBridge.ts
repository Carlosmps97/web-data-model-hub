/**
 * sessionChangesetBridge — espeja `useSessionStore.activeChangesetId` →
 * `useChangesetStore.setActive(id)`.
 *
 * El flujo nuevo (Open model, R2) decide el working copy activo en
 * `useSessionStore.activeChangesetId` (modo `editing`). Pero TODOS los lectores
 * existentes del changeset activo —tanto las escrituras de `governance.service`
 * (`active()`) como los gates de UI (`ModelerCanvas.onConnect`, `TableNode`,
 * `PropertiesPanel`, `RelationshipPopup`, `GovDrawer`)— leen
 * `useChangesetStore.activeId`. Sin este puente, editar en el canvas no
 * encuentra changeset activo y lanza "Se requiere un changeset activo".
 *
 * Espejar (en vez de migrar cada lector) es la mínima invasión: el seam queda
 * manejado por `useSessionStore` sin tocar a los consumidores. La dirección es
 * unidireccional (session → changeset), así que no hay ciclo de actualización.
 *
 * Import-safety: este módulo importa ambos stores; ninguno de los dos stores
 * importa este módulo, así que no hay ciclo de import. Se monta una sola vez
 * desde `App.tsx`.
 */
import { useSessionStore } from './useSessionStore';
import { useChangesetStore } from './useChangesetStore';

let installed = false;

/** Instala el espejo session → changeset. Idempotente (sólo una suscripción). */
export function installSessionChangesetBridge(): void {
  if (installed) return;
  installed = true;

  // Sincroniza el valor inicial: si el store de sesión ya tiene un changeset
  // (p.ej. tras un Open model previo a montar el bridge), refléjalo de una.
  const initial = useSessionStore.getState().activeChangesetId;
  if (useChangesetStore.getState().activeId !== initial) {
    useChangesetStore.getState().setActive(initial);
  }

  useSessionStore.subscribe((state, prev) => {
    if (state.activeChangesetId === prev.activeChangesetId) return;
    useChangesetStore.getState().setActive(state.activeChangesetId);
  });
}
