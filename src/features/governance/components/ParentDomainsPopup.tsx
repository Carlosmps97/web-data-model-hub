import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, AlertTriangle, ChevronLeft, ArrowRight } from 'lucide-react';
import * as naming from '@/services/naming.service';
import type { ParentDomainFull, DomainImpact } from '@/services/naming.service';

/**
 * Parent Domains (Pantalla 09a configure / 09b cascade). Contenido del GovPopup
 * (se renderiza dentro de su Modal). Los dominios son configuración **global**:
 * un cambio de tipo se propaga (cascade) a las columnas que lo usan SIN override.
 * NO entra en el publish (REST directo, no changeset).
 */
const BLANK: Omit<ParentDomainFull, 'id'> = { name: '', defaultDataType: '', namingTerm: '', description: '' };

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5, display: 'block' };
const field: React.CSSProperties = { marginBottom: 12 };

export default function ParentDomainsPopup({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const [domains, setDomains] = useState<ParentDomainFull[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<ParentDomainFull, 'id'>>(BLANK);
  const [origType, setOrigType] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'configure' | 'cascade'>('configure');
  const [impact, setImpact] = useState<DomainImpact | null>(null);

  const load = async () => { try { setDomains(await naming.listDomainsGlobal()); } catch { pushToast('No se pudieron cargar los dominios', 'err'); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (d: ParentDomainFull) => {
    setSelId(d.id); setCreating(false);
    setForm({ name: d.name, defaultDataType: d.defaultDataType, namingTerm: d.namingTerm ?? '', description: d.description ?? '' });
    setOrigType(d.defaultDataType); setStep('configure');
  };
  const startNew = () => { setSelId(null); setCreating(true); setForm(BLANK); setOrigType(''); setStep('configure'); };

  const save = async () => {
    if (!form.name.trim() || !form.defaultDataType.trim()) { pushToast('Nombre y tipo son obligatorios', 'err'); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), defaultDataType: form.defaultDataType.trim(), namingTerm: form.namingTerm?.trim() || undefined, description: form.description?.trim() || undefined };
      if (creating) { const d = await naming.createDomainGlobal(body); await load(); select(d); pushToast('Dominio creado'); }
      else if (selId) { await naming.updateDomainGlobal(selId, body); await load(); pushToast('Dominio guardado'); }
    } catch { pushToast('No se pudo guardar', 'err'); } finally { setBusy(false); }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar el dominio “${name}”?`)) return;
    try { await naming.deleteDomainGlobal(id); if (selId === id) { setSelId(null); setForm(BLANK); } await load(); pushToast('Dominio eliminado'); }
    catch { pushToast('No se pudo eliminar', 'err'); }
  };

  const openCascade = async () => {
    if (!selId) return;
    setBusy(true);
    try { setImpact(await naming.getDomainImpact(selId)); setStep('cascade'); }
    catch { pushToast('No se pudo calcular el impacto', 'err'); } finally { setBusy(false); }
  };

  const applyCascade = async () => {
    if (!selId) return;
    setBusy(true);
    try { const r = await naming.propagateDomain(selId); pushToast(`${r.updated} columnas actualizadas`); setOrigType(form.defaultDataType); setStep('configure'); await load(); }
    catch { pushToast('No se pudo aplicar', 'err'); } finally { setBusy(false); }
  };

  const hint = (
    <div className="rd-small" style={{ background: 'var(--amber-tint, #FFF6E6)', color: 'var(--amber-deep, #9A6B00)', padding: '7px 10px', borderRadius: 8, marginBottom: 12 }}>
      Cambios globales — no entran en el publish.
    </div>
  );

  // ── Cascade (09b) ──
  if (step === 'cascade' && impact) {
    return (
      <div>
        {hint}
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setStep('configure')} style={{ marginBottom: 10 }}>
          <ChevronLeft size={14} /> Back to configure
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span className="rd-mono" style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--fill-3)', fontSize: 12 }}>{origType || '—'}</span>
          <ArrowRight size={15} color="var(--muted)" />
          <span className="rd-mono" style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--blue-tint)', color: 'var(--primary)', fontSize: 12 }}>{form.defaultDataType}</span>
        </div>
        <div className="rd-small" style={{ marginBottom: 10 }}>
          <strong>{impact.willUpdate}</strong> column{impact.willUpdate === 1 ? '' : 's'} will update · <strong>{impact.overridden}</strong> with override skipped · {impact.columnsUsing} total
        </div>
        <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border-soft)', borderRadius: 9 }}>
          {impact.columns.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid var(--border-soft)' }}>
              {c.overridden
                ? <AlertTriangle size={14} color="var(--amber, #E0A024)" />
                : <Check size={14} color="var(--green, #16A37B)" />}
              <span className="rd-mono" style={{ flex: 1, fontSize: 12 }}>{c.physicalName}</span>
              <span className="rd-small" style={{ color: 'var(--muted)' }}>{c.overridden ? 'override — skipped' : 'will update'}</span>
            </div>
          ))}
          {impact.columns.length === 0 && <div className="rd-small" style={{ padding: 10, color: 'var(--muted)' }}>No columns use this domain.</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setStep('configure')}>Discard</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || impact.willUpdate === 0} onClick={applyCascade}>Apply cascade change</button>
        </div>
      </div>
    );
  }

  // ── Configure (09a) ──
  return (
    <div>
      {hint}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14 }}>
        {/* Lista de dominios */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ ...lbl, marginBottom: 0 }}>Domains</span>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={startNew}><Plus size={13} /> New</button>
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border-soft)', borderRadius: 9 }}>
            {domains.map((d) => (
              <div key={d.id} onClick={() => select(d)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border-soft)', background: selId === d.id ? 'var(--blue-tint)' : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: selId === d.id ? 'var(--primary)' : 'var(--ink)' }}>{d.name}</div>
                  <div className="rd-mono rd-small" style={{ color: 'var(--muted)' }}>{d.defaultDataType}</div>
                </div>
                <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Eliminar" onClick={(e) => { e.stopPropagation(); remove(d.id, d.name); }}><Trash2 size={12} /></button>
              </div>
            ))}
            {domains.length === 0 && <div className="rd-small" style={{ padding: 10, color: 'var(--muted)' }}>Sin dominios. Usá “New”.</div>}
          </div>
        </div>

        {/* Detalle del dominio */}
        <div>
          <div style={field}>
            <label style={lbl}>Domain name</label>
            <input className="rd-input" value={form.name} placeholder="e.g. Importe" onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div style={field}>
            <label style={lbl}>Default data type</label>
            <input className="rd-input rd-mono" value={form.defaultDataType} placeholder="DECIMAL(18,2)" onChange={(e) => setForm({ ...form, defaultDataType: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div style={field}>
            <label style={lbl}>Naming term</label>
            <input className="rd-input rd-mono" value={form.namingTerm ?? ''} placeholder="e.g. mto" onChange={(e) => setForm({ ...form, namingTerm: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div style={field}>
            <label style={lbl}>Description</label>
            <textarea className="wk-pp-textarea" value={form.description ?? ''} placeholder="Para qué se usa este dominio…" onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ width: '100%', minHeight: 52 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy} onClick={save}>{creating ? 'Create domain' : 'Save'}</button>
            {!creating && selId && (
              <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={openCascade}>Edit type &amp; propagate…</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
