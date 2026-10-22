import { useEffect, useMemo, useState } from 'react';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { isAsOfChangesetId } from '@/services/versioning.service';
import { schemasForKind, type SchemaKindFilter } from '../lib/schemaPick';
import { canCreateSchema, createActionLabel } from '../lib/schemaCreate';
import SchemaCreateDialog from './SchemaCreateDialog';
import SearchSelect from './SearchSelect';

/**
 * Combobox de esquemas sobre SearchSelect: contrato externo de un `<select>`
 * (value/onChange), con buscador embebido («contiene», sin distinguir
 * mayúsculas) y menú flotante por portal, consistente con los combos de
 * dominio/tipo y con el filtro de esquemas de Import existing/CTAS.
 *
 * Opciones = esquemas efectivos de la versión activa (los creados en el draft
 * aparecen al instante), particionados por `kind`: un contexto de tablas no
 * muestra esquemas de vistas ni viceversa; los sin clasificar entran en ambos.
 * '' = sin esquema. Un valor actual no catalogado (p. ej. una tabla cuyo
 * esquema no está en el catálogo) o de otro kind se muestra igual como opción
 * extra para no romper la edición.
 *
 * Al elegir el esquema de una tabla o una vista en una versión en edición, el
 * menú ofrece «+ Create schema…»: abre `SchemaCreateDialog`, el esquema entra a
 * la versión (como Structure · Schemas) y solo entonces queda seleccionado
 * aquí. Nunca en solo lectura ni en `kind="all"`.
 */
export default function SchemaSelect({ value, onChange, disabled, className, style, inputStyle, kind = 'all' }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Clase del input (como la de un `<select>`). */
  className?: string;
  /** Estilo del wrapper (layout: width del combo). */
  style?: React.CSSProperties;
  /** Estilo del input (ViewEditor le pasa su estética de campo). */
  inputStyle?: React.CSSProperties;
  /** Tipo de objeto del contexto: filtra el catálogo. */
  kind?: SchemaKindFilter;
}) {
  const schemas = useModelerStore((s) => s.schemas);
  const loadSchemas = useModelerStore((s) => s.loadSchemas);
  const openMode = useSessionStore((s) => s.openMode);
  const changesetId = useSessionStore((s) => s.activeChangesetId);
  // Lo tipeado al pedir «+ Create schema…» (null = popup cerrado).
  const [creating, setCreating] = useState<string | null>(null);
  const canCreate = canCreateSchema({ disabled, kind, openMode, changesetId, asOf: isAsOfChangesetId(changesetId) });
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
        action={canCreate ? { label: createActionLabel, onRun: (q) => setCreating(q.trim()) } : undefined}
      />
      {creating !== null && kind !== 'all' && (
        <SchemaCreateDialog kind={kind} initialName={creating} onCreated={onChange} onClose={() => setCreating(null)} />
      )}
    </div>
  );
}
