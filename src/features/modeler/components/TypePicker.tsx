import { useEffect, useState } from 'react';
import SearchSelect, { type SearchOption } from './SearchSelect';
import { TYPE_OPTIONS, argSpecFor, composeParamType, editTypeArg, isTypeArg, parseParamType } from '../lib/typePick';

const COMPLEX = ['ARRAY', 'MAP', 'STRUCT'];

/**
 * Selector de tipo de dato: catálogo cerrado con buscador "contiene" en vez
 * de texto libre (escribir el tipo a mano es fuente de errores). Los tipos
 * parametrizados (DECIMAL(p,s), VARCHAR(n), …) se completan con argumentos
 * puntuales, y STRUCT/ARRAY/MAP viven en la lista (elegirlos emite `X<>` y el
 * caller abre su ComplexTypeBuilder). Un valor fuera de catálogo se muestra
 * tal cual como opción extra (patrón SchemaSelect): no rompe la edición de
 * columnas con tipos que no están en el catálogo.
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
  // Borrador local de los argumentos, atado a su base: al valor solo viaja el
  // prefijo válido (un scale sin precision emite 'DECIMAL' a secas), pero el
  // input conserva lo escrito. Se resincroniza cuando el valor cambia por fuera
  // (otra base, heredar el default del dominio, reload), lo que se detecta
  // porque la base es otra o porque el valor entrante difiere de lo que este
  // borrador compone. Con la base en el borrador, un argumento de un tipo
  // anterior nunca reaparece en las cajas de otro.
  const [draft, setDraft] = useState<{ base: string; args: string[] }>(
    { base: parsed?.base ?? '', args: parsed?.args ?? [] });
  useEffect(() => {
    if (parsed && (draft.base !== parsed.base || composeParamType(parsed.base, draft.args) !== trimmed)) {
      setDraft({ base: parsed.base, args: parsed.args });
    }
  }, [trimmed]); // eslint-disable-line react-hooks/exhaustive-deps
  const argsDraft = parsed && draft.base === parsed.base ? draft.args : (parsed?.args ?? []);

  const options: SearchOption[] = TYPE_OPTIONS.map((t) => ({
    value: t,
    label: t,
    detail: COMPLEX.includes(t) ? '<…>' : (argSpecFor(t) ? `(${argSpecFor(t)!.join(', ')})` : undefined),
  }));
  // Valor fuera de catálogo (y no complejo): opción extra al tope para poder
  // verlo/re-elegirlo; nunca se pierde al abrir la lista.
  if (trimmed && !parsed && !isComplexValue) {
    options.unshift({ value: trimmed, label: trimmed, detail: '(current)' });
  }

  const pick = (v: string) => {
    if (!v) { onChange(''); return; }
    if (COMPLEX.includes(v)) { onChange(`${v}<>`); return; }   // abre el builder del caller
    const s = argSpecFor(v);
    // Re-elegir la misma base conserva los argumentos ya puestos; otra base
    // arranca con las cajas vacías (nada oculto de la anterior).
    const keep = parsed?.base === v ? parsed.args : [];
    setDraft({ base: v, args: keep });
    onChange(s ? composeParamType(v, keep) : v);
  };
  const setArg = (i: number, raw: string) => {
    if (!parsed || !spec) return;
    const next = editTypeArg(spec, argsDraft, i, raw);
    setDraft({ base: parsed.base, args: next });
    // Mientras una caja tenga algo que no es un argumento (`18,2`, `--`), el
    // tipo queda como estaba: nada se aplica a medias ni se pierde.
    if (next.some((a) => a.trim() !== '' && !isTypeArg(a))) return;
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
          {spec.map((label, i) => {
            // Texto, no número: `MAX`, `30 CHAR`, `*`, `-2`. Lo que no
            // es un argumento (`18,2`, `--`) se ve marcado y no viaja al tipo.
            const bad = (argsDraft[i] ?? '').trim() !== '' && !isTypeArg(argsDraft[i]);
            // width inline: dentro del panel, `.wk-pp-typewrap .rd-input`
            // fuerza 100% — el estilo local gana y mantiene la caja compacta.
            return (
              <input key={label} className="rd-input rd-mono" type="text" spellCheck={false}
                placeholder={label} disabled={disabled}
                aria-invalid={bad || undefined}
                title={bad ? 'Not applied — use a number or a word (MAX, 30 CHAR, *)' : undefined}
                style={{ width: 96 }}
                value={argsDraft[i] ?? ''}
                onChange={(e) => setArg(i, e.target.value)} />
            );
          })}
        </div>
      )}
    </div>
  );
}
