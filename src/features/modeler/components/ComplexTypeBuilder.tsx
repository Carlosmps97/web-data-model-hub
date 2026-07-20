/**
 * ComplexTypeBuilder — "cajita" para declarar tipos complejos EN BONITO.
 *
 * Aparece bajo el input de tipo cuando el texto es un STRUCT/ARRAY/MAP: en vez
 * de tipear la estructura lineal a mano, se edita campo a campo (STRUCT:
 * nombre + tipo por subcampo; ARRAY: tipo del elemento; MAP: tipo de clave y
 * de valor). Cada cambio recompone el string canónico y lo empuja al input —
 * el tipo SIGUE siendo texto (las "subcolumnas" de un STRUCT no son columnas
 * reales; el DDL lo emite verbatim). Anidados (p.ej. ARRAY<STRUCT<…>>) se
 * tipean en el campo de tipo correspondiente.
 *
 * El spec vive en ESTADO LOCAL y solo se re-deriva del `value` cuando el
 * texto cambió por FUERA (input crudo, chip de plantilla, reload) — nunca
 * por el eco de nuestro propio compose. Sin eso, tipear `varchar(` en una
 * fila componía un string transitoriamente inválido (paréntesis sin cerrar),
 * el re-parse fallaba y la cajita se auto-destruía a mitad de tipeo.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/Icon';
import {
  composeComplexType,
  parseComplexType,
  type ComplexSpec,
} from '../lib/complexTypes';

interface Props {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export default function ComplexTypeBuilder({ value, onChange, disabled }: Props) {
  const [spec, setSpec] = useState<ComplexSpec | null>(() => parseComplexType(value));
  // Último texto que NOSOTROS compusimos (o el value inicial): si el prop
  // coincide, el cambio es nuestro eco y no hay nada que re-derivar.
  const lastComposed = useRef<string>(value);

  useEffect(() => {
    if (value === lastComposed.current) return;
    lastComposed.current = value;
    setSpec(parseComplexType(value));
  }, [value]);

  const push = (next: ComplexSpec) => {
    setSpec(next);
    const composed = composeComplexType(next);
    lastComposed.current = composed;
    onChange(composed);
  };

  if (!spec) {
    return (
      <div className="wk-ctb wk-ctb-warn rd-small">
        Unrecognized structure — edit it as text above (or go back to a
        <span className="rd-mono">STRUCT&lt;&gt;</span> template to use the editor).
      </div>
    );
  }

  if (spec.kind === 'array') {
    return (
      <div className="wk-ctb">
        <div className="wk-ctb-head">ARRAY · element type</div>
        <div className="wk-ctb-row">
          <input
            className="rd-input rd-mono wk-ctb-in"
            placeholder="e.g. INT · STRUCT<cod:INT,des:STRING>"
            disabled={disabled}
            value={spec.element}
            onChange={(e) => push({ ...spec, element: e.target.value })}
          />
        </div>
      </div>
    );
  }

  if (spec.kind === 'map') {
    return (
      <div className="wk-ctb">
        <div className="wk-ctb-head">MAP · key and value</div>
        <div className="wk-ctb-row">
          <input
            className="rd-input rd-mono wk-ctb-in"
            placeholder="key type (e.g. STRING)"
            disabled={disabled}
            value={spec.key}
            onChange={(e) => push({ ...spec, key: e.target.value })}
          />
          <input
            className="rd-input rd-mono wk-ctb-in"
            placeholder="value type (e.g. DECIMAL(18,2))"
            disabled={disabled}
            value={spec.value}
            onChange={(e) => push({ ...spec, value: e.target.value })}
          />
        </div>
      </div>
    );
  }

  // STRUCT: un subcampo por fila (nombre + tipo) + alta/baja de filas.
  const setField = (i: number, patch: Partial<{ name: string; type: string }>) =>
    push({ ...spec, fields: spec.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <div className="wk-ctb">
      <div className="wk-ctb-head">STRUCT · subfields (name + type)</div>
      {spec.fields.length === 0 && (
        <div className="wk-ctb-empty rd-small">No subfields — add the first one.</div>
      )}
      {spec.fields.map((f, i) => (
        <div className="wk-ctb-row" key={i}>
          <input
            className="rd-input rd-mono wk-ctb-in"
            placeholder="name"
            disabled={disabled}
            value={f.name}
            onChange={(e) => setField(i, { name: e.target.value })}
          />
          <input
            className="rd-input rd-mono wk-ctb-in"
            placeholder="type (e.g. VARCHAR(30))"
            disabled={disabled}
            value={f.type}
            onChange={(e) => setField(i, { type: e.target.value })}
          />
          {!disabled && (
            <button
              type="button"
              className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm"
              title="Remove subfield"
              onClick={() => push({ ...spec, fields: spec.fields.filter((_, j) => j !== i) })}
            >
              <Icon name="trash" size={11} style={{ color: 'var(--error)' }} />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="rd-btn rd-btn-ghost rd-btn-sm wk-ctb-add"
          onClick={() => push({ ...spec, fields: [...spec.fields, { name: '', type: '' }] })}
        >
          + Subcampo
        </button>
      )}
    </div>
  );
}
