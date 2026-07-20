import { useEffect, useMemo, useState } from 'react';
import { Boxes, Pencil, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import type { StandardsSnapshot, SnapshotDomain } from '../standards.service';
import { applyStandards } from '../standards.service';
import { getDomainImpact, type DomainImpact } from '@/services/naming.service';
import { impactWarning, visibleImpactTables, tableLabel } from '../domainImpact';

type Mode = 'view' | 'edit' | 'create';

export default function DomainsPage({ snapshot, canEdit, onApplied }: {
  snapshot: StandardsSnapshot;
  canEdit: boolean;
  onApplied: () => void;
}) {
  const domains = snapshot.domains;
  const [selId, setSelId] = useState<string | null>(domains[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>('view');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'apply' | 'delete'>(null);
  const [impact, setImpact] = useState<DomainImpact | null>(null);
  // Tras crear un dominio, el id lo genera el backend; guardamos el nombre para
  // seleccionarlo cuando la recarga lo traiga (si no, selId quedaba en '__new__').
  const [pendingName, setPendingName] = useState<string | null>(null);

  const selected = useMemo(() => domains.find((d) => d.id === selId) ?? null, [domains, selId]);

  useEffect(() => {
    if (!pendingName) return;
    const d = domains.find((x) => x.name === pendingName);
    if (d) { setSelId(d.id); setPendingName(null); }
  }, [domains, pendingName]);
  const [form, setForm] = useState<SnapshotDomain>({ id: '', name: '', defaultDataType: '', namingTerm: '', description: '' });

  useEffect(() => {
    setMode('view'); setConfirm(null); setImpact(null);
    if (selected) setForm({ ...selected });
    if (selId && selId !== '__new__') getDomainImpact(selId).then(setImpact).catch(() => setImpact(null));
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return !n ? domains : domains.filter((d) => d.name.toLowerCase().includes(n));
  }, [domains, q]);

  const startCreate = () => { setSelId('__new__'); setForm({ id: '', name: '', defaultDataType: '', namingTerm: '', description: '' }); setMode('create'); setImpact(null); };
  const startEdit = () => { if (selected) { setForm({ ...selected }); setMode('edit'); } };
  const cancel = () => { setMode('view'); setConfirm(null); if (selected) setForm({ ...selected }); };

  const typeChanged = mode === 'edit' && selected && selected.defaultDataType !== form.defaultDataType;

  // F2 #2: estado del dialog de impacto detallado (búsqueda server-side + toggle).
  const [dlgQ, setDlgQ] = useState('');
  const [showOverridden, setShowOverridden] = useState(false);
  const [dlgImpact, setDlgImpact] = useState<DomainImpact | null>(null);

  // Reset del dialog de impacto al abrirlo.
  useEffect(() => {
    if (confirm === 'apply') { setDlgQ(''); setShowOverridden(false); setDlgImpact(null); }
  }, [confirm]);

  // Búsqueda server-side (q) con debounce 300ms dentro del dialog (F2 #2);
  // `alive` descarta respuestas fuera de orden (patrón CatalogPanel).
  useEffect(() => {
    if (confirm !== 'apply' || !typeChanged || !selId || selId === '__new__') return;
    let alive = true;
    const h = setTimeout(() => {
      getDomainImpact(selId, { q: dlgQ.trim() || undefined, limit: 200 })
        .then((i) => { if (alive) setDlgImpact(i); })
        .catch(() => { if (alive) setDlgImpact(null); });
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [confirm, dlgQ, selId, typeChanged]);

  const apply = async () => {
    setBusy(true);
    try {
      const creating = mode === 'create';
      const v = await applyStandards({
        kind: 'domain',
        domainsUpsert: [{ id: creating ? undefined : form.id, name: form.name.trim(), defaultDataType: form.defaultDataType.trim(), namingTerm: form.namingTerm || undefined, description: form.description || undefined }],
      });
      toast.success(`Applied · ${v.label} · ${v.impact.columns} columns re-typed`);
      if (creating) setPendingName(form.name.trim());   // seleccionarlo al recargar
      setMode('view'); setConfirm(null); onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't apply"); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const v = await applyStandards({ kind: 'domain', domainsDelete: [selected.id] });
      toast.success(`Domain deleted · ${v.label}`);
      setConfirm(null); setSelId(domains.find((d) => d.id !== selected.id)?.id ?? null); onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete"); } finally { setBusy(false); }
  };

  const editable = mode === 'edit' || mode === 'create';

  return (
    <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
      {/* list */}
      <div style={{ width: 308, flex: 'none', borderRight: '1px solid #EAEDF2', background: '#FAFBFC', padding: '18px 16px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9AA3B2' }}>Domains · {domains.length}</span>
          {canEdit && <button onClick={startCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', border: '1px solid #D4E0FF', background: '#fff', color: '#2E5BFF', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Plus size={12} />New</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 11px', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 9, marginBottom: 12 }}>
          <Search size={14} color="#9AA3B2" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domains…" style={{ flex: 1, border: 0, outline: 'none', fontSize: 12.5, background: 'transparent' }} />
        </div>
        {mode === 'create' && <div style={{ ...domCard(true), marginBottom: 8 }}><Boxes size={15} color="#8B5CF6" /><span style={{ fontSize: 13.5, fontWeight: 600, color: '#1A2B4A', marginLeft: 8 }}>{form.name || 'New domain'}</span></div>}
        {filtered.map((d) => (
          <div key={d.id} onClick={() => { if (!editable) setSelId(d.id); }} style={{ ...domCard(d.id === selId && mode !== 'create'), marginBottom: 8, cursor: editable ? 'default' : 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Boxes size={15} color="#8B5CF6" /><span style={{ fontSize: 13.5, fontWeight: 600, color: '#1A2B4A' }}>{d.name}</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}><span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: '#1A2B4A', background: '#F2F4F8', borderRadius: 6, padding: '2px 7px' }}>{d.defaultDataType}</span></div>
          </div>
        ))}
      </div>

      {/* detail */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '26px 30px', background: '#FBFCFD' }}>
        {!selected && mode !== 'create' ? <div style={{ fontSize: 13, color: '#9AA3B2' }}>Pick a domain.</div> : (
          <div style={{ maxWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1A2B4A' }}>{mode === 'create' ? 'New domain' : mode === 'edit' ? 'Edit domain' : form.name}</h1>
              {editable && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#2E5BFF', background: '#EAF0FF', border: '1px solid #D4E0FF', borderRadius: 999, padding: '3px 10px' }}>Edit mode</span>}
            </div>
            {!editable && form.description && <p style={{ margin: '0 0 22px', fontSize: 13, color: '#6B7689', lineHeight: 1.5 }}>{form.description}</p>}

            <label style={lbl}>Domain name</label>
            {editable ? <input className="rd-input" style={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Importe" />
              : <div style={fieldRO}>{form.name}</div>}

            <label style={lbl}>Default data type</label>
            {editable ? <input className="rd-input" style={{ ...field, fontFamily: 'var(--mono, monospace)' }} value={form.defaultDataType} onChange={(e) => setForm({ ...form, defaultDataType: e.target.value })} placeholder="DECIMAL(18,2)" />
              : <div style={{ ...fieldRO, fontFamily: 'var(--mono, monospace)', fontWeight: 600 }}>{form.defaultDataType}</div>}
            {editable && <div style={{ fontSize: 12, color: '#8A93A5', margin: '-10px 0 18px' }}>On apply, columns of this domain WITHOUT an override are re-typed.</div>}

            <label style={lbl}>Description</label>
            {editable ? <textarea className="rd-input" style={{ ...field, minHeight: 64, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              : <div style={{ ...fieldRO, minHeight: 44 }}>{form.description || '—'}</div>}

            {/* impact */}
            {impact && mode !== 'create' && (
              <div style={{ background: 'linear-gradient(180deg,#F4F7FF,#FAFBFF)', border: '1px solid #D9E3FB', borderRadius: 12, padding: '15px 17px', margin: '4px 0 18px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A2B4A' }}>
                  Usado por <strong style={{ color: '#2E5BFF' }}>{impact.columnsUsing} columnas</strong> en <strong>{impact.totalTables} tablas</strong> de <strong>{impact.modelsAffected} modelos</strong>.
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
                  <span style={{ fontSize: 13, color: '#0E8C6A', fontWeight: 600 }}>● {impact.willUpdate} se actualizan</span>
                  <span style={{ fontSize: 13, color: '#9A6B00', fontWeight: 600 }}>● {impact.overridden} con override (skip)</span>
                </div>
              </div>
            )}

            {/* actions */}
            {canEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 18, borderTop: '1px solid #EAEDF2' }}>
                <span style={{ flex: 1 }} />
                {mode === 'view' && <>
                  <button onClick={() => setConfirm('delete')} style={{ ...btnGhost, color: '#D6455D', borderColor: '#F1D4D9' }}><Trash2 size={14} />Delete</button>
                  <button onClick={startEdit} style={btnPrimary}><Pencil size={14} />Edit domain</button>
                </>}
                {editable && <>
                  <button onClick={cancel} style={btnGhost}>Cancel</button>
                  <button onClick={() => setConfirm('apply')} disabled={!form.name.trim() || !form.defaultDataType.trim()} style={{ ...btnPrimary, opacity: form.name.trim() && form.defaultDataType.trim() ? 1 : 0.5 }}><UploadCloud size={14} />{mode === 'create' ? 'Create domain' : 'Apply changes'}</button>
                </>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* confirm apply (15e) */}
      {confirm === 'apply' && (
        <div style={backdrop}>
          <div style={dialog} onClick={(e) => e.stopPropagation()}>
            <div style={dlgHead}><div style={{ ...dlgIcon, background: '#F3EEFF', color: '#8B5CF6' }}><Boxes size={21} /></div>
              <div style={{ flex: 1 }}><h2 style={dlgTitle}>{mode === 'create' ? `Create domain ${form.name}` : `Apply changes · ${form.name}`}</h2><p style={dlgSub}>{typeChanged ? 'Cascada el nuevo tipo a las columnas sin override.' : 'Nada se aplica hasta confirmar.'}</p></div>
              <button onClick={() => setConfirm(null)} style={iconClose}><X size={13} /></button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              {typeChanged && selected && <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--mono, monospace)', fontSize: 13, marginBottom: 12 }}><span style={{ color: '#8A93A5', textDecoration: 'line-through' }}>{selected.defaultDataType}</span> → <span style={{ fontWeight: 600, color: '#1A2B4A' }}>{form.defaultDataType}</span></div>}
              {typeChanged && (
                <>
                  {/* Warning explícito (spec #2) — números GLOBALES (impact sin q). */}
                  <div style={{ background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 11, padding: '12px 15px', fontSize: 13, fontWeight: 600, color: '#7A6220', marginBottom: 12 }}>
                    {impact ? impactWarning(impact) : 'Calculando impacto…'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 8, flex: 1 }}>
                      <Search size={13} color="#9AA3B2" />
                      <input value={dlgQ} onChange={(e) => setDlgQ(e.target.value)} placeholder="Is a table affected? Search by name…" style={{ flex: 1, border: 0, outline: 'none', fontSize: 12.5, background: 'transparent' }} />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#56607A', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <input type="checkbox" checked={showOverridden} onChange={(e) => setShowOverridden(e.target.checked)} />
                      Show overridden columns
                    </label>
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #EAEDF2', borderRadius: 10 }}>
                    {visibleImpactTables((dlgImpact ?? impact)?.tables ?? [], showOverridden).map((t) => (
                      <div key={t.tableId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #F2F4F8', fontSize: 12.5 }}>
                        <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 600, color: '#1A2B4A' }}>{tableLabel(t)}</span>
                        <span style={{ color: '#8A93A5', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.logicalName}</span>
                        <span style={{ color: '#0E8C6A', fontWeight: 600, whiteSpace: 'nowrap' }}>{t.columns - t.overridden} col.</span>
                        {t.overridden > 0 && <span style={{ color: '#9A6B00', fontWeight: 600, whiteSpace: 'nowrap' }}>{t.overridden} override</span>}
                      </div>
                    ))}
                    {visibleImpactTables((dlgImpact ?? impact)?.tables ?? [], showOverridden).length === 0 && (
                      <div style={{ padding: 14, fontSize: 12.5, color: '#9AA3B2' }}>
                        {dlgQ.trim() ? 'No affected table matches the search.' : 'No affected tables.'}
                      </div>
                    )}
                  </div>
                  {(dlgImpact ?? impact) && (dlgImpact ?? impact)!.totalTables > ((dlgImpact ?? impact)!.tables.length) && (
                    <div style={{ fontSize: 11.5, color: '#9AA3B2', marginTop: 6 }}>
                      Showing {(dlgImpact ?? impact)!.tables.length} of {(dlgImpact ?? impact)!.totalTables} tables
                    </div>
                  )}
                </>
              )}
              {mode === 'create' && <div style={{ fontSize: 13, color: '#56607A' }}>Domain <strong>{form.name}</strong> will be created with type <span style={{ fontFamily: 'var(--mono, monospace)' }}>{form.defaultDataType}</span>.</div>}
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '16px 24px 20px' }}><span style={{ flex: 1 }} /><button onClick={() => setConfirm(null)} disabled={busy} style={btnGhost}>Cancel</button><button onClick={apply} disabled={busy} style={btnPrimary}>{busy ? <span className="rd-spin" /> : <UploadCloud size={15} />}{busy ? 'Applying…' : mode === 'create' ? 'Create' : 'Apply cascade'}</button></div>
          </div>
        </div>
      )}

      {/* confirm delete */}
      {confirm === 'delete' && selected && (
        <div style={backdrop}>
          <div style={{ ...dialog, width: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={dlgHead}><div style={{ ...dlgIcon, background: '#FBEEF0', color: '#D6455D' }}><Trash2 size={20} /></div>
              <div style={{ flex: 1 }}><h2 style={dlgTitle}>Delete domain {selected.name}?</h2><p style={dlgSub}>Columns keep their current type but lose the link to the domain.</p></div>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '16px 24px 20px' }}><span style={{ flex: 1 }} /><button onClick={() => setConfirm(null)} disabled={busy} style={btnGhost}>Cancel</button><button onClick={del} disabled={busy} style={{ ...btnPrimary, background: '#D6455D' }}>{busy ? <span className="rd-spin" /> : <Trash2 size={15} />}Delete</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

const domCard = (active: boolean): React.CSSProperties => ({ background: '#fff', border: `${active ? 1.5 : 1}px solid ${active ? '#2E5BFF' : '#E6EAF0'}`, borderRadius: 11, padding: '11px 12px', boxShadow: active ? '0 0 0 3px rgba(46,91,255,0.1)' : 'none' });
const lbl: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 7 };
const field: React.CSSProperties = { width: '100%', height: 44, marginBottom: 18, fontSize: 14 };
const fieldRO: React.CSSProperties = { display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 14px', background: '#fff', border: '1px solid #E2E6EE', borderRadius: 10, fontSize: 14, color: '#1A2B4A', marginBottom: 18 };
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,28,45,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
const dialog: React.CSSProperties = { width: 560, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden' };
const dlgHead: React.CSSProperties = { display: 'flex', gap: 14, padding: '22px 24px 18px', borderBottom: '1px solid #EEF1F6' };
const dlgIcon: React.CSSProperties = { width: 42, height: 42, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' };
const dlgTitle: React.CSSProperties = { margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' };
const dlgSub: React.CSSProperties = { margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 };
const iconClose: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 20px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
