'use client';

import React, { useState, memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TableModel } from '@/types/model';
import { useUIStore } from '@/store/useUIStore';
import { useModelStore } from '@/store/useModelStore';
import TableNodeGearMenu from './TableNodeGearMenu';

const DEFAULT_COLOR = '#0d9488';

interface TableNodeData {
  table: TableModel;
  selected?: boolean;
  activeRelationColumns?: string[];
  /**
   * Map of `columnId → 'left' | 'right'` reflecting which side ELK
   * placed the column's source port on after the most recent layout.
   * Purely a styling hint now — every column row renders a full set of
   * four handles (`source-left`, `target-left`, `source-right`,
   * `target-right`). The hint is used to fade the inactive handles so
   * they don't visually clutter the row, while keeping them as live
   * drop targets for the user when they re-route a connection by drag
   * or open Connect mode.
   */
  handleSideByColumn?: Record<string, 'left' | 'right'>;
  onEditTable?: (id: string) => void;
  onDeleteTable?: (id: string) => void;
  /**
   * Notify the canvas that the cursor entered/left a specific column
   * row. Wired by `DiagramCanvas` to `useHighlightController.onColumnHover`
   * so wires touching only the hovered column light up (Issue #5).
   * Pass `null` to clear.
   */
  onColumnHover?: (ref: { tableId: string; columnId: string } | null) => void;
  viewMode?: 'logical' | 'physical';
  [key: string]: unknown;
}

function TableNodeComponent({ data }: NodeProps) {
  const nodeData = data as TableNodeData;
  const table = nodeData?.table;
  const isSelected = nodeData?.selected || false;
  const activeRelCols = nodeData?.activeRelationColumns ?? [];
  const handleSideByColumn = nodeData?.handleSideByColumn;
  const onEditTable = nodeData?.onEditTable as ((id: string) => void) | undefined;
  const onDeleteTable = nodeData?.onDeleteTable as ((id: string) => void) | undefined;
  const onColumnHover = nodeData?.onColumnHover as
    | ((ref: { tableId: string; columnId: string } | null) => void)
    | undefined;
  const viewMode = (nodeData?.viewMode as 'logical' | 'physical' | undefined) ?? 'physical';
  const isLogical = viewMode === 'logical';

  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [gearMenuOpen, setGearMenuOpen] = useState(false);

  // Live preview from UI store — applies to any table when its gear menu is open
  const previewColor = useUIStore(s => s.previewColor);
  const headerColor = (gearMenuOpen && previewColor !== null)
    ? previewColor
    : (table?.color ?? DEFAULT_COLOR);

  const updateTable = useModelStore(s => s.updateTable);

  const handleGearClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setGearMenuOpen(prev => !prev);
  }, []);

  const handleEdit = useCallback(() => {
    onEditTable?.(table.id);
  }, [onEditTable, table?.id]);

  const handleDelete = useCallback(() => {
    onDeleteTable?.(table.id);
  }, [onDeleteTable, table?.id]);

  const handleApplyColor = useCallback((color: string) => {
    updateTable(table.id, { color });
  }, [updateTable, table?.id]);

  if (!table) return null;

  return (
    <div className={`table-node ${isSelected ? 'selected' : ''} ${isLogical ? 'table-node--logical' : ''}`}>
      {/* Header */}
      <div
        className="table-node-header"
        style={{ background: isLogical ? 'var(--color-indigo-primary)' : headerColor }}
      >
        <span className="table-node-title">
          {isLogical ? (
            // Vista lógica: muestra nombre de entidad (lógico) sin schema
            <>{table.logicalName || table.name}</>
          ) : (
            // Vista física: muestra schema.nombre
            <>
              {table.schema && (
                <span className="table-node-schema">{table.schema}.</span>
              )}
              {table.name}
            </>
          )}
        </span>
        {table.partition && table.partition.strategy !== 'NONE' && table.partition.columns.length > 0 && (
          <span
            className="table-node-partition-badge"
            title={`Partitioned by ${table.partition.strategy} (${table.partition.columns.join(', ')})`}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </span>
        )}
        <span className="table-node-badge">{table.columns.length}</span>
        <button
          className="table-node-gear-btn nodrag"
          onClick={handleGearClick}
          onMouseDown={(e) => e.stopPropagation()}
          title="Options"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {gearMenuOpen && (
          <TableNodeGearMenu
            currentColor={table.color}
            onEdit={handleEdit}
            onDelete={onDeleteTable ? handleDelete : undefined}
            onApplyColor={handleApplyColor}
            onClose={() => setGearMenuOpen(false)}
          />
        )}
      </div>

      {/* Columns */}
      <div className="table-node-columns">
        {table.columns.map((col, idx) => {
          const isPartitionCol =
            !!col.isPartitionKey ||
            !!table.partition?.columns?.includes(col.name);
          let iconLabel = '';
          let iconClass = '';
          if (col.isPrimaryKey) { iconLabel = 'PK'; iconClass = 'pk'; }
          else if (col.isForeignKey) { iconLabel = 'FK'; iconClass = 'fk'; }
          else if (col.isSurrogateKey) { iconLabel = 'SK'; iconClass = 'sk'; }
          else if (isPartitionCol) { iconLabel = 'PT'; iconClass = 'pk'; }

          // `activeRelationColumns` now carries column IDs (kept in sync with
          // `Relationship.sourceColumn`/`targetColumn`), so match against
          // `col.id`. Falls back to name-match to stay compatible with legacy
          // pre-migration relationships that still hold column names.
          const isActiveRelation =
            activeRelCols.includes(col.id) || activeRelCols.includes(col.name);

          // Every column row carries the full set of four handles —
          // source-left, target-left, source-right, target-right —
          // keyed by column id (NOT name) so connections survive
          // renames. We pass the ELK-chosen side via `handleSideByColumn`
          // purely to dim the unused pair so the row stays visually
          // calm. All four are live drop targets so the canvas can:
          //   1. switch sides dynamically at render time when a node is
          //      dragged across its peer (CrowsFootEdge picks the right
          //      anchor each frame),
          //   2. let the user start a Connect-mode drag from any side
          //      of any column without ELK having to "approve" the side
          //      first (Issue #6).
          // Handle ids encode the side so React Flow can map an edge's
          // `sourceHandle` / `targetHandle` to the right anchor.
          const elkSide = handleSideByColumn?.[col.id];
          const dimLeft = elkSide === 'right';
          const dimRight = elkSide === 'left';

          return (
            <div
              key={idx}
              className={`table-node-column${isActiveRelation ? ' active-relation-row' : ''}`}
              onMouseEnter={() => {
                setHoveredCol(idx);
                onColumnHover?.({ tableId: table.id, columnId: col.id });
              }}
              onMouseLeave={() => {
                setHoveredCol(null);
                onColumnHover?.(null);
              }}
            >
              {/* Left-side handle pair. Both source + target render so
                  the edge can anchor to whichever ELK / live routing
                  picks. Visual dim controlled by `handleSideByColumn`. */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.id}-target-left`}
                className={`dbdiagram-handle${dimLeft ? ' dbdiagram-handle--inactive' : ''}`}
              />
              <Handle
                type="source"
                position={Position.Left}
                id={`${col.id}-source-left`}
                className={`dbdiagram-handle${dimLeft ? ' dbdiagram-handle--inactive' : ''}`}
              />

              {/* Main column row — name, type, nullable, PK/FK icon */}
              <div className="table-node-column-main">
                {/* Key icon */}
                <div className={`table-node-col-icon ${iconClass}`}>
                  {iconLabel ? iconLabel : (
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="2.5" fill="#c4ccc9" />
                    </svg>
                  )}
                </div>

                {/* Column name — lógico o físico según viewMode */}
                <span className="table-node-col-name">
                  {isLogical && col.logicalName ? col.logicalName : col.name}
                </span>

                {/* Nullable indicator */}
                {col.isNullable !== false && (
                  <span className="table-node-col-nullable">
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2L14 8L8 14L2 8Z" stroke="#b8c4c1" strokeWidth="1.5" fill="none" />
                    </svg>
                  </span>
                )}

                {/* Data type */}
                <span className="table-node-col-type">{col.dataType}</span>
              </div>

              {/* Right-side handle pair. Same rules as the left pair —
                  always rendered, dimmed when ELK chose the opposite
                  side as the canonical anchor for this column. */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${col.id}-source-right`}
                className={`dbdiagram-handle${dimRight ? ' dbdiagram-handle--inactive' : ''}`}
              />
              <Handle
                type="target"
                position={Position.Right}
                id={`${col.id}-target-right`}
                className={`dbdiagram-handle${dimRight ? ' dbdiagram-handle--inactive' : ''}`}
              />

              {/* Tooltip — shows on hover for every column */}
              {hoveredCol === idx && (
                <div className="table-node-column-tooltip">
                  <strong>{col.logicalName ? `${col.logicalName} / ` : ''}{col.name}</strong>
                  <span style={{ color: '#9DBEBB', fontSize: '10px' }}>{col.dataType}</span>
                  {col.functionalDefinition && (
                    <span>{col.functionalDefinition}</span>
                  )}
                  {col.isForeignKey && col.foreignKeyRef && (
                    <span style={{ display: 'block', marginTop: 2, color: '#9DBEBB', fontSize: '10px' }}>
                      FK → {col.foreignKeyRef.table}.{col.foreignKeyRef.column}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: en lógico muestra dominio + definición, en físico solo definición */}
      {(table.functionalDefinition || (isLogical && table.domain)) && (
        <div className="table-node-footer">
          {isLogical && table.domain && (
            <span className="table-node-domain-badge">{table.domain}{table.subdomain ? ` › ${table.subdomain}` : ''}</span>
          )}
          {table.functionalDefinition && (
            <span>
              {table.functionalDefinition.length > 45
                ? table.functionalDefinition.substring(0, 45) + '…'
                : table.functionalDefinition}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(TableNodeComponent);
