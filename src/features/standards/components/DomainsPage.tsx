import { useEffect, useMemo, useState } from 'react';
import { Boxes, Pencil, Plus, RotateCcw, Search, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Dialog } from '@/components/ui';
import type { StandardsSnapshot, SnapshotDomain, DomainHistoryEntry } from '../standards.service';
import { applyStandards } from '../standards.service';
import { getDomainColumnImpact, physicalize, type DomainColumnImpact } from '@/services/naming.service';
import { typeTargets, usageLines } from '../domainImpact';
import { revertForm } from '../domainHistory';
import { domainEditInput } from '../domainForm';
import DomainCascadeDialog from './DomainCascadeDialog';
import DomainHistory from './DomainHistory';
import TypePicker from '@/features/modeler/components/TypePicker';
import ComplexTypeBuilder from '@/features/modeler/components/ComplexTypeBuilder';
import { isComplexTypeStart } from '@/features/modeler/lib/complexTypes';
import UdpAssign from '@/features/modeler/components/UdpAssign';
import type { Facet } from '@/lib/facets';

type Mode = 'view' | 'edit' | 'create';
const EMPTY: SnapshotDomain = { id: '', name: '', defaultDataType: '', logicalDataType: '', namingTerm: '', description: '', inheritsName: false, physicalName: '', physicalDescription: '', udpValues: {} };

export default function DomainsPage({ projectId, snapshot, canEdit, onApplied }: {
  projectId: string;
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
  // Doc 95 D7: el panel usa la MISMA regla que la cascada (quién sigue hoy al dominio).
  const [usage, setUsage] = useState<DomainColumnImpact | null>(null);
  // Doc 95 D8: versión desde la que se está revirtiendo (null = edición normal).
  const [revertFrom, setRevertFrom] = useState<string | null>(null);
  // Tras crear un dominio, el id lo genera el backend; guardamos el nombre para
  // seleccionarlo cuando la recarga lo traiga (si no, selId quedaba en '__new__').
  const [pendingName, setPendingName] = useState<string | null>(null);

  const selected = useMemo(() => domains.find((d) => d.id === selId) ?? null, [domains, selId]);

  useEffect(() => {
    if (!pendingName) return;
    const d = domains.find((x) => x.name === pendingName);
    if (d) { setSelId(d.id); setPendingName(null); }
  }, [domains, pendingName]);
  const [form, setForm] = useState<SnapshotDomain>(EMPTY);
  // Doc 85 §3.5: la página muestra UNA faceta a la vez, como Data Standards → UDP.
  const [facet, setFacet] = useState<Facet>('logical');
  // Físico DERIVADO del lógico por la regla del scope column (placeholder / valor cuando no hay override).
  const [derivedPhys, setDerivedPhys] = useState('');
  useEffect(() => {
    const logical = form.name.trim();
    if (!logical) { setDerivedPhys(''); return; }
    let alive = true;
    const t = setTimeout(() => {
      physicalize(projectId, logical, 'column').then((r) => { if (alive) setDerivedPhys(r.physical); }).catch(() => { if (alive) setDerivedPhys(''); });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [form.name, projectId]);

  useEffect(() => {
    setMode('view'); setConfirm(null); setFacet('logical'); setRevertFrom(null);
    if (selected) setForm({ ...selected });
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel del dominio: se recalcula al cambiar de dominio y tras aplicar un tipo nuevo.
  useEffect(() => {
    setUsage(null);
    if (!selId || selId === '__new__') return undefined;
    let alive = true;
    getDomainColumnImpact(projectId, selId, { limit: 0 })
      .then((u) => { if (alive) setUsage(u); })
      .catch(() => { if (alive) setUsage(null); });
    return () => { alive = false; };
  }, [projectId, selId, selected?.defaultDataType, selected?.logicalDataType]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return !n ? domains : domains.filter((d) => d.name.toLowerCase().includes(n));
  }, [domains, q]);

  const startCreate = () => { setSelId('__new__'); setForm(EMPTY); setFacet('logical'); setRevertFrom(null); setMode('create'); };
  const startEdit = () => { if (selected) { setForm({ ...selected }); setRevertFrom(null); setMode('edit'); } };
  const cancel = () => { setMode('view'); setConfirm(null); setRevertFrom(null); if (selected) setForm({ ...selected }); };
  // Doc 95 D8: revertir = cargar en el editor los valores de esa versión; se
  // aplican con el mismo popup de cascada (misma regla, versión nueva auditada).
  const startRevert = (entry: DomainHistoryEntry) => {
    if (!selected) return;
    setForm(revertForm(selected, entry)); setRevertFrom(entry.label); setFacet('physical'); setMode('edit');
  };

  // Doc 95 D7: tipos que el borrador CAMBIA (física y/o lógica).
  const targets = useMemo(() => (mode === 'edit' ? typeTargets(selected, form) : {}), [mode, selected, form]);

  const apply = async () => {
    setBusy(true);
    try {
      const creating = mode === 'create';
      const v = await applyStandards(projectId, {
        kind: 'domain',
        // Doc 95 D8: el revert queda como una versión nueva con título propio.
        title: revertFrom ? `Revert ${form.name.trim()} to ${revertFrom}` : undefined,
        domainsUpsert: [domainEditInput(form, creating ? null : selected)],
      });
      toast.success(`Applied · ${v.label} · ${v.impact.columns} columns re-typed`);
      if (creating) setPendingName(form.name.trim());   // seleccionarlo al recargar
      setMode('view'); setConfirm(null); setRevertFrom(null); onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't apply"); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const v = await applyStandards(projectId, { kind: 'domain', domainsDelete: [selected.id] });
      toast.success(`Domain deleted · ${v.label}`);
      setConfirm(null); setSelId(domains.find((d) => d.id !== selected.id)?.id ?? null); onApplied();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete"); } finally { setBusy(false); }
  };

  const editable = mode === 'edit' || mode === 'create';
  const u = usage ? usageLines(usage) : null;

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: '#1A2B4A', background: '#F2F4F8', borderRadius: 6, padding: '2px 7px' }} title="Physical default type">{d.defaultDataType}</span>
              {d.logicalDataType && <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: '#5B3FA0', background: '#F4EEFF', borderRadius: 6, padding: '2px 7px' }} title="Logical data type">{d.logicalDataType}</span>}
              {/* Doc 85: físico con override (vacío = derivado del lógico). */}
              {d.physicalName && d.physicalName !== d.name && <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: '#9A6B00', background: '#FFF6E5', borderRadius: 6, padding: '2px 7px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`Physical name override: ${d.physicalName}`}>{d.physicalName}</span>}
              {/* Doc 80 §4: se ve de un vistazo cuáles imponen nombre+definición. */}
              {d.inheritsName && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#0E8C6A', background: '#E8F7F1', border: '1px solid #C6EADC', borderRadius: 6, padding: '2px 7px' }} title="Standard attribute: its name and definition are inherited by the column">name + definition</span>}
            </div>
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
            {revertFrom && mode === 'edit' && (
              <div style={revertBanner}>
                <RotateCcw size={14} style={{ flex: 'none', marginTop: 2 }} />
                <span>Reverting to <strong>{revertFrom}</strong>: the form now has that version&apos;s values. Review them and apply — the columns that follow this domain are re-typed with the same rule as any change.</span>
              </div>
            )}
            {!editable && form.description && <p style={{ margin: '0 0 18px', fontSize: 13, color: '#6B7689', lineHeight: 1.5 }}>{form.description}</p>}

            {/* Doc 85 §3.5: switch de faceta (mismo rd-seg de Data Standards → UDP). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div className="rd-seg" role="tablist" aria-label="Facet">
                <button type="button" role="tab" aria-selected={facet === 'logical'} className={facet === 'logical' ? 'active' : ''} onClick={() => setFacet('logical')}>Logical · Attribute</button>
                <button type="button" role="tab" aria-selected={facet === 'physical'} className={facet === 'physical' ? 'active' : ''} onClick={() => setFacet('physical')}>Physical · Column</button>
              </div>
              <span style={{ fontSize: 12, color: facet === 'logical' ? '#6D3FC4' : '#1F4FD8' }}>
                {facet === 'logical' ? 'What the attribute inherits in the Logical model.' : 'What the column inherits in the Physical model (DDL).'}
              </span>
            </div>

            {facet === 'logical' && (
              <>
                <label style={lbl}>Logical name</label>
                {editable ? <input className="rd-input" style={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Codigo Clave" />
                  : <div style={fieldRO}>{form.name}</div>}

                <label style={lbl}>Logical data type</label>
                {editable ? (
                  <div style={{ marginBottom: 18 }}>
                    <TypePicker value={form.logicalDataType ?? ''} onChange={(v) => setForm({ ...form, logicalDataType: v })} placeholder="Same as physical" />
                    {isComplexTypeStart(form.logicalDataType ?? '') && (
                      <ComplexTypeBuilder value={form.logicalDataType ?? ''} onChange={(v) => setForm({ ...form, logicalDataType: v })} />
                    )}
                  </div>
                ) : <div style={{ ...fieldRO, fontFamily: 'var(--mono, monospace)', fontWeight: 600 }}>{form.logicalDataType || '—'}</div>}

                <label style={lbl}>Description</label>
                {editable ? <textarea className="rd-input" style={{ ...field, minHeight: 64, resize: 'vertical' }} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  : <div style={{ ...fieldRO, minHeight: 44 }}>{form.description || '—'}</div>}

                <label style={lbl}>Attribute UDP defaults (Logical)</label>
                <div style={{ padding: '12px 14px', background: '#fff', border: '1px solid #E2E6EE', borderRadius: 10, marginBottom: 18 }}>
                  <UdpAssign key={`${selId}:logical`} level="column" view="logical" defs={snapshot.udp ?? []} values={form.udpValues ?? {}} disabled={!editable}
                    onChange={(next) => setForm((f) => ({ ...f, udpValues: next }))} />
                  <div style={{ fontSize: 11.5, color: '#8A93A5', marginTop: 8 }}>Offered to the modeler when this domain is assigned to a column — they pick which to inherit.</div>
                </div>
              </>
            )}

            {facet === 'physical' && (
              <>
                <label style={lbl}>Physical name</label>
                {/* Doc 85 D1: vacío = DERIVADO del lógico por la regla del scope column; texto = override. */}
                {editable ? (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
                    <input className="rd-input" style={{ ...field, marginBottom: 0, fontFamily: 'var(--mono, monospace)' }} value={form.physicalName ?? ''}
                      onChange={(e) => setForm({ ...form, physicalName: e.target.value })} placeholder={derivedPhys ? `Derived: ${derivedPhys}` : 'Derived from the logical name'} />
                    <button type="button" title="Derive from the logical name (naming rule)" onClick={() => setForm({ ...form, physicalName: '' })}
                      style={{ ...btnGhost, height: 44, padding: '0 12px' }}>⚡</button>
                  </div>
                ) : (
                  <div style={{ ...fieldRO, fontFamily: 'var(--mono, monospace)', fontWeight: 600, gap: 8 }}>
                    {form.physicalName || derivedPhys || '—'}
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: form.physicalName ? '#9A6B00' : '#0E8C6A' }}>{form.physicalName ? 'override' : 'derived'}</span>
                  </div>
                )}

                <label style={lbl}>Physical data type</label>
                {editable ? (
                  <div style={{ marginBottom: 18 }}>
                    <TypePicker value={form.defaultDataType} onChange={(v) => setForm({ ...form, defaultDataType: v })} placeholder="Data type" />
                    {isComplexTypeStart(form.defaultDataType) && (
                      <ComplexTypeBuilder value={form.defaultDataType} onChange={(v) => setForm({ ...form, defaultDataType: v })} />
                    )}
                  </div>
                ) : <div style={{ ...fieldRO, fontFamily: 'var(--mono, monospace)', fontWeight: 600 }}>{form.defaultDataType}</div>}
                {editable && <div style={{ fontSize: 12, color: '#8A93A5', margin: '-10px 0 18px' }}>On apply, columns of this domain WITHOUT an override (per facet) are re-typed.</div>}

                <label style={lbl}>Physical description</label>
                {editable ? <textarea className="rd-input" style={{ ...field, minHeight: 64, resize: 'vertical' }} value={form.physicalDescription ?? ''}
                  onChange={(e) => setForm({ ...form, physicalDescription: e.target.value })} placeholder={form.description ? `Same as logical: ${form.description}` : 'Same as the logical description'} />
                  : <div style={{ ...fieldRO, minHeight: 44, color: form.physicalDescription ? '#1A2B4A' : '#8A93A5' }}>{form.physicalDescription || (form.description ? `Same as logical: ${form.description}` : '—')}</div>}

                <label style={lbl}>Column UDP defaults (Physical)</label>
                <div style={{ padding: '12px 14px', background: '#fff', border: '1px solid #E2E6EE', borderRadius: 10, marginBottom: 18 }}>
                  <UdpAssign key={`${selId}:physical`} level="column" view="physical" defs={snapshot.udp ?? []} values={form.udpValues ?? {}} disabled={!editable}
                    onChange={(next) => setForm((f) => ({ ...f, udpValues: next }))} />
                  <div style={{ fontSize: 11.5, color: '#8A93A5', marginTop: 8 }}>Offered to the modeler when this domain is assigned to a column — they pick which to inherit.</div>
                </div>
              </>
            )}

            {/* ── Both models ── */}
            <div style={{ ...lbl, marginTop: 6 }}>Both models</div>
            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 15px', background: form.inheritsName ? '#F2FBF7' : '#fff', border: `1px solid ${form.inheritsName ? '#C6EADC' : '#E2E6EE'}`, borderRadius: 10, marginBottom: 18 }}>
              <input type="checkbox" id="dom-inherits-name" style={{ marginTop: 2, width: 15, height: 15, cursor: editable ? 'pointer' : 'default' }}
                checked={!!form.inheritsName} disabled={!editable}
                onChange={(e) => setForm({ ...form, inheritsName: e.target.checked })} />
              <label htmlFor="dom-inherits-name" style={{ flex: 1, cursor: editable ? 'pointer' : 'default' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A2B4A' }}>Standard attribute — pushes its names and descriptions</div>
                <div style={{ fontSize: 12.5, color: '#6B7689', lineHeight: 1.5, marginTop: 3 }}>
                  On assigning this domain, the column takes its <strong>logical and physical names</strong> and its <strong>logical and physical descriptions</strong>.
                  Off (the default) the domain only sets the <strong>data types</strong> and offers its <strong>UDP defaults</strong> — the column keeps its own names and descriptions.
                </div>
              </label>
            </div>

            {/* Doc 95 D7: quién sigue hoy al dominio — en inglés y con la regla de la cascada */}
            {u && mode !== 'create' && (
              <div style={usageBox}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1A2B4A' }}>{u.headline}</div>
                <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: '#0E8C6A', fontWeight: 600 }} title="Re-typed when the domain type changes">● {u.follow}</span>
                  <span style={{ fontSize: 13, color: '#9A6B00', fontWeight: 600 }}>● {u.override}</span>
                  <span style={{ fontSize: 13, color: '#8A93A5', fontWeight: 600 }}>● {u.differs}</span>
                </div>
              </div>
            )}

            {/* Doc 95 D8: historial de este dominio, con Revert */}
            {mode === 'view' && selected && (
              <DomainHistory projectId={projectId} domainId={selected.id} canEdit={canEdit} onRevert={startRevert} />
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

      {/* Doc 95 D7: popup de cascada con la lista exacta por columna */}
      {confirm === 'apply' && mode === 'edit' && selected && (
        <DomainCascadeDialog projectId={projectId} domainId={selected.id} domainName={form.name} targets={targets}
          busy={busy} title={revertFrom ? `Revert ${form.name} to ${revertFrom}` : undefined}
          onCancel={() => setConfirm(null)} onApply={apply} />
      )}
      {confirm === 'apply' && mode === 'create' && (
        <Dialog open title={`Create domain ${form.name}`} icon={Boxes} onClose={() => setConfirm(null)} width={520}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" icon={UploadCloud} onClick={apply} disabled={busy}>{busy ? 'Applying…' : 'Create'}</Button>
          </>}>
          <div style={{ fontSize: 13, color: '#56607A' }}>Domain <strong>{form.name}</strong> will be created with type <span style={{ fontFamily: 'var(--mono, monospace)' }}>{form.defaultDataType}</span>.</div>
        </Dialog>
      )}
      {confirm === 'delete' && selected && (
        <Dialog open title={`Delete domain ${selected.name}?`} icon={Trash2} onClose={() => setConfirm(null)} width={480}
          subtitle="Columns keep their current type but lose the link to the domain."
          footer={<>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" icon={Trash2} onClick={del} disabled={busy}>Delete</Button>
          </>}>
          <div style={{ fontSize: 13, color: '#56607A' }}>Recorded as a new Data Standards version — it can be rolled back from the history.</div>
        </Dialog>
      )}
    </div>
  );
}

const domCard = (active: boolean): React.CSSProperties => ({ background: '#fff', border: `${active ? 1.5 : 1}px solid ${active ? '#2E5BFF' : '#E6EAF0'}`, borderRadius: 11, padding: '11px 12px', boxShadow: active ? '0 0 0 3px rgba(46,91,255,0.1)' : 'none' });
const lbl: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 7 };
const field: React.CSSProperties = { width: '100%', height: 44, marginBottom: 18, fontSize: 14 };
const fieldRO: React.CSSProperties = { display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 14px', background: '#fff', border: '1px solid #E2E6EE', borderRadius: 10, fontSize: 14, color: '#1A2B4A', marginBottom: 18 };
const usageBox: React.CSSProperties = { background: 'linear-gradient(180deg,#F4F7FF,#FAFBFF)', border: '1px solid #D9E3FB', borderRadius: 12, padding: '15px 17px', margin: '4px 0 18px' };
const revertBanner: React.CSSProperties = { display: 'flex', gap: 10, background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 11, padding: '11px 14px', margin: '4px 0 16px', fontSize: 12.5, color: '#7A6220', lineHeight: 1.5 };
const btnGhost: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 20px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
