import { useRef } from 'react';
import { Check, Palette, RotateCcw } from 'lucide-react';
import { NO_COLOR, STANDARD_COLORS, normalColor, themeRef, type Theme } from '@/lib/colors';
import { openSystemPicker } from '../lib/systemColorPicker';

/**
 * Selector de color (un solo componente para los lugares que pintan: la ficha
 * del canvas, el campo Color de Properties y la barra de formato de dibujos).
 * «More colors…» abre el del sistema (`lib/systemColorPicker`).
 *
 *   Themes          los colores con nombre del proyecto (Data Standards)
 *   Other colors    10 colores estándar + «More colors…» (selector del sistema)
 *   ───
 *   No color        sin color
 *   Use the table's color   solo en el canvas: quita la excepción
 *
 * `value` es la referencia vigente (ColorRef o null). Elegir llama a
 * `onPick` con la referencia nueva; quien lo monta cierra el panel.
 */
export interface ColorPickerProps {
  title?: string;
  value: string | null;
  themes?: Theme[];
  onPick: (ref: string | null) => void;
  /** Qué elige «No color»: 'none' (excepción del canvas) o null. Sin la prop,
   *  el ítem no aparece. */
  noneValue?: string | null;
  /** Canvas: «Use the table's color» (quita la excepción). `hex` = el color
   *  que la caja toma al elegirlo (null = sin color). */
  inherit?: { label: string; hex: string | null; current: boolean } | null;
  /** Mientras devuelva true, «More colors…» aplica lo elegido (el
   *  selector del sistema puede seguir abierto después de cerrarse este panel,
   *  y se sigue ajustando). Sin la prop, aplica mientras sigan la sesión y el
   *  canvas donde se abrió. */
  alive?: () => boolean;
}

const sameRef = (a: string | null | undefined, b: string | null | undefined) =>
  (normalColor(a, true) ?? null) === (normalColor(b, true) ?? null);

export default function ColorPicker({ title, value, themes = [], onPick, noneValue, inherit, alive }: ColorPickerProps) {
  const isCustom = !!value && value.startsWith('#') && !STANDARD_COLORS.some((c) => c.hex === value);
  // Lo elegido en el selector del sistema llega cuando este panel ya puede estar
  // cerrado: se aplica con el `onPick` del último render.
  const pick = useRef(onPick);
  pick.current = onPick;

  return (
    <div className="wk-cpick" role="menu" aria-label={title ?? 'Color'}>
      {title && <div className="wk-cpick-title">{title}</div>}
      {themes.length > 0 && (
        <>
          <div className="wk-cpick-cap">Themes</div>
          {themes.map((t) => {
            const ref = themeRef(t.id);
            const on = !inherit?.current && sameRef(value, ref);
            return (
              <button key={t.id} type="button" role="menuitemradio" aria-checked={on}
                className={`wk-cpick-item${on ? ' on' : ''}`} onClick={() => onPick(ref)}>
                <span className="wk-cpick-dot" style={{ background: t.color }} aria-hidden />
                <span className="wk-cpick-name">{t.name}</span>
                {on && <Check size={13} className="wk-cpick-check" aria-hidden />}
              </button>
            );
          })}
          <div className="wk-cpick-sep" />
        </>
      )}
      <div className="wk-cpick-cap">{themes.length ? 'Other colors' : 'Colors'}</div>
      <div className="wk-cpick-swatches">
        {STANDARD_COLORS.map((c) => {
          const on = !inherit?.current && sameRef(value, c.hex);
          return (
            <button key={c.hex} type="button" role="menuitemradio" aria-checked={on} aria-label={c.name} title={c.name}
              className={`wk-cpick-sw${on ? ' on' : ''}`} style={{ background: c.hex }} onClick={() => onPick(c.hex)} />
          );
        })}
      </div>
      <button type="button" role="menuitem" className={`wk-cpick-item${isCustom && !inherit?.current ? ' on' : ''}`}
        onClick={(e) => openSystemPicker(value && value.startsWith('#') ? value : '#4F7DF3',
          e.currentTarget.getBoundingClientRect(), (hex) => pick.current(hex), alive)}>
        {isCustom && !inherit?.current
          ? <span className="wk-cpick-dot" style={{ background: value! }} aria-hidden />
          : <Palette size={14} className="wk-cpick-ico" aria-hidden />}
        <span className="wk-cpick-name">More colors…</span>
        {isCustom && !inherit?.current && <span className="wk-cpick-hex">{value}</span>}
      </button>
      {(noneValue !== undefined || inherit) && <div className="wk-cpick-sep" />}
      {noneValue !== undefined && (() => {
        const on = !inherit?.current && (noneValue === null ? value === null : sameRef(value, noneValue ?? NO_COLOR));
        return (
          <button type="button" role="menuitemradio" aria-checked={on} className={`wk-cpick-item${on ? ' on' : ''}`}
            onClick={() => onPick(noneValue)}>
            <span className="wk-cpick-dot wk-cpick-dot--none" aria-hidden />
            <span className="wk-cpick-name">No color</span>
            {on && <Check size={13} className="wk-cpick-check" aria-hidden />}
          </button>
        );
      })()}
      {inherit && (
        <button type="button" role="menuitemradio" aria-checked={inherit.current}
          className={`wk-cpick-item${inherit.current ? ' on' : ''}`} onClick={() => onPick(null)}>
          <RotateCcw size={13} className="wk-cpick-ico" aria-hidden />
          <span className="wk-cpick-name">{inherit.label}</span>
          <span className={`wk-cpick-dot wk-cpick-dot--sm${inherit.hex ? '' : ' wk-cpick-dot--none'}`}
            style={inherit.hex ? { background: inherit.hex } : undefined} aria-hidden />
          {inherit.current && <Check size={13} className="wk-cpick-check" aria-hidden />}
        </button>
      )}
    </div>
  );
}
