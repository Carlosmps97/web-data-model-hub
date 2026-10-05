import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useModelerStore } from '@/store/useModelerStore';
import { colorHex, colorLabel, normalColor } from '@/lib/colors';
import ColorPicker from './ColorPicker';
import FloatingPanel from './FloatingPanel';

/**
 * Doc 109 — campo «Color» de Properties (tabla o vista): el color PROPIO del
 * objeto, el que se ve en todos sus canvases. Si el canvas abierto lo pinta
 * distinto, una línea lo dice (y dónde se cambia: clic derecho en la caja).
 */
export default function ColorField({ id, own, canEdit, noun, onPick }: {
  id: string;
  own: string | null | undefined;
  canEdit: boolean;
  /** «table» / «entity» / «view» — para el título del selector. */
  noun: string;
  onPick: (ref: string | null) => void;
}) {
  const themes = useModelerStore((s) => s.themes);
  const idx = useModelerStore((s) => s.themeIdx);
  const override = useModelerStore((s) => s.canvasColors[id] ?? null);
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<DOMRect | null>(null);
  const value = normalColor(own) ?? null;
  const hex = colorHex(value, idx);
  const overrideHex = override ? colorHex(override, idx) : null;

  return (
    <div className="wk-props-field">
      <label>Color</label>
      <button ref={btn} type="button" className="wk-colorfield" disabled={!canEdit}
        aria-haspopup="menu" aria-expanded={open != null}
        onClick={() => setOpen((cur) => (cur ? null : btn.current?.getBoundingClientRect() ?? null))}>
        <span className={`wk-cpick-dot${hex ? '' : ' wk-cpick-dot--none'}`} style={hex ? { background: hex } : undefined} aria-hidden />
        <span className="wk-colorfield-name">{colorLabel(value, idx)}</span>
        <ChevronDown size={14} className="wk-colorfield-caret" aria-hidden />
      </button>
      <p className="wk-pp-cap wk-colorfield-hint">
        {override ? (
          <>
            This canvas paints it{' '}
            <span className={`wk-cpick-dot wk-cpick-dot--inline${overrideHex ? '' : ' wk-cpick-dot--none'}`}
              style={overrideHex ? { background: overrideHex } : undefined} aria-hidden />
            {' '}{colorLabel(override, idx)} — right-click the box to change it here.
          </>
        ) : (
          <>Shown on every canvas. Right-click the box to paint it differently on one canvas.</>
        )}
      </p>
      {open && (
        <FloatingPanel anchor={open} owner={btn.current} onClose={() => setOpen(null)}>
          <ColorPicker title={`Color of the ${noun}`} themes={themes} value={value} noneValue={null}
            onPick={(ref) => { setOpen(null); onPick(ref); }} />
        </FloatingPanel>
      )}
    </div>
  );
}
