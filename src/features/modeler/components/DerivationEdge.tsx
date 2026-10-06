import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';

// Gris tenue LITERAL (no CSS var): el SVG exportado (Export image) no resuelve
// variables fuera del documento, así el wire sale idéntico en la imagen.
const STROKE = '#94A3B8';

/**
 * Wire de DERIVACIÓN tabla→vista (F3, spec §3-5 · mock 2026-07-12): bezier
 * libre arqueado, gris tenue, línea CONTINUA fina (las relaciones crow's-foot
 * son ortogonales y punteadas — este se distingue a propósito), SIN etiqueta
 * y con un anillo hueco en el extremo de la vista. Header-a-header (handles
 * __hdr_src/__hdr_tgt), nunca de columnas; sin marcadores crow's-foot.
 * Se atenúa/resalta con hover/selección como los demás edges.
 */
function DerivationEdge(props: EdgeProps) {
  const { id, source, target, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  // Selectores DERIVADOS booleanos (mismo patrón que CrowFootEdge): hover y
  // selección solo re-renderizan los edges afectados.
  const active = useModelerStore(
    (s) => s.hoverEdgeId === id || s.selectedEdgeId === id
      || (!!s.hoverNodeId && (source === s.hoverNodeId || target === s.hoverNodeId)),
  );

  const [path] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35,
  });

  return (
    // Doc 111: el atenuado del resto lo hace la clase del canvas (CrowFootEdge).
    <g className={active ? 'wk-edge wk-edge--hot' : 'wk-edge'}>
      <BaseEdge path={path} style={{ stroke: STROKE, strokeWidth: active ? 1.8 : 1.2 }} />
      {/* Anillo hueco en el extremo de la VISTA (target); fill literal por el
          export SVG (no resuelve CSS vars fuera del documento). */}
      <circle cx={targetX} cy={targetY} r={3.5} fill="#FBFCFD" stroke={STROKE} strokeWidth={1.5} />
    </g>
  );
}

export default memo(DerivationEdge);
