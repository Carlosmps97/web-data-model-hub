import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';

// Gris tenue LITERAL (no CSS var): el SVG exportado (Export image) no resuelve
// variables fuera del documento, así el wire sale idéntico en la imagen.
const STROKE = '#94A3B8';

/**
 * Wire de DERIVACIÓN tabla→vista (F3, spec §3-5): bezier libre arqueado,
 * gris tenue, línea CONTINUA fina (las relaciones crow's-foot son ortogonales
 * y punteadas — este se distingue a propósito), etiqueta "DERIVA DE" y puntito
 * en el extremo de la vista. Header-a-header (handles __hdr_src/__hdr_tgt),
 * nunca de columnas; sin marcadores crow's-foot. Se atenúa/resalta con
 * hover/selección como los demás edges.
 */
function DerivationEdge(props: EdgeProps) {
  const { id, source, target, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  // Selectores DERIVADOS booleanos (mismo patrón que CrowFootEdge): hover y
  // selección solo re-renderizan los edges afectados.
  const active = useModelerStore(
    (s) => s.hoverEdgeId === id || s.selectedEdgeId === id
      || (!!s.hoverNodeId && (source === s.hoverNodeId || target === s.hoverNodeId)),
  );
  const anyHover = useModelerStore((s) => !!s.hoverEdgeId || !!s.hoverNodeId);
  const dimmed = anyHover && !active;

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35,
  });

  return (
    <g style={{ opacity: dimmed ? 0.22 : 1, transition: 'opacity .12s' }}>
      <BaseEdge path={path} style={{ stroke: STROKE, strokeWidth: active ? 1.8 : 1.2 }} />
      {/* Puntito en el extremo de la VISTA (target). */}
      <circle cx={targetX} cy={targetY} r={3} fill={STROKE} />
      {/* Etiqueta como <text> SVG (no EdgeLabelRenderer): así sale tal cual en
          el export SVG del toolbar. paint-order dibuja un halo claro debajo. */}
      <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', fill: STROKE,
          stroke: '#FBFCFD', strokeWidth: 3, paintOrder: 'stroke' }}>
        DERIVA DE
      </text>
    </g>
  );
}

export default memo(DerivationEdge);
