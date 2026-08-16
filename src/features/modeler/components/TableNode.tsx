import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2, Table2 } from 'lucide-react';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { CanonicalColumn, CanonicalTable } from '@/features/governance/services/governance.service';
import { collapseComplexType, isComplexType } from '../lib/complexTypes';
import { pkInKeyOrder } from '../lib/keyOrder';
import { tableLodSize } from '../lib/lodSize';

export interface TableNodeData {
  table: CanonicalTable;
  columns: CanonicalColumn[];
  /** LOD (doc 33): render compacto bajo el umbral de zoom. */
  lod?: boolean;
  /** Ids de columnas ancladas por algún wire (par 0 de sus relaciones): el
   *  nodo compacto les deja handles fantasma con el MISMO id que la fila del
   *  modo detallado, así los edges nunca se re-arman ni pierden ancla. */
  refCols?: string[];
  [key: string]: unknown;
}

function TableNode({ data }: NodeProps) {
  const { table, columns, lod, refCols } = data as TableNodeData;
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
  // Columnas a RESALTAR cuando el wire de una relación está bajo el mouse (o
  // seleccionado): TODAS las de los pares que tocan ESTA tabla. El selector
  // devuelve un string estable ('' para las tablas no afectadas) para que el
  // hover sólo re-renderice los 2 nodos de la relación, no el canvas entero.
  const hotColsKey = useModelerStore((s) => {
    const relId = s.hoverEdgeId ?? s.selectedEdgeId;
    if (!relId || !s.diagram) return '';
    const rel = s.diagram.relationships.find((r) => r.id === relId);
    if (!rel || (rel.parentTableId !== table.id && rel.childTableId !== table.id)) return '';
    const ids: string[] = [];
    for (const p of rel.pairs) {
      if (rel.parentTableId === table.id && p.parentColumnId) ids.push(p.parentColumnId);
      if (rel.childTableId === table.id && p.childColumnId) ids.push(p.childColumnId);
    }
    return ids.join('|');
  });
  const hotCols = useMemo(() => new Set(hotColsKey ? hotColsKey.split('|') : []), [hotColsKey]);

  const nameOf = (o: { logicalName: string; physicalName: string }) =>
    viewMode === 'logical' ? o.logicalName : o.physicalName;
  // Bloque PK en el ORDEN DE LA LLAVE (pkPosition), como Erwin — no en el
  // orden físico de columnas; sin pkPosition (PK marcada a mano) cae al
  // ordinal. Misma regla que el PRIMARY KEY(...) del DDL (lib/keyOrder).
  const pks = pkInKeyOrder(columns);
  const rest = columns.filter((c) => !c.isPrimaryKey);

  // LOD (doc 33): caja compacta con el MISMO tamaño, header y franja PK que el
  // nodo detallado — a este zoom las filas medían <1px, no se pierde nada
  // visible. Handles: el del header (ancla de derivaciones) + fantasmas por
  // columna referenciada por wires (mismo id que la fila real → los edges no
  // cambian entre modos). Sin botón "+" (la edición vuelve al acercar).
  if (lod) {
    const { w, h, pkRows } = tableLodSize(table as CanonicalTable, columns, viewMode);
    return (
      <div className={`wk-node wk-lod${selected ? ' sel' : ''}`} style={{ width: w, height: h }}>
        <div className="wk-node-head">
          <Table2 size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
          <span className="rd-mono wk-node-title">
            {table.schema && <span className="wk-node-schema">{table.schema}.</span>}
            {nameOf(table)}
          </span>
          <Handle type="source" position={Position.Right} id="__hdr_src" isConnectable={false} className="wk-hdr-handle" />
        </div>
        {pkRows > 0 && <div className="wk-node-pk" style={{ height: pkRows * 28 }} />}
        {(refCols ?? []).map((cid) => (
          <span key={cid}>
            <Handle type="source" position={Position.Right} id={`${cid}__src`} isConnectable={false} className="wk-hdr-handle" style={{ top: '50%' }} />
            <Handle type="target" position={Position.Left} id={`${cid}__tgt`} isConnectable={false} className="wk-hdr-handle" style={{ top: '50%' }} />
          </span>
        ))}
      </div>
    );
  }

  const renderRow = (c: CanonicalColumn) => (
    <div className={`wk-node-row${hotCols.has(c.id) ? ' hot' : ''}`} key={c.id}>
      <span className="wk-node-key" aria-hidden>
        {c.isPrimaryKey ? (
          <KeyRound size={11} strokeWidth={2} style={{ color: 'var(--k-pk)' }} />
        ) : c.isForeignKey ? (
          <Link2 size={11} strokeWidth={2} style={{ color: 'var(--k-fk)' }} />
        ) : null}
      </span>
      <span className={`wk-node-name${c.isForeignKey ? ' fk' : ''}`}>{nameOf(c)}</span>
      <span className="wk-node-dt rd-mono" title={isComplexType(c.dataType) ? c.dataType : undefined}>
        {collapseComplexType(c.dataType)}
      </span>
      {/* Doc 47: las columnas ya NO inician relaciones (el origen es la
          cabecera del padre); siguen siendo el destino del drop en el hijo. */}
      <Handle type="source" position={Position.Right} id={`${c.id}__src`} isConnectable={connectable}
        isConnectableStart={false} className="wk-handle" />
      <Handle type="target" position={Position.Left} id={`${c.id}__tgt`} isConnectable={connectable}
        isConnectableStart={false} className="wk-handle" />
    </div>
  );

  return (
    <div className={`wk-node${selected ? ' sel' : ''}`}>
      <div className="wk-node-head">
        <Table2 size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
        {/* Header = SOLO esquema.nombre del modo activo (lógico o físico); el
            nombre del otro modo no se muestra — sin nowrap envolvía en varias
            líneas y estiraba el nodo hacia ABAJO al topar el max-width. */}
        <span className="rd-mono wk-node-title">
          {table.schema && <span className="wk-node-schema">{table.schema}.</span>}
          {nameOf(table)}
        </span>
        {canEdit && <button className="wk-node-add" title="Add column" onClick={() => setColumnTarget(table.id)}>+</button>}
        {/* Origen de RELACIONES (doc 47): con la herramienta armada, el header
            entero inicia el drag (hit-area .armed). Sin armar queda 1px
            invisible: sigue siendo el ancla de las derivaciones F3 y de los
            wires crowfoot (sourceHandle __hdr_src). */}
        <Handle type="source" position={Position.Right} id="__hdr_src" isConnectable={connectable}
          className={`wk-hdr-handle${connectable ? ' armed' : ''}`} />
      </div>
      {pks.length > 0 && <div className="wk-node-pk">{pks.map(renderRow)}</div>}
      {pks.length > 0 && rest.length > 0 && <div className="wk-node-div" />}
      {rest.map(renderRow)}
      {columns.length === 0 && <div className="wk-node-empty rd-small">No columns</div>}
    </div>
  );
}

// memo: React Flow re-renderiza los custom nodes en cada update del grafo
// (pan/zoom/drag); sin memo, un canvas de 100 tablas × 30 columnas repinta
// ~3.000 filas + ~6.000 handles por frame.
export default memo(TableNode);
