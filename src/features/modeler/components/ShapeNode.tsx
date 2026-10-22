import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NodeResizer, NodeToolbar, Position, useStore, type NodeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { Drawing, DrawingType } from '@/features/modeler/services/modeler.service';
import { drawingFill, drawingStroke, hasText, textCss } from '../lib/drawingStyle';
import DrawingToolbar from './DrawingToolbar';
import { drawingToolbarSide, nodeTopOnScreen } from '../lib/toolbarSide';

export interface ShapeNodeData {
  drawing: Drawing;
  [key: string]: unknown;
}

/** Estrella de 5 puntas como `points` de un <polygon> dentro de un viewBox 100×100. */
const STAR_POINTS = (() => {
  const pts: string[] = [];
  const cx = 50, cy = 50, outer = 48, inner = 19;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
})();

/** La forma en sí (relleno y borde): con relleno y borde propios o, sin ellos,
 *  con el estilo por defecto (borde azul y su tinte suave). */
function ShapeBody({ type, stroke, fill, w, h }: { type: DrawingType; stroke: string | null; fill: string | null; w: number; h: number }) {
  const bg = fill ?? 'transparent';
  const border = stroke ? `2px solid ${stroke}` : 'none';
  if (type === 'text') {
    return <div className="wk-shape-box" style={{ borderRadius: 3, border: stroke ? `1px solid ${stroke}` : 'none', background: bg }} />;
  }
  if (type === 'circle' || type === 'ellipse') {
    return <div className="wk-shape-box" style={{ borderRadius: '50%', border, background: bg }} />;
  }
  if (type === 'rect' || type === 'square') {
    return <div className="wk-shape-box" style={{ borderRadius: 8, border, background: bg }} />;
  }
  if (type === 'line') {
    // Corre por el lado largo de su caja (horizontal o vertical).
    const vertical = h > w;
    return (
      <svg className="wk-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1={vertical ? 50 : 0} y1={vertical ? 0 : 50} x2={vertical ? 50 : 100} y2={vertical ? 100 : 50}
          stroke={stroke ?? '#56607A'} strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  const svgStroke = stroke ?? 'none';
  if (type === 'diamond') {
    return (
      <svg className="wk-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points="50,2 98,50 50,98 2,50" fill={bg} stroke={svgStroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  return (
    <svg className="wk-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon points={STAR_POINTS} fill={bg} stroke={svgStroke} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Dibujo del canvas (capa DRAWING, detrás de las tablas). Todas las
 * formas menos la línea llevan texto (doble clic para escribir); seleccionado
 * y en edición muestra tiradores para redimensionar y la barra de formato.
 * Posición y tamaño se guardan con el canvas (`updateDrawing`).
 */
export default function ShapeNode({ id, data, selected, width, height }: NodeProps) {
  const { drawing } = data as ShapeNodeData;
  const updateDrawing = useModelerStore((s) => s.updateDrawing);
  const deleteDrawing = useModelerStore((s) => s.deleteDrawing);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(drawing.text ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(drawing.text ?? ''); }, [drawing.text]);
  useEffect(() => { if (!selected) setEditing(false); }, [selected]);

  const commitText = () => {
    setEditing(false);
    const next = drawing.type === 'text' ? draft.trim() : draft.replace(/\s+$/, '');
    if (next !== (drawing.text ?? '')) updateDrawing(id, { text: next });
  };

  const w = width ?? drawing.w;
  const h = height ?? drawing.h;
  const stroke = drawingStroke(drawing);
  const fill = drawingFill(drawing);
  const withText = hasText(drawing);
  const css = textCss(drawing);
  const placeholder = drawing.type === 'text' ? 'Text' : '';
  const shown = drawing.text || placeholder;

  return (
    <>
      {canEdit && (
        <NodeResizer
          isVisible={selected && !editing}
          minWidth={drawing.type === 'line' ? 16 : 24}
          minHeight={drawing.type === 'line' ? 4 : 16}
          handleClassName="wk-shape-handle"
          lineClassName="wk-shape-rline"
          onResizeEnd={(_e, p) => updateDrawing(id, {
            x: Math.round(p.x), y: Math.round(p.y), w: Math.max(1, Math.round(p.width)), h: Math.max(1, Math.round(p.height)),
          })}
        />
      )}
      {canEdit && selected && !editing && (
        <ShapeToolbar id={id}>
          <DrawingToolbar drawing={drawing} onChange={(patch) => updateDrawing(id, patch)} onDelete={() => deleteDrawing(id)} />
        </ShapeToolbar>
      )}
      <div className={`wk-shape${selected ? ' sel' : ''}`} style={{ width: w, height: h }}
        onDoubleClick={() => { if (canEdit && withText) setEditing(true); }}>
        <ShapeBody type={drawing.type} stroke={stroke} fill={fill} w={w} h={h} />
        {withText && !editing && shown && (
          <div className={`wk-shape-text${drawing.text ? '' : ' empty'}`} style={css}>
            <span className="wk-shape-textin">{shown}</span>
          </div>
        )}
        {withText && editing && (
          <textarea
            ref={inputRef}
            className="wk-shape-textedit nodrag nopan nowheel"
            value={draft}
            aria-label="Drawing text"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              // Solo flechas y Supr: son del texto, no del canvas (el resto sigue
              // su camino: deshacer, Esc de un popup).
              if (e.key.startsWith('Arrow') || e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
              if (e.key === 'Escape') { setDraft(drawing.text ?? ''); setEditing(false); }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitText();
            }}
            style={{ ...css, display: 'block' }}
            // Evita que React Flow arranque un drag al seleccionar texto.
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}
      </div>
    </>
  );
}

/** La barra de formato va arriba del dibujo; abajo si arriba se cortaría contra
 *  el borde superior del canvas y abajo entra. Se monta solo con el dibujo
 *  seleccionado y del store de React Flow toma solo el lado: re-render cuando
 *  cambia, no en cada cuadro de pan/zoom. */
function ShapeToolbar({ id, children }: { id: string; children: ReactNode }) {
  const side = useStore((s) => {
    const n = s.nodeLookup.get(id);
    if (!n) return 'top';
    const top = nodeTopOnScreen(n.internals.positionAbsolute.y, s.transform);
    return drawingToolbarSide(top, top + (n.measured?.height ?? n.height ?? 0) * s.transform[2], s.height);
  });
  return (
    <NodeToolbar isVisible position={side === 'top' ? Position.Top : Position.Bottom} offset={12}>
      {children}
    </NodeToolbar>
  );
}
