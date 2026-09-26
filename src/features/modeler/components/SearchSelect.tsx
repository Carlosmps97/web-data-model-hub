import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';
import { containsCI } from '../lib/typePick';
import { enterTarget, moveHighlight } from '../lib/searchSelectNav';

export interface SearchOption { value: string; label: string; detail?: string }

/** Doc 96 D1: acción al pie del menú (p. ej. «+ Create schema…»). Recibe lo
 *  tipeado; se alcanza también con ↑/↓ y Enter. */
export interface SearchAction { label: (query: string) => string; onRun: (query: string) => void }

/** Posición del menú flotante (doc 52): fixed contra el viewport. */
interface MenuPos {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Combobox con buscador embebido (doc 41) — reemplaza selects nativos y
 * datalists en los puntos de alta/edición de columna. Diseño calcado del
 * dropdown "Find a Table" del toolbar (lista acotada con scroll, item con
 * etiqueta + detalle a la derecha).
 *
 * Comportamiento: al abrir, la búsqueda arranca VACÍA y la lista muestra todo
 * (el valor actual queda como placeholder) — tipear filtra por "contiene"
 * case-insensitive y REEMPLAZA al elegir. Esto corrige el bloqueo del datalist
 * nativo: con un valor puesto ya no hace falta borrarlo para ver la lista.
 * Teclado: ↑/↓ navegan, Enter elige, Esc cierra sin cambiar.
 *
 * Doc 52: el menú se renderiza por PORTAL a `document.body` con posición
 * `fixed` — un menú absoluto dentro de un contenedor con overflow (el cuerpo
 * de Dialog/Modal) contribuía a su área scrolleable y generaba scroll
 * horizontal en el popup. Flotante de verdad: no altera el layout de ningún
 * contenedor; flip hacia arriba si abajo no entra; un scroll FUERA del menú o
 * un resize lo cierran (patrón select nativo — no se re-posiciona).
 */
export default function SearchSelect({ options, valueLabel, placeholder, onPick, disabled, mono, emptyLabel, inputClassName, inputStyle, matchDetail, action }: {
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
  /** Estilos extra del INPUT (doc 52 — SchemaSelect reenvía acá su `style`);
   *  el padding derecho del caret se re-impone después. */
  inputStyle?: React.CSSProperties;
  /** Doc 91 D4: el filtro «contiene» también mira `detail` (p.ej. el nombre
   *  lógico de una tabla junto a su `schema.físico`). */
  matchDetail?: boolean;
  /** Doc 96 D1: fila de acción fija al pie del menú (sin ella, nada cambia). */
  action?: SearchAction;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
  const pick = (v: string) => { onPick(v); close(); inputRef.current?.blur(); };
  // Índice de la acción = justo después de las opciones filtradas.
  const actionIdx = action ? filtered.length : -1;
  const runAction = () => { const q = query; close(); inputRef.current?.blur(); action?.onRun(q); };

  return (
    <div className="wk-ss-wrap">
      <input
        ref={inputRef}
        className={`${inputClassName ?? 'rd-input'}${mono ? ' rd-mono' : ''}`}
        style={{ width: '100%', ...inputStyle, paddingRight: 26 }}
        disabled={disabled}
        value={open ? query : valueLabel}
        placeholder={open ? (valueLabel || placeholder) : placeholder}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { setQuery(e.target.value); setHi(0); }}
        onBlur={close}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => moveHighlight(h, 1, filtered.length, !!action)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => moveHighlight(h, -1, filtered.length, !!action)); }
          else if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            const target = enterTarget(hi, filtered.length, !!action);
            if (target === 'action') runAction(); else if (target === 'option') pick(filtered[hi].value);
          }
          else if (e.key === 'Escape') { e.stopPropagation(); close(); inputRef.current?.blur(); }
        }}
      />
      <Icon name="chevD" size={12} className="wk-ss-caret" />
      {open && pos && createPortal(
        // preventDefault también en el CONTENEDOR: arrastrar el scrollbar del
        // menú no debe blurear el input (cerraría la lista a media navegación).
        // position fixed + zIndex inline pisan el absolute del CSS (el menú
        // sigue usando .wk-ss-menu para el look).
        <div className="wk-ss-menu" ref={menuRef} onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'fixed', zIndex: 500, left: pos.left, top: pos.top ?? 'auto',
                   bottom: pos.bottom, minWidth: pos.minWidth, maxWidth: pos.maxWidth, maxHeight: pos.maxHeight }}>
          {filtered.length === 0 && <div className="wk-ss-empty">No matches</div>}
          {filtered.map((o, i) => (
            // onMouseDown (no onClick): elige ANTES de que el blur del input
            // cierre la lista — mismo truco que el Find a Table del toolbar.
            <button key={o.value || '∅'} type="button" className={`wk-ss-item${i === hi ? ' hi' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              onMouseEnter={() => setHi(i)}>
              <span className={`wk-ss-label${mono ? ' rd-mono' : ''}`}>{o.label}</span>
              {o.detail && <span className="wk-ss-detail rd-mono">{o.detail}</span>}
            </button>
          ))}
          {action && (
            <button type="button" className={`wk-ss-item wk-ss-action${hi === actionIdx ? ' hi' : ''}`}
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
