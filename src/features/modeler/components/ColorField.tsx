import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useModelerStore } from '@/store/useModelerStore';
import { colorHex, colorLabel, normalColor } from '@/lib/colors';
import ColorPicker from './ColorPicker';
import FloatingPanel from './FloatingPanel';
import { shownColor, type ColorSource } from '../lib/canvasColors';

/**
 * Doc 109 — campo «Color» de Properties (tabla o vista). Doc 112: muestra las
 * DOS capas, para que una caja pintada por el canvas no parezca «sin color»:
 *
 *   On this canvas   ● lo que se ve en la caja y de dónde sale (pintada en este
 *                    canvas, el color de la tabla o ninguno) — «Change» abre la
 *                    ficha del canvas (Model properties) con esta caja
 *   <Noun> color     el color PROPIO del objeto, el de todos sus canvases (se
 *                    elige acá)
 */
export default function ColorField({ id, own, canEdit, noun, onPick }: {
  id: string;
  own: string | null | undefined;
  canEdit: boolean;
  /** «table» / «entity» / «view» — para las etiquetas y el título del selector. */
  noun: string;
  onPick: (ref: string | null) => void;
}) {
  const themes = useModelerStore((s) => s.themes);
  const idx = useModelerStore((s) => s.themeIdx);
  const here = useModelerStore((s) => s.canvasColors[id] ?? null);
  const openModelProps = useModelerStore((s) => s.openModelProps);
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<DOMRect | null>(null);
  const value = normalColor(own) ?? null;
  const hex = colorHex(value, idx);
  const shown = shownColor(id, own, here ? { [id]: here } : {});
  const shownHex = colorHex(shown.ref, idx);
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const source: Record<ColorSource, string> = {
    canvas: 'painted on this canvas',
    table: `the ${noun}'s color`,
    none: '',
  };

  return (
    <div className="wk-props-field">
      <label>Color</label>
      <span className="wk-colorfield-k">On this canvas</span>
      <div className="wk-colorhere">
        <span className={`wk-colorhere-chip${shown.source === 'canvas' ? ' wk-colorhere-chip--canvas' : ''}`}
          title={shown.source === 'canvas' ? `This canvas paints it ${colorLabel(shown.ref, idx)}` : undefined}>
          <span className={`wk-cpick-dot${shownHex ? '' : ' wk-cpick-dot--none'}`} style={shownHex ? { background: shownHex } : undefined} aria-hidden />
          <span className="wk-colorfield-name">{colorLabel(shown.ref, idx)}</span>
          {source[shown.source] && <span className="wk-colorhere-src">{source[shown.source]}</span>}
        </span>
        {canEdit && (
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm"
            title="Model properties → Colors on this canvas"
            onClick={() => openModelProps([id])}>
            {shown.source === 'canvas' ? 'Change' : 'Paint here'}
          </button>
        )}
      </div>
      <span className="wk-colorfield-k">{`${Noun} color · every canvas`}</span>
      <button ref={btn} type="button" className="wk-colorfield" disabled={!canEdit}
        aria-label={`${Noun} color: ${colorLabel(value, idx)}`}
        aria-haspopup="menu" aria-expanded={open != null}
        onClick={() => setOpen((cur) => (cur ? null : btn.current?.getBoundingClientRect() ?? null))}>
        <span className={`wk-cpick-dot${hex ? '' : ' wk-cpick-dot--none'}`} style={hex ? { background: hex } : undefined} aria-hidden />
        <span className="wk-colorfield-name">{colorLabel(value, idx)}</span>
        <ChevronDown size={14} className="wk-colorfield-caret" aria-hidden />
      </button>
      {open && (
        <FloatingPanel anchor={open} owner={btn.current} onClose={() => setOpen(null)}>
          <ColorPicker title={`Color of the ${noun} · every canvas`} themes={themes} value={value} noneValue={null}
            onPick={(ref) => { setOpen(null); onPick(ref); }} />
        </FloatingPanel>
      )}
    </div>
  );
}
