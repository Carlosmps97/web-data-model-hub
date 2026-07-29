import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Eye, Pencil } from 'lucide-react';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { CanonicalTable } from '@/features/governance/services/governance.service';
import type { View } from '@/services/views.service';
import { collapseComplexType, isComplexType } from '../lib/complexTypes';
import { viewNodeRows } from '../lib/viewGraph';
import { viewLodSize } from '../lib/lodSize';

export interface ViewNodeData {
  view: View;
  /** Tablas fuente resueltas (las presentes en el diagrama). Las conserva
   *  ModelerCanvas para trazar el wire de derivación; el nodo ya no las lista. */
  sourceTables: CanonicalTable[];
  /** dataType de la columna origen por `${tableId}::${column}`. */
  colTypes: Record<string, string>;
  /** Abre el ViewEditor (lo inyecta ModelerCanvas). */
  onEdit: (viewId: string) => void;
  /** LOD (doc 33): render compacto bajo el umbral de zoom. */
  lod?: boolean;
  [key: string]: unknown;
}

/**
 * Nodo VISTA del canvas (F3, spec §3-5): card "medio plomo" — header gris
 * pizarra con ojo + badge VISTA, borde punteado envolvente y cuerpo con hatch
 * diagonal tenue a 45°. La derivación se comunica SOLO por el wire punteado
 * tabla→vista (el nodo ya no lleva etiqueta "Origen/Deriva de"). Click = SOLO
 * selección (usa el `selected` nativo de React Flow — nunca abre el
 * PropertiesPanel); el lápiz del header abre el ViewEditor si canEdit.
 */
function ViewNode({ data, selected }: NodeProps) {
  const { view, colTypes, onEdit, lod } = data as ViewNodeData;
  // Mismo gate que TableNode: en modo visor no hay affordances de edición.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;

  const rows = viewNodeRows(view, colTypes);

  // LOD (doc 33): misma caja "medio plomo" (borde punteado + hatch del body =
  // la identidad visual de VISTA a lo lejos) con el MISMO tamaño, sin filas.
  // Conserva el ancla del wire de derivación (__hdr_tgt). Sin lápiz de edición.
  if (lod) {
    const { w, h } = viewLodSize(view, colTypes);
    return (
      <div className={`wk-vnode wk-lod${selected ? ' sel' : ''}`} style={{ width: w, height: h }}>
        <div className="wk-vnode-head">
          <Eye size={13} strokeWidth={1.9} className="wk-node-glyph" aria-hidden />
          <span className="rd-mono wk-vnode-title">
            {view.schema && <span className="wk-node-schema">{view.schema}.</span>}
            {view.name}
          </span>
          <span className="wk-vnode-badge">VISTA</span>
          <Handle type="target" position={Position.Left} id="__hdr_tgt" isConnectable={false} className="wk-hdr-handle" />
        </div>
        <div className="wk-vnode-body wk-lod-body" />
      </div>
    );
  }

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
          <button className="wk-vnode-edit" title="Edit view"
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
    </div>
  );
}

// memo: mismo motivo que TableNode — React Flow re-renderiza los custom nodes
// en cada update del grafo (pan/zoom/drag).
export default memo(ViewNode);
