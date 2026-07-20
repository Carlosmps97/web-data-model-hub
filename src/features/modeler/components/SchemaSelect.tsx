import { useEffect } from 'react';
import { useModelerStore } from '@/store/useModelerStore';

/**
 * Dropdown de esquemas (doc 18): reemplaza los inputs de texto libre para
 * eliminar typos. Opciones = esquemas EFECTIVOS de la versión activa (los
 * creados en el draft aparecen al instante). '' = sin esquema. Un valor legacy
 * no catalogado (tabla vieja) se muestra igual como opción extra para no
 * romper la edición.
 */
export default function SchemaSelect({ value, onChange, disabled, className, style }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const schemas = useModelerStore((s) => s.schemas);
  const loadSchemas = useModelerStore((s) => s.loadSchemas);
  useEffect(() => {
    if (useModelerStore.getState().schemas.length === 0) void loadSchemas().catch(() => {});
  }, [loadSchemas]);
  const known = schemas.some((s) => s.name === value);
  return (
    <select
      className={className ?? 'rd-input rd-mono'}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={style}
    >
      <option value="">(sin esquema)</option>
      {!known && value && <option value={value}>{value}</option>}
      {schemas.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
    </select>
  );
}
