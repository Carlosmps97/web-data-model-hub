/**
 * domainHistory — lógica pura del historial de un parent domain.
 */
import type { DomainHistoryEntry, SnapshotDomain } from './standards.service';

const LABEL: Record<string, string> = {
  name: 'Name', defaultDataType: 'Physical type', logicalDataType: 'Logical type', namingTerm: 'Naming term',
  description: 'Description', inheritsName: 'Standard attribute', physicalName: 'Physical name',
  physicalDescription: 'Physical description', udpValues: 'UDP defaults',
};
// Campos cortos: se muestra el valor previo y el nuevo («x → y»); el resto, solo «changed».
const SHOW_VALUES = new Set(['name', 'defaultDataType', 'logicalDataType', 'namingTerm', 'physicalName']);
const txt = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Qué modificó cada entrada (más reciente primero) respecto de la anterior. */
export function historyLines(entries: DomainHistoryEntry[]): string[][] {
  return entries.map((e, i) => {
    const older = entries[i + 1];
    if (!e.state) return ['Deleted'];
    if (!older) return ['Created'];
    if (!older.state) return ['Restored'];
    const prev = older.state as Record<string, unknown>;
    const cur = e.state as Record<string, unknown>;
    return e.changed.map((k) => (SHOW_VALUES.has(k)
      ? `${LABEL[k] ?? k}: ${txt(prev[k])} → ${txt(cur[k])}`
      : `${LABEL[k] ?? k} changed`));
  });
}

/** Formulario del editor con los valores de una versión (revert). Si en esa
 *  versión no había tipo lógico se conserva el actual: un tipo nunca se cascadea
 *  a vacío, así el formulario muestra lo que de verdad quedará. */
export function revertForm(current: SnapshotDomain, entry: DomainHistoryEntry): SnapshotDomain {
  const state: Partial<SnapshotDomain> = entry.state ?? {};
  return { ...current, ...state, id: current.id, logicalDataType: state.logicalDataType || current.logicalDataType };
}
