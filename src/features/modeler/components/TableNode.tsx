import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2, Table2 } from 'lucide-react';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { CanonicalColumn, CanonicalTable } from '@/features/governance/services/governance.service';

export interface TableNodeData {
  table: CanonicalTable;
  columns: CanonicalColumn[];
  [key: string]: unknown;
}

function TableNode({ data }: NodeProps) {
  const { table, columns } = data as TableNodeData;
  // En modo visor puede haber changeset activo (viendo un request): sin handles
  // conectables ni affordances de edición.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  // Los handles sólo conectan con la herramienta "Dibujar relación" armada
  // (relPreset != null) — sin armar, el drag desde una columna no crea wires.
  const relArmed = useModelerStore((s) => s.relPreset != null);
  const connectable = canEdit && relArmed;
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const viewMode = useModelerStore((s) => s.viewMode);
  // Selector BOOLEANO (no el id crudo): con el id, cambiar la selección
  // re-renderizaba los 100 nodos del canvas; con el booleano sólo los 2
  // afectados (el que se selecciona y el que se deselecciona).
  const selected = useModelerStore((s) => s.selectedTableId === table.id);

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
      <Handle type="source" position={Position.Right} id={`${c.id}__src`} isConnectable={connectable} className="wk-handle" />
      <Handle type="target" position={Position.Left} id={`${c.id}__tgt`} isConnectable={connectable} className="wk-handle" />
    </div>
  );

  return (
    <div className={`wk-node${selected ? ' sel' : ''}`}>
      <div className="wk-node-head">
        <Table2 size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
        <span className="rd-mono wk-node-title">
          {table.schema && <span className="wk-node-schema">{table.schema}.</span>}
          {nameOf(table)}
        </span>
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

// memo: React Flow re-renderiza los custom nodes en cada update del grafo
// (pan/zoom/drag); sin memo, un canvas de 100 tablas × 30 columnas repinta
// ~3.000 filas + ~6.000 handles por frame.
export default memo(TableNode);
