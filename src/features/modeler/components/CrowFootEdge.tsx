import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, useInternalNode, Position, type EdgeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { useUiStore } from '@/store/useUiStore';
import type { Cardinality } from '@/services/governance.service';
import { fanSourceY, HEADER_H, ROW_H } from '../lib/edgeFanout';
import { labelPlacement } from '../lib/relationshipLabel';
import { STUB_BLOCK, routedGeometry } from '../lib/wireRoute';
import RelationshipEdgeLabel from './RelationshipEdgeLabel';
import WireRouteHandles from './WireRouteHandles';
import { useWireRoute } from './useWireRoute';

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
  // Doc 98: la etiqueta se oculta con el botón del toolbar y en zoom lejano
  // (LOD compacto: a esa escala el texto es ilegible y solo ensucia).
  const labelsHidden = useUiStore((s) => s.relLabelsHidden);
  // Doc 99: trazo manual del wire (null = camino automático de siempre).
  const { via, editable, lod, setDraft, commit } = useWireRoute(id, !!(data as { pending?: boolean } | undefined)?.pending);

  if (!sourceNode || !targetNode) return null;
  // `pending` = edge fantasma (drop hecho, popup de confirmación abierto).
  // v2 (doc 19): source del edge = PADRE (lado PK), target = HIJO (lado FK).
  // Doc 47: fanSlot/fanCount/parentPkRows reparten la salida en la zona de
  // llave del padre; `drifted` = pares fuera de sync con la llave (ámbar).
  const d = (data ?? {}) as {
    parentCardinality: Cardinality; childCardinality: Cardinality;
    identifying: boolean; pending?: boolean; pairCount?: number;
    fanSlot?: number; fanCount?: number; parentPkRows?: number; drifted?: boolean;
    // Doc 98: frases de relación ya compuestas («padre→hijo / hijo→padre»);
    // `labelTitle` = texto completo, para el tooltip cuando el dibujo se cortó.
    label?: string | null; labelTitle?: string | null;
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

  // Doc 47: la salida se reparte en la zona de llave del padre (fan-out). El
  // fantasma (sin fanCount) conserva la Y de su handle.
  const sh = sourceNode.measured?.height ?? HEADER_H + ROW_H;
  const sy = d.fanCount
    ? fanSourceY(sAbs.y, sh, d.parentPkRows ?? 0, d.fanSlot ?? 0, d.fanCount)
    : sourceY;

  // Ruteo ortogonal (H/V) con esquinas redondeadas — lo provee React Flow
  // (`getSmoothStepPath`), sin matemática manual de caminos. Doc 99: con trazo
  // manual el camino pasa por sus puntos (`routedGeometry`) y el lado de cada
  // extremo lo decide el trazo, no la posición del otro bloque.
  const manual = via && routedGeometry({
    sBox: { x: sAbs.x, w: sw }, sy, sStub: STUB_BLOCK,
    tBox: { x: tAbs.x, w: tw }, ty: targetY, tStub: STUB_BLOCK, via,
  });
  const [path, labelX, labelY] = manual
    ? [manual.path, manual.mid.x, manual.mid.y]
    : getSmoothStepPath({
      sourceX: sx, sourceY: sy, sourcePosition: sPos,
      targetX: tx, targetY, targetPosition: tPos,
      borderRadius: 10,
    });

  // Resaltado (dbdiagram): activa la relación bajo el mouse o las conectadas a la
  // tabla bajo el mouse; atenúa el resto. Drift (doc 47) → ROJO: incongruencia
  // de llave que el modelador debe corregir (owner 2026-08-23).
  const dimmed = anyHover && !active;
  const stroke = d.pending ? 'var(--primary)'
    : d.drifted ? 'var(--red)'
    : active ? 'var(--primary)' : 'var(--ink-2)';

  const showLabel = !!d.label && !d.pending && !labelsHidden && !lod;
  // Misma regla que el export: centrada en el punto medio del wire y con el
  // ancho que deja el hueco entre los bloques (si no cabe, parte línea); en
  // una recursiva el wire corre bajo el bloque, así que va encima de él.
  // Doc 99: con trazo la etiqueta sigue al camino, también en una recursiva.
  const at = labelPlacement({
    recursive: !manual && source === target,
    facesRight: manual ? manual.s.dir === 1 : sourceFacesRight,
    sx: manual ? manual.s.x : sx, tx: manual ? manual.t.x : tx,
    midX: labelX, midY: labelY,
    box: { x: sAbs.x, y: sAbs.y, w: sw },
  });

  return (
    <>
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
      {showLabel && (
        <RelationshipEdgeLabel text={d.label as string} title={d.labelTitle} at={at} active={active} dimmed={dimmed} editing={editable} />
      )}
      {editable && (
        <WireRouteHandles
          via={via ?? []}
          segments={manual ? manual.segments : null}
          center={{ x: labelX, y: labelY }}
          ends={manual
            ? { s: manual.sOut, t: manual.tOut }
            : { s: { x: sx, y: sy }, t: { x: tx, y: targetY } }}
          onDraft={setDraft}
          onCommit={commit}
        />
      )}
    </>
  );
}

export default memo(CrowFootEdge);
