'use client';

import React, { useState, memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TableModel } from '@/types/model';


interface TableNodeData {
  table: TableModel;
  selected?: boolean;
  activeRelationColumns?: string[];
  [key: string]: unknown;
}

function TableNodeComponent({ data }: NodeProps) {
  const nodeData = data as TableNodeData;
  const table = nodeData?.table;
  const isSelected = nodeData?.selected || false;
  const activeRelCols = nodeData?.activeRelationColumns ?? [];
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  if (!table) return null;

  return (
    <div className={`table-node ${isSelected ? 'selected' : ''}`}>
      {/* Header */}
      <div className="table-node-header">
        <span className="table-node-title">{table.name}</span>
        <span className="table-node-badge">{table.columns.length}</span>
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

          const hasTooltip = col.functionalDefinition || col.isForeignKey;

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

              {/* Tooltip */}
              {hoveredCol === idx && hasTooltip && (
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
