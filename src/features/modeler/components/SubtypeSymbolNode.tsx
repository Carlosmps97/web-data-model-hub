import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { SYMBOL_SIZE } from '../lib/subtypeGraph';

/**
 * Símbolo de subcategoría: el nodo intermedio del grupo supertipo→subtipos,
 * un rombo con barra discriminadora (variante de la notación Erwin). Es un
 * nodo derivado de las relaciones del grupo: no se persiste como entidad; su
 * posición vive en layout[symbolId]. Con la herramienta Subcategory armada, el
 * símbolo entero inicia el drag hacia un subtipo a agregar (flujo Erwin "clic
 * en el símbolo"). Doble clic → popup de gestión del grupo (lo maneja
 * ModelerCanvas).
 *
 * Colores literales (no CSS vars): el SVG del Export image no resuelve
 * variables en atributos (mismo criterio que DerivationEdge).
 */
function SubtypeSymbolNode({ id }: NodeProps) {
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  const armed = useModelerStore((s) => s.subcatArmed);
  const connectable = canEdit && armed;
  const hot = useModelerStore(
    (s) => s.hoverNodeId === id
      || (!!s.hoverEdgeId && s.hoverEdgeId.startsWith('subsym-') && s.hoverEdgeId === `subsym-${id}`),
  );
  const stroke = hot ? '#2E5BFF' : '#3A4658';
  return (
    <div
      className={`wk-subsym${connectable ? ' armed' : ''}`}
      style={{ width: SYMBOL_SIZE, height: SYMBOL_SIZE }}
      title={connectable
        ? 'Drag from this symbol onto a table to add another subtype'
        : 'Subcategory — double-click to manage its subtypes'}
    >
      <svg viewBox="0 0 28 28" width={SYMBOL_SIZE} height={SYMBOL_SIZE} aria-hidden>
        <path d="M14 2.4 L25.6 14 L14 25.6 L2.4 14 Z" fill="#FBFCFD" stroke={stroke}
          strokeWidth="1.8" strokeLinejoin="round" />
        <line x1="8.8" y1="14" x2="19.2" y2="14" stroke={stroke} strokeWidth="1.8" />
      </svg>
      <Handle type="target" position={Position.Top} id="__sym_tgt" isConnectable={false} className="wk-sym-handle" />
      <Handle type="source" position={Position.Bottom} id="__sym_src" isConnectable={connectable}
        className={`wk-sym-handle${connectable ? ' armed' : ''}`} />
    </div>
  );
}

export default memo(SubtypeSymbolNode);
