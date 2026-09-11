// Lógica PURA del ViewPropertiesPanel (doc 61) — separada del JSX para
// testearla con vitest sin DOM (mismo criterio que viewEditorLogic).
import type { ViewSource } from '@/services/views.service';

/** Reordena `sources` moviendo el ítem `from` a la posición `to` (índices del
 *  array COMPLETO; `to` = posición de inserción POST-remoción). Pura, clampa. */
export function moveSource(sources: ViewSource[], from: number, to: number): ViewSource[] {
  const next = sources.map((s) => ({ ...s }));
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  const dest = Math.max(0, Math.min(to, next.length));
  next.splice(dest, 0, item);
  return next;
}

/** Sincroniza el valor del UDP "View Type" con el MODO real de la vista
 *  (doc 61 §2.3): la verdad técnica es `customSql`; el UDP es el dato
 *  reportable. Sin def sembrado (defId null) devuelve los valores tal cual. */
/** Nombre (CI) del UDP gestionado «Tipo de Vista» (seed doc 61): lo sincroniza
 *  el modo Regular/Personalizada; el panel y el inspector lo bloquean. */
export const VIEW_TYPE_NAME = 'tipo de vista';

export function syncViewTypeUdp(
  values: Record<string, string> | undefined,
  defId: string | null | undefined,
  custom: boolean,
): Record<string, string> | undefined {
  if (!defId) return values;
  return { ...(values ?? {}), [defId]: custom ? 'Personalizada' : 'Regular' };
}

/** Cuerpo (SELECT…) de un `CREATE OR REPLACE VIEW … AS\n<body>;` generado —
 *  para prellenar el sandbox al pasar a Personalizada. Best-effort: si el DDL
 *  no tiene el marcador ` AS\n`, devuelve el texto tal cual (sin `;` final). */
export function extractDdlBody(ddl: string): string {
  const marker = ' AS\n';
  const i = ddl.indexOf(marker);
  const body = i >= 0 ? ddl.slice(i + marker.length) : ddl;
  return body.trim().replace(/;\s*$/, '');
}
