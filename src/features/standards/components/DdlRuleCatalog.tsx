/**
 * Rule catalog (pantalla 16b) — tabla DENSA tipo hoja de cálculo, no cards:
 * los modeladores vienen de Excel. La columna Status combina el toggle de
 * enabled + el punto de validación. Fila → editor. "New rule" abre el picker
 * de plantillas (16d). Incluye el CTA de las 7 semillas cuando está vacío
 * (doc 30 D4), el editor de lookups/functions y la cascada de generadores.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, Info, Plus, Search, Sparkles, Table2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  seedStarterRules, toggleDdlRule, type DdlArtifact,
} from '../ddlRules.service';
import type { DdlRule, DdlRulesetConfig } from '../standards.service';
import DdlLookupsEditor from './DdlLookupsEditor';
import DdlOutputSettingsEditor from './DdlOutputSettingsEditor';
import DdlRuleTemplates from './DdlRuleTemplates';

export default function DdlRuleCatalog({ projectId, rules, config, artifacts, canEdit, initialAttention, onBack, onOpen, onNew, onApplied }: {
  projectId: string;
  rules: DdlRule[];
  config: DdlRulesetConfig;
  artifacts: DdlArtifact[];
  canEdit: boolean;
  initialAttention?: boolean;
  onBack: () => void;
  onOpen: (rule: DdlRule) => void;
  onNew: (draft?: Partial<DdlRule>) => void;
  onApplied: () => Promise<void> | void;
}) {
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | 'rule' | 'generator'>('all');
  const [artifact, setArtifact] = useState('all');
  const [attention, setAttention] = useState(!!initialAttention);
  const [templates, setTemplates] = useState(false);
  const [lookups, setLookups] = useState(false);
  const [output, setOutput] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const needsAttention = rules.filter((r) => r.validationState !== 'valid').length;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rules.filter((r) => {
      if (type !== 'all' && r.kind !== type) return false;
      if (attention && r.validationState === 'valid') return false;
      if (artifact !== 'all') {
        const arts = r.kind === 'generator'
          ? [((r.action?.emit as Record<string, unknown> | undefined)?.artifact as string) ?? '']
          : r.appliesTo;
        if (!arts.includes(artifact)) return false;
      }
      if (!term) return true;
      const hay = `${r.name} ${r.condition} ${JSON.stringify(r.action)}`.toLowerCase();
      return hay.includes(term);
    });
  }, [rules, q, type, artifact, attention]);

  // Cadenas de dependencia de generadores (spec §7.3, visible): raíz → … → hoja.
  const chains = useMemo(() => {
    const gens = rules.filter((r) => r.kind === 'generator' && r.enabled);
    const emitOf = (g: DdlRule) => ((g.action?.emit as Record<string, unknown> | undefined)?.artifact as string) ?? '';
    const bySource = new Map<string, DdlRule[]>();
    gens.forEach((g) => {
      const s = g.sourceArtifact ?? '';
      bySource.set(s, [...(bySource.get(s) ?? []), g]);
    });
    const out: string[] = [];
    const walk = (art: string, path: string[]) => {
      const nexts = bySource.get(art) ?? [];
      if (!nexts.length) { if (path.length > 1) out.push(path.join(' → ')); return; }
      nexts.forEach((g) => walk(emitOf(g), [...path, emitOf(g)]));
    };
    ['ddl.tabla_fisica', 'ddl.vista_negocio'].forEach((root) => walk(root, [root]));
    return out;
  }, [rules]);

  const doToggle = async (rule: DdlRule, enabled: boolean) => {
    setBusyId(rule.id);
    try { await toggleDdlRule(projectId, rule, enabled); await onApplied(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't update the rule"); }
    finally { setBusyId(null); }
  };

  const doSeed = async () => {
    setSeeding(true);
    try { await seedStarterRules(projectId); await onApplied(); toast.success('Starter rules added'); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't add the starter rules"); }
    finally { setSeeding(false); }
  };

  const actionSummary = (r: DdlRule): string => {
    const a = r.action ?? {};
    if (typeof a.expression === 'string') return a.expression;
    if (a.tags) return `SET TAGS (${Object.keys(a.tags as object).join(', ')})`;
    if (a.tblproperties) return `TBLPROPERTIES (${Object.keys(a.tblproperties as object).join(', ')})`;
    if (a.exclude === true) return 'Exclude column from the SELECT';
    if (a.statements) {
      const st = a.statements as { before?: string[]; after?: string[] };
      const n = (st.before?.length ?? 0) + (st.after?.length ?? 0);
      return `Statements: ${(st.before?.[0] ?? st.after?.[0] ?? '').slice(0, 48)}${n > 1 ? ` (+${n - 1})` : ''}`;
    }
    if (a.layout) {
      const lay = a.layout as { partitionColumns?: string; partitionUdp?: string; partitionOrderUdp?: string };
      const udp = (lay.partitionUdp ?? lay.partitionOrderUdp ?? '').trim();
      return `Column layout: partition columns ${(lay.partitionColumns ?? 'keep') === 'last' ? 'last' : 'in physical order'}`
        + (udp ? ` · partitions from UDP "${udp}"` : '');
    }
    if (a.types) {
      const map = Object.entries(a.types as Record<string, string>).map(([k, v]) => `${k} → ${v}`).join(', ');
      return `Data types: ${map}`;
    }
    const emit = a.emit as Record<string, unknown> | undefined;
    if (emit) return `+ ${emit.type === 'view' ? 'view' : 'tbl'} "${emit.schema}.${emit.name}"`;
    return '—';
  };
  const artifactChips = (r: DdlRule): string[] => (r.kind === 'generator'
    ? [(((r.action?.emit as Record<string, unknown> | undefined)?.artifact as string) ?? '')]
    : r.appliesTo);

  return (
    <div style={{ padding: '22px 34px', background: '#FBFCFD', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', padding: 0, fontSize: 12, fontWeight: 600, color: '#8A93A5', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 4 }}>
            <ChevronLeft size={13} /> DDL export rules
          </button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1A2B4A', letterSpacing: '-0.01em' }}>Export rule catalog</h1>
        </div>
        <div style={{ fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5, textAlign: 'right' }}>
          Applied when DDL is exported<br />
          <strong style={{ color: '#1A2B4A' }}>
            {rules.filter((r) => r.kind === 'rule').length} rules · {rules.filter((r) => r.kind === 'generator').length} generators
          </strong>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 9, width: 270 }}>
          <Search size={14} color="#9AA3B2" style={{ flex: 'none' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rules…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12.5, color: '#1A2B4A', background: 'transparent', fontFamily: 'inherit' }} />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} style={sel}>
          <option value="all">Type: All</option>
          <option value="rule">Type: Rules</option>
          <option value="generator">Type: Generators</option>
        </select>
        <select value={artifact} onChange={(e) => setArtifact(e.target.value)} style={sel}>
          <option value="all">Artifact: All</option>
          {artifacts.map((a) => <option key={a.id} value={a.id}>{a.id}{a.kind ? ` · ${a.kind}` : ''}</option>)}
        </select>
        {needsAttention > 0 && (
          <button onClick={() => setAttention(!attention)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 12px', border: `1px solid ${attention ? '#E0736A' : '#F1D9D5'}`, background: '#FDF2F1', color: '#B23A2E', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: attention ? '0 0 0 2px rgba(214,69,93,0.15)' : 'none' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D6455D' }} />
            Needs attention <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 700 }}>{needsAttention}</span>
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={() => setOutput(true)} style={{ ...sel, cursor: 'pointer' } as React.CSSProperties}>
          Output settings
        </button>
        <button onClick={() => setLookups(true)} style={{ ...sel, cursor: 'pointer' } as React.CSSProperties}>
          Lookups &amp; Functions · {Object.keys(config.lookups).length + config.functions.length}
        </button>
        {canEdit && (
          <button onClick={() => setTemplates(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 16px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 2px rgba(46,91,255,0.35)' }}>
            <Plus size={14} /> New rule
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <div style={{ border: '1px dashed #C9D2E0', borderRadius: 12, background: '#fff', padding: '38px 24px', textAlign: 'center' }}>
          <Sparkles size={22} color="#8B5CF6" />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1A2B4A', marginTop: 8 }}>No export rules yet</div>
          <div style={{ fontSize: 12.5, color: '#8A93A5', margin: '6px auto 14px', maxWidth: 460, lineHeight: 1.5 }}>
            Restore the base rule set — the DDL set of the BCP macro: commented DROP, vacuum
            TBLPROPERTIES, updateFrequency / isDAC / DAC tags, rejected table, NoDAC and DAC technical
            and rejected views, and DAC decryption on business views — and the output settings
            (quoting, casing, file names). You can edit or disable any of them later.
          </div>
          {canEdit && (
            <button onClick={doSeed} disabled={seeding}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {seeding ? 'Adding…' : 'Restore the base rule set'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ border: '1px solid #EAEDF2', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ ...row, background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', padding: '11px 18px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>
            <div>Rule</div><div>Type</div><div>Condition</div><div>Action</div><div>Applies to</div><div>Prio</div><div>Status</div>
          </div>
          {filtered.map((r) => {
            const bad = r.validationState !== 'valid';
            const chips = artifactChips(r);
            return (
              <div key={r.id} onClick={() => onOpen(r)}
                style={{ ...row, alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #F2F4F8', cursor: 'pointer', background: bad ? '#FFFBFB' : '#fff' }}>
                <div style={{ ...cellMono, fontWeight: 600, color: r.enabled ? '#1A2B4A' : '#8A93A5' }}>{r.name}</div>
                <div>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: r.kind === 'generator' ? '#8B5CF6' : '#2E5BFF', background: r.kind === 'generator' ? '#F3EEFF' : '#EAF0FF', borderRadius: 999, padding: '2px 9px' }}>
                    {r.kind === 'generator' ? 'Generator' : 'Rule'}
                  </span>
                </div>
                <div style={{ ...cellMono, color: r.enabled ? '#56607A' : '#8A93A5' }}>
                  {bad && r.validationReport?.errors?.[0]?.token
                    ? <ErrTok text={r.condition || '—'} token={r.validationReport.errors[0].token!} />
                    : (r.condition || 'true')}
                </div>
                <div style={{ ...cellMono, color: r.enabled ? '#1A2B4A' : '#8A93A5' }}>{actionSummary(r)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden' }}>
                  {chips[0]
                    ? <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10, color: '#56607A', background: '#F2F4F8', borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>{chips[0]}</span>
                    : <span style={{ fontSize: 10.5, color: '#9AA3B2' }}>—</span>}
                  {chips.length > 1 && <span style={{ fontSize: 10, color: '#9AA3B2' }}>+{chips.length - 1}</span>}
                </div>
                <div style={{ ...cellMono, color: r.enabled ? '#1A2B4A' : '#9AA3B2' }}>{r.priority}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }} onClick={(e) => e.stopPropagation()}>
                  <Toggle on={r.enabled} busy={busyId === r.id} disabled={!canEdit}
                    onFlip={(v) => doToggle(r, v)} />
                  {r.validationState === 'valid' && <span title={r.enabled ? 'Valid' : 'Disabled'} style={{ width: 8, height: 8, borderRadius: '50%', background: r.enabled ? '#16A37B' : '#C7CFDB', flex: 'none' }} />}
                  {r.validationState === 'invalid' && <><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D6455D', flex: 'none' }} /><span style={{ fontSize: 10, fontWeight: 600, color: '#C0392B' }}>error</span></>}
                  {r.validationState === 'stale' && <><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E5A83B', flex: 'none' }} /><span style={{ fontSize: 10, fontWeight: 600, color: '#B98600' }}>stale</span></>}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '22px 18px', fontSize: 12.5, color: '#9AA3B2' }}>No rules match the current filters.</div>
          )}
        </div>
      )}

      {chains.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
          <Table2 size={14} color="#B6BECD" style={{ flex: 'none' }} />
          <span style={{ fontSize: 11.5, color: '#9AA3B2' }}>Generator cascade:</span>
          {chains.map((c) => (
            <span key={c} style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10.5, color: '#56607A', background: '#F2F4F8', borderRadius: 6, padding: '3px 8px' }}>{c}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 10, fontSize: 11.5, color: '#9AA3B2' }}>
        <Info size={14} color="#B6BECD" style={{ flex: 'none' }} />
        Rules run in priority order (high → low) when you export DDL. Disabled rules and rules with a red
        validation dot are skipped.
      </div>

      {templates && (
        <DdlRuleTemplates projectId={projectId} onClose={() => setTemplates(false)}
          onPick={(draft) => { setTemplates(false); onNew(draft); }} />
      )}
      {lookups && (
        <DdlLookupsEditor projectId={projectId} config={config} canEdit={canEdit}
          onClose={() => setLookups(false)} onApplied={onApplied} />
      )}
      {output && (
        <DdlOutputSettingsEditor projectId={projectId} config={config} canEdit={canEdit}
          onClose={() => setOutput(false)} onApplied={onApplied} />
      )}
    </div>
  );
}

function ErrTok({ text, token }: { text: string; token: string }) {
  const i = text.indexOf(token);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span style={{ color: '#C0392B', textDecoration: 'underline wavy #E4907F', textUnderlineOffset: 2 }}>{token}</span>
      {text.slice(i + token.length)}
    </>
  );
}

function Toggle({ on, busy, disabled, onFlip }: { on: boolean; busy?: boolean; disabled?: boolean; onFlip: (v: boolean) => void }) {
  return (
    <button onClick={() => !disabled && !busy && onFlip(!on)} disabled={disabled || busy}
      aria-label={on ? 'Disable rule' : 'Enable rule'}
      style={{ width: 30, height: 17, borderRadius: 999, border: 'none', padding: 2, background: on ? '#2E5BFF' : '#C7CFDB', cursor: disabled ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, display: 'inline-flex', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background 0.15s' }}>
      <span style={{ width: 13, height: 13, borderRadius: '50%', background: '#fff', display: 'block' }} />
    </button>
  );
}

const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1.5fr 0.85fr 2.1fr 1.9fr 1.65fr 0.6fr 1fr', gap: 10 };
const cellMono: React.CSSProperties = { fontFamily: 'var(--mono, monospace)', fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const sel: React.CSSProperties = { height: 36, padding: '0 12px', border: '1px solid #E2E6EE', background: '#fff', color: '#3A4658', borderRadius: 9, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', outline: 'none' };
