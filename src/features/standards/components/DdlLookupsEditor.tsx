/**
 * Lookups & Functions del ruleset. El lookup es el BUSCARV de Excel: tabla de
 * dos columnas con la izquierda precargada con los valores permitidos del UDP
 * de origen; el modelador solo llena la derecha. Cada fila tiene tres estados
 * (espejo de `_resolve_lookup`): un valor; «nada» (null: no se emite); y sin
 * mapear (emite el default). Con default, los dos últimos no son lo mismo: el
 * placeholder dice qué pasa y la fila ofrece pasar de uno al otro («Emit
 * nothing» / «Unmap»). Vaciar la celda la deja sin mapear. Ver `lookupRow`.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Ban, Plus, RotateCcw, Table2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { saveDdlConfig } from '../ddlRules.service';
import { applyErrorNotice, ddlConfigChanged, lookupRow, NO_CHANGES_HINT } from '../standardsDiff';
import { getUdpDefs, type DdlLookup, type DdlRulesetConfig, type UdpDefinition } from '../standards.service';
import { useEffect } from 'react';

/** Columnas de la tabla de un lookup: valor del UDP · valor emitido · acción de la fila. */
const LK_COLS = '1fr 1fr 24px';
const rowBtn: CSSProperties = {
  width: 24, height: 24, padding: 0, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', borderRadius: 6,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

export default function DdlLookupsEditor({ projectId, config, canEdit, onClose, onApplied }: {
  projectId: string;
  config: DdlRulesetConfig;
  canEdit: boolean;
  onClose: () => void;
  onApplied: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<'lookups' | 'functions'>('lookups');
  const [lookups, setLookups] = useState<Record<string, DdlLookup>>(() => structuredClone(config.lookups));
  // Claves de cada lookup en el config inicial: las stale siguen visibles hasta
  // guardar; al borrar el lookup se descartan (uno nuevo con el mismo nombre no
  // hereda sus filas).
  const [initialKeys, setInitialKeys] = useState<Record<string, string[]>>(
    () => Object.fromEntries(Object.entries(config.lookups).map(([name, l]) => [name, Object.keys(l.values ?? {})])));
  const [functions, setFunctions] = useState(() => structuredClone(config.functions));
  const [defs, setDefs] = useState<UdpDefinition[]>([]);
  const [selected, setSelected] = useState<string | null>(Object.keys(config.lookups)[0] ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getUdpDefs(projectId).then(setDefs).catch(() => setDefs([])); }, [projectId]);

  const defById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  const listDefs = useMemo(() => defs.filter((d) => d.dataType === 'list'), [defs]);
  const lk = selected ? lookups[selected] : undefined;
  // Sin un cambio real no se guarda (evita registrar una versión vacía).
  const dirty = useMemo(() => ddlConfigChanged(lookups, functions, config), [lookups, functions, config]);
  const srcDef = lk?.fromUdpId ? defById.get(lk.fromUdpId) : undefined;

  // Filas = valores permitidos del UDP (izquierda precargada) + claves ya
  // mapeadas que están fuera de la lista (stale, se muestran igual). Las stale
  // del config inicial siguen visibles hasta guardar: vaciar su celda las
  // des-mapea sin que la fila desaparezca con el foco adentro.
  const rows = useMemo(() => {
    if (!lk) return [];
    const allowed = srcDef?.allowedValues ?? [];
    const initial = selected ? initialKeys[selected] ?? [] : [];
    const extra = [...new Set([...Object.keys(lk.values), ...initial])].filter((k) => !allowed.includes(k));
    return [...allowed, ...extra];
  }, [lk, srcDef, selected, initialKeys]);

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
      await saveDdlConfig(projectId, { lookups, functions });
      toast.success('Lookups & functions saved');
      await onApplied(); onClose();
    } catch (e) { const n = applyErrorNotice(e, "Couldn't save"); toast[n.kind](n.text); }
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
              <span style={{ fontFamily: 'var(--mono, monospace)' }}>{'{lookup:name}'}</span>. Unmapped values emit the default; a value set to “nothing” is not emitted.
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
                          const rest = { ...lookups }; delete rest[selected];
                          setLookups(rest); setSelected(Object.keys(rest)[0] ?? null);
                          setInitialKeys((m) => { const next = { ...m }; delete next[selected]; return next; });
                        }} title="Delete lookup"
                          style={{ width: 32, height: 32, border: '1px solid #F1D9D5', background: '#FDF2F1', color: '#B23A2E', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <div style={{ border: '1px solid #EAEDF2', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: LK_COLS, gap: 0, background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', padding: '8px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>
                        <div>{srcDef?.name ?? 'UDP value'}</div><div>Emitted value</div><div />
                      </div>
                      {rows.map((val) => {
                        // Con default, «nada» y «sin mapear» emiten distinto: el
                        // placeholder lo dice y la fila pasa de uno al otro.
                        const row = lookupRow(lk, val);
                        const unmap = lk.default != null
                          ? `Unmap ${val} — emit the default (${lk.default === '' ? "''" : lk.default})` : `Unmap ${val}`;
                        const nothing = `Emit nothing for ${val} (instead of the default)`;
                        return (
                          <div key={val} style={{ display: 'grid', gridTemplateColumns: LK_COLS, alignItems: 'center', borderBottom: '1px solid #F2F4F8', padding: '6px 12px', gap: 10 }}>
                            <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, color: (srcDef?.allowedValues ?? []).includes(val) ? '#1A2B4A' : '#B98600' }}>{val}</div>
                            <input value={lk.values[val] ?? ''} disabled={!canEdit} placeholder={row.placeholder} aria-label={`Emitted value for ${val}`}
                              onChange={(e) => {
                                // Vaciar la celda la vuelve a «sin mapear» (emite el default);
                                // «nothing» (null) se elige solo con «Emit nothing».
                                const next = { ...lk.values, [val]: e.target.value };
                                if (!e.target.value) delete next[val];
                                patchLk({ values: next });
                              }}
                              style={{ height: 30, border: '1px solid #E6EAF0', borderRadius: 7, padding: '0 9px', fontFamily: 'var(--mono, monospace)', fontSize: 12, outline: 'none' }} />
                            {canEdit && row.action === 'unmap' ? (
                              <button type="button" title={unmap} aria-label={unmap} style={rowBtn}
                                onClick={() => { const next = { ...lk.values }; delete next[val]; patchLk({ values: next }); }}>
                                <RotateCcw size={12} aria-hidden />
                              </button>
                            ) : canEdit && row.action === 'nothing' ? (
                              <button type="button" title={nothing} aria-label={nothing} style={rowBtn}
                                onClick={() => patchLk({ values: { ...lk.values, [val]: null } })}>
                                <Ban size={12} aria-hidden />
                              </button>
                            ) : <span />}
                          </div>
                        );
                      })}
                      <div style={{ display: 'grid', gridTemplateColumns: LK_COLS, alignItems: 'center', padding: '6px 12px', gap: 10, background: '#FBFCFD' }}>
                        <div style={{ fontSize: 11.5, color: '#8A93A5', fontWeight: 600 }}>default (unmapped)</div>
                        <input value={lk.default ?? ''} disabled={!canEdit} placeholder="— nothing (not emitted)" aria-label="Default value (unmapped)"
                          onChange={(e) => patchLk({ default: e.target.value || null })}
                          style={{ height: 30, border: '1px solid #E6EAF0', borderRadius: 7, padding: '0 9px', fontFamily: 'var(--mono, monospace)', fontSize: 12, outline: 'none' }} />
                        <span />
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
          <span style={{ flex: 1, fontSize: 11.5, color: '#9AA3B2' }}>{dirty ? 'Saving records a Data Standards version (rollback available).' : NO_CHANGES_HINT}</span>
          <button onClick={onClose} style={{ height: 38, padding: '0 16px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          {canEdit && (
            <button onClick={doSave} disabled={saving || !dirty} title={dirty ? undefined : NO_CHANGES_HINT}
              style={{ height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: dirty ? 'pointer' : 'default', opacity: dirty ? 1 : 0.5, fontFamily: 'inherit' }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
