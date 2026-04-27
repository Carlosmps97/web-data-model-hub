'use client';

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ViewModel, ViewType } from '@/types/model';

const VIEW_TYPE_META: Record<ViewType, { label: string; color: string; bg: string }> = {
  technical: { label: 'TECH',  color: '#0369a1', bg: '#e0f2fe' },
  user:      { label: 'USER',  color: '#0d9488', bg: '#ccfbf1' },
  business:  { label: 'BIZ',   color: '#7c3aed', bg: '#ede9fe' },
};

interface ViewNodeData {
  view: ViewModel;
  sourceTableName?: string;
  selected?: boolean;
  onEditView?: (id: string) => void;
  [key: string]: unknown;
}

function ViewNodeComponent({ data }: NodeProps) {
  const nodeData = data as ViewNodeData;
  const view     = nodeData?.view;
  const srcName  = nodeData?.sourceTableName ?? '';
  const isSelected = nodeData?.selected ?? false;
  const onEdit   = nodeData?.onEditView as ((id: string) => void) | undefined;

  if (!view) return null;

  const typeMeta = VIEW_TYPE_META[view.viewType] ?? VIEW_TYPE_META.technical;
  const includedCols = view.columns.filter((c) => c.include);
  const hasExpressions = includedCols.some((c) => !!c.expression);
  const hasWhere = !!view.whereClause?.trim();
  const hasCustomSql = !!view.useCustomSql;

  return (
    <div className={`view-node ${isSelected ? 'selected' : ''}`}>
      {/* Header */}
      <div className="view-node-header" style={{ borderBottom: `2px solid ${typeMeta.color}` }}>
        <div className="view-node-header-top">
          {/* View type badge */}
          <span
            className="view-node-type-badge"
            style={{ background: typeMeta.bg, color: typeMeta.color }}
            title={`Vista ${view.viewType}`}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="12" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            {typeMeta.label}
          </span>

          <span className="view-node-name" title={view.logicalName || view.name}>
            {view.logicalName || view.name}
          </span>

          {onEdit && (
            <button
              className="view-node-edit-btn nodrag"
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(view.id); }}
              title="Editar vista"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Physical name (if different) + source table */}
        <div className="view-node-meta">
          {view.logicalName && view.name !== view.logicalName && (
            <span className="view-node-physical">{view.schema ? `${view.schema}.` : ''}{view.name}</span>
          )}
          {srcName && (
            <span className="view-node-source">← {srcName}</span>
          )}
        </div>
      </div>

      {/* Custom SQL indicator */}
      {hasCustomSql ? (
        <div className="view-node-custom-sql">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
          Query personalizado
        </div>
      ) : (
        /* Column list */
        <div className="view-node-columns">
          {includedCols.map((col, idx) => {
            const hasExpr = !!col.expression;
            const hasAlias = !!col.alias && col.alias !== col.sourceColumn;
            return (
              <div key={idx} className="view-node-col">
                {/* Left handle */}
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${view.id}-${col.sourceColumn}-target`}
                  className="dbdiagram-handle"
                />

                {/* Expression badge */}
                {hasExpr && (
                  <span className="view-node-fx" title={col.expression}>fx</span>
                )}

                {/* Column display */}
                <span className="view-node-col-name">
                  {hasAlias ? (
                    <>
                      <span className="view-node-col-source">{col.sourceColumn}</span>
                      <span className="view-node-col-arrow">→</span>
                      <span className="view-node-col-alias">{col.alias}</span>
                    </>
                  ) : col.sourceColumn}
                </span>

                {/* Right handle */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${view.id}-${col.sourceColumn}-source`}
                  className="dbdiagram-handle"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: indicators */}
      {(hasWhere || hasExpressions) && (
        <div className="view-node-footer">
          {hasWhere && (
            <span className="view-node-indicator" title={`WHERE ${view.whereClause}`}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              WHERE
            </span>
          )}
          {hasExpressions && !hasCustomSql && (
            <span className="view-node-indicator">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              Expresiones SQL
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ViewNodeComponent);
