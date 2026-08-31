import { useEffect, useMemo } from 'react';
import { useModelerStore } from '@/store/useModelerStore';
import { schemasForKind, type SchemaKindFilter } from '../lib/schemaPick';
import SearchSelect from './SearchSelect';

/**
 * Combobox de esquemas (doc 18, reconstruido en doc 52 sobre SearchSelect):
 * mismo contrato externo que el `<select>` que reemplaza, ahora con buscador
 * embebido (contiene CI) y menú flotante por portal — consistente con los
 * combos de dominio/tipo y con el filtro de esquemas de Import existing/CTAS.
 *
 * Opciones = esquemas EFECTIVOS de la versión activa (los creados en el draft
 * aparecen al instante), particionados por `kind` (doc 52 §3): un contexto de
 * tablas no muestra esquemas de vistas ni viceversa; los sin clasificar entran
 * en ambos. '' = sin esquema. Un valor actual no catalogado (tabla legacy) o
 * de otro kind se muestra igual como opción extra para no romper la edición.
 */
export default function SchemaSelect({ value, onChange, disabled, className, style, inputStyle, kind = 'all' }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Clase del INPUT (como el `<select>` viejo). */
  className?: string;
  /** Estilo del WRAPPER (layout: width del combo). */
  style?: React.CSSProperties;
  /** Estilo del INPUT (ViewEditor le pasa su estética de campo). */
  inputStyle?: React.CSSProperties;
  /** Tipo de objeto del contexto (doc 52 §3): filtra el catálogo. */
  kind?: SchemaKindFilter;
}) {
  const schemas = useModelerStore((s) => s.schemas);
  const loadSchemas = useModelerStore((s) => s.loadSchemas);
  useEffect(() => {
    if (useModelerStore.getState().schemas.length === 0) void loadSchemas().catch(() => {});
  }, [loadSchemas]);

  const options = useMemo(() => {
    const pool = schemasForKind(schemas, kind);
    const opts = pool.map((s) => ({ value: s.name, label: s.name }));
    if (value && !pool.some((s) => s.name === value)) opts.unshift({ value, label: value });
    return opts;
  }, [schemas, kind, value]);

  return (
    <div style={style}>
      <SearchSelect
        mono
        options={options}
        valueLabel={value}
        placeholder="Search schema…"
        emptyLabel="(no schema)"
        onPick={onChange}
        disabled={disabled}
        inputClassName={className ?? 'rd-input'}
        inputStyle={inputStyle}
      />
    </div>
  );
}
