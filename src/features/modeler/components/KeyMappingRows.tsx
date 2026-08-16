import { KeyRound } from 'lucide-react';
import type { CanonicalColumn } from '@/features/governance/services/governance.service';
import type { MappingTarget } from '@/features/modeler/lib/relationshipPairs';
import SearchSelect from './SearchSelect';

export interface KeyRowState {
  parentColumnId: string;
  target: MappingTarget;
  roleName: string;
  /** Sync: par ya vigente — mapeo fijo, sin selector. */
  locked?: boolean;
}

const CREATE = '__create__';

/**
 * Grid de mapeo N=N (doc 47): una fila por PK del padre — destino en el hijo
 * (columna existente o "Create") + role name opcional en filas Create. Sin
 * agregar/quitar filas. Presentacional puro: el estado vive en el popup.
 */
export default function KeyMappingRows({ parentPks, childCols, rows, onChange, locked }: {
  parentPks: CanonicalColumn[];
  childCols: CanonicalColumn[];
  rows: KeyRowState[];
  onChange: (rows: KeyRowState[]) => void;
  locked?: boolean;
}) {
  const pkById = new Map(parentPks.map((c) => [c.id, c]));
  const colById = new Map(childCols.map((c) => [c.id, c]));
  const claimed = new Set(rows.flatMap((r) => (r.target.kind === 'existing' ? [r.target.columnId] : [])));
  const patch = (i: number, p: Partial<KeyRowState>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));

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
            .map((c) => ({ value: c.id, label: c.physicalName })),
        ];
        return (
          <div className="wk-relpair" key={pk.id}>
            <div className="wk-relpair-cols">
              <KeyRound size={11} strokeWidth={2} style={{ color: 'var(--k-pk)', flex: 'none' }} aria-hidden />
              <span className="rd-mono">{pk.physicalName}</span>
              <span style={{ color: 'var(--text-muted-3)' }}>→</span>
              {row.locked ? (
                <span className="rd-mono">{current?.physicalName ?? '—'}</span>
              ) : (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SearchSelect
                    options={options} mono
                    valueLabel={isCreate ? `➕ Create "${row.roleName.trim() || pk.logicalName}"` : (current?.physicalName ?? '')}
                    placeholder="child column…"
                    disabled={locked}
                    onPick={(v) => patch(i, { target: v === CREATE ? { kind: 'create' } : { kind: 'existing', columnId: v } })}
                  />
                </div>
              )}
            </div>
            {isCreate && !row.locked && (
              <div className="wk-relpair-role">
                <input
                  className="rd-input rd-mono" disabled={locked}
                  placeholder={`Role name (optional) — default "${pk.logicalName}"`}
                  value={row.roleName}
                  onChange={(e) => patch(i, { roleName: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
