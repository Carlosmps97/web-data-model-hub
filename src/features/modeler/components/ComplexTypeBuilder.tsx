/**
 * ComplexTypeBuilder (doc 64 §2) — declarador HÍBRIDO de tipos complejos.
 *
 * Aparece bajo el input de tipo cuando el texto es un STRUCT/ARRAY/MAP. Cada
 * "hueco" de tipo (elemento del ARRAY, key/value del MAP, tipo de cada
 * subcampo del STRUCT) es un TypeSlot: dropdown del catálogo (TypePicker, con
 * argumentos puntuales para DECIMAL/VARCHAR/…) en modo visual, sub-builder
 * ANIDADO cuando el valor es a su vez complejo, y toggle a CÓDIGO (texto
 * libre) por slot para pegar directo `STRUCT<a:INT,b:ARRAY<STRING>>`. A nivel
 * raíz hay un segmented Builder | Code y un preview permanente del string
 * canónico. Sincronización bidireccional: el builder recompone el texto y el
 * texto re-deriva el builder (round-trip parse/compose ya testeado).
 *
 * El spec vive en ESTADO LOCAL POR NIVEL y solo se re-deriva del `value`
 * cuando el texto cambió por FUERA — nunca por el eco del propio compose
 * (useSpecState). Sin eso, tipear `varchar(` en una hoja compone un string
 * transitoriamente inválido, el re-parse del nivel superior falla y el árbol
 * de cajitas se auto-destruye a mitad de tipeo.
 *
 * El tipo SIGUE siendo texto (las "subcolumnas" de un STRUCT no son columnas
 * reales; el DDL lo emite verbatim).
 */
import { useEffect, useRef, useState } from 'react';
import { Code } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import {
  composeComplexType,
  isComplexTypeStart,
  parseComplexType,
  type ComplexSpec,
} from '../lib/complexTypes';
import TypePicker from './TypePicker';

interface Props {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/** Builder visual anidado hasta esta profundidad; más adentro se edita como
 *  código (defensivo — un ARRAY<STRUCT<…ARRAY<…>…>> más hondo es ilegible en
 *  cajitas y el texto siempre está disponible). */
const MAX_DEPTH = 3;

/** Spec local por NIVEL con anti-eco: solo se re-deriva del `value` cuando
 *  cambió por FUERA (input crudo, reload, edición en otro nivel). */
function useSpecState(value: string, onChange: (next: string) => void) {
  const [spec, setSpec] = useState<ComplexSpec | null>(() => parseComplexType(value));
  const lastComposed = useRef(value);
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
  return { spec, push };
}

/** Slot de TIPO (hoja): TypePicker en visual + toggle `</>` a código; un valor
 *  complejo abre el sub-builder anidado debajo (recursión). */
function TypeSlot({ value, onChange, disabled, placeholder, depth }: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  depth: number;
}) {
  const [codeWanted, setCodeWanted] = useState(false);
  const complexish = isComplexTypeStart(value);
  const parsed = complexish ? parseComplexType(value) : null;
  // Complejo que NO parsea, o demasiado profundo: el picker no puede
  // representarlo — código forzado (el texto nunca se pierde).
  const forcedCode = complexish && (!parsed || depth >= MAX_DEPTH);
  const inCode = codeWanted || forcedCode;
  return (
    <div className="wk-ctb-slot">
      <div className="wk-ctb-slotrow">
        {inCode ? (
          <input
            className="rd-input rd-mono wk-ctb-in"
            spellCheck={false}
            placeholder={placeholder ?? 'e.g. INT · STRUCT<cod:INT,des:STRING>'}
            disabled={disabled}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="wk-ctb-slotpick">
            <TypePicker value={value} onChange={onChange} disabled={disabled} placeholder={placeholder ?? 'type'} />
          </div>
        )}
        <button
          type="button"
          className={`wk-ctb-mode${inCode ? ' on' : ''}`}
          disabled={disabled || forcedCode}
          title={forcedCode
            ? (parsed ? 'Deeply nested — edited as code at this level' : 'Unrecognized structure — fix the text to go back to the picker')
            : inCode ? 'Back to the visual picker' : 'Edit as code (free text)'}
          onClick={() => setCodeWanted(!inCode)}
        >
          <Code size={11} />
        </button>
      </div>
      {!inCode && parsed && (
        <div className="wk-ctb-nest">
          <NestedComplex value={value} onChange={onChange} disabled={disabled} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

/** Sub-builder de un slot complejo: spec local propio (anti-eco por nivel). */
function NestedComplex({ value, onChange, disabled, depth }: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  depth: number;
}) {
  const { spec, push } = useSpecState(value, onChange);
  if (!spec) return null; // el TypeSlot padre ya cae a código si no parsea
  return <SpecEditor spec={spec} onSpec={push} disabled={disabled} depth={depth} />;
}

/** Cuerpo del builder para UN spec (array / map / struct). */
function SpecEditor({ spec, onSpec, disabled, depth }: {
  spec: ComplexSpec;
  onSpec: (s: ComplexSpec) => void;
  disabled?: boolean;
  depth: number;
}) {
  if (spec.kind === 'array') {
    return (
      <div className="wk-ctb-rows">
        <div className="wk-ctb-row">
          <span className="wk-ctb-lbl">Element</span>
          <TypeSlot value={spec.element} onChange={(t) => onSpec({ ...spec, element: t })}
            disabled={disabled} placeholder="element type — e.g. INT" depth={depth} />
        </div>
      </div>
    );
  }
  if (spec.kind === 'map') {
    return (
      <div className="wk-ctb-rows">
        <div className="wk-ctb-row">
          <span className="wk-ctb-lbl">Key</span>
          <TypeSlot value={spec.key} onChange={(t) => onSpec({ ...spec, key: t })}
            disabled={disabled} placeholder="key type — e.g. STRING" depth={depth} />
        </div>
        <div className="wk-ctb-row">
          <span className="wk-ctb-lbl">Value</span>
          <TypeSlot value={spec.value} onChange={(t) => onSpec({ ...spec, value: t })}
            disabled={disabled} placeholder="value type — e.g. DECIMAL(18,2)" depth={depth} />
        </div>
      </div>
    );
  }
  // STRUCT: un subcampo por fila (nombre + slot de tipo) + alta/baja de filas.
  const setField = (i: number, patch: Partial<{ name: string; type: string }>) =>
    onSpec({ ...spec, fields: spec.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <div className="wk-ctb-rows">
      {spec.fields.length === 0 && (
        <div className="wk-ctb-empty rd-small">No subfields — add the first one.</div>
      )}
      {spec.fields.map((f, i) => (
        <div className="wk-ctb-row" key={i}>
          <input
            className="rd-input rd-mono wk-ctb-name"
            placeholder="name"
            disabled={disabled}
            value={f.name}
            onChange={(e) => setField(i, { name: e.target.value })}
          />
          <TypeSlot value={f.type} onChange={(t) => setField(i, { type: t })}
            disabled={disabled} placeholder="type — e.g. VARCHAR(30)" depth={depth} />
          {!disabled && (
            <button
              type="button"
              className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm wk-ctb-del"
              title="Remove subfield"
              onClick={() => onSpec({ ...spec, fields: spec.fields.filter((_, j) => j !== i) })}
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
          onClick={() => onSpec({ ...spec, fields: [...spec.fields, { name: '', type: '' }] })}
        >
          + Subfield
        </button>
      )}
    </div>
  );
}

export default function ComplexTypeBuilder({ value, onChange, disabled }: Props) {
  const { spec, push } = useSpecState(value, onChange);
  // Doc 96 D9: abre en Code — el día a día es pegar la estructura; el Builder es ayuda.
  const [mode, setMode] = useState<'builder' | 'code'>('code');
  const header = spec?.kind === 'array' ? 'ARRAY · element type'
    : spec?.kind === 'map' ? 'MAP · key and value'
      : spec?.kind === 'struct' ? 'STRUCT · subfields (name + type)'
        : 'Complex type';
  const builderOk = spec != null;
  return (
    <div className="wk-ctb">
      <div className="wk-ctb-head">
        <span>{header}</span>
        <span className="wk-ctb-headtools" role="group" aria-label="Editor mode">
          <button type="button" className={mode === 'builder' && builderOk ? 'on' : ''}
            title={builderOk ? 'Visual builder' : "The text doesn't parse yet — fix it to use the builder"}
            onClick={() => { if (builderOk) setMode('builder'); }}>
            Builder
          </button>
          <button type="button" className={mode === 'code' || !builderOk ? 'on' : ''}
            title="Edit the whole type as code" onClick={() => setMode('code')}>
            Code
          </button>
        </span>
      </div>

      {mode === 'code' || !builderOk ? (
        <>
          <textarea
            className="wk-ctb-code rd-mono"
            spellCheck={false}
            disabled={disabled}
            value={value}
            placeholder="e.g. STRUCT<a:INT,b:ARRAY<STRING>>"
            onChange={(e) => onChange(e.target.value)}
          />
          {!builderOk && (
            <div className="wk-ctb-warn2 rd-small">
              Unrecognized structure — the visual builder comes back when the text parses
              (<span className="rd-mono">STRUCT&lt;a:INT&gt;</span> · <span className="rd-mono">ARRAY&lt;INT&gt;</span> · <span className="rd-mono">MAP&lt;STRING,INT&gt;</span>).
            </div>
          )}
        </>
      ) : (
        <SpecEditor spec={spec} onSpec={push} disabled={disabled} depth={0} />
      )}

      <div className="wk-ctb-preview">
        <span>Preview</span>
        <code>{value.trim() || '—'}</code>
      </div>
    </div>
  );
}
