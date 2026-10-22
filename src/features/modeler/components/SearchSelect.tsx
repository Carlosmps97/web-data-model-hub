import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { isFocusReturn } from '@/components/ui/focusTrap';
import { containsCI } from '../lib/typePick';
import { enterTarget, moveHighlight } from '../lib/searchSelectNav';

export interface SearchOption { value: string; label: string; detail?: string }

/** Acción al pie del menú (p. ej. «+ Create schema…»). Recibe lo
 *  tipeado; se alcanza también con ↑/↓ y Enter. */
export interface SearchAction { label: (query: string) => string; onRun: (query: string) => void }

/** Posición del menú flotante: fixed contra el viewport. */
interface MenuPos {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Combobox con buscador embebido, usado en lugar de selects nativos y
 * datalists en los puntos de alta/edición de columna. Mismo diseño que el
 * dropdown "Find a Table" del toolbar (lista acotada con scroll, item con
 * etiqueta + detalle a la derecha).
 *
 * Comportamiento: al abrir, la búsqueda arranca vacía y la lista muestra todo
 * (el valor actual queda como placeholder); escribir filtra por "contiene"
 * sin distinguir mayúsculas y, al elegir, sustituye el valor. A diferencia del datalist
 * nativo, con un valor puesto no hace falta borrarlo para ver la lista.
 * Teclado: ↑/↓ navegan (con el menú cerrado, lo abren), Enter elige, Esc
 * cierra sin cambiar. Dentro de un diálogo el foco queda en el input al
 * cerrar el menú; fuera, el input lo suelta.
 *
 * El menú se renderiza por portal a `document.body` con posición `fixed`: un
 * menú absoluto dentro de un contenedor con overflow (el cuerpo de
 * Dialog/Modal) contribuiría a su área scrolleable y generaría scroll
 * horizontal en el popup. Flotante de verdad: no altera el layout de ningún
 * contenedor; flip hacia arriba si abajo no entra; un scroll fuera del menú o
 * un resize lo cierran (patrón select nativo; no se re-posiciona).
 */
export default function SearchSelect({ options, valueLabel, placeholder, onPick, disabled, mono, emptyLabel, inputClassName, inputStyle, matchDetail, action, ariaLabel, ariaDescribedBy }: {
  options: SearchOption[];
  /** Etiqueta del valor actual ('' si no hay). */
  valueLabel: string;
  placeholder?: string;
  onPick: (value: string) => void;
  disabled?: boolean;
  /** Lista y trigger en fuente mono (tipos de dato). */
  mono?: boolean;
  /** Opción "ninguno" (value '') al tope de la lista, si aplica. */
  emptyLabel?: string;
  inputClassName?: string;
  /** Estilos extra del input (SchemaSelect reenvía aquí su `inputStyle`);
   *  el padding derecho del caret se re-impone después. */
  inputStyle?: React.CSSProperties;
  /** El filtro «contiene» también mira `detail` (p. ej. el nombre
   *  lógico de una tabla junto a su `schema.físico`). */
  matchDetail?: boolean;
  /** Fila de acción fija al pie del menú (opcional). */
  action?: SearchAction;
  /** Nombre accesible del input cuando no hay un <label> que lo nombre. */
  ariaLabel?: string;
  /** Id del texto que describe el input (p. ej. por qué está deshabilitado),
   *  sin tocar su nombre accesible. */
  ariaDescribedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Patrón ARIA 1.2 de combobox: el input controla un listbox (su menú) y
  // anuncia la opción resaltada con `aria-activedescendant`; así un lector de
  // pantalla no lo lee como un campo de texto suelto.
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const base: SearchOption[] = emptyLabel != null ? [{ value: '', label: emptyLabel }, ...options] : options;
  const filtered = query.trim() === '' ? base
    : base.filter((o) => containsCI(o.label, query) || (!!matchDetail && !!o.detail && containsCI(o.detail, query)));

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.children[hi] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  // Abierto: scroll fuera del menú (cuerpo del dialog, sidebar, página) o
  // resize → cerrar. Capture: el scroll de contenedores internos no burbujea.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false); setQuery('');
    };
    const onResize = () => { setOpen(false); setQuery(''); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  /** Posición fixed desde el rect del input: abajo por defecto; flip arriba
   *  si abajo hay <160px y arriba hay más; clamps al viewport. */
  const place = (): MenuPos | null => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return null;
    const GAP = 4, MARGIN = 8, MENU_MAX = 240;
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < 160 && above > below;
    return {
      left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - r.width - MARGIN)),
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      minWidth: r.width,
      maxWidth: Math.max(r.width, window.innerWidth - r.left - MARGIN),
      maxHeight: Math.max(96, Math.min(MENU_MAX, up ? above : below)),
    };
  };

  const openList = () => { if (disabled) return; setPos(place()); setOpen(true); setQuery(''); setHi(0); };
  const close = () => { setOpen(false); setQuery(''); };
  const openOnInput = () => { if (!open) openList(); };
  // Dentro de un diálogo (`aria-modal`), cerrar el menú no suelta el foco: el
  // blur lo dejaría en <body> y Tab saldría a la página de atrás. Fuera de un
  // diálogo, al elegir, el input suelta el foco.
  const release = () => { if (!inputRef.current?.closest('[aria-modal="true"]')) inputRef.current?.blur(); };
  const pick = (v: string) => { onPick(v); close(); release(); };
  // Índice de la acción = justo después de las opciones filtradas.
  const actionIdx = action ? filtered.length : -1;
  const activeOption = open && (hi < filtered.length || hi === actionIdx) ? optionId(hi) : undefined;
  // Sin blur previo: el diálogo que abre la acción sabe quién lo abrió y, al
  // cerrarse, le devuelve el foco a este input (sin reabrir el menú: `onFocus`).
  const runAction = () => { const q = query; close(); action?.onRun(q); };

  return (
    <div className="wk-ss-wrap">
      <input
        ref={inputRef}
        className={`${inputClassName ?? 'rd-input'}${mono ? ' rd-mono' : ''}`}
        style={{ width: '100%', ...inputStyle, paddingRight: 26 }}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeOption}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        value={open ? query : valueLabel}
        placeholder={open ? (valueLabel || placeholder) : placeholder}
        onFocus={(e) => {
          // El foco que devuelve un diálogo al cerrarse (el de la acción del
          // pie, o uno que abrió `onPick`, como «Inherit from domain») no
          // reabre el menú: el usuario acaba de elegir; el foco del usuario, sí.
          if (!isFocusReturn(e.currentTarget)) openList();
        }}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { setQuery(e.target.value); setHi(0); }}
        onBlur={close}
        // Con el menú cerrado, también lo abre lo que no entra por un keydown
        // imprimible: pegar, IME/teclas muertas (composición) y dictado.
        onPaste={openOnInput}
        onCompositionStart={openOnInput}
        onBeforeInput={openOnInput}
        onKeyDown={(e) => {
          if (!open) {
            // Menú cerrado con el foco en el input (tras elegir o ESC en un diálogo,
            // o tras la acción del pie): ↓/↑ lo abren; escribir también, sin
            // preventDefault, para que lo escrito caiga en la búsqueda. AltGr
            // (Ctrl+Alt en Windows) también escribe.
            const altGr = e.getModifierState?.('AltGraph') ?? false;
            const typing = (e.key.length === 1 && (altGr || (!e.ctrlKey && !e.metaKey))) || e.key === 'Backspace' || e.key === 'Delete';
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList(); }
            else if (typing && !e.nativeEvent?.isComposing) openList();
            return;
          }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => moveHighlight(h, 1, filtered.length, !!action)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => moveHighlight(h, -1, filtered.length, !!action)); }
          else if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            const target = enterTarget(hi, filtered.length, !!action);
            if (target === 'action') runAction(); else if (target === 'option') pick(filtered[hi].value);
          }
          else if (e.key === 'Escape') { e.stopPropagation(); close(); release(); }
        }}
      />
      <Icon name="chevD" size={12} className="wk-ss-caret" />
      {open && pos && createPortal(
        // preventDefault también en el contenedor: arrastrar el scrollbar del
        // menú no debe blurear el input (cerraría la lista a media navegación).
        // position fixed + zIndex inline pisan el absolute del CSS (el menú
        // sigue usando .wk-ss-menu para el look).
        <div className="wk-ss-menu" ref={menuRef} id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'fixed', zIndex: 500, left: pos.left, top: pos.top ?? 'auto',
                   bottom: pos.bottom, minWidth: pos.minWidth, maxWidth: pos.maxWidth, maxHeight: pos.maxHeight }}>
          {filtered.length === 0 && <div className="wk-ss-empty" role="option" aria-disabled aria-selected={false}>No matches</div>}
          {filtered.map((o, i) => (
            // onMouseDown (no onClick): elige antes de que el blur del input
            // cierre la lista — mismo truco que el Find a Table del toolbar.
            <button key={o.value || '∅'} type="button" className={`wk-ss-item${i === hi ? ' hi' : ''}`}
              id={optionId(i)} role="option" aria-selected={i === hi}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              onMouseEnter={() => setHi(i)}>
              <span className={`wk-ss-label${mono ? ' rd-mono' : ''}`}>{o.label}</span>
              {o.detail && <span className="wk-ss-detail rd-mono">{o.detail}</span>}
            </button>
          ))}
          {action && (
            <button type="button" className={`wk-ss-item wk-ss-action${hi === actionIdx ? ' hi' : ''}`}
              id={optionId(actionIdx)} role="option" aria-selected={hi === actionIdx}
              onMouseDown={(e) => { e.preventDefault(); runAction(); }}
              onMouseEnter={() => setHi(actionIdx)}>
              <span className="wk-ss-label">{action.label(query)}</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
