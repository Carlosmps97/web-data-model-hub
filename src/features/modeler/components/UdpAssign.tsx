import { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { getUdpDefs, type UdpDefinition, type UdpLevel } from '@/features/standards/standards.service';

/** Asigna VALORES a las etiquetas UDP (definidas en Data Standards) de una
 *  tabla o columna. Muestra cada key con su input (select si es 'list', input
 *  tipado si no) y llama `onChange(next)` con el mapa completo {defId: value}.
 *  Sólo lista las definiciones cuyo `appliesTo` incluye el `level` actual. */
export default function UdpAssign({ level, values, onChange, disabled }: {
  level: UdpLevel;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [defs, setDefs] = useState<UdpDefinition[]>([]);
  useEffect(() => {
    let alive = true;
    getUdpDefs().then((d) => { if (alive) setDefs(d.filter((x) => x.level === level)); }).catch(() => {});
    return () => { alive = false; };
  }, [level]);

  if (defs.length === 0) {
    return <div style={{ fontSize: 12, color: '#9AA3B2', padding: '4px 0' }}>No hay UDP definidos para {level === 'table' ? 'tablas' : 'columnas'}. Definilos en <b>Data Standards → UDP</b>.</div>;
  }

  const setVal = (id: string, v: string) => {
    const next = { ...values };
    if (v === '') delete next[id]; else next[id] = v;
    onChange(next);
  };
  const inp: React.CSSProperties = { height: 30, padding: '0 9px', border: '1px solid #DCE1EA', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', color: '#1A2B4A', minWidth: 150, boxSizing: 'border-box' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {defs.map((d) => {
        const val = values[d.id] ?? '';
        return (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 12.5, color: '#48526A' }} title={d.description ?? undefined}>
              <Tags size={12} color="#7A4DD6" />{d.name}
            </span>
            {d.dataType === 'list' ? (
              <select style={inp} value={val} disabled={disabled} onChange={(e) => setVal(d.id, e.target.value)}>
                <option value="">{d.defaultValue ? `${d.defaultValue} (default)` : '—'}</option>
                {d.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input style={inp} value={val} disabled={disabled}
                type={d.dataType === 'number' ? 'number' : d.dataType === 'date' ? 'date' : 'text'}
                placeholder={d.defaultValue ?? ''} onChange={(e) => setVal(d.id, e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
