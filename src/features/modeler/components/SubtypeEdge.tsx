import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, useInternalNode, Position, type EdgeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { SYMBOL_SIZE } from '../lib/subtypeGraph';

// Colores LITERALES (tokens.css resueltos): el SVG del Export image no
// resuelve CSS vars fuera del documento (mismo criterio que DerivationEdge).
const INK = '#3A4658';       // --ink-2
const PRIMARY = '#2E5BFF';   // --primary
const DANGER = '#C0392B';    // --red
const CANVAS = '#FBFCFD';    // --canvas-bg — carve central del trazo doble

/**
 * Arista de SUBCATEGORÍA (doc 53): TRAZO DOBLE sólido sin crow's-foot — el
 * rasgo distintivo frente a identifying (sólida simple), non-identifying
 * (punteada) y derivación de vistas (oblicua ploma). El doble se dibuja con
 * un trazo ancho del color de la arista más un carve central del color del
 * canvas. Dos variantes con el mismo tipo: tronco supertipo→símbolo
 * (`data.trunk`) y símbolo→subtipo (id = rel.id). El lado de salida/entrada
 * se recalcula por posición de los nodos; la Y de anclaje en tablas usa la
 * del handle real y en el símbolo su centro. Drift (llave fuera de sync) →
 * rojo; pending = fantasma punteado simple.
 */
function SubtypeEdge(props: EdgeProps) {
  const { id, source, target, sourceY, targetY, data } = props;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const active = useModelerStore(
    (s) => s.hoverEdgeId === id || s.selectedEdgeId === id
      || (!!s.hoverNodeId && (source === s.hoverNodeId || target === s.hoverNodeId)),
  );
  const anyHover = useModelerStore((s) => !!s.hoverEdgeId || !!s.hoverNodeId);

  if (!sourceNode || !targetNode) return null;
  const d = (data ?? {}) as { trunk?: boolean; pending?: boolean; drifted?: boolean; symbolId?: string };

  const sAbs = sourceNode.internals.positionAbsolute;
  const tAbs = targetNode.internals.positionAbsolute;
  const sw = sourceNode.measured?.width ?? (sourceNode.type === 'subcat' ? SYMBOL_SIZE : 230);
  const tw = targetNode.measured?.width ?? (targetNode.type === 'subcat' ? SYMBOL_SIZE : 230);
  const sourceFacesRight = (sAbs.x + sw / 2) <= (tAbs.x + tw / 2);

  const sx = sourceFacesRight ? sAbs.x + sw : sAbs.x;
  const tx = sourceFacesRight ? tAbs.x : tAbs.x + tw;
  const sPos = sourceFacesRight ? Position.Right : Position.Left;
  const tPos = sourceFacesRight ? Position.Left : Position.Right;

  // Los extremos que son SÍMBOLO anclan a su centro vertical; las tablas
  // conservan la Y de su handle (cabecera del supertipo / columna del subtipo).
  const sh = sourceNode.measured?.height ?? SYMBOL_SIZE;
  const th = targetNode.measured?.height ?? SYMBOL_SIZE;
  const sy = sourceNode.type === 'subcat' ? sAbs.y + sh / 2 : sourceY;
  const ty = targetNode.type === 'subcat' ? tAbs.y + th / 2 : targetY;

  const [path] = getSmoothStepPath({
    sourceX: sx, sourceY: sy, sourcePosition: sPos,
    targetX: tx, targetY: ty, targetPosition: tPos,
    borderRadius: 10,
  });

  const dimmed = anyHover && !active;
  const color = d.pending ? PRIMARY : d.drifted ? DANGER : active ? PRIMARY : INK;
  const opacity = d.pending ? 0.5 : dimmed ? 0.22 : 1;
  const fx = { transition: 'opacity .12s, stroke .12s, stroke-width .12s' };

  if (d.pending) {
    return (
      <BaseEdge
        path={path}
        style={{ stroke: color, strokeWidth: 1.6, strokeDasharray: '6 5', opacity, ...fx }}
      />
    );
  }
  return (
    <>
      <BaseEdge
        path={path}
        style={{ stroke: color, strokeWidth: active ? 5.4 : 4.4, opacity, ...fx }}
      />
      <BaseEdge
        path={path}
        style={{ stroke: CANVAS, strokeWidth: active ? 2.4 : 1.8, opacity,
                 pointerEvents: 'none' as const, ...fx }}
      />
    </>
  );
}

export default memo(SubtypeEdge);
