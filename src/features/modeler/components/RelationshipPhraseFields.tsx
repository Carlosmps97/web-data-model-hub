import { Check } from 'lucide-react';
import { PHRASE_MAX, type PhraseKey } from '../lib/relationshipLabel';

export type { PhraseKey };
export type PhraseValues = Record<PhraseKey, string>;

const FIELDS: { key: PhraseKey; label: string; placeholder: string }[] = [
  { key: 'parentToChildPhrase', label: 'Parent-to-child phrase', placeholder: 'e.g. Customer owns' },
  { key: 'childToParentPhrase', label: 'Child-to-parent phrase', placeholder: 'e.g. is owned by a Customer' },
];

/**
 * Frases de relación (doc 98, Erwin: Relationship Editor · General): las dos
 * cajas que comparten el popup de CREACIÓN (staging: viajan en el lote del
 * Confirm) y el de EDICIÓN, que pasa `onApply` y gana el botón Apply — mismo
 * patrón que el Role name. Guardar al salir de la caja se descartó: bloqueaba
 * el popup mientras se tipeaba la segunda frase y se tragaba el clic
 * siguiente. Componente controlado y sin IO.
 */
export default function RelationshipPhraseFields({ values, onChange, locked, onApply, canApply = false, bare = false }: {
  values: PhraseValues;
  onChange: (key: PhraseKey, value: string) => void;
  locked: boolean;
  /** Popup de edición: graba las dos frases en UN guardado (botón o Enter). */
  onApply?: () => void;
  /** Hay cambios sin grabar. */
  canApply?: boolean;
  /** Sin título ni margen de bloque: va DENTRO de otra fila (un subtipo del
   *  popup de subcategoría, que pone un único título para todas). */
  bare?: boolean;
}) {
  return (
    <div className={bare ? undefined : 'wk-props-field'}>
      {!bare && <label>Verb phrases · shown as the label on the relationship line</label>}
      <div className="wk-relphrases">
        {FIELDS.map((f) => (
          <div className="wk-relphrase" key={f.key}>
            <span className="rd-small" aria-hidden>{f.label}</span>
            <input
              className="rd-input"
              aria-label={f.label}
              disabled={locked}
              maxLength={PHRASE_MAX}
              placeholder={locked ? '—' : f.placeholder}
              value={values[f.key]}
              onChange={(e) => onChange(f.key, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && onApply && canApply) onApply(); }}
            />
          </div>
        ))}
        {onApply && (
          <div className="wk-relphrase-apply">
            {canApply && <span className="rd-small">Unsaved changes</span>}
            <button type="button" className="rd-btn rd-btn-sm" disabled={locked || !canApply}
              title="Save both phrases" onClick={onApply}>
              <Check size={13} /> Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
