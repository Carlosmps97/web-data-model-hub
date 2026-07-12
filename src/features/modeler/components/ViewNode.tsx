import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Eye, GitBranch, Pencil } from 'lucide-react';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { CanonicalTable } from '@/features/governance/services/governance.service';
import type { View } from '@/services/views.service';
import { collapseComplexType, isComplexType } from '../lib/complexTypes';
import { viewNodeRows } from '../lib/viewGraph';

export interface ViewNodeData {
  view: View;
  /** Tablas fuente resueltas (las presentes en el diagrama), para el footer. */
  sourceTables: CanonicalTable[];
  /** dataType de la columna origen por `${tableId}::${column}`. */
  colTypes: Record<string, string>;
  /** Abre el ViewEditor (lo inyecta ModelerCanvas). */
  onEdit: (viewId: string) => void;
  [key: string]: unknown;
}

/**
 * Nodo VISTA del canvas (F3, spec §3-5): header oscuro con ojo + badge VISTA,
 * franja izquierda punteada, filas alias+tipo (marca fx si expresión/cast) y
 * footer "Origen: …" (nombres según viewMode lógico/físico). Click = SOLO
 * selección (usa el `selected` nativo de React Flow — nunca abre el
 * PropertiesPanel); el lápiz del header abre el ViewEditor si canEdit.
 */
function ViewNode({ data, selected }: NodeProps) {
  const { view, sourceTables, colTypes, onEdit } = data as ViewNodeData;
  // Mismo gate que TableNode: en modo visor no hay affordances de edición.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  const viewMode = useModelerStore((s) => s.viewMode);

  const nameOf = (t: CanonicalTable) => (viewMode === 'logical' ? t.logicalName : t.physicalName);
  const rows = viewNodeRows(view, colTypes);

  return (
    <div className={`wk-vnode${selected ? ' sel' : ''}`}>
      <div className="wk-vnode-head">
        <Eye size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
        <span className="rd-mono wk-vnode-title">
          {view.schema && <span className="wk-node-schema">{view.schema}.</span>}
          {view.name}
        </span>
        <span className="wk-vnode-badge">VISTA</span>
        {canEdit && (
          <button className="wk-vnode-edit" title="Editar vista"
            onClick={(e) => { e.stopPropagation(); onEdit(view.id); }}>
            <Pencil size={11} />
          </button>
        )}
        {/* Ancla del wire de derivación (header-a-header). No conectable. */}
        <Handle type="target" position={Position.Left} id="__hdr_tgt" isConnectable={false} className="wk-hdr-handle" />
      </div>
      <div className="wk-vnode-body">
        {rows.map((r, i) => (
          <div className="wk-node-row" key={`${r.name}-${i}`}>
            {r.fx
              ? <span className="wk-vnode-fx" aria-hidden>fx</span>
              : <span className="wk-vnode-fx-sp" aria-hidden />}
            <span className="wk-node-name">{r.name}</span>
            <span className="wk-node-dt rd-mono" title={isComplexType(r.type) ? r.type : undefined}>
              {collapseComplexType(r.type)}
            </span>
          </div>
        ))}
        {rows.length === 0 && <div className="wk-node-empty rd-small">Sin columnas</div>}
      </div>
      <div className="wk-vnode-foot rd-mono">
        <GitBranch size={11} strokeWidth={2} aria-hidden />
        <span className="wk-vnode-foot-k">Origen</span>
        {sourceTables.length ? sourceTables.map(nameOf).join(' · ') : '—'}
      </div>
    </div>
  );
}

// memo: mismo motivo que TableNode — React Flow re-renderiza los custom nodes
// en cada update del grafo (pan/zoom/drag).
export default memo(ViewNode);
