import { useRef } from 'react';
import { Check, Palette, RotateCcw } from 'lucide-react';
import { NO_COLOR, STANDARD_COLORS, normalColor, themeRef, type Theme } from '@/lib/colors';
import { useModelerStore } from '@/store/useModelerStore';
import { pinSession } from '../lib/sessionGuard';

/**
 * Doc 109 — selector de color (UN componente para los tres lugares: el menú
 * del canvas, el campo Color de Properties y la barra de formato de dibujos).
 *
 *   THEMES          los colores con nombre del proyecto (Data Standards)
 *   OTHER COLORS    10 colores estándar + «More colors…» (selector del sistema)
 *   ───
 *   No color        sin color
 *   Use the table's color   sólo en el canvas: quita la excepción
 *
 * `value` es la referencia elegida hoy (ColorRef o null). Elegir llama a
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
}

const sameRef = (a: string | null | undefined, b: string | null | undefined) =>
  (normalColor(a, true) ?? null) === (normalColor(b, true) ?? null);

/** «More colors…»: el selector del sistema sobre un <input type="color"> PROPIO,
 *  fuera de React. Abrirlo le quita el foco a la ventana y el menú que lo
 *  ofreció se cierra (el del canvas, al perder el foco): el input sigue vivo y
 *  aplica lo elegido igual. Según el navegador avisa con `input` en cada
 *  arrastre y con `change` al cerrarse: se aplica al `change` o tras una pausa
 *  sin cambios. Uno a la vez: abrir otro descarta el anterior. Sólo aplica en
 *  la sesión y el canvas donde se abrió (el selector del sistema puede seguir
 *  abierto mientras el usuario cambia de versión o de canvas). */
let systemPicker: HTMLInputElement | null = null;
function openSystemPicker(initial: string, at: DOMRect | null, apply: (hex: string) => void): void {
  systemPicker?.remove();
  const pin = pinSession();
  const canvas = useModelerStore.getState().activeSaId;
  const valid = () => pin.holds() && useModelerStore.getState().activeSaId === canvas;
  const el = document.createElement('input');
  el.type = 'color';
  el.value = initial.toLowerCase();
  el.tabIndex = -1;
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: `${at?.left ?? 0}px`, top: `${at?.bottom ?? 0}px`,
    width: '1px', height: '1px', opacity: '0', border: '0', padding: '0', pointerEvents: 'none',
  });
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!valid()) { pending = null; el.remove(); return; }
    if (pending) { const v = pending; pending = null; apply(v); }
  };
  const onInput = () => {
    pending = el.value.toUpperCase();
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 700);
  };
  el.addEventListener('input', onInput);
  // Al cerrarse el selector se suelta el foco: los atajos (deshacer, borrar)
  // vuelven al canvas, que ignora las teclas que caen en un input.
  el.addEventListener('change', () => { onInput(); flush(); el.blur(); });
  document.body.appendChild(el);
  systemPicker = el;
  el.click();
}

export default function ColorPicker({ title, value, themes = [], onPick, noneValue, inherit }: ColorPickerProps) {
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
          e.currentTarget.getBoundingClientRect(), (hex) => pick.current(hex))}>
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
