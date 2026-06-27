import { BaseEdge, getBezierPath, useInternalNode, Position, type EdgeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import type { Cardinality } from '@/features/governance/services/governance.service';

export default function CrowFootEdge(props: EdgeProps) {
  const { id, source, target, sourceY, targetY, data } = props;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const hoverEdgeId = useModelerStore((s) => s.hoverEdgeId);
  const hoverNodeId = useModelerStore((s) => s.hoverNodeId);
  const selectedEdgeId = useModelerStore((s) => s.selectedEdgeId);

  if (!sourceNode || !targetNode) return null;
  const d = (data ?? {}) as { sourceCardinality: Cardinality; targetCardinality: Cardinality; identifying: boolean };

  // Lado que mira a la otra tabla (dbdiagram): si el centro del origen está a la
  // izquierda del centro del destino, el origen sale por la DERECHA y el destino
  // entra por la IZQUIERDA; si no, al revés. Se voltea solo al mover los nodos.
  const sAbs = sourceNode.internals.positionAbsolute;
  const tAbs = targetNode.internals.positionAbsolute;
  const sw = sourceNode.measured?.width ?? 230;
  const tw = targetNode.measured?.width ?? 230;
  const sourceFacesRight = (sAbs.x + sw / 2) <= (tAbs.x + tw / 2);

  const sx = sourceFacesRight ? sAbs.x + sw : sAbs.x;
  const tx = sourceFacesRight ? tAbs.x : tAbs.x + tw;
  const sPos = sourceFacesRight ? Position.Right : Position.Left;
  const tPos = sourceFacesRight ? Position.Left : Position.Right;

  const [path] = getBezierPath({
    sourceX: sx, sourceY, sourcePosition: sPos,
    targetX: tx, targetY, targetPosition: tPos,
  });

  // Resaltado (dbdiagram): activa la relación bajo el mouse o las conectadas a la
  // tabla bajo el mouse; atenúa el resto.
  const active = hoverEdgeId === id || selectedEdgeId === id || (!!hoverNodeId && (source === hoverNodeId || target === hoverNodeId));
  const anyHover = !!hoverEdgeId || !!hoverNodeId;
  const dimmed = anyHover && !active;
  const stroke = active ? 'var(--primary)' : 'var(--ink-2)';

  return (
    <BaseEdge
      path={path}
      markerStart={`url(#cf-${d.sourceCardinality ?? 'one'})`}
      markerEnd={`url(#cf-${d.targetCardinality ?? 'many'})`}
      style={{
        stroke,
        strokeWidth: active ? 2.4 : 1.5,
        strokeDasharray: d.identifying ? undefined : '6 4',
        opacity: dimmed ? 0.22 : 1,
        transition: 'opacity .12s, stroke .12s, stroke-width .12s',
      }}
    />
  );
}
