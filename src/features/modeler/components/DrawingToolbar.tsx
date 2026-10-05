import { useState, type ReactNode } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart, Bold, ChevronDown, Italic, PaintBucket, Square, Trash2, Underline,
} from 'lucide-react';
import type { Drawing, DrawingFont, TextAlign, TextVAlign } from '../services/modeler.service';
import {
  FONT_FAMILIES, FONT_SIZES, drawingAlign, drawingFill, drawingFont, drawingStroke, fontPatch, fontStack, legacyUpgrade,
} from '../lib/drawingStyle';
import { useModelerStore } from '@/store/useModelerStore';
import ColorPicker from './ColorPicker';
import FloatingPanel from './FloatingPanel';

/**
 * Doc 109 — barra de formato de un dibujo SELECCIONADO (aparece sólo así,
 * encima del dibujo y a tamaño de pantalla): relleno · borde | fuente ·
 * tamaño · B · I · U · color del texto · alineación | borrar. Una línea sólo
 * tiene su color y borrar. Cada control abre su panel; elegir aplica al toque.
 */
type Panel = 'fill' | 'stroke' | 'font' | 'size' | 'text' | 'align';

export default function DrawingToolbar({ drawing, onChange, onDelete }: {
  drawing: Drawing;
  onChange: (patch: Partial<Drawing>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<{ which: Panel; at: DOMRect; el: HTMLButtonElement } | null>(null);
  const close = () => setOpen(null);
  const toggle = (which: Panel) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    setOpen((cur) => (cur?.which === which ? null : { which, at: el.getBoundingClientRect(), el }));
  };
  const font = drawingFont(drawing);
  const { align, valign } = drawingAlign(drawing);
  const stroke = drawingStroke(drawing);
  const fill = drawingFill(drawing);
  // El patch se arma sobre el dibujo VIGENTE (el selector del sistema aplica
  // tarde: con la foto del clic revertía un cambio hecho entretanto), y un
  // texto viejo pasa al modelo nuevo en su primera edición (sin cambiar cómo
  // se ve).
  const current = () => useModelerStore.getState().drawings.find((x) => x.id === drawing.id) ?? drawing;
  // Lo elegido como se compara con lo que se ve («No color» = null).
  const asColor = (ref: string | null) => (!ref || ref === 'none' ? null : ref);
  const apply = (patch: Partial<Drawing>) => onChange({ ...legacyUpgrade(current()), ...patch });
  const setFont = (change: Partial<DrawingFont>) => onChange(fontPatch(current(), change));
  const line = drawing.type === 'line';
  const families = font.family && !FONT_FAMILIES.includes(font.family) ? [font.family, ...FONT_FAMILIES] : FONT_FAMILIES;
  const AlignIcon = align === 'center' ? AlignCenter : align === 'right' ? AlignRight : AlignLeft;

  const btn = (which: Panel, label: string, content: ReactNode) => (
    <button type="button" className={`wk-dtb-btn${open?.which === which ? ' on' : ''}`} aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={open?.which === which} onClick={toggle(which)}>
      {content}
      <ChevronDown size={10} className="wk-dtb-caret" aria-hidden />
    </button>
  );
  const swatch = (hex: string | null, outline = false) => (
    <span className={`wk-dtb-sw${hex ? '' : ' wk-cpick-dot--none'}${outline ? ' wk-dtb-sw--outline' : ''}`}
      style={hex ? (outline ? { borderColor: hex } : { background: hex.slice(0, 7) }) : undefined} aria-hidden />
  );
  const toggleBtn = (label: string, on: boolean, icon: ReactNode, change: Partial<DrawingFont>) => (
    <button type="button" className={`wk-dtb-btn${on ? ' on' : ''}`} aria-label={label} title={label} aria-pressed={on}
      onClick={() => setFont(change)}>
      {icon}
    </button>
  );

  return (
    <div className="wk-dtb nodrag nopan" role="toolbar" aria-label="Format" onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}>
      {line ? (
        btn('stroke', 'Line color', swatch(stroke))
      ) : (
        <>
          {btn('fill', 'Fill', <><PaintBucket size={14} aria-hidden />{swatch(fill)}</>)}
          {btn('stroke', 'Border', <><Square size={14} aria-hidden />{swatch(stroke)}</>)}
          <span className="wk-dtb-div" />
          {btn('font', 'Font', <span className="wk-dtb-font" style={{ fontFamily: fontStack(font.family) }}>{font.family ?? 'Default font'}</span>)}
          {btn('size', 'Font size (pt)', <span className="wk-dtb-size">{font.size}</span>)}
          {toggleBtn('Bold', font.bold, <Bold size={14} aria-hidden />, { bold: !font.bold })}
          {toggleBtn('Italic', font.italic, <Italic size={14} aria-hidden />, { italic: !font.italic })}
          {toggleBtn('Underline', font.underline, <Underline size={14} aria-hidden />, { underline: !font.underline })}
          {btn('text', 'Text color', <span className="wk-dtb-a" style={{ borderBottomColor: font.color }}>A</span>)}
          {btn('align', 'Text alignment', <AlignIcon size={14} aria-hidden />)}
        </>
      )}
      <span className="wk-dtb-div" />
      <button type="button" className="wk-dtb-btn wk-dtb-del" aria-label="Delete drawing" title="Delete drawing" onClick={onDelete}>
        <Trash2 size={14} aria-hidden />
      </button>

      {open && (
        <FloatingPanel anchor={open.at} owner={open.el} onClose={close}>
          {open.which === 'fill' && (
            <ColorPicker title="Fill" value={drawing.fill === 'none' ? 'none' : (drawing.fill ?? null)} noneValue="none"
              onPick={(ref) => { close(); if (asColor(ref) !== fill) apply({ fill: ref ?? 'none' }); }} />
          )}
          {open.which === 'stroke' && (
            <ColorPicker title={line ? 'Line color' : 'Border'} value={stroke ? stroke : (line ? null : 'none')}
              noneValue={line ? undefined : 'none'}
              onPick={(ref) => { close(); if (asColor(ref) !== stroke) apply({ color: ref ?? 'none' }); }} />
          )}
          {open.which === 'text' && (
            <ColorPicker title="Text color" value={font.color} onPick={(ref) => { close(); if (ref && ref !== font.color) setFont({ color: ref }); }} />
          )}
          {open.which === 'font' && (
            <div className="wk-cpick" role="menu" aria-label="Font">
              <button type="button" role="menuitemradio" aria-checked={!font.family}
                className={`wk-cpick-item${!font.family ? ' on' : ''}`} onClick={() => { close(); if (font.family) setFont({ family: null }); }}>
                <span className="wk-cpick-name" style={{ fontFamily: fontStack(null) }}>Default font</span>
              </button>
              {families.map((f) => (
                <button key={f} type="button" role="menuitemradio" aria-checked={font.family === f}
                  className={`wk-cpick-item${font.family === f ? ' on' : ''}`} onClick={() => { close(); if (font.family !== f) setFont({ family: f }); }}>
                  <span className="wk-cpick-name" style={{ fontFamily: fontStack(f) }}>{f}</span>
                </button>
              ))}
            </div>
          )}
          {open.which === 'size' && (
            <div className="wk-cpick wk-dtb-sizes" role="menu" aria-label="Font size">
              {(FONT_SIZES.includes(font.size) ? FONT_SIZES : [...FONT_SIZES, font.size].sort((a, b) => a - b)).map((n) => (
                <button key={n} type="button" role="menuitemradio" aria-checked={font.size === n}
                  className={`wk-cpick-item${font.size === n ? ' on' : ''}`} onClick={() => { close(); if (font.size !== n) setFont({ size: n }); }}>
                  <span className="wk-cpick-name">{n} pt</span>
                </button>
              ))}
            </div>
          )}
          {open.which === 'align' && (
            <div className="wk-cpick wk-dtb-align" role="menu" aria-label="Text alignment">
              <div className="wk-cpick-cap">Horizontal</div>
              <div className="wk-dtb-row">
                {([['left', AlignLeft, 'Left'], ['center', AlignCenter, 'Center'], ['right', AlignRight, 'Right']] as const).map(([v, Icon, label]) => (
                  <button key={v} type="button" className={`wk-dtb-btn${align === v ? ' on' : ''}`} aria-label={`Align ${label.toLowerCase()}`}
                    title={label} aria-pressed={align === v} onClick={() => { if (align !== v) apply({ align: v as TextAlign }); }}>
                    <Icon size={15} aria-hidden />
                  </button>
                ))}
              </div>
              <div className="wk-cpick-cap">Vertical</div>
              <div className="wk-dtb-row">
                {([['top', AlignVerticalJustifyStart, 'Top'], ['middle', AlignVerticalJustifyCenter, 'Middle'], ['bottom', AlignVerticalJustifyEnd, 'Bottom']] as const).map(([v, Icon, label]) => (
                  <button key={v} type="button" className={`wk-dtb-btn${valign === v ? ' on' : ''}`} aria-label={`Align ${label.toLowerCase()}`}
                    title={label} aria-pressed={valign === v} onClick={() => { if (valign !== v) apply({ valign: v as TextVAlign }); }}>
                    <Icon size={15} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          )}
        </FloatingPanel>
      )}
    </div>
  );
}
