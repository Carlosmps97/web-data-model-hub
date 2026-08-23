import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { SYMBOL_SIZE } from '../lib/subtypeGraph';

/**
 * Símbolo de SUBCATEGORÍA (doc 53): el círculo intermedio del grupo
 * supertipo→subtipos (notación Erwin; subrayado simple = incompleta, lo que
 * produce el equipo). Es un nodo DERIVADO de las relaciones del grupo — no se
 * persiste como entidad; su posición vive en layout[symbolId]. Con la
 * herramienta Subcategory armada, el círculo entero inicia el drag hacia un
 * subtipo nuevo (flujo Erwin "click en el símbolo"). Doble click → popup de
 * gestión del grupo (lo maneja ModelerCanvas).
 *
 * Colores LITERALES (no CSS vars): el SVG del Export image no resuelve
 * variables en atributos (mismo criterio que DerivationEdge).
 */
function SubtypeSymbolNode({ id }: NodeProps) {
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
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
      <svg viewBox="0 0 26 26" width={SYMBOL_SIZE} height={SYMBOL_SIZE} aria-hidden>
        <circle cx="13" cy="13" r="10.5" fill="#FBFCFD" stroke={stroke} strokeWidth="1.7" />
        <line x1="5.5" y1="17" x2="20.5" y2="17" stroke={stroke} strokeWidth="1.7" />
      </svg>
      <Handle type="target" position={Position.Top} id="__sym_tgt" isConnectable={false} className="wk-sym-handle" />
      <Handle type="source" position={Position.Bottom} id="__sym_src" isConnectable={connectable}
        className={`wk-sym-handle${connectable ? ' armed' : ''}`} />
    </div>
  );
}

export default memo(SubtypeSymbolNode);
