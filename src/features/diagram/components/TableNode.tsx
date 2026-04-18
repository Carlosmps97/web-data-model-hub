'use client';

import React, { useState, memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TableModel } from '@/types/model';
import { useUIStore } from '@/store/useUIStore';
import { useModelStore } from '@/store/useModelStore';
import TableNodeGearMenu from './TableNodeGearMenu';

const DEFAULT_COLOR = '#468189';

interface TableNodeData {
  table: TableModel;
  selected?: boolean;
  activeRelationColumns?: string[];
  onEditTable?: (id: string) => void;
  [key: string]: unknown;
}

function TableNodeComponent({ data }: NodeProps) {
  const nodeData = data as TableNodeData;
  const table = nodeData?.table;
  const isSelected = nodeData?.selected || false;
  const activeRelCols = nodeData?.activeRelationColumns ?? [];
  const onEditTable = nodeData?.onEditTable as ((id: string) => void) | undefined;

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

  const handleApplyColor = useCallback((color: string) => {
    updateTable(table.id, { color });
  }, [updateTable, table?.id]);

  if (!table) return null;

  return (
    <div className={`table-node ${isSelected ? 'selected' : ''}`}>
      {/* Header */}
      <div
        className="table-node-header"
        style={{ background: headerColor }}
      >
        <span className="table-node-title">{table.name}</span>
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
            onApplyColor={handleApplyColor}
            onClose={() => setGearMenuOpen(false)}
          />
        )}
      </div>

      {/* Columns */}
      <div className="table-node-columns">
        {table.columns.map((col, idx) => {
          let iconLabel = '';
          let iconClass = '';
          if (col.isPrimaryKey) { iconLabel = 'PK'; iconClass = 'pk'; }
          else if (col.isForeignKey) { iconLabel = 'FK'; iconClass = 'fk'; }
          else if (col.isSurrogateKey) { iconLabel = 'SK'; iconClass = 'sk'; }
          else if (col.isPartitionKey) { iconLabel = 'PT'; iconClass = 'pk'; }

          const isActiveRelation = activeRelCols.includes(col.name);

          return (
            <div
              key={idx}
              className={`table-node-column${isActiveRelation ? ' active-relation-row' : ''}`}
              onMouseEnter={() => setHoveredCol(idx)}
              onMouseLeave={() => setHoveredCol(null)}
            >
              {/* Left handle (target) — invisible, functional */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.name}-target`}
                className="dbdiagram-handle"
              />

              {/* Key icon */}
              <div className={`table-node-col-icon ${iconClass}`}>
                {iconLabel ? iconLabel : (
                  <svg width="8" height="8" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="2.5" fill="#c4ccc9" />
                  </svg>
                )}
              </div>

              {/* Column name */}
              <span className="table-node-col-name">{col.name}</span>

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

              {/* Right handle (source) — invisible, functional */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${col.name}-source`}
                className="dbdiagram-handle"
              />

              {/* Tooltip — shows on hover for every column */}
              {hoveredCol === idx && (
                <div className="table-node-column-tooltip">
                  <strong>{col.name} {col.dataType}</strong>
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

      {/* Footer description */}
      {table.functionalDefinition && (
        <div className="table-node-footer">
          {table.functionalDefinition.length > 45
            ? table.functionalDefinition.substring(0, 45) + '…'
            : table.functionalDefinition}
        </div>
      )}
    </div>
  );
}

export default memo(TableNodeComponent);
