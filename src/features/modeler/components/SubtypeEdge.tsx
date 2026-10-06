import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, useInternalNode, Position, type EdgeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { useUiStore } from '@/store/useUiStore';
import { labelPlacement } from '../lib/relationshipLabel';
import { SYMBOL_SIZE } from '../lib/subtypeGraph';
import { STUB_BLOCK, STUB_SYMBOL, routedGeometry } from '../lib/wireRoute';
import RelationshipEdgeLabel from './RelationshipEdgeLabel';
import WireRouteHandles from './WireRouteHandles';
import { useWireRoute } from './useWireRoute';

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
 * rojo; pending = fantasma punteado simple. Doc 98: la RAMA de cada subtipo
 * lleva la frase de su relación (misma etiqueta y mismas reglas que el wire
 * crow's-foot); el tronco no es una relación y no lleva. Doc 99: tronco y
 * ramas aceptan trazo manual (el del tronco va con el id del edge,
 * `subsym-{símbolo}`; el de una rama, con el id de su relación).
 */
function SubtypeEdge(props: EdgeProps) {
  const { id, source, target, sourceY, targetY, data } = props;
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const active = useModelerStore(
    (s) => s.hoverEdgeId === id || s.selectedEdgeId === id
      || (!!s.hoverNodeId && (source === s.hoverNodeId || target === s.hoverNodeId)),
  );
  const labelsHidden = useUiStore((s) => s.relLabelsHidden);
  const { via, editable, lod, setDraft, commit } = useWireRoute(id, !!(data as { pending?: boolean } | undefined)?.pending);

  if (!sourceNode || !targetNode) return null;
  const d = (data ?? {}) as {
    trunk?: boolean; pending?: boolean; drifted?: boolean; symbolId?: string;
    label?: string | null; labelTitle?: string | null;
  };

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

  // Doc 99: con trazo manual el camino pasa por sus puntos; el tramo fijo es
  // corto en el extremo que es símbolo (no lleva marcador).
  const manual = via && routedGeometry({
    sBox: { x: sAbs.x, w: sw }, sy, sStub: sourceNode.type === 'subcat' ? STUB_SYMBOL : STUB_BLOCK,
    tBox: { x: tAbs.x, w: tw }, ty, tStub: targetNode.type === 'subcat' ? STUB_SYMBOL : STUB_BLOCK, via,
  });
  const [path, labelX, labelY] = manual
    ? [manual.path, manual.mid.x, manual.mid.y]
    : getSmoothStepPath({
      sourceX: sx, sourceY: sy, sourcePosition: sPos,
      targetX: tx, targetY: ty, targetPosition: tPos,
      borderRadius: 10,
    });
  const showLabel = !!d.label && !d.trunk && !d.pending && !labelsHidden && !lod;
  const at = labelPlacement({
    recursive: false, facesRight: manual ? manual.s.dir === 1 : sourceFacesRight,
    sx: manual ? manual.s.x : sx, tx: manual ? manual.t.x : tx,
    midX: labelX, midY: labelY,
    box: { x: sAbs.x, y: sAbs.y, w: sw },
  });
  const handles = editable && (
    <WireRouteHandles
      via={via ?? []}
      segments={manual ? manual.segments : null}
      center={{ x: labelX, y: labelY }}
      ends={manual ? { s: manual.sOut, t: manual.tOut } : { s: { x: sx, y: sy }, t: { x: tx, y: ty } }}
      onDraft={setDraft}
      onCommit={commit}
    />
  );

  // Doc 111: el atenuado del resto lo hace la clase del canvas (CrowFootEdge).
  const cls = active ? 'wk-edge wk-edge--hot' : 'wk-edge';
  const color = d.pending ? PRIMARY : d.drifted ? DANGER : active ? PRIMARY : INK;
  const opacity = d.pending ? 0.5 : undefined;
  const fx = { transition: 'stroke .12s, stroke-width .12s' };

  if (d.pending) {
    return (
      <BaseEdge
        path={path}
        className={cls}
        style={{ stroke: color, strokeWidth: 1.6, strokeDasharray: '6 5', opacity, ...fx }}
      />
    );
  }
  return (
    <>
      <BaseEdge
        path={path}
        className={cls}
        style={{ stroke: color, strokeWidth: active ? 5.4 : 4.4, opacity, ...fx }}
      />
      <BaseEdge
        path={path}
        className={cls}
        style={{ stroke: CANVAS, strokeWidth: active ? 2.4 : 1.8, opacity,
                 pointerEvents: 'none' as const, ...fx }}
      />
      {showLabel && (
        <RelationshipEdgeLabel text={d.label as string} title={d.labelTitle} at={at} active={active} editing={editable} />
      )}
      {handles}
    </>
  );
}

export default memo(SubtypeEdge);
