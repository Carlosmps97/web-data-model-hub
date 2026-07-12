import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { getFacets, isFilterableField, shouldFetchFacets, type Condition, type FieldDef, type Op, type ViewKey, type WhereGroup } from '../query.service';

const OP_LABEL: Record<Op, string> = {
  eq: '=', ne: '≠', in: 'in', nin: 'not in', contains: 'contains', startsWith: 'starts with',
  gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between', exists: 'is set', isnull: 'is empty',
};
const NO_VALUE: Op[] = ['exists', 'isnull'];
const sel: React.CSSProperties = { height: 30, padding: '0 7px', border: '1px solid #DCE1EA', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: '#1A2B4A' };

function isGroup(n: Condition | WhereGroup): n is WhereGroup {
  return (n as WhereGroup).conditions !== undefined;
}

function ValueEditor({ fd, cond, from, onChange }: { fd?: FieldDef; cond: Condition; from: ViewKey; onChange: (v: unknown) => void }) {
  const [facets, setFacets] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    // Carga opciones (typeahead server-side) para campos hidratados (dominio) o
    // facetables conocidos (schema/dataType). enum ya trae sus allowedValues; los
    // campos derived nunca facetan (ops=[]).
    if (fd && shouldFetchFacets(fd)) {
      getFacets(from, fd.key).then(setFacets).catch(() => {});
    } else {
      setFacets([]);
    }
  }, [fd?.key, from]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fd || NO_VALUE.includes(cond.op)) return null;
  const opts = fd.enumValues?.map((v) => ({ value: v, label: v })) ?? facets;
  if (cond.op === 'in' || cond.op === 'nin') {
    const arr = Array.isArray(cond.value) ? cond.value as string[] : [];
    return (
      <select multiple style={{ ...sel, height: 66, minWidth: 150 }} value={arr}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (opts.length) {
    return <select style={{ ...sel, minWidth: 130 }} value={String(cond.value ?? '')} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  }
  if (fd.type === 'boolean') {
    return <select style={sel} value={String(cond.value ?? 'true')} onChange={(e) => onChange(e.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select>;
  }
  return <input style={{ ...sel, minWidth: 130 }} type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
    value={String(cond.value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="valor" />;
}

function ConditionRow({ cond, catalog, from, onChange, onRemove }: {
  cond: Condition; catalog: FieldDef[]; from: ViewKey; onChange: (c: Condition) => void; onRemove: () => void;
}) {
  const fd = catalog.find((f) => f.key === cond.field);
  // Los campos derived (ops=[]) no son filtrables → fuera del selector.
  const fields = catalog.filter(isFilterableField);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
      <select style={{ ...sel, minWidth: 150 }} value={cond.field} onChange={(e) => {
        const nf = catalog.find((f) => f.key === e.target.value);
        onChange({ field: e.target.value, op: (nf?.ops[0] ?? 'eq'), value: undefined });
      }}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.udp ? '◆ ' : ''}{f.label}</option>)}
      </select>
      <select style={sel} value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as Op, value: undefined })}>
        {(fd?.ops ?? []).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
      </select>
      <ValueEditor fd={fd} cond={cond} from={from} onChange={(v) => onChange({ ...cond, value: v })} />
      <button onClick={onRemove} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#B6BECD' }}><X size={15} /></button>
    </div>
  );
}

export default function FilterBuilder({ group, catalog, from, onChange, depth = 0 }: {
  group: WhereGroup; catalog: FieldDef[]; from: ViewKey; onChange: (g: WhereGroup) => void; depth?: number;
}) {
  const set = (conditions: (Condition | WhereGroup)[]) => onChange({ ...group, conditions });
  const firstFilterable = catalog.find(isFilterableField);
  const addCond = () => set([...group.conditions, { field: firstFilterable?.key ?? '', op: firstFilterable?.ops[0] ?? 'eq', value: undefined }]);
  const addGroup = () => set([...group.conditions, { op: 'and', conditions: [] }]);

  return (
    <div style={{ border: depth ? '1px dashed #D6DCE6' : 'none', borderRadius: 9, padding: depth ? 10 : 0, background: depth ? '#FAFBFD' : 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'inline-flex', border: '1px solid #DCE1EA', borderRadius: 7, overflow: 'hidden' }}>
          {(['and', 'or'] as const).map((o) => (
            <button key={o} onClick={() => onChange({ ...group, op: o })}
              style={{ height: 26, padding: '0 11px', border: 'none', background: group.op === o ? '#2E5BFF' : '#fff', color: group.op === o ? '#fff' : '#48526A', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' }}>{o}</button>
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: '#9AA3B2' }}>de estas condiciones</span>
      </div>
      {group.conditions.map((c, i) => (
        isGroup(c)
          ? <div key={i} style={{ marginBottom: 6 }}><FilterBuilder group={c} catalog={catalog} from={from} depth={depth + 1}
              onChange={(g) => set(group.conditions.map((x, j) => (j === i ? g : x)))} />
              <button onClick={() => set(group.conditions.filter((_, j) => j !== i))} style={{ marginTop: 4, border: 'none', background: 'transparent', color: '#C0392B', fontSize: 11.5, cursor: 'pointer' }}>quitar grupo</button></div>
          : <ConditionRow key={i} cond={c} catalog={catalog} from={from}
              onChange={(nc) => set(group.conditions.map((x, j) => (j === i ? nc : x)))}
              onRemove={() => set(group.conditions.filter((_, j) => j !== i))} />
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={addCond} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #DCE1EA', background: '#fff', borderRadius: 7, height: 28, padding: '0 10px', fontSize: 12, cursor: 'pointer', color: '#48526A' }}><Plus size={12} />Condición</button>
        {depth < 2 && <button onClick={addGroup} style={{ border: '1px solid #DCE1EA', background: '#fff', borderRadius: 7, height: 28, padding: '0 10px', fontSize: 12, cursor: 'pointer', color: '#8A93A5' }}>+ grupo</button>}
      </div>
    </div>
  );
}
