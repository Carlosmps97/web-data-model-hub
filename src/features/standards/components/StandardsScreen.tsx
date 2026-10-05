import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText, Boxes, ChevronRight, Database, History, RotateCcw, ShieldCheck, Tags, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/useAuthStore';
import { LAST_PROJECT_KEY, useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from '@/store/useModelerStore';
import { listProjects } from '@/services/projects.service';
import { sortProjects } from '@/lib/projects';
import SearchSelect from '@/features/modeler/components/SearchSelect';
import type { Project } from '@/types/model';
import {
  getRollbackPreview, getSnapshot, getVersions, rollbackStandards,
  type RollbackPreview, type StandardsSnapshot, type StandardsVersion,
} from '../standards.service';
import { AffectedTable, Button, Dialog, type AffectedColumn } from '@/components/ui';
import { rollbackDomainRows, rollbackSummary, type RollbackDomainRow } from '../rollbackPreview';
import GlossaryPage from './GlossaryPage';
import DomainsPage from './DomainsPage';
import UdpDefsPage from './UdpDefsPage';
import DdlRulesTab from './DdlRulesTab';
import ThemesPage from './ThemesPage';

type Tab = 'overview' | 'glossary' | 'domains' | 'udp' | 'ddl' | 'themes';

/** Proyecto inicial del módulo: el de la sesión de canvas → el último abierto → el primero A–Z. */
function initialProjectId(projects: Project[]): string | null {
  const session = useSessionStore.getState().activeProjectId;
  if (session && projects.some((p) => p.id === session)) return session;
  let last: string | null = null;
  try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* storage ausente */ }
  if (last && projects.some((p) => p.id === last)) return last;
  return sortProjects(projects)[0]?.id ?? null;
}

export default function StandardsScreen() {
  const canEdit = useAuthStore((s) => s.has('standards.edit'));
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>('overview');
  // Doc 75: los Data Standards son POR PROYECTO — el selector decide de cuál.
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<StandardsSnapshot | null>(null);
  const [versions, setVersions] = useState<StandardsVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<StandardsVersion | null>(null);
  const [busy, setBusy] = useState(false);
  // Doc 95 D9: qué re-tipa y qué re-deriva el rollback elegido, antes de confirmarlo.
  const [preview, setPreview] = useState<RollbackPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!rollbackTarget || !projectId) return undefined;
    let alive = true;
    getRollbackPreview(projectId, rollbackTarget.seq)
      .then((p) => { if (alive) setPreview(p); })
      .catch((e) => { if (alive) setPreviewError(e instanceof Error ? e.message : "Couldn't calculate the preview"); });
    return () => { alive = false; };
  }, [rollbackTarget, projectId]);
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  useEffect(() => {
    listProjects()
      .then((ps) => { setProjects(ps); setProjectId(initialProjectId(ps)); })
      .catch(() => { toast.error("Couldn't load the projects"); setLoading(false); });
  }, []);

  const reload = useCallback(async () => {
    if (!projectId) return;
    const [snap, vers] = await Promise.all([getSnapshot(projectId), getVersions(projectId)]);
    setSnapshot(snap); setVersions(vers);
    // Doc 109: un canvas abierto de este proyecto repinta con los themes vigentes
    // (un apply o un rollback pudo cambiarlos).
    const modeler = useModelerStore.getState();
    if (modeler.activeProjectId === projectId) void modeler.loadThemes(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true); setSnapshot(null); setVersions([]);
    reload().catch(() => toast.error("Couldn't load Data Standards")).finally(() => setLoading(false));
  }, [reload, projectId]);

  const current = versions[0];
  const doRollback = async (target: StandardsVersion) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const v = await rollbackStandards(projectId, target.seq);
      toast.success(`Rolled back to ${target.label} · new ${v.label}`);
      setRollbackTarget(null); setHistory(false); await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't revert"); } finally { setBusy(false); }
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
        {subTab('ddl', 'DDL Export rules')}
        {subTab('themes', 'Color themes')}
        <span style={{ flex: 1 }} />
        {/* Doc 75: proyecto cuyos estándares se ven/editan. */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 10 }}>
          <Database size={14} color="#8A93A5" aria-hidden />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#56607A' }}>Project</span>
          <span style={{ width: 240 }}>
            <SearchSelect
              options={sortProjects(projects).map((p) => ({ value: p.id, label: p.name }))}
              valueLabel={project?.name ?? ''}
              placeholder={projects.length ? 'Choose a project…' : 'No projects yet'}
              onPick={(v) => { if (v) setProjectId(v); }}
              disabled={projects.length === 0}
            />
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px', borderRadius: 999, background: '#F3EEFF', border: '1px solid #E3D6FB', color: '#7A4DD6', fontSize: 12, fontWeight: 600 }}><ShieldCheck size={13} />Restricted module</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {!projectId ? (
          <div style={{ padding: 40, color: '#9AA3B2' }}>{projects.length === 0 && !loading ? 'Create a project first (Model › Open model › New project…).' : 'Loading…'}</div>
        ) : loading || !snapshot ? (
          <div style={{ padding: 40, color: '#9AA3B2' }}>Loading…</div>
        ) : tab === 'overview' ? (
          <Overview snapshot={snapshot} versions={versions} canEdit={canEdit} meName={me?.name ?? me?.username}
            projectName={project?.name ?? ''} onGo={setTab} onHistory={() => setHistory(true)} />
        ) : tab === 'glossary' ? (
          <GlossaryPage projectId={projectId} snapshot={snapshot} canEdit={canEdit} onApplied={reload} />
        ) : tab === 'domains' ? (
          <DomainsPage projectId={projectId} snapshot={snapshot} canEdit={canEdit} onApplied={reload} />
        ) : tab === 'udp' ? (
          <UdpDefsPage projectId={projectId} snapshot={snapshot} canEdit={canEdit} onApplied={reload} />
        ) : tab === 'themes' ? (
          <ThemesPage projectId={projectId} snapshot={snapshot} canEdit={canEdit} onApplied={reload} />
        ) : (
          <DdlRulesTab projectId={projectId} snapshot={snapshot} versions={versions} canEdit={canEdit}
            meName={me?.name ?? me?.username} onApplied={reload} />
        )}
      </div>

      {/* footer: última versión + historial */}
      {!loading && current && (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 24px', borderTop: '1px solid #EAEDF2', background: '#fff' }}>
          <span style={{ fontSize: 12, color: '#8A93A5' }}>Latest version <strong style={{ color: '#56607A' }}>{current.label}</strong> · {current.author}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setHistory(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', border: '1px solid #DDE2EC', background: '#fff', color: '#3A4658', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><History size={14} />Version history</button>
        </div>
      )}

      {/* 15f · historial */}
      {history && (
        <div style={backdrop}>
          <div style={{ width: 740, maxHeight: 800, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 14, padding: '22px 24px 16px', borderBottom: '1px solid #EEF1F6' }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: '#EAF0FF', color: '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><History size={21} /></div>
              <div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>Standard change history</h2><p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5' }}>All versions of Glossary, UDP + Parent Domains, newest first. Each applied one can be rolled back.</p></div>
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
              <span style={{ flex: 1, fontSize: 11.5, color: '#9AA3B2' }}>Rollback re-derives names and types to the chosen version and is recorded as a new version.</span>
              <button onClick={() => setHistory(false)} style={btnGhost}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* 15g · rollback confirm — doc 95 D9: con la vista previa de lo que re-tipa */}
      {rollbackTarget && (
        <Dialog open title={`Roll back to ${rollbackTarget.label}?`} icon={TriangleAlert} width={760}
          onClose={() => setRollbackTarget(null)}
          subtitle="Restores ALL Data Standards (glossary, domains, UDPs, DDL rules, naming) to that version. Recorded as a new version."
          footer={<>
            <Button variant="secondary" onClick={() => setRollbackTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" icon={RotateCcw} onClick={() => doRollback(rollbackTarget)}
              disabled={busy || (!preview && !previewError)}>{busy ? 'Rolling back…' : 'Roll back'}</Button>
          </>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!preview && !previewError && <div style={{ fontSize: 13, color: '#8A93A5' }}>Calculating what changes…</div>}
            {previewError && <div style={{ fontSize: 12.5, color: '#C0392B' }}>{previewError}</div>}
            {preview && rollbackSummary(preview).map((l) => <div key={l} style={{ fontSize: 13, color: '#1A2B4A' }}>{l}</div>)}
            {preview && preview.domains.length > 0 && (
              <AffectedTable rows={rollbackDomainRows(preview)} columns={ROLLBACK_COLUMNS} rowKey={(r) => r.id}
                height={Math.min(280, 44 + preview.domains.length * 36)} />
            )}
            <div style={{ fontSize: 12.5, color: '#7A6220', background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 11, padding: '12px 15px' }}>
              Columns with an overridden type keep it. To undo a single domain, open it in Parent domains → History → Revert.
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ── Overview ──
function Overview({ snapshot, versions, canEdit, meName, projectName, onGo, onHistory }: {
  snapshot: StandardsSnapshot; versions: StandardsVersion[]; canEdit: boolean; meName?: string | null;
  projectName: string; onGo: (t: Tab) => void; onHistory: () => void;
}) {
  const recent = useMemo(() => versions.slice(0, 3), [versions]);
  return (
    <div style={{ padding: '26px 34px', background: '#FBFCFD', flex: 1 }}>
      <div style={{ maxWidth: 980 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8A93A5', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Governance</div>
        <h1 style={{ margin: '4px 0 16px', fontSize: 26, fontWeight: 700, color: '#1A2B4A' }}>Naming &amp; domain standards</h1>

        <div style={{ display: 'flex', gap: 12, background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 12, padding: '13px 16px', marginBottom: 22, fontSize: 12.5, color: '#7A6220', lineHeight: 1.5 }}>
          <TriangleAlert size={18} color="#B98600" style={{ flex: 'none', marginTop: 1 }} />
          <div><strong style={{ color: '#8A6D1F' }}>Project scope.</strong> Editing a glossary term, a naming rule or a domain can re-derive physical names and data types in <strong>{projectName}</strong> only — glossary changes show you exactly which names change before applying. Other projects are never affected. That is why standards live in their own module, separate from the canvas and restricted.</div>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>Recent standard changes</div><Button variant="secondary" size="sm" icon={History} onClick={onHistory}>View all versions</Button></div>
            {recent.map((v) => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #F2F4F8' }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: v.kind === 'domain' ? '#F3EEFF' : '#EAF0FF', color: v.kind === 'domain' ? '#8B5CF6' : '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{v.kind === 'domain' ? <Boxes size={14} /> : <BookOpenText size={14} />}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: '#1A2B4A' }}>{v.title}</div><div style={{ fontSize: 11.5, color: '#8A93A5' }}>{v.author} · {v.label}</div></div>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: v.kind === 'baseline' ? '#8A93A5' : '#0E8C6A', background: v.kind === 'baseline' ? '#F2F4F8' : '#E4F6EF', borderRadius: 999, padding: '3px 9px', flex: 'none' }}>{v.kind === 'baseline' ? 'Baseline' : 'Applied'}</span>
              </div>
            ))}
            {recent.length === 0 && <div style={{ fontSize: 12.5, color: '#9AA3B2', padding: '8px 0' }}>No changes yet.</div>}
          </div>
          <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 14 }}>Who can manage standards</div>
            {canEdit
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 32, height: 32, borderRadius: 999, background: '#2E5BFF', color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(meName ?? 'ME').slice(0, 2).toUpperCase()}</span><div><div style={{ fontSize: 13, fontWeight: 600, color: '#1A2B4A' }}>{meName ?? 'You'}</div><div style={{ fontSize: 11, color: '#8A93A5' }}>Standards admin · you</div></div></div>
              : <div style={{ fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 }}>Your role can <strong>view</strong> standards but not edit them.</div>}
            <div style={{ height: 1, background: '#F2F4F8', margin: '15px 0' }} />
            <div style={{ fontSize: 11.5, color: '#8A93A5', lineHeight: 1.5 }}>Standards edit access is granted from <strong style={{ color: '#56607A' }}>Admin · Permissions</strong> (permission <span style={{ fontFamily: 'var(--mono, monospace)' }}>standards.edit</span>).</div>
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

const ROLLBACK_COLUMNS: AffectedColumn<RollbackDomainRow>[] = [
  { key: 'name', header: 'Domain', width: '1.4fr', render: (r) => r.name },
  { key: 'physical', header: 'Physical type', width: '1.2fr', mono: true, render: (r) => r.physical },
  { key: 'logical', header: 'Logical type', width: '1.2fr', mono: true, render: (r) => r.logical },
  { key: 'columns', header: 'Columns re-typed', width: '140px', render: (r) => r.columns },
];
