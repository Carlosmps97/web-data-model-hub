import { KeyRound } from 'lucide-react';
import type { CanonicalColumn } from '@/services/governance.service';
import { distinctNames, facetNouns, type Facet } from '@/lib/facets';
import type { MappingTarget } from '@/features/modeler/lib/relationshipPairs';
import SearchSelect from './SearchSelect';

export interface KeyRowState {
  parentColumnId: string;
  target: MappingTarget;
  roleName: string;
  /** Herencia de metadata del padre — POR FILA (default sí). */
  inherit: boolean;
  /** Sync: par ya vigente — mapeo fijo, sin selector ni role/inherit. */
  locked?: boolean;
}

const CREATE = '__create__';

/**
 * Grid de mapeo N=N (doc 47): una fila por PK del padre — destino en el hijo
 * (columna existente o "Create") + role name e "Inherit" POR FILA (feedback
 * prueba viva 2026-08-15; en existentes el role name RENOMBRA la columna).
 * Sin agregar/quitar filas. Presentacional puro: el estado vive en el popup.
 * Doc 114: los nombres, los del modelo del canvas (`mode`) — atributos en el
 * lógico, columnas en el físico (antes, siempre los físicos); los lógicos
 * repetidos se distinguen por su físico (revisión: si no, la FK podía ir a la
 * columna equivocada sin notarse).
 */
export default function KeyMappingRows({ parentPks, childCols, rows, onChange, locked, mode }: {
  parentPks: CanonicalColumn[];
  childCols: CanonicalColumn[];
  rows: KeyRowState[];
  onChange: (rows: KeyRowState[]) => void;
  locked?: boolean;
  mode: Facet;
}) {
  const pkById = new Map(parentPks.map((c) => [c.id, c]));
  const colById = new Map(childCols.map((c) => [c.id, c]));
  const claimed = new Set(rows.flatMap((r) => (r.target.kind === 'existing' ? [r.target.columnId] : [])));
  const patch = (i: number, p: Partial<KeyRowState>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const childName = distinctNames(childCols, mode);
  const pkName = distinctNames(parentPks, mode);
  const name = (c: CanonicalColumn | undefined) => (c ? childName.get(c.id) ?? pkName.get(c.id) ?? '' : '');
  const n = facetNouns(mode);

  return (
    <div className="wk-relpairs">
      {rows.map((row, i) => {
        const pk = pkById.get(row.parentColumnId);
        if (!pk) return null;
        const isCreate = row.target.kind === 'create';
        const current = row.target.kind === 'existing' ? colById.get(row.target.columnId) : undefined;
        // Opciones: crear + columnas del hijo no reclamadas por OTRA fila; sin auto-mapeo.
        const options = [
          { value: CREATE, label: `➕ Create "${row.roleName.trim() || pk.logicalName}"` },
          ...childCols
            .filter((c) => c.id !== pk.id && (!claimed.has(c.id) || (!!current && c.id === current.id)))
            .map((c) => ({ value: c.id, label: name(c) })),
        ];
        return (
          <div className="wk-relpair" key={pk.id}>
            <div className="wk-relpair-cols">
              <KeyRound size={11} strokeWidth={2} style={{ color: 'var(--k-pk)', flex: 'none' }} aria-hidden />
              <span className="rd-mono" title={pkName.get(pk.id)}>{pkName.get(pk.id)}</span>
              <span style={{ color: 'var(--text-muted-3)' }}>→</span>
              {row.locked ? (
                <span className="rd-mono" title={current ? name(current) : undefined}>{current ? name(current) : '—'}</span>
              ) : (
                <div style={{ flex: 1, minWidth: 0 }} title={isCreate ? undefined : name(current) || undefined}>
                  <SearchSelect
                    options={options} mono
                    valueLabel={isCreate ? `➕ Create "${row.roleName.trim() || pk.logicalName}"` : name(current)}
                    placeholder={`child ${n.member}…`}
                    disabled={locked}
                    onPick={(v) => patch(i, { target: v === CREATE ? { kind: 'create' } : { kind: 'existing', columnId: v } })}
                  />
                </div>
              )}
            </div>
            {!row.locked && (
              <div className="wk-relpair-role">
                <input
                  className="rd-input rd-mono" disabled={locked}
                  placeholder={isCreate
                    ? `Role name (optional) — default "${pk.logicalName}"`
                    : `Role name (optional) — renames this ${n.member}`}
                  value={row.roleName}
                  onChange={(e) => patch(i, { roleName: e.target.value })}
                />
                <select
                  className="rd-input wk-relpair-inherit" disabled={locked}
                  title={`Copy definition, UDPs and metadata from the parent ${n.member}`}
                  value={row.inherit ? 'yes' : 'no'}
                  onChange={(e) => patch(i, { inherit: e.target.value === 'yes' })}
                >
                  <option value="yes">Inherit: Yes</option>
                  <option value="no">Inherit: No</option>
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
