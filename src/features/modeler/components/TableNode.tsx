import { Handle, Position, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2, Table2 } from 'lucide-react';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';
import type { CanonicalColumn, CanonicalTable } from '@/features/governance/services/governance.service';

export interface TableNodeData {
  table: CanonicalTable;
  columns: CanonicalColumn[];
  [key: string]: unknown;
}

export default function TableNode({ data }: NodeProps) {
  const { table, columns } = data as TableNodeData;
  const canEdit = useChangesetStore((s) => s.activeId) != null;
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const viewMode = useModelerStore((s) => s.viewMode);
  // Selección desde el store (consistente con la del wire): evita el borde
  // "fantasma" del nodo cuando se selecciona una relación.
  const selected = useModelerStore((s) => s.selectedTableId) === table.id;

  const nameOf = (o: { logicalName: string; physicalName: string }) =>
    viewMode === 'logical' ? o.logicalName : o.physicalName;
  const pks = columns.filter((c) => c.isPrimaryKey);
  const rest = columns.filter((c) => !c.isPrimaryKey);

  const renderRow = (c: CanonicalColumn) => (
    <div className="wk-node-row" key={c.id}>
      <span className="wk-node-key" aria-hidden>
        {c.isPrimaryKey ? (
          <KeyRound size={11} strokeWidth={2} style={{ color: 'var(--k-pk)' }} />
        ) : c.isForeignKey ? (
          <Link2 size={11} strokeWidth={2} style={{ color: 'var(--k-fk)' }} />
        ) : null}
      </span>
      <span className={`wk-node-name${c.isForeignKey ? ' fk' : ''}`}>{nameOf(c)}</span>
      <span className="wk-node-dt rd-mono">{c.dataType}</span>
      <Handle type="source" position={Position.Right} id={`${c.id}__src`} isConnectable={canEdit} className="wk-handle" />
      <Handle type="target" position={Position.Left} id={`${c.id}__tgt`} isConnectable={canEdit} className="wk-handle" />
    </div>
  );

  return (
    <div className={`wk-node${selected ? ' sel' : ''}`}>
      <div className="wk-node-head">
        <Table2 size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
        <span className="rd-mono">{nameOf(table)}</span>
        <span className="wk-node-sub">{viewMode === 'logical' ? table.physicalName : table.logicalName}</span>
        {canEdit && <button className="wk-node-add" title="Agregar columna" onClick={() => setColumnTarget(table.id)}>+</button>}
      </div>
      {pks.length > 0 && <div className="wk-node-pk">{pks.map(renderRow)}</div>}
      {pks.length > 0 && rest.length > 0 && <div className="wk-node-div" />}
      {rest.map(renderRow)}
      {columns.length === 0 && <div className="wk-node-empty rd-small">Sin columnas</div>}
    </div>
  );
}
