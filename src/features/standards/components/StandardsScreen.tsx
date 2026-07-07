import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText, Boxes, ChevronRight, History, RotateCcw, ShieldCheck, Tags, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/useAuthStore';
import {
  getSnapshot, getVersions, rollbackStandards,
  type StandardsSnapshot, type StandardsVersion,
} from '../standards.service';
import GlossaryPage from './GlossaryPage';
import DomainsPage from './DomainsPage';
import UdpDefsPage from './UdpDefsPage';

type Tab = 'overview' | 'glossary' | 'domains' | 'udp';

export default function StandardsScreen() {
  const canEdit = useAuthStore((s) => s.has('standards.edit'));
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>('overview');
  const [snapshot, setSnapshot] = useState<StandardsSnapshot | null>(null);
  const [versions, setVersions] = useState<StandardsVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<StandardsVersion | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [snap, vers] = await Promise.all([getSnapshot(), getVersions()]);
    setSnapshot(snap); setVersions(vers);
  }, []);

  useEffect(() => {
    setLoading(true);
    reload().catch(() => toast.error('No se pudo cargar Data Standards')).finally(() => setLoading(false));
  }, [reload]);

  const current = versions[0];
  const doRollback = async (target: StandardsVersion) => {
    setBusy(true);
    try {
      const v = await rollbackStandards(target.seq);
      toast.success(`Rolled back to ${target.label} · new ${v.label}`);
      setRollbackTarget(null); setHistory(false); await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo revertir'); } finally { setBusy(false); }
  };

  const subTab = (id: Tab, label: string) => (
    <button onClick={() => setTab(id)} style={{ height: 52, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', border: 'none', background: 'transparent', fontSize: 13, fontWeight: tab === id ? 600 : 500, color: tab === id ? '#1A2B4A' : '#8A93A5', borderBottom: `2px solid ${tab === id ? '#2E5BFF' : 'transparent'}`, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff' }}>
      {/* sub-tabs */}
      <div style={{ height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 2, padding: '0 24px', borderBottom: '1px solid #EAEDF2' }}>
        {subTab('overview', 'Overview')}
        {subTab('glossary', 'Glossary')}
        {subTab('domains', 'Parent Domains')}
        {subTab('udp', 'UDP')}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px', borderRadius: 999, background: '#F3EEFF', border: '1px solid #E3D6FB', color: '#7A4DD6', fontSize: 12, fontWeight: 600 }}><ShieldCheck size={13} />Restricted module</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {loading || !snapshot ? (
          <div style={{ padding: 40, color: '#9AA3B2' }}>Cargando…</div>
        ) : tab === 'overview' ? (
          <Overview snapshot={snapshot} versions={versions} canEdit={canEdit} meName={me?.name ?? me?.username}
            onGo={setTab} onHistory={() => setHistory(true)} />
        ) : tab === 'glossary' ? (
          <GlossaryPage snapshot={snapshot} canEdit={canEdit} onApplied={reload} />
        ) : tab === 'domains' ? (
          <DomainsPage snapshot={snapshot} canEdit={canEdit} onApplied={reload} />
        ) : (
          <UdpDefsPage snapshot={snapshot} canEdit={canEdit} onApplied={reload} />
        )}
      </div>

      {/* footer: última versión + historial */}
      {!loading && current && (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px', borderTop: '1px solid #EAEDF2', background: '#fff' }}>
          <span style={{ fontSize: 12, color: '#8A93A5' }}>Última versión <strong style={{ color: '#56607A' }}>{current.label}</strong> · {current.author}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setHistory(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', border: '1px solid #DDE2EC', background: '#fff', color: '#3A4658', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><History size={14} />Version history</button>
        </div>
      )}

      {/* 15f · historial */}
      {history && (
        <div style={backdrop} onClick={() => setHistory(false)}>
          <div style={{ width: 740, maxHeight: 800, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 14, padding: '22px 24px 16px', borderBottom: '1px solid #EEF1F6' }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: '#EAF0FF', color: '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><History size={21} /></div>
              <div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>Standard change history</h2><p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5' }}>Todas las versiones de Glossary, UDP + Parent Domains, más reciente primero. Cada una aplicada puede revertirse.</p></div>
              <button onClick={() => setHistory(false)} style={iconClose}><X size={13} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 24px 8px' }}>
              {versions.map((v) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 2px', borderBottom: '1px solid #F2F4F8' }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: v.kind === 'domain' ? '#F3EEFF' : v.kind === 'rollback' ? '#FBEEF0' : '#EAF0FF', color: v.kind === 'domain' ? '#8B5CF6' : v.kind === 'rollback' ? '#D6455D' : '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}>
                    {v.kind === 'domain' ? <Boxes size={15} /> : v.kind === 'rollback' ? <RotateCcw size={14} /> : <BookOpenText size={15} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10.5, fontWeight: 600, color: '#56607A', background: '#F2F4F8', borderRadius: 5, padding: '1px 6px' }}>{v.label}</span>
                      <span style={{ fontSize: 13, color: '#1A2B4A' }}>{v.title}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8A93A5', marginTop: 4 }}>{v.author} · {v.impact.columns} names · {v.impact.tables} tables</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: v.kind === 'baseline' ? '#8A93A5' : '#0E8C6A', background: v.kind === 'baseline' ? '#F2F4F8' : '#E4F6EF', borderRadius: 999, padding: '3px 9px' }}>{v.kind === 'baseline' ? 'Baseline' : 'Applied'}</span>
                    {canEdit && v.kind !== 'baseline' && v.seq !== current.seq && (
                      <button onClick={() => setRollbackTarget(v)} style={{ height: 30, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 11px', border: '1px solid #DDE2EC', background: '#fff', color: '#3A4658', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><RotateCcw size={12} />Roll back</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 24px 18px', borderTop: '1px solid #EEF1F6' }}>
              <span style={{ flex: 1, fontSize: 11.5, color: '#9AA3B2' }}>El rollback re-deriva nombres y tipos a la versión elegida y se registra como una versión nueva.</span>
              <button onClick={() => setHistory(false)} style={btnGhost}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* 15g · rollback confirm */}
      {rollbackTarget && (
        <div style={backdrop} onClick={() => !busy && setRollbackTarget(null)}>
          <div style={{ width: 520, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 14, padding: '22px 24px 18px', borderBottom: '1px solid #EEF1F6' }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: '#FBEEF0', color: '#D6455D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><TriangleAlert size={20} /></div>
              <div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>Roll back to {rollbackTarget.label}?</h2><p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 }}>Restaura el estado de estándares de <strong>{rollbackTarget.label}</strong> y re-deriva los nombres/tipos afectados. Se registra como una versión nueva.</p></div>
            </div>
            <div style={{ padding: '16px 24px', fontSize: 12.5, color: '#7A6220', background: '#FFF9EE', borderTop: '1px solid #F1E2BD', borderBottom: '1px solid #F1E2BD' }}>
              Las columnas editadas desde entonces conservan sus nombres/tipos más nuevos si tienen override.
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '16px 24px 20px' }}>
              <span style={{ flex: 1 }} /><button onClick={() => setRollbackTarget(null)} disabled={busy} style={btnGhost}>Cancel</button>
              <button onClick={() => doRollback(rollbackTarget)} disabled={busy} style={{ ...btnPrimary, background: '#D6455D' }}>{busy ? <span className="rd-spin" /> : <RotateCcw size={15} />}{busy ? 'Rolling back…' : 'Roll back this change'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Overview ──
function Overview({ snapshot, versions, canEdit, meName, onGo, onHistory }: {
  snapshot: StandardsSnapshot; versions: StandardsVersion[]; canEdit: boolean; meName?: string | null;
  onGo: (t: Tab) => void; onHistory: () => void;
}) {
  const recent = useMemo(() => versions.slice(0, 3), [versions]);
  return (
    <div style={{ padding: '26px 34px', background: '#FBFCFD', flex: 1 }}>
      <div style={{ maxWidth: 980 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8A93A5', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Governance</div>
        <h1 style={{ margin: '4px 0 16px', fontSize: 26, fontWeight: 700, color: '#1A2B4A' }}>Naming &amp; domain standards</h1>

        <div style={{ display: 'flex', gap: 12, background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 12, padding: '13px 16px', marginBottom: 22, fontSize: 12.5, color: '#7A6220', lineHeight: 1.5 }}>
          <TriangleAlert size={18} color="#B98600" style={{ flex: 'none', marginTop: 1 }} />
          <div><strong style={{ color: '#8A6D1F' }}>Scope global.</strong> Editar una regla de naming o un dominio re-deriva nombres físicos y tipos de dato en <strong>toda tabla de todo proyecto</strong> — no está acotado a un modelo. Por eso los estándares viven en su propio módulo, separados del canvas y restringidos.</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, marginBottom: 26 }}>
          <button onClick={() => onGo('glossary')} style={ovCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}><div style={{ width: 44, height: 44, borderRadius: 12, background: '#EAF0FF', color: '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><BookOpenText size={22} /></div><div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B4A' }}>Glossary · Naming rules</div><div style={{ fontSize: 12, color: '#8A93A5' }}>Terms &amp; abbreviations · physical naming</div></div><ChevronRight size={16} color="#B6BECD" /></div>
            <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, fontWeight: 600, color: '#1A2B4A', background: '#F2F4F8', borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>{snapshot.dict.length} terms</div>
          </button>
          <button onClick={() => onGo('domains')} style={ovCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}><div style={{ width: 44, height: 44, borderRadius: 12, background: '#F3EEFF', color: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Boxes size={22} /></div><div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B4A' }}>Parent Domains</div><div style={{ fontSize: 12, color: '#8A93A5' }}>Reusable data domains</div></div><ChevronRight size={16} color="#B6BECD" /></div>
            <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, fontWeight: 600, color: '#1A2B4A', background: '#F2F4F8', borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>{snapshot.domains.length} domains</div>
          </button>
          <button onClick={() => onGo('udp')} style={ovCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}><div style={{ width: 44, height: 44, borderRadius: 12, background: '#F1EBFF', color: '#7A4DD6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Tags size={22} /></div><div style={{ flex: 1, textAlign: 'left' }}><div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B4A' }}>UDP</div><div style={{ fontSize: 12, color: '#8A93A5' }}>User Defined Properties · etiquetas</div></div><ChevronRight size={16} color="#B6BECD" /></div>
            <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, fontWeight: 600, color: '#1A2B4A', background: '#F2F4F8', borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>{(snapshot.udp ?? []).length} properties</div>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 18 }}>
          <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>Recent standard changes</div><button onClick={onHistory} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#2E5BFF', cursor: 'pointer', fontFamily: 'inherit' }}><History size={13} />View all versions</button></div>
            {recent.map((v) => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #F2F4F8' }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: v.kind === 'domain' ? '#F3EEFF' : '#EAF0FF', color: v.kind === 'domain' ? '#8B5CF6' : '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{v.kind === 'domain' ? <Boxes size={14} /> : <BookOpenText size={14} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: '#1A2B4A' }}>{v.title}</div><div style={{ fontSize: 11.5, color: '#8A93A5' }}>{v.author} · {v.label}</div></div>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: v.kind === 'baseline' ? '#8A93A5' : '#0E8C6A', background: v.kind === 'baseline' ? '#F2F4F8' : '#E4F6EF', borderRadius: 999, padding: '3px 9px', flex: 'none' }}>{v.kind === 'baseline' ? 'Baseline' : 'Applied'}</span>
              </div>
            ))}
            {recent.length === 0 && <div style={{ fontSize: 12.5, color: '#9AA3B2', padding: '8px 0' }}>Sin cambios todavía.</div>}
          </div>
          <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 14 }}>Who can manage standards</div>
            {canEdit
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 32, height: 32, borderRadius: 999, background: '#2E5BFF', color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(meName ?? 'YO').slice(0, 2).toUpperCase()}</span><div><div style={{ fontSize: 13, fontWeight: 600, color: '#1A2B4A' }}>{meName ?? 'Vos'}</div><div style={{ fontSize: 11, color: '#8A93A5' }}>Standards admin · vos</div></div></div>
              : <div style={{ fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 }}>Tu rol puede <strong>ver</strong> los estándares pero no editarlos.</div>}
            <div style={{ height: 1, background: '#F2F4F8', margin: '15px 0' }} />
            <div style={{ fontSize: 11.5, color: '#8A93A5', lineHeight: 1.5 }}>El acceso de edición de estándares se otorga desde <strong style={{ color: '#56607A' }}>Admin · Permisos</strong> (permiso <span style={{ fontFamily: 'var(--mono, monospace)' }}>standards.edit</span>).</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ovCard: React.CSSProperties = { display: 'block', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: 20, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' };
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,28,45,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
const iconClose: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { height: 40, padding: '0 18px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 20px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
