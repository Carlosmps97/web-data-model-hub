import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, useInternalNode, Position, type EdgeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import type { Cardinality } from '@/features/governance/services/governance.service';

function CrowFootEdge(props: EdgeProps) {
  const { id, source, target, sourceY, targetY, data } = props;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // Selectores DERIVADOS (booleanos por edge, no los ids crudos): con los ids,
  // cada hover re-renderizaba TODOS los edges del canvas; así sólo cambian los
  // afectados por el resaltado/atenuado.
  const active = useModelerStore(
    (s) => s.hoverEdgeId === id || s.selectedEdgeId === id
      || (!!s.hoverNodeId && (source === s.hoverNodeId || target === s.hoverNodeId)),
  );
  const anyHover = useModelerStore((s) => !!s.hoverEdgeId || !!s.hoverNodeId);

  if (!sourceNode || !targetNode) return null;
  // `pending` = edge fantasma optimista: recién dibujado, aún persistiéndose.
  // v2 (doc 19): source del edge = PADRE (lado PK), target = HIJO (lado FK).
  const d = (data ?? {}) as {
    parentCardinality: Cardinality; childCardinality: Cardinality;
    identifying: boolean; pending?: boolean; pairCount?: number;
  };

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

  // Ruteo ortogonal (H/V) con esquinas redondeadas — lo provee React Flow
  // (`getSmoothStepPath`), sin matemática manual de caminos.
  const [path] = getSmoothStepPath({
    sourceX: sx, sourceY, sourcePosition: sPos,
    targetX: tx, targetY, targetPosition: tPos,
    borderRadius: 10,
  });

  // Resaltado (dbdiagram): activa la relación bajo el mouse o las conectadas a la
  // tabla bajo el mouse; atenúa el resto.
  const dimmed = anyHover && !active;
  const stroke = d.pending ? 'var(--primary)' : active ? 'var(--primary)' : 'var(--ink-2)';

  return (
    <BaseEdge
      path={path}
      markerStart={`url(#cf-${d.parentCardinality ?? 'one'})`}
      markerEnd={`url(#cf-${d.childCardinality ?? 'zero-many'})`}
      style={{
        stroke,
        strokeWidth: active ? 2.4 : 1.5,
        // Convención Erwin (doc 19): identifying = línea SÓLIDA (la FK entra a
        // la PK del hijo); non-identifying = punteada. Pending: dash más aireado.
        strokeDasharray: d.pending ? '6 5' : d.identifying ? undefined : '7 4',
        opacity: d.pending ? 0.5 : dimmed ? 0.22 : 1,
        transition: 'opacity .12s, stroke .12s, stroke-width .12s',
      }}
    />
  );
}

export default memo(CrowFootEdge);
