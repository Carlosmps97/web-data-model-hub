import { useEffect, useState } from 'react';
import SearchSelect, { type SearchOption } from './SearchSelect';
import { TYPE_OPTIONS, argSpecFor, composeParamType, parseParamType } from '../lib/typePick';

const COMPLEX = ['ARRAY', 'MAP', 'STRUCT'];

/**
 * Selector de tipo de dato (doc 41): catálogo cerrado con buscador
 * "empieza por" en vez de texto libre (pedido de los modeladores: tipear el
 * tipo a mano era fuente de errores). Los tipos parametrizados —
 * DECIMAL(p,s), VARCHAR(n), … — se completan con argumentos puntuales, y
 * STRUCT/ARRAY/MAP viven EN la lista (elegirlos emite `X<>` y el caller abre
 * su ComplexTypeBuilder, como siempre). Un valor fuera de catálogo (legacy)
 * se muestra tal cual como opción extra — patrón SchemaSelect: no rompe la
 * edición de columnas viejas.
 */
export default function TypePicker({ value, onChange, disabled, placeholder, emptyLabel }: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Opción "ninguno" (emite '') — el alta la usa como "usar el default del dominio". */
  emptyLabel?: string;
}) {
  const trimmed = value.trim();
  const parsed = parseParamType(trimmed);
  const isComplexValue = trimmed.includes('<');
  const spec = parsed ? argSpecFor(parsed.base) : null;
  // Borrador LOCAL de los argumentos: al valor solo viaja el PREFIJO válido
  // (un scale sin precision emite 'DECIMAL' a secas), pero el input conserva
  // lo tipeado. Se resincroniza cuando el valor cambia por FUERA (elegir otra
  // base, heredar el default del dominio, reload) — detectado porque el valor
  // entrante ya no es lo que este borrador compone.
  const [argsDraft, setArgsDraft] = useState<string[]>(parsed?.args ?? []);
  useEffect(() => {
    if (parsed && composeParamType(parsed.base, argsDraft) !== trimmed) setArgsDraft(parsed.args);
  }, [trimmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const options: SearchOption[] = TYPE_OPTIONS.map((t) => ({
    value: t,
    label: t,
    detail: COMPLEX.includes(t) ? '<…>' : (argSpecFor(t) ? `(${argSpecFor(t)!.join(', ')})` : undefined),
  }));
  // Valor legacy fuera de catálogo (y no complejo): opción extra al tope para
  // poder verlo/re-elegirlo — nunca se pierde al abrir la lista.
  if (trimmed && !parsed && !isComplexValue) {
    options.unshift({ value: trimmed, label: trimmed, detail: '(current)' });
  }

  const pick = (v: string) => {
    if (!v) { onChange(''); return; }
    if (COMPLEX.includes(v)) { onChange(`${v}<>`); return; }   // abre el builder del caller
    const s = argSpecFor(v);
    // Re-elegir la MISMA base conserva los argumentos ya puestos.
    onChange(s ? composeParamType(v, parsed?.base === v ? parsed.args : []) : v);
  };
  const setArg = (i: number, raw: string) => {
    if (!parsed || !spec) return;
    const next = [...argsDraft];
    while (next.length < spec.length) next.push('');
    next[i] = raw;
    setArgsDraft(next);
    onChange(composeParamType(parsed.base, next));
  };

  return (
    <div style={{ minWidth: 0 }}>
      <SearchSelect
        options={options}
        valueLabel={trimmed}
        placeholder={placeholder}
        onPick={pick}
        disabled={disabled}
        mono
        emptyLabel={emptyLabel}
      />
      {spec && !isComplexValue && (
        <div className="wk-ss-args">
          {spec.map((label, i) => (
            // width inline: dentro del panel, `.wk-pp-typewrap .rd-input`
            // fuerza 100% — el estilo local gana y mantiene la caja compacta.
            <input key={label} className="rd-input rd-mono" type="number" min={0}
              placeholder={label} disabled={disabled}
              style={{ width: 96 }}
              value={argsDraft[i] ?? ''}
              onChange={(e) => setArg(i, e.target.value)} />
          ))}
        </div>
      )}
    </div>
  );
}
