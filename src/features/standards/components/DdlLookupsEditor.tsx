/**
 * Lookups & Functions del ruleset (doc 30 §7, componentes que el diseño no
 * traía). El lookup es el BUSCARV de Excel: tabla de DOS columnas con la
 * izquierda PREcargada con los valores permitidos del UDP de origen — el
 * modelador solo llena la derecha (spec §6.7). Vacío = no emitir (null).
 */
import { useMemo, useState } from 'react';
import { Plus, Table2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { saveDdlConfig } from '../ddlRules.service';
import { getUdpDefs, type DdlLookup, type DdlRulesetConfig, type UdpDefinition } from '../standards.service';
import { useEffect } from 'react';

export default function DdlLookupsEditor({ config, canEdit, onClose, onApplied }: {
  config: DdlRulesetConfig;
  canEdit: boolean;
  onClose: () => void;
  onApplied: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<'lookups' | 'functions'>('lookups');
  const [lookups, setLookups] = useState<Record<string, DdlLookup>>(() => structuredClone(config.lookups));
  const [functions, setFunctions] = useState(() => structuredClone(config.functions));
  const [defs, setDefs] = useState<UdpDefinition[]>([]);
  const [selected, setSelected] = useState<string | null>(Object.keys(config.lookups)[0] ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getUdpDefs().then(setDefs).catch(() => setDefs([])); }, []);

  const defById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  const listDefs = useMemo(() => defs.filter((d) => d.dataType === 'list'), [defs]);
  const lk = selected ? lookups[selected] : undefined;
  const srcDef = lk?.fromUdpId ? defById.get(lk.fromUdpId) : undefined;

  // Filas = valores permitidos del UDP (izquierda precargada) + claves ya
  // mapeadas que quedaron fuera de la lista (stale, se muestran igual).
  const rows = useMemo(() => {
    if (!lk) return [];
    const allowed = srcDef?.allowedValues ?? [];
    const extra = Object.keys(lk.values).filter((k) => !allowed.includes(k));
    return [...allowed, ...extra];
  }, [lk, srcDef]);

  const patchLk = (p: Partial<DdlLookup>) => {
    if (!selected) return;
    setLookups({ ...lookups, [selected]: { ...lookups[selected], ...p } });
  };

  const addLookup = () => {
    const name = window.prompt('Lookup name (used as {lookup:name}):', 'mi_map');
    if (!name?.trim()) return;
    const slug = name.trim().replace(/\s+/g, '_');
    if (lookups[slug]) { toast.error(`Lookup '${slug}' already exists`); return; }
    setLookups({ ...lookups, [slug]: { fromUdpId: listDefs[0]?.id, fromLevel: listDefs[0]?.level, values: {}, default: null } });
    setSelected(slug);
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await saveDdlConfig({ lookups, functions });
      toast.success('Lookups & functions saved');
      await onApplied(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,28,45,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ width: 720, maxHeight: 720, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '22px 24px 14px', borderBottom: '1px solid #EEF1F6' }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: '#F3EEFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Table2 size={20} color="#8B5CF6" /></div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>Lookups &amp; Functions</h2>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 }}>
              A lookup is a VLOOKUP over a UDP's allowed values — used as{' '}
              <span style={{ fontFamily: 'var(--mono, monospace)' }}>{'{lookup:name}'}</span>. Empty output = emit nothing.
            </p>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}><X size={13} /></button>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid #EAEDF2' }}>
          {(['lookups', 'functions'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ height: 42, padding: '0 14px', border: 'none', background: 'transparent', fontSize: 12.5, fontWeight: tab === t ? 600 : 500, color: tab === t ? '#1A2B4A' : '#8A93A5', borderBottom: `2px solid ${tab === t ? '#2E5BFF' : 'transparent'}`, cursor: 'pointer', fontFamily: 'inherit' }}>
              {t === 'lookups' ? `Lookups · ${Object.keys(lookups).length}` : `Functions · ${functions.length}`}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 24px' }}>
          {tab === 'lookups' ? (
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ width: 190, flex: 'none' }}>
                {Object.keys(lookups).map((name) => (
                  <button key={name} onClick={() => setSelected(name)}
                    style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 6, padding: '8px 10px', border: 'none', borderRadius: 8, background: selected === name ? '#EAF0FF' : 'transparent', color: selected === name ? '#2E5BFF' : '#3A4658', fontFamily: 'var(--mono, monospace)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                    {name}
                  </button>
                ))}
                {canEdit && (
                  <button onClick={addLookup}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, height: 30, padding: '0 10px', border: '1px dashed #C9D2E0', background: '#fff', color: '#8A93A5', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Plus size={12} /> New lookup
                  </button>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {!lk ? (
                  <div style={{ fontSize: 12.5, color: '#9AA3B2', padding: '20px 0' }}>No lookups yet.</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>Source UDP</label>
                      <select value={lk.fromUdpId ?? ''} disabled={!canEdit}
                        onChange={(e) => {
                          const d = defById.get(e.target.value);
                          patchLk({ fromUdpId: e.target.value, fromLevel: d?.level });
                        }}
                        style={{ flex: 1, height: 34, padding: '0 10px', border: '1px solid #E2E6EE', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
                        {listDefs.map((d) => <option key={d.id} value={d.id}>[{d.level}] {d.name}</option>)}
                      </select>
                      {canEdit && selected && (
                        <button onClick={() => {
                          const { [selected]: _gone, ...rest } = lookups;
                          setLookups(rest); setSelected(Object.keys(rest)[0] ?? null);
                        }} title="Delete lookup"
                          style={{ width: 32, height: 32, border: '1px solid #F1D9D5', background: '#FDF2F1', color: '#B23A2E', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <div style={{ border: '1px solid #EAEDF2', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', padding: '8px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>
                        <div>{srcDef?.name ?? 'UDP value'}</div><div>Emitted value</div>
                      </div>
                      {rows.map((val) => (
                        <div key={val} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', borderBottom: '1px solid #F2F4F8', padding: '6px 12px', gap: 10 }}>
                          <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, color: (srcDef?.allowedValues ?? []).includes(val) ? '#1A2B4A' : '#B98600' }}>{val}</div>
                          <input value={lk.values[val] ?? ''} disabled={!canEdit} placeholder="— nothing"
                            onChange={(e) => patchLk({ values: { ...lk.values, [val]: e.target.value || null } })}
                            style={{ height: 30, border: '1px solid #E6EAF0', borderRadius: 7, padding: '0 9px', fontFamily: 'var(--mono, monospace)', fontSize: 12, outline: 'none' }} />
                        </div>
                      ))}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', padding: '6px 12px', gap: 10, background: '#FBFCFD' }}>
                        <div style={{ fontSize: 11.5, color: '#8A93A5', fontWeight: 600 }}>default (unmapped)</div>
                        <input value={lk.default ?? ''} disabled={!canEdit} placeholder="— nothing (null)"
                          onChange={(e) => patchLk({ default: e.target.value || null })}
                          style={{ height: 30, border: '1px solid #E6EAF0', borderRadius: 7, padding: '0 9px', fontFamily: 'var(--mono, monospace)', fontSize: 12, outline: 'none' }} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div>
              {functions.map((fn, i) => (
                <div key={i} style={{ border: '1px solid #EAEDF2', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input value={fn.name} disabled={!canEdit} placeholder="function_name"
                      onChange={(e) => setFunctions(functions.map((f, j) => j === i ? { ...f, name: e.target.value.replace(/\s+/g, '_') } : f))}
                      style={{ flex: 1, height: 32, border: '1px solid #E2E6EE', borderRadius: 8, padding: '0 10px', fontFamily: 'var(--mono, monospace)', fontSize: 12, outline: 'none' }} />
                    <input value={fn.params.join(', ')} disabled={!canEdit} placeholder="params: col, nivel"
                      onChange={(e) => setFunctions(functions.map((f, j) => j === i ? { ...f, params: e.target.value.split(',').map((p) => p.trim()).filter(Boolean) } : f))}
                      style={{ flex: 1, height: 32, border: '1px solid #E2E6EE', borderRadius: 8, padding: '0 10px', fontFamily: 'var(--mono, monospace)', fontSize: 12, outline: 'none' }} />
                    {canEdit && <button onClick={() => setFunctions(functions.filter((_, j) => j !== i))}
                      style={{ width: 32, height: 32, border: '1px solid #F1D9D5', background: '#FDF2F1', color: '#B23A2E', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Trash2 size={13} /></button>}
                  </div>
                  <textarea value={fn.body} disabled={!canEdit} spellCheck={false}
                    placeholder={"CASE WHEN '{nivel}' LIKE 'DAC-%' THEN sha2({col}, 512) ELSE {col} END"}
                    onChange={(e) => setFunctions(functions.map((f, j) => j === i ? { ...f, body: e.target.value } : f))}
                    style={{ width: '100%', minHeight: 64, border: '1px solid #E2E6EE', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--mono, monospace)', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                </div>
              ))}
              {canEdit && (
                <button onClick={() => setFunctions([...functions, { name: '', params: [], body: '' }])}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', border: '1px dashed #C9D2E0', background: '#fff', color: '#8A93A5', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Plus size={12} /> New function
                </button>
              )}
              <div style={{ fontSize: 11, color: '#9AA3B2', marginTop: 10, lineHeight: 1.5 }}>
                Reusable SQL bodies with <span style={{ fontFamily: 'var(--mono, monospace)' }}>{'{param}'}</span> placeholders —
                used as <span style={{ fontFamily: 'var(--mono, monospace)' }}>{'{name(col, …)}'}</span>. A SQL CASE covers almost
                everything; if you need more, you probably need a lookup.
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 24px 18px', borderTop: '1px solid #EEF1F6' }}>
          <span style={{ flex: 1, fontSize: 11.5, color: '#9AA3B2' }}>Saving records a Data Standards version (rollback available).</span>
          <button onClick={onClose} style={{ height: 38, padding: '0 16px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          {canEdit && (
            <button onClick={doSave} disabled={saving}
              style={{ height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
