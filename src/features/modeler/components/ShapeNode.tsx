import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import type { Drawing, DrawingType } from '@/features/modeler/services/modeler.service';

export interface ShapeNodeData {
  drawing: Drawing;
  [key: string]: unknown;
}

// Paleta acotada para el mini-control de color (tokens del design system).
const SWATCHES = ['#2E5BFF', '#16A37B', '#E0A024', '#8B5CF6', '#C0392B', '#56607A'];

// Convierte un hex de relleno a una versión clara (10% alpha) para el fondo suave.
const fill = (hex: string) => `${hex}1A`;

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

function ShapeBody({ type, color }: { type: DrawingType; color: string }) {
  const stroke = color;
  const bg = fill(color);

  if (type === 'circle' || type === 'ellipse') {
    return <div className="wk-shape-box" style={{ borderRadius: '50%', borderColor: stroke, background: bg }} />;
  }
  if (type === 'rect' || type === 'square') {
    return <div className="wk-shape-box" style={{ borderRadius: 8, borderColor: stroke, background: bg }} />;
  }
  if (type === 'line') {
    return (
      <svg className="wk-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="0" y1="50" x2="100" y2="50" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  if (type === 'diamond') {
    return (
      <svg className="wk-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points="50,2 98,50 50,98 2,50" fill={bg} stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  // star
  return (
    <svg className="wk-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polygon points={STAR_POINTS} fill={bg} stroke={stroke} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function ShapeNode({ id, data, selected }: NodeProps) {
  const { drawing } = data as ShapeNodeData;
  const updateDrawing = useModelerStore((s) => s.updateDrawing);
  const deleteDrawing = useModelerStore((s) => s.deleteDrawing);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const color = drawing.color ?? '#2E5BFF';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(drawing.text ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(drawing.text ?? ''); }, [drawing.text]);

  const commitText = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (drawing.text ?? '')) updateDrawing(id, { text: next });
  };

  const wrapStyle: CSSProperties = { width: drawing.w, height: drawing.h };

  return (
    <div className={`wk-shape${selected ? ' sel' : ''}`} style={wrapStyle}>
      {drawing.type === 'text' ? (
        editing ? (
          <textarea
            ref={inputRef}
            className="wk-shape-textedit rd-mono"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setDraft(drawing.text ?? ''); setEditing(false); }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitText();
            }}
            style={{ color }}
            // Evita que React Flow arranque un drag al seleccionar texto.
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="wk-shape-text"
            style={{ color }}
            onDoubleClick={() => !readonly && setEditing(true)}
          >
            {drawing.text || 'Text'}
          </div>
        )
      ) : (
        <ShapeBody type={drawing.type} color={color} />
      )}

      {/* Mini-control al seleccionar: swatches de color + eliminar (oculto en readonly). */}
      {selected && !readonly && (
        <div className="wk-shape-bar" onMouseDown={(e) => e.stopPropagation()}>
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`wk-shape-sw${c === color ? ' on' : ''}`}
              style={{ background: c }}
              title={`Color ${c}`}
              onClick={() => updateDrawing(id, { color: c })}
            />
          ))}
          <span className="wk-shape-bar-div" />
          <button type="button" className="wk-shape-del" title="Delete shape" onClick={() => deleteDrawing(id)}>×</button>
        </div>
      )}
    </div>
  );
}
