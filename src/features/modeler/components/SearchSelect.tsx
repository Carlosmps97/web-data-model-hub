import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { startsWithCI } from '../lib/typePick';

export interface SearchOption { value: string; label: string; detail?: string }

/**
 * Combobox con buscador embebido (doc 41) — reemplaza selects nativos y
 * datalists en los puntos de alta/edición de columna. Diseño calcado del
 * dropdown "Find a Table" del toolbar (lista acotada con scroll, item con
 * etiqueta + detalle a la derecha).
 *
 * Comportamiento: al abrir, la búsqueda arranca VACÍA y la lista muestra todo
 * (el valor actual queda como placeholder) — tipear filtra por "empieza por"
 * case-insensitive y REEMPLAZA al elegir. Esto corrige el bloqueo del datalist
 * nativo: con un valor puesto ya no hace falta borrarlo para ver la lista.
 * Teclado: ↑/↓ navegan, Enter elige, Esc cierra sin cambiar.
 */
export default function SearchSelect({ options, valueLabel, placeholder, onPick, disabled, mono, emptyLabel, inputClassName }: {
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
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const base: SearchOption[] = emptyLabel != null ? [{ value: '', label: emptyLabel }, ...options] : options;
  const filtered = query.trim() === '' ? base : base.filter((o) => startsWithCI(o.label, query));

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.children[hi] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const openList = () => { if (disabled) return; setOpen(true); setQuery(''); setHi(0); };
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (v: string) => { onPick(v); close(); inputRef.current?.blur(); };

  return (
    <div className="wk-ss-wrap">
      <input
        ref={inputRef}
        className={`${inputClassName ?? 'rd-input'}${mono ? ' rd-mono' : ''}`}
        style={{ width: '100%', paddingRight: 26 }}
        disabled={disabled}
        value={open ? query : valueLabel}
        placeholder={open ? (valueLabel || placeholder) : placeholder}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { setQuery(e.target.value); setHi(0); }}
        onBlur={close}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (filtered[hi]) pick(filtered[hi].value); }
          else if (e.key === 'Escape') { e.stopPropagation(); close(); inputRef.current?.blur(); }
        }}
      />
      <Icon name="chevD" size={12} className="wk-ss-caret" />
      {open && (
        // preventDefault también en el CONTENEDOR: arrastrar el scrollbar del
        // menú no debe blurear el input (cerraría la lista a media navegación).
        <div className="wk-ss-menu" ref={menuRef} onMouseDown={(e) => e.preventDefault()}>
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
        </div>
      )}
    </div>
  );
}
