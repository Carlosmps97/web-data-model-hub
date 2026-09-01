import { useEffect, useRef, useState } from 'react';
import { Tags } from 'lucide-react';
import { getUdpDefs, type UdpDefinition, type UdpLevel } from '@/features/standards/standards.service';
import { applyPending, commitValue, prunePending, type UdpValues } from '../lib/udpDraft';

/** Asigna VALORES a las etiquetas UDP (definidas en Data Standards) de una
 *  tabla, columna o canvas. Muestra cada key con su input (select si es
 *  'list', input tipado si no) y llama `onChange(next)` con el mapa completo
 *  {defId: value}. Sólo lista las definiciones del `level` actual.
 *
 *  Guardado (doc 40): los selects commitean al elegir; los inputs de
 *  texto/número/fecha bufferean LOCAL y commitean al salir del campo (blur o
 *  Enter) y al desmontar (cerrar Properties / colapsar la fila guarda lo
 *  pendiente). Antes cada tecla disparaba onChange → un upsert + reload por
 *  carácter, y el input (atado al prop del server) perdía teclas al tipear
 *  rápido. `pending` (udpDraft.ts) evita que un commit armado sobre el prop
 *  stale pise lo recién guardado en otro campo mientras el reload viaja. */
export default function UdpAssign({ level, values, onChange, disabled, locked }: {
  level: UdpLevel;
  values: UdpValues;
  onChange: (next: UdpValues) => void;
  disabled?: boolean;
  /** Doc 61: defs gestionados por la plataforma (defId → hint). Se muestran
   *  deshabilitados con el hint como title (p.ej. "View Type" se cambia desde
   *  la pestaña Query SQL, no acá). */
  locked?: Record<string, string>;
}) {
  const [defs, setDefs] = useState<UdpDefinition[]>([]);
  // Borrador por campo (solo mientras se tipea); undefined = sin edición viva.
  const [draft, setDraft] = useState<Record<string, string | undefined>>({});
  // Commits que el server todavía no refleja (el reload del padre demora).
  const pending = useRef<UdpValues>({});
  // Refs para el flush de desmontaje (cleanup de efecto ve el primer render).
  const latest = useRef({ values, onChange, draft });
  latest.current = { values, onChange, draft };

  useEffect(() => {
    let alive = true;
    getUdpDefs().then((d) => { if (alive) setDefs(d.filter((x) => x.level === level)); }).catch(() => {});
    return () => { alive = false; };
  }, [level]);

  // Llegó un prop nuevo (reload): podar lo pendiente que ya está reflejado.
  useEffect(() => { pending.current = prunePending(values, pending.current); }, [values]);

  // Flush al desmontar: lo tipeado sin blur (cerrar el panel / colapsar la
  // fila / cerrar el modal) se commitea en UN onChange con todos los borradores.
  useEffect(() => () => {
    const { values: vals, onChange: emit, draft: d } = latest.current;
    let base = applyPending(vals, pending.current);
    let dirty = false;
    for (const [id, v] of Object.entries(d)) {
      if (v === undefined || v === (base[id] ?? '')) continue;
      base = commitValue(base, id, v);
      dirty = true;
    }
    if (dirty) emit(base);
  }, []);

  if (defs.length === 0) {
    const noun = level === 'table' ? 'tablas' : level === 'canvas' ? 'modelos' : level === 'view' ? 'vistas' : 'columnas';
    return <div style={{ fontSize: 12, color: '#9AA3B2', padding: '4px 0' }}>No hay UDP definidos para {noun}. Definilos en <b>Data Standards → UDP</b>.</div>;
  }

  const base = applyPending(values, pending.current);
  const commit = (id: string) => {
    const v = draft[id];
    setDraft((d) => ({ ...d, [id]: undefined }));
    if (v === undefined || v === (base[id] ?? '')) return;
    pending.current = { ...pending.current, [id]: v };
    onChange(commitValue(base, id, v));
  };
  // Select ('list'): acción discreta → commit inmediato, sin borrador.
  const setListVal = (id: string, v: string) => {
    pending.current = { ...pending.current, [id]: v };
    onChange(commitValue(base, id, v));
  };
  const inp: React.CSSProperties = { height: 30, padding: '0 9px', border: '1px solid #DCE1EA', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', color: '#1A2B4A', minWidth: 150, boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {defs.map((d) => {
        const val = draft[d.id] ?? base[d.id] ?? '';
        const lockHint = locked?.[d.id];
        return (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={lockHint}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 12.5, color: '#48526A' }} title={lockHint ?? d.description ?? undefined}>
              <Tags size={12} color="#7A4DD6" />{d.name}
            </span>
            {d.dataType === 'list' ? (
              <select style={inp} value={val} disabled={disabled || !!lockHint} onChange={(e) => setListVal(d.id, e.target.value)}>
                <option value="">{d.defaultValue ? `${d.defaultValue} (default)` : '—'}</option>
                {d.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input style={inp} value={val} disabled={disabled || !!lockHint}
                type={d.dataType === 'number' ? 'number' : d.dataType === 'date' ? 'date' : 'text'}
                placeholder={d.defaultValue ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, [d.id]: e.target.value }))}
                onBlur={() => commit(d.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
