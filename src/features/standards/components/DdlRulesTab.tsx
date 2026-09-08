/**
 * DDL Export rules — 5ta pestaña de Data Standards (doc 30, pantallas 16/16b/
 * 16c/16d). Navegación interna: overview → catalog → editor. Las reglas
 * transforman el TEXTO del Export DDL según UDPs; nunca tocan el modelo.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Braces, ChevronRight, PackagePlus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import {
  getDdlArtifacts, type DdlArtifact,
} from '../ddlRules.service';
import type { DdlRule, StandardsSnapshot, StandardsVersion } from '../standards.service';
import DdlRuleCatalog from './DdlRuleCatalog';
import DdlRuleEditor from './DdlRuleEditor';

type View =
  | { t: 'overview' }
  | { t: 'catalog'; attention?: boolean }
  | { t: 'editor'; rule: DdlRule | null; draft?: Partial<DdlRule> };

export default function DdlRulesTab({ projectId, snapshot, versions, canEdit, meName, onApplied }: {
  projectId: string;
  snapshot: StandardsSnapshot;
  versions: StandardsVersion[];
  canEdit: boolean;
  meName?: string | null;
  onApplied: () => Promise<void> | void;
}) {
  const rules = useMemo(() => snapshot.ddlRules ?? [], [snapshot.ddlRules]);
  const config = useMemo(() => snapshot.ddlConfig ?? { lookups: {}, functions: [] }, [snapshot.ddlConfig]);
  const [view, setView] = useState<View>({ t: 'overview' });
  const [artifacts, setArtifacts] = useState<DdlArtifact[]>([]);

  const reloadArtifacts = useCallback(() => {
    getDdlArtifacts(projectId).then(setArtifacts).catch(() => toast.error("Couldn't load DDL artifacts"));
  }, [projectId]);
  useEffect(() => { reloadArtifacts(); }, [reloadArtifacts, rules]);

  const invalid = rules.filter((r) => r.validationState === 'invalid');
  const stale = rules.filter((r) => r.validationState === 'stale');
  const attention = invalid.length + stale.length;
  const generators = rules.filter((r) => r.kind === 'generator');
  const plain = rules.filter((r) => r.kind === 'rule');
  const recentDdl = useMemo(() => versions.filter((v) => v.kind === 'ddl').slice(0, 3), [versions]);

  const applied = async () => { await onApplied(); reloadArtifacts(); };

  if (view.t === 'editor') {
    return (
      <DdlRuleEditor
        projectId={projectId}
        rule={view.rule} draft={view.draft} rules={rules} config={config}
        udpDefs={snapshot.udp} artifacts={artifacts} canEdit={canEdit}
        onBack={() => setView({ t: 'catalog' })}
        onSaved={async () => { await applied(); setView({ t: 'catalog' }); }}
      />
    );
  }
  if (view.t === 'catalog') {
    return (
      <DdlRuleCatalog
        projectId={projectId}
        rules={rules} config={config} artifacts={artifacts} canEdit={canEdit}
        initialAttention={view.attention}
        onBack={() => setView({ t: 'overview' })}
        onOpen={(rule) => setView({ t: 'editor', rule })}
        onNew={(draft) => setView({ t: 'editor', rule: null, draft })}
        onApplied={applied}
      />
    );
  }

  // ── Overview (pantalla 16) ──
  return (
    <div style={{ padding: '26px 34px', background: '#FBFCFD', flex: 1 }}>
      <div style={{ maxWidth: 980 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8A93A5', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Governance</div>
            <h1 style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700, color: '#1A2B4A', letterSpacing: '-0.015em' }}>DDL export rules</h1>
          </div>
          <div style={{ fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5, textAlign: 'right' }}>
            Authored here · applied on export<br />
            <strong style={{ color: '#1A2B4A' }}>{plain.length} rules · {generators.length} generators</strong>
          </div>
        </div>

        {/* Banner AZUL — "solo el texto exportado", no ámbar (doc 30 §7) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: '#EFF4FF', border: '1px solid #D4E0FF', borderRadius: 12, padding: '13px 16px', marginBottom: 16 }}>
          <Braces size={18} color="#2E5BFF" style={{ flex: 'none', marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: '#45597C', lineHeight: 1.55 }}>
            <strong style={{ color: '#1A2B4A' }}>Authoring only.</strong> Rules are written and validated
            here, then applied automatically when you export DDL from the canvas. They never modify your
            tables, views, or data — generated artifacts are ephemeral.
          </div>
        </div>

        {attention > 0 && (
          <button onClick={() => setView({ t: 'catalog', attention: true })}
            style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', background: '#FDF2F1', border: '1px solid #F1D9D5', borderRadius: 11, padding: '10px 15px', marginBottom: 22, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            <TriangleAlert size={16} color="#C0392B" style={{ flex: 'none' }} />
            <span style={{ fontSize: 12.5, color: '#8A4038', flex: 1 }}>
              <strong style={{ color: '#B23A2E' }}>{attention} rule{attention === 1 ? '' : 's'} need attention</strong>
              {' '}— {invalid.length > 0 ? 'they have validation errors and would be skipped on export' : 'a UDP list value they use was removed'}.
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#C0392B', display: 'inline-flex', alignItems: 'center', gap: 5 }}>Review <ChevronRight size={13} /></span>
          </button>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 26 }}>
          <button onClick={() => setView({ t: 'catalog' })} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: '#F3EEFF', color: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><PackagePlus size={22} /></div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B4A' }}>Generators</div>
                <div style={{ fontSize: 12, color: '#8A93A5' }}>Emit new artifacts on export</div>
              </div>
              <ChevronRight size={16} color="#B6BECD" />
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#6B7689', lineHeight: 1.5, textAlign: 'left' }}>
              Emit additional artifacts derived from a physical table — a rejected-rows table, a technical
              view — that exist only in the exported DDL.
            </p>
            <span style={mono}>{generators.length} generators</span>
          </button>
          <button onClick={() => setView({ t: 'catalog' })} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: '#EAF0FF', color: '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Braces size={22} /></div>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B4A' }}>Column & table rules</div>
                <div style={{ fontSize: 12, color: '#8A93A5' }}>Decorate the DDL on export</div>
              </div>
              <ChevronRight size={16} color="#B6BECD" />
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#6B7689', lineHeight: 1.5, textAlign: 'left' }}>
              Transform column expressions, governance tags and table properties based on UDP values —
              masking and hashing applied as the DDL is written.
            </p>
            <span style={mono}>{plain.length} rules</span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 18 }}>
          <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>Recent rule changes</div>
              <button onClick={() => setView({ t: 'catalog' })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#2E5BFF', cursor: 'pointer', fontFamily: 'inherit' }}>
                Open catalog <ChevronRight size={12} />
              </button>
            </div>
            {recentDdl.map((v) => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #F2F4F8' }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#EAF0FF', color: '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Braces size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#1A2B4A' }}>{v.title}</div>
                  <div style={{ fontSize: 11.5, color: '#8A93A5' }}>{v.author} · {v.label}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#0E8C6A', background: '#E4F6EF', borderRadius: 999, padding: '3px 9px', flex: 'none' }}>Applied</span>
              </div>
            ))}
            {recentDdl.length === 0 && <div style={{ fontSize: 12.5, color: '#9AA3B2', padding: '8px 0' }}>No rule changes yet.</div>}
          </div>

          <div style={{ background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 14 }}>Who can manage export rules</div>
            {canEdit
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 999, background: '#2E5BFF', color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(meName ?? 'ME').slice(0, 2).toUpperCase()}</span>
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: '#1A2B4A' }}>{meName ?? 'You'}</div><div style={{ fontSize: 11, color: '#8A93A5' }}>Standards admin · you</div></div>
                </div>
              : <div style={{ fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 }}>Your role can <strong>view and test</strong> rules but not save them.</div>}
            <div style={{ height: 1, background: '#F2F4F8', margin: '15px 0' }} />
            <div style={{ fontSize: 11.5, color: '#8A93A5', lineHeight: 1.5 }}>
              Modelers &amp; reviewers can <strong style={{ color: '#56607A' }}>view and test</strong> rules but
              not save them. Access is granted from <strong style={{ color: '#56607A' }}>Admin · Permissions</strong>{' '}
              (permission <span style={{ fontFamily: 'var(--mono, monospace)' }}>standards.edit</span>).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { display: 'block', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: 20, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', boxShadow: '0 1px 2px rgba(16,27,48,0.04)' };
const mono: React.CSSProperties = { fontFamily: 'var(--mono, monospace)', fontSize: 11, fontWeight: 600, color: '#1A2B4A', background: '#F2F4F8', borderRadius: 6, padding: '3px 8px', display: 'inline-block' };
