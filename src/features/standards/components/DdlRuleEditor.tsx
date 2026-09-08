/**
 * Rule editor + validation bench (pantallas 16c y 16c·2) — split 50/50:
 * izquierda DEFINE (Form ↔ YAML), derecha VALIDA (los 5 checks en vivo, error
 * estilo compilador con caret + "Did you mean", Test contra una tabla REAL del
 * catálogo y el impacto estimado). El panel derecho es un banco de validación
 * de la regla — NO un preview del export (doc 30 §2).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Clock3, Lock, Minus, Save, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { apiGet } from '@/services/http';
import { API_BASE } from '@/services/apiBase';

import {
  impactDdlRule, ruleToYaml, saveDdlRule, deleteDdlRule, testDdlRule, toEditInput,
  validateDdlRule, yamlToRule,
  type DdlArtifact, type DdlImpact, type DdlTestResult, type DdlValidateResult,
} from '../ddlRules.service';
import type {
  DdlRule, DdlRuleEditInput, DdlRulesetConfig, UdpDefinition,
} from '../standards.service';

interface CatalogTable { id: string; physicalName: string; schema?: string | null; }

const LEVEL_OF = { columna: 'column', tabla: 'table', modelo: 'canvas' } as const;

export default function DdlRuleEditor({ projectId, rule, draft: draftSeed, udpDefs, artifacts, canEdit, onBack, onSaved }: {
  projectId: string;
  rule: DdlRule | null;                       // null = nueva
  draft?: Partial<DdlRule>;                   // pre-carga de plantilla (16d)
  rules: DdlRule[];
  config: DdlRulesetConfig;
  udpDefs: UdpDefinition[];
  artifacts: DdlArtifact[];
  canEdit: boolean;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const isNew = rule === null;
  const [draft, setDraft] = useState<DdlRuleEditInput>(() => rule ? toEditInput(rule) : {
    name: '', kind: 'rule', target: 'column', condition: '', action: {},
    appliesTo: [], priority: 100, enabled: true,
    ...(draftSeed as Partial<DdlRuleEditInput> | undefined),
  });
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [yamlText, setYamlText] = useState('');
  const [yamlErr, setYamlErr] = useState<string | null>(null);
  const [report, setReport] = useState<DdlValidateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [impact, setImpact] = useState<DdlImpact | null>(null);
  const [testTable, setTestTable] = useState<CatalogTable | null>(null);
  const [testOut, setTestOut] = useState<DdlTestResult | null>(null);
  const [tableQ, setTableQ] = useState('');
  const [tableHits, setTableHits] = useState<CatalogTable[]>([]);
  const [tablePick, setTablePick] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ac, setAc] = useState<{ base: keyof typeof LEVEL_OF; partial: string; sel: number } | null>(null);
  const condRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<DdlRuleEditInput>) => setDraft((d) => ({ ...d, ...p }));

  // ── Validación en vivo (debounce) — los 5 checks del back ──
  useEffect(() => {
    setChecking(true);
    const t = setTimeout(() => {
      validateDdlRule(projectId, draft)
        .then((r) => { setReport(r); })
        .catch(() => setReport(null))
        .finally(() => setChecking(false));
    }, 450);
    return () => clearTimeout(t);
  }, [draft]);

  const valid = report?.state === 'valid';

  // Impacto + Test se recalculan solo con regla válida.
  useEffect(() => {
    if (!valid) { setImpact(null); setTestOut(null); return; }
    const t = setTimeout(() => {
      impactDdlRule(projectId, draft).then(setImpact).catch(() => setImpact(null));
      if (testTable) testDdlRule(projectId, draft, testTable.id).then(setTestOut).catch(() => setTestOut(null));
    }, 250);
    return () => clearTimeout(t);
  }, [valid, draft, testTable]);

  // Buscador de tablas reales del catálogo (spec 15.4).
  useEffect(() => {
    if (!tablePick) return;
    const t = setTimeout(() => {
      apiGet<CatalogTable[]>(`${API_BASE}/api/catalog/tables?q=${encodeURIComponent(tableQ)}&limit=15`)
        .then(setTableHits).catch(() => setTableHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [tableQ, tablePick]);

  // ── Autocomplete de UDP (16c·2): agrupa por clase, filtra al target ──
  const acItems = useMemo(() => {
    if (!ac) return [];
    const level = LEVEL_OF[ac.base];
    const p = ac.partial.toLowerCase();
    return udpDefs.filter((d) => d.level === level && d.name.toLowerCase().includes(p)).slice(0, 8);
  }, [ac, udpDefs]);

  const onConditionChange = (value: string) => {
    patch({ condition: value });
    const m = /(columna|tabla|modelo)\.udp(?:\[\s*["']?([^"'\]]*)?)?$/.exec(value);
    if (m && (draft.kind === 'generator' ? m[1] !== 'columna' : true)) {
      setAc({ base: m[1] as keyof typeof LEVEL_OF, partial: m[2] ?? '', sel: 0 });
    } else setAc(null);
  };

  const insertUdp = (name: string) => {
    if (!ac) return;
    const value = draft.condition;
    const m = /(columna|tabla|modelo)\.udp(?:\[\s*["']?(?:[^"'\]]*)?)?$/.exec(value);
    if (!m) { setAc(null); return; }
    // SIEMPRE la forma canónica con corchetes (spec §6.2).
    const next = value.slice(0, m.index) + `${m[1]}.udp["${name}"]`;
    patch({ condition: next });
    setAc(null);
    condRef.current?.focus();
  };

  const applySuggestion = (err: NonNullable<DdlValidateResult['errors']>[number]) => {
    if (!err.token || !err.suggestion) return;
    if (err.suggestion.startsWith('LIKE ')) {
      // '= 'DAC'' → `LIKE 'DAC-%'` (la trampa del catálogo, spec §9)
      patch({ condition: draft.condition.replace(`= '${err.token}'`, err.suggestion) });
    } else {
      patch({ condition: draft.condition.replace(err.token, err.suggestion) });
    }
  };

  const switchMode = (m: 'form' | 'yaml') => {
    if (m === mode) return;
    if (m === 'yaml') { setYamlText(ruleToYaml(draft)); setYamlErr(null); setMode('yaml'); return; }
    try { setDraft(yamlToRule(yamlText, draft)); setYamlErr(null); setMode('form'); }
    catch (e) { setYamlErr(e instanceof Error ? e.message : 'Invalid YAML'); }
  };

  const doSave = async () => {
    let toSave = draft;
    if (mode === 'yaml') {
      try { toSave = yamlToRule(yamlText, draft); }
      catch (e) { setYamlErr(e instanceof Error ? e.message : 'Invalid YAML'); return; }
    }
    setSaving(true);
    try {
      await saveDdlRule(projectId, toSave, isNew);
      toast.success(`Rule ${toSave.name} saved`);
      await onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save the rule"); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!rule) return;
    setSaving(true);
    try { await deleteDdlRule(projectId, rule); toast.success(`Rule ${rule.name} deleted`); await onSaved(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete the rule"); setSaving(false); }
  };

  const errCount = report?.errors?.length ?? 0;
  const action = draft.action as Record<string, unknown>;
  const actionKind: 'expression' | 'tags' | 'tblproperties' | 'layout' | 'emit' =
    draft.kind === 'generator' ? 'emit'
      : action.tags ? 'tags' : action.tblproperties ? 'tblproperties' : action.layout ? 'layout' : 'expression';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* breadcrumb bar */}
      <div style={{ height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 11, padding: '0 24px', borderBottom: '1px solid #EAEDF2', background: '#fff' }}>
        <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: '#8A93A5', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          <ChevronLeft size={13} /> Rule catalog
        </button>
        <span style={{ color: '#D4D9E2' }}>/</span>
        <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 15, fontWeight: 700, color: '#1A2B4A' }}>{draft.name || 'new rule'}</span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: draft.kind === 'generator' ? '#8B5CF6' : '#2E5BFF', background: draft.kind === 'generator' ? '#F3EEFF' : '#EAF0FF', borderRadius: 999, padding: '2px 9px' }}>
          {draft.kind === 'generator' ? 'Generator' : 'Rule'}
        </span>
        {checking
          ? <span style={{ fontSize: 11.5, color: '#9AA3B2', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Clock3 size={12} /> checking…</span>
          : errCount > 0
            ? <span style={{ fontSize: 11.5, color: '#C0392B', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D6455D' }} />{errCount} error{errCount === 1 ? '' : 's'}</span>
            : <span style={{ fontSize: 11.5, color: '#9AA3B2', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A37B' }} />Unsaved draft</span>}
        <div style={{ flex: 1 }} />
        {!isNew && canEdit && (
          confirmDelete
            ? <button onClick={doDelete} disabled={saving} style={{ ...ghostBtn, color: '#fff', background: '#D6455D', border: 'none' }}><Trash2 size={13} /> Confirm delete</button>
            : <button onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, color: '#B23A2E' }}><Trash2 size={13} /> Delete</button>
        )}
        <button onClick={onBack} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={13} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* ── IZQUIERDA · definition ── */}
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid #EAEDF2', background: '#fff', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 46, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px', borderBottom: '1px solid #F0F2F6' }}>
            <span style={cap}>Definition</span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', background: '#EFF1F5', border: '1px solid #E4E8EF', borderRadius: 8, padding: 2 }}>
              {(['form', 'yaml'] as const).map((m) => (
                <button key={m} onClick={() => switchMode(m)}
                  style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 12px', border: 'none', background: mode === m ? '#fff' : 'transparent', color: mode === m ? '#1A2B4A' : '#A9B1BE', borderRadius: 6, fontSize: 12, fontWeight: mode === m ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: mode === m ? '0 1px 2px rgba(16,27,48,0.06)' : 'none' }}>
                  {m === 'form' ? 'Form' : 'YAML'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
            {mode === 'yaml' ? (
              <>
                <textarea value={yamlText} onChange={(e) => { setYamlText(e.target.value); setYamlErr(null); }}
                  spellCheck={false} disabled={!canEdit}
                  style={{ width: '100%', minHeight: 380, border: `1px solid ${yamlErr ? '#E0736A' : '#E2E6EE'}`, borderRadius: 9, padding: '10px 12px', fontFamily: 'var(--mono, monospace)', fontSize: 12.5, lineHeight: 1.55, color: '#1A2B4A', resize: 'vertical', outline: 'none', background: '#fff' }} />
                {yamlErr && <div style={{ marginTop: 6, fontSize: 11.5, color: '#C0392B' }}>{yamlErr}</div>}
                <div style={{ marginTop: 6, fontSize: 11, color: '#9AA3B2' }}>Keys map 1:1 with the form. Switch back to Form to apply.</div>
              </>
            ) : (
              <>
                <label style={lbl}>Rule name</label>
                <input value={draft.name} onChange={(e) => patch({ name: e.target.value.replace(/\s+/g, '_') })}
                  placeholder="my_rule_slug" disabled={!canEdit} style={inp} />

                <div style={{ display: 'flex', gap: 14, margin: '16px 0' }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Type</label>
                    <Segmented options={[['generator', 'Generator'], ['rule', 'Rule']]}
                      value={draft.kind} disabled={!canEdit}
                      onPick={(v) => patch(v === 'generator'
                        ? { kind: 'generator', target: undefined, appliesTo: [], action: { emit: (action.emit as object) ?? { artifact: 'ddl.', type: 'table', schema: '{tabla.esquema}', name: '{tabla.nombre}', columns: { inherit: 'all' } } } }
                        : { kind: 'rule', target: draft.target ?? 'column', sourceArtifact: undefined, action: action.emit ? {} : action })} />
                  </div>
                  <div style={{ flex: 1 }}>
                    {draft.kind === 'rule' ? (
                      <>
                        <label style={lbl}>Target</label>
                        <Segmented options={[['column', 'Column'], ['table', 'Table']]}
                          value={draft.target ?? 'column'} disabled={!canEdit}
                          onPick={(v) => patch({ target: v as 'column' | 'table' })} />
                      </>
                    ) : (
                      <>
                        <label style={lbl}>Source artifact</label>
                        <select value={draft.sourceArtifact ?? ''} disabled={!canEdit}
                          onChange={(e) => patch({ sourceArtifact: e.target.value || undefined })}
                          style={{ ...inp, cursor: 'pointer' }}>
                          <option value="">— pick a source —</option>
                          {artifacts.map((a) => <option key={a.id} value={a.id}>{a.id}{a.kind ? ` · ${a.kind}` : ''}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                </div>

                <label style={lbl}>Condition</label>
                <div style={{ position: 'relative', marginBottom: 4 }}>
                  <input ref={condRef} value={draft.condition} disabled={!canEdit}
                    onChange={(e) => onConditionChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (!ac || !acItems.length) return;
                      if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...ac, sel: (ac.sel + 1) % acItems.length }); }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, sel: (ac.sel - 1 + acItems.length) % acItems.length }); }
                      if (e.key === 'Enter') { e.preventDefault(); insertUdp(acItems[ac.sel].name); }
                      if (e.key === 'Escape') setAc(null);
                    }}
                    placeholder={'columna.udp["Clasificacion del Dato"] LIKE \'DAC-%\''}
                    spellCheck={false}
                    style={{ ...inp, fontFamily: 'var(--mono, monospace)', borderColor: errCount ? '#E0736A' : undefined, boxShadow: errCount ? '0 0 0 3px rgba(214,69,93,0.1)' : undefined }} />
                  {ac && acItems.length > 0 && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', zIndex: 30, background: '#fff', border: '1px solid #E2E6EE', borderRadius: 10, boxShadow: '0 16px 38px rgba(16,27,48,0.2)', overflow: 'hidden' }}>
                      <div style={{ padding: '8px 12px', borderBottom: '1px solid #F2F4F8', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' }}>
                        UDP catalog · {LEVEL_OF[ac.base]} <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#B6BECD' }}>· closed list · exhaustive</span>
                      </div>
                      {acItems.map((d, i) => (
                        <button key={d.id} onClick={() => insertUdp(d.name)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', border: 'none', borderLeft: i === ac.sel ? '2px solid #2E5BFF' : '2px solid transparent', background: i === ac.sel ? '#F4F7FF' : '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <span style={{ width: 20, height: 20, borderRadius: 5, background: '#F3EEFF', color: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono, monospace)', fontSize: 10, fontWeight: 700, flex: 'none' }}>U</span>
                          <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12.5, fontWeight: i === ac.sel ? 600 : 500, color: '#1A2B4A' }}>{d.name}</span>
                          <span style={{ flex: 1 }} />
                          <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10.5, color: '#8A93A5' }}>
                            {d.allowedValues.slice(0, 3).join(' · ')}{d.allowedValues.length > 3 ? ` +${d.allowedValues.length - 3} more` : ''}
                          </span>
                        </button>
                      ))}
                      <div style={{ padding: '7px 12px', borderTop: '1px solid #F2F4F8', background: '#FBFCFD', fontSize: 10.5, color: '#9AA3B2' }}>
                        <span style={{ fontFamily: 'var(--mono, monospace)' }}>↵</span> insert · <span style={{ fontFamily: 'var(--mono, monospace)' }}>esc</span> dismiss
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ margin: '0 0 16px', fontSize: 11, color: '#9AA3B2' }}>
                  Type <span style={{ fontFamily: 'var(--mono, monospace)', color: '#8A93A5' }}>columna.udp[</span> to autocomplete a
                  UDP from the catalog (closed list). Empty condition = always applies. Use{' '}
                  <span style={{ fontFamily: 'var(--mono, monospace)', color: '#8A93A5' }}>LIKE 'DAC-%'</span> for critical columns —
                  never <span style={{ fontFamily: 'var(--mono, monospace)', color: '#8A93A5' }}>'%DAC%'</span> (it also matches 'No DAC').
                </div>

                {draft.kind === 'rule' ? (
                  <RuleAction action={action} actionKind={actionKind} canEdit={canEdit} target={draft.target ?? 'column'}
                    onChange={(a) => patch({ action: a })} />
                ) : (
                  <EmitAction action={action} canEdit={canEdit} onChange={(a) => patch({ action: a })} />
                )}

                {draft.kind === 'rule' && (
                  <>
                    <label style={lbl}>Target artifacts</label>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, padding: 8, border: '1px solid #E2E6EE', borderRadius: 9, background: '#fff', marginBottom: 16 }}>
                      {draft.appliesTo.map((a) => (
                        <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono, monospace)', fontSize: 11.5, color: '#2E5BFF', background: '#EAF0FF', border: '1px solid #D4E0FF', borderRadius: 7, padding: '4px 8px' }}
                          title={artifacts.find((x) => x.id === a)?.kind ? `${artifacts.find((x) => x.id === a)?.kind} artifact` : undefined}>
                          {a}
                          {artifacts.find((x) => x.id === a)?.kind && (
                            <span style={{ fontFamily: 'inherit', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#7FA0F0' }}>
                              {artifacts.find((x) => x.id === a)?.kind}
                            </span>
                          )}
                          {canEdit && <button onClick={() => patch({ appliesTo: draft.appliesTo.filter((x) => x !== a) })} style={{ border: 'none', background: 'transparent', color: '#7FA0F0', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={10} /></button>}
                        </span>
                      ))}
                      {canEdit && (
                        <select value="" onChange={(e) => { if (e.target.value) patch({ appliesTo: [...draft.appliesTo, e.target.value] }); }}
                          style={{ height: 28, padding: '0 10px', border: '1px dashed #C9D2E0', background: '#fff', color: '#8A93A5', borderRadius: 7, fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
                          <option value="">+ Add</option>
                          {artifacts.filter((a) => !draft.appliesTo.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.id}{a.kind ? ` · ${a.kind}` : ''}</option>)}
                        </select>
                      )}
                    </div>
                  </>
                )}

                <label style={lbl}>Priority</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="number" value={draft.priority} disabled={!canEdit}
                    onChange={(e) => patch({ priority: Number(e.target.value) || 0 })}
                    style={{ ...inp, width: 90 }} />
                  <span style={{ fontSize: 11.5, color: '#9AA3B2' }}>Higher priority runs first on export.</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── DERECHA · validation bench ── */}
        <div style={{ flex: 1, minWidth: 0, background: '#FBFCFD', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 46, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px', borderBottom: '1px solid #F0F2F6' }}>
            <span style={cap}>Validation</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: '#9AA3B2', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Clock3 size={12} color="#B6BECD" /> auto-checks as you type</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
            {valid ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#E9F7F0', border: '1px solid #BFE6D3', borderRadius: 11, padding: '12px 15px', marginBottom: 18 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#16A37B', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Check size={14} color="#fff" strokeWidth={2.8} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0E7A5C' }}>Valid</div>
                  <div style={{ fontSize: 11.5, color: '#4E8C74' }}>All 5 checks passed · ready to save</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#FDECEA', border: '1px solid #F3C9C2', borderRadius: 11, padding: '12px 15px', marginBottom: 16 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#D6455D', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><X size={13} color="#fff" strokeWidth={2.8} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#B23A2E' }}>{errCount || '—'} error{errCount === 1 ? '' : 's'}</div>
                  <div style={{ fontSize: 11.5, color: '#B5675E' }}>Fix {errCount === 1 ? 'it' : 'them'} before this rule can be saved or applied</div>
                </div>
              </div>
            )}

            {(report?.errors?.length ?? 0) > 0 && (
              <>
                <div style={{ ...cap, marginBottom: 8 }}>Error detail</div>
                <div style={{ background: '#FCF4F3', border: '1px solid #F1D9D5', borderRadius: 11, padding: '13px 15px', marginBottom: 20 }}>
                  {report!.errors.map((err, i) => (
                    <div key={i} style={{ marginBottom: i < report!.errors.length - 1 ? 12 : 0 }}>
                      {err.snippet && (
                        <pre style={{ margin: '0 0 8px', fontFamily: 'var(--mono, monospace)', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre', overflowX: 'auto', color: '#56607A' }}>{err.snippet}</pre>
                      )}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <TriangleAlert size={14} color="#C0392B" style={{ flex: 'none', marginTop: 1 }} />
                        <div style={{ fontSize: 12.5, color: '#8A4038', lineHeight: 1.5 }}>
                          {err.message}
                          {err.suggestion && canEdit && (
                            <>{' '}<button onClick={() => applySuggestion(err)}
                              style={{ border: 'none', background: '#EAF0FF', color: '#2E5BFF', fontFamily: 'var(--mono, monospace)', fontWeight: 600, borderRadius: 4, padding: '0 4px', cursor: 'pointer', fontSize: 12 }}>
                              {err.suggestion}
                            </button></>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {(report?.warnings?.length ?? 0) > 0 && (
              <div style={{ background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 11, padding: '11px 14px', marginBottom: 18 }}>
                {report!.warnings.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#7A6220', lineHeight: 1.5, marginBottom: i < report!.warnings.length - 1 ? 6 : 0 }}>
                    <TriangleAlert size={13} color="#B98600" style={{ flex: 'none', marginTop: 2 }} />{w}
                  </div>
                ))}
              </div>
            )}

            <div style={{ ...cap, marginBottom: 10 }}>Checks</div>
            <div style={{ border: '1px solid #EAEDF2', borderRadius: 11, overflow: 'hidden', background: '#fff', marginBottom: 20 }}>
              {(report?.checks ?? DEFAULT_CHECKS).map((c, i, arr) => (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < arr.length - 1 ? '1px solid #F2F4F8' : 'none', background: c.ok === false ? '#FDF6F5' : '#fff' }}>
                  {c.ok === true && <Check size={16} color="#16A37B" strokeWidth={2.2} style={{ flex: 'none' }} />}
                  {c.ok === false && <X size={16} color="#D6455D" strokeWidth={2.2} style={{ flex: 'none' }} />}
                  {c.ok === null && <Minus size={16} color="#C7CFDB" style={{ flex: 'none' }} />}
                  <span style={{ flex: 1, fontSize: 12.5, color: c.ok === false ? '#B23A2E' : c.ok === null ? '#A9B1BE' : '#1A2B4A', fontWeight: c.ok === false ? 600 : 400 }}>{c.name}</span>
                  <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: c.ok === false ? '#C0392B' : c.ok === null ? '#C7CFDB' : '#9AA3B2' }}>
                    {c.ok === null ? 'waiting' : c.detail || (c.ok ? 'ok' : '✕')}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Test contra una tabla real (spec 15.4) ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={cap}>Test</span>
              <div style={{ flex: 1 }} />
              <div style={{ position: 'relative' }}>
                <button onClick={() => { setTablePick(!tablePick); setTableQ(''); }} disabled={!valid}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', border: '1px solid #E2E6EE', background: valid ? '#fff' : '#F4F6F9', borderRadius: 8, fontSize: 12, color: valid ? '#8A93A5' : '#A9B1BE', cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                  Sample table{' '}
                  <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 600, color: valid ? '#1A2B4A' : '#A9B1BE' }}>
                    {testTable?.physicalName ?? 'pick one'}
                  </span>
                  <ChevronDown size={12} color="#9AA3B2" />
                </button>
                {tablePick && (
                  <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, width: 300, background: '#fff', border: '1px solid #E2E6EE', borderRadius: 10, boxShadow: '0 16px 38px rgba(16,27,48,0.2)', overflow: 'hidden' }}>
                    <input autoFocus value={tableQ} onChange={(e) => setTableQ(e.target.value)} placeholder="Search tables…"
                      style={{ width: '100%', border: 'none', borderBottom: '1px solid #F0F2F6', outline: 'none', padding: '9px 12px', fontSize: 12.5, fontFamily: 'inherit' }} />
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                      {tableHits.map((t) => (
                        <button key={t.id} onClick={() => { setTestTable(t); setTablePick(false); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, color: '#1A2B4A' }}>{t.physicalName}</span>
                          <span style={{ fontSize: 10.5, color: '#9AA3B2' }}>{t.schema ?? ''}</span>
                        </button>
                      ))}
                      {tableHits.length === 0 && <div style={{ padding: '10px 12px', fontSize: 12, color: '#9AA3B2' }}>No results</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {!valid ? (
              <div style={{ border: '1px dashed #E2E6EE', borderRadius: 11, background: '#FAFBFC', padding: '22px 18px', textAlign: 'center', marginBottom: 14 }}>
                <Lock size={20} color="#C7CFDB" />
                <div style={{ fontSize: 12.5, color: '#8A93A5', marginTop: 8 }}>Fix the error above to test this rule against a sample table.</div>
              </div>
            ) : testOut ? (
              <div style={{ border: '1px solid #EAEDF2', borderRadius: 11, background: '#fff', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ padding: '9px 14px', background: '#F7F9FC', borderBottom: '1px solid #EEF1F6', fontSize: 11.5, color: '#56607A' }}>
                  <strong style={{ color: '#1A2B4A' }}>{testOut.matched} of {testOut.total} {testOut.total === 1 ? 'object' : 'columns'}</strong> match this rule — generated fragment:
                </div>
                {testOut.fragments.slice(0, 6).map((f, i) => (
                  <div key={i} style={{ padding: '11px 14px', borderBottom: i < Math.min(testOut.fragments.length, 6) - 1 ? '1px solid #F2F4F8' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A37B', flex: 'none' }} />
                      <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, fontWeight: 600, color: '#1A2B4A' }}>{f.column ?? f.label}</span>
                      {f.why && <span style={{ fontSize: 10.5, color: '#8A93A5' }}>{f.why}</span>}
                    </div>
                    <pre style={{ margin: 0, fontFamily: 'var(--mono, monospace)', fontSize: 12, background: '#F7F9FC', border: '1px solid #EEF1F6', borderRadius: 7, padding: '7px 9px', whiteSpace: 'pre-wrap', overflowX: 'auto', color: '#1A2B4A' }}>{f.sql}</pre>
                  </div>
                ))}
                {testOut.matched === 0 && <div style={{ padding: '12px 14px', fontSize: 12, color: '#9AA3B2' }}>Nothing on this table matches the condition.</div>}
              </div>
            ) : (
              <div style={{ border: '1px dashed #E2E6EE', borderRadius: 11, background: '#FAFBFC', padding: '18px', textAlign: 'center', marginBottom: 8, fontSize: 12.5, color: '#8A93A5' }}>
                Pick a sample table to see the generated fragments.
              </div>
            )}
            <div style={{ fontSize: 11, color: '#9AA3B2', margin: '0 0 18px', lineHeight: 1.45 }}>
              Only the generated fragment for matching columns is shown — not the full DDL. The full DDL is
              produced later, on Export DDL.
            </div>

            <div style={{ background: valid && impact ? 'linear-gradient(180deg,#F4F7FF,#FAFBFF)' : '#F7F9FC', border: `1px solid ${valid && impact ? '#D9E3FB' : '#EAEDF2'}`, borderRadius: 12, padding: '14px 16px' }}>
              {valid && impact ? (
                <div style={{ fontSize: 13.5, color: '#1A2B4A', lineHeight: 1.45 }}>
                  Matches <strong style={{ color: '#2E5BFF' }}>{impact.columns} columns</strong> across{' '}
                  <strong style={{ color: '#2E5BFF' }}>{impact.tables} tables</strong> when applied on export.
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#9AA3B2', lineHeight: 1.45 }}>Impact can't be estimated until the rule is valid.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 24px', borderTop: '1px solid #EAEDF2', background: '#fff' }}>
        {valid
          ? <span style={{ fontSize: 12, color: '#8A93A5', display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A37B' }} />Validated · draft not saved</span>
          : <span style={{ fontSize: 12, color: '#C0392B', display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D6455D' }} />{errCount || '—'} error{errCount === 1 ? '' : 's'} · can't save yet</span>}
        <span style={{ flex: 1 }} />
        <button onClick={onBack} style={ghostBtn}>Discard</button>
        <button onClick={doSave} disabled={!canEdit || !valid || !draft.name.trim() || saving}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 20px', border: 'none', background: (!canEdit || !valid || !draft.name.trim()) ? '#EAECF1' : '#2E5BFF', color: (!canEdit || !valid || !draft.name.trim()) ? '#A9B1BE' : '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: (!canEdit || !valid || !draft.name.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: valid && canEdit ? '0 1px 2px rgba(46,91,255,0.35)' : 'none' }}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save rule'}
        </button>
      </div>
    </div>
  );
}

// ── sub-editores de action ─────────────────────────────────────────────────

function RuleAction({ action, actionKind, canEdit, target, onChange }: {
  action: Record<string, unknown>;
  actionKind: 'expression' | 'tags' | 'tblproperties' | 'layout' | 'emit';
  canEdit: boolean;
  /** Doc 73: «Column layout» sólo existe para reglas de TABLA (sobre la física). */
  target: 'column' | 'table';
  onChange: (a: Record<string, unknown>) => void;
}) {
  const [kind, setKind] = useState<'expression' | 'tags' | 'tblproperties' | 'layout'>(actionKind === 'emit' ? 'expression' : actionKind);
  const layout = (action.layout as { partitionColumns?: string } | undefined) ?? {};
  const pairs = (k: 'tags' | 'tblproperties') =>
    Object.entries((action[k] as Record<string, string>) ?? {});
  const setPairs = (k: 'tags' | 'tblproperties', entries: [string, string][]) =>
    onChange({ [k]: Object.fromEntries(entries.filter(([a]) => a.trim())) });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ ...lbl, marginBottom: 0 }}>Action</label>
        <div style={{ flex: 1 }} />
        <Segmented small options={[['expression', 'Expression'], ['tags', 'Tags'], ['tblproperties', 'Properties'],
          ...(target === 'table' ? [['layout', 'Column layout'] as [string, string]] : [])]}
          value={kind} disabled={!canEdit}
          onPick={(v) => {
            setKind(v as typeof kind);
            onChange(v === 'expression' ? { expression: (action.expression as string) ?? '', alias: (action.alias as string) ?? '{columna.nombre}' }
              : v === 'tags' ? { tags: (action.tags as object) ?? {} }
                : v === 'layout' ? { layout: (action.layout as object) ?? { partitionColumns: 'last' } }
                  : { tblproperties: (action.tblproperties as object) ?? {} });
          }} />
      </div>
      {kind === 'layout' ? (
        <div style={{ border: '1px solid #E2E6EE', borderRadius: 9, padding: 10, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ ...lbl, marginBottom: 0, flex: 'none' }}>Partition columns</label>
            <select value={layout.partitionColumns ?? 'last'} disabled={!canEdit}
              onChange={(e) => onChange({ layout: { ...layout, partitionColumns: e.target.value } })}
              style={{ ...inp, height: 32, fontSize: 12, flex: 1 }}>
              <option value="last">Emit at the end of the CREATE TABLE</option>
              <option value="keep">Keep the physical order</option>
            </select>
          </div>
          <div style={{ fontSize: 11, color: '#8A93A5', marginTop: 8, lineHeight: 1.45 }}>
            Applies to every physical table of the export (leave the condition empty). The model’s physical
            order, the PARTITIONED BY clause and the PRIMARY KEY don’t change; generated tables already emit
            their partition columns last.
          </div>
        </div>
      ) : kind === 'expression' ? (
        <>
          <input value={(action.expression as string) ?? ''} disabled={!canEdit} spellCheck={false}
            onChange={(e) => onChange({ ...action, expression: e.target.value })}
            placeholder="sha2({col}, 512)"
            style={{ ...inp, fontFamily: 'var(--mono, monospace)' }} />
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '8px 0 16px' }}>
            <span style={{ fontSize: 11, color: '#9AA3B2', fontWeight: 600, marginRight: 2 }}>Insert</span>
            {['{col}', '{columna.nombre}', '{columna.tipo}', '{tabla.nombre}', '{tabla.esquema}'].map((t) => (
              <button key={t} disabled={!canEdit}
                onClick={() => onChange({ ...action, expression: `${(action.expression as string) ?? ''}${t}` })}
                style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: '#56607A', background: '#F2F4F8', border: '1px solid #E6EAF0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                {t}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div style={{ border: '1px solid #E2E6EE', borderRadius: 9, padding: 10, marginBottom: 16 }}>
          {pairs(kind).map(([k, v], i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={k} disabled={!canEdit} placeholder="key"
                onChange={(e) => { const es = pairs(kind); es[i] = [e.target.value, v]; setPairs(kind, es); }}
                style={{ ...inp, height: 32, fontSize: 12, fontFamily: 'var(--mono, monospace)', flex: 1 }} />
              <input value={v} disabled={!canEdit} placeholder="{udp:…} · {lookup:…} · text"
                onChange={(e) => { const es = pairs(kind); es[i] = [k, e.target.value]; setPairs(kind, es); }}
                style={{ ...inp, height: 32, fontSize: 12, fontFamily: 'var(--mono, monospace)', flex: 1.4 }} />
              {canEdit && <button onClick={() => setPairs(kind, pairs(kind).filter((_, j) => j !== i))}
                style={{ border: 'none', background: 'transparent', color: '#B6BECD', cursor: 'pointer' }}><X size={13} /></button>}
            </div>
          ))}
          {canEdit && (
            <button onClick={() => setPairs(kind, [...pairs(kind), ['', '']])}
              style={{ height: 28, padding: '0 10px', border: '1px dashed #C9D2E0', background: '#fff', color: '#8A93A5', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              + Add pair
            </button>
          )}
        </div>
      )}
    </>
  );
}

const STRIP_OPTS = ['not_null', 'pk', 'fk', 'default', 'check'] as const;

function EmitAction({ action, canEdit, onChange }: {
  action: Record<string, unknown>; canEdit: boolean; onChange: (a: Record<string, unknown>) => void;
}) {
  const emit = (action.emit as Record<string, unknown>) ?? {};
  const setEmit = (p: Record<string, unknown>) => onChange({ emit: { ...emit, ...p } });
  const cols = (emit.columns as Record<string, unknown>) ?? { inherit: 'all' };
  const setCols = (p: Record<string, unknown>) =>
    setEmit({ columns: { inherit: cols.inherit ?? 'all', ...cols, ...p } });
  const strip = Array.isArray(cols.strip) ? (cols.strip as string[]) : [];
  const added = (emit.add_columns as { name: string; type: string }[]) ?? [];
  const setAdded = (list: { name: string; type: string }[]) => setEmit({ add_columns: list });
  const isTable = ((emit.type as string) ?? 'table') === 'table';
  return (
    <div style={{ border: '1px solid #E2E6EE', borderRadius: 9, padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1.4 }}>
          <label style={lbl}>Emits artifact</label>
          <input value={(emit.artifact as string) ?? ''} disabled={!canEdit} placeholder="ddl.tabla_rej"
            onChange={(e) => setEmit({ artifact: e.target.value })}
            style={{ ...inp, height: 34, fontSize: 12, fontFamily: 'var(--mono, monospace)' }} />
        </div>
        <div style={{ flex: 0.7 }}>
          <label style={lbl}>As</label>
          <select value={(emit.type as string) ?? 'table'} disabled={!canEdit}
            onChange={(e) => setEmit({ type: e.target.value })}
            style={{ ...inp, height: 34, fontSize: 12, cursor: 'pointer' }}>
            <option value="table">table</option>
            <option value="view">view</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Schema</label>
          <input value={(emit.schema as string) ?? ''} disabled={!canEdit} placeholder="{tabla.esquema}_v"
            onChange={(e) => setEmit({ schema: e.target.value })}
            style={{ ...inp, height: 34, fontSize: 12, fontFamily: 'var(--mono, monospace)' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Name</label>
          <input value={(emit.name as string) ?? ''} disabled={!canEdit} placeholder="{tabla.nombre}_rej"
            onChange={(e) => setEmit({ name: e.target.value })}
            style={{ ...inp, height: 34, fontSize: 12, fontFamily: 'var(--mono, monospace)' }} />
        </div>
        {isTable && (
          <div style={{ flex: 0.8 }}>
            <label style={lbl}>Force type</label>
            <input value={(cols.force_type as string) ?? ''} disabled={!canEdit} placeholder="STRING"
              onChange={(e) => setCols({ force_type: e.target.value || undefined })}
              style={{ ...inp, height: 34, fontSize: 12, fontFamily: 'var(--mono, monospace)' }} />
          </div>
        )}
      </div>

      {isTable && (
        <>
          <label style={lbl}>Strip from inherited columns</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {STRIP_OPTS.map((s) => {
              const on = strip.includes(s);
              return (
                <button key={s} disabled={!canEdit}
                  onClick={() => setCols({ strip: on ? strip.filter((x) => x !== s) : [...strip, s] })}
                  style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, padding: '3px 9px', borderRadius: 999, border: `1px solid ${on ? '#D4E0FF' : '#E6EAF0'}`, background: on ? '#EAF0FF' : '#fff', color: on ? '#2E5BFF' : '#8A93A5', cursor: canEdit ? 'pointer' : 'default', fontWeight: 600 }}>
                  {s}
                </button>
              );
            })}
          </div>

          <label style={lbl}>Added columns · appended after the inherited ones, before any partition column</label>
          <div style={{ border: '1px solid #EAEDF2', borderRadius: 8, padding: 8, marginBottom: 4 }}>
            {added.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input value={c.name} disabled={!canEdit} placeholder="TIPREJECT"
                  onChange={(e) => setAdded(added.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  style={{ ...inp, height: 30, fontSize: 12, fontFamily: 'var(--mono, monospace)', flex: 1.4 }} />
                <input value={c.type} disabled={!canEdit} placeholder="STRING"
                  onChange={(e) => setAdded(added.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                  style={{ ...inp, height: 30, fontSize: 12, fontFamily: 'var(--mono, monospace)', flex: 0.8 }} />
                {canEdit && (
                  <button onClick={() => setAdded(added.filter((_, j) => j !== i))} aria-label="Remove column"
                    style={{ border: 'none', background: 'transparent', color: '#B6BECD', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><X size={13} /></button>
                )}
              </div>
            ))}
            {added.length === 0 && (
              <div style={{ fontSize: 11.5, color: '#9AA3B2', padding: '2px 2px 6px' }}>No added columns.</div>
            )}
            {canEdit && (
              <button onClick={() => setAdded([...added, { name: '', type: 'STRING' }])}
                style={{ height: 26, padding: '0 10px', border: '1px dashed #C9D2E0', background: '#fff', color: '#8A93A5', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Add column
              </button>
            )}
          </div>
        </>
      )}
      <div style={{ fontSize: 11, color: '#9AA3B5' }}>
        Inherits {String(cols.inherit ?? 'all')} columns from the source
        {isTable ? ' — partitions, USING, LOCATION and identifier casing mirror the physical CREATE on export.' : '.'}
      </div>
    </div>
  );
}

function Segmented({ options, value, onPick, disabled, small }: {
  options: [string, string][]; value: string; onPick: (v: string) => void; disabled?: boolean; small?: boolean;
}) {
  return (
    <div style={{ display: 'flex', background: '#EFF1F5', border: '1px solid #E4E8EF', borderRadius: 9, padding: 3 }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => !disabled && onPick(v)} disabled={disabled}
          style={{ flex: 1, height: small ? 26 : 32, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: small ? '0 10px' : undefined, border: 'none', background: value === v ? '#fff' : 'transparent', color: value === v ? '#1A2B4A' : '#A9B1BE', borderRadius: 7, fontSize: small ? 11.5 : 12.5, fontWeight: value === v ? 600 : 500, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', boxShadow: value === v ? '0 1px 2px rgba(16,27,48,0.06)' : 'none', whiteSpace: 'nowrap' }}>
          {label}
        </button>
      ))}
    </div>
  );
}

const DEFAULT_CHECKS = [
  'Condition syntax', 'UDP exists in catalog', 'Value allowed for UDP',
  'Expression syntax (Databricks)', 'Placeholders resolved',
].map((name) => ({ name, ok: null as boolean | null, detail: '' }));

const cap: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 6 };
const inp: React.CSSProperties = { width: '100%', height: 40, border: '1px solid #E2E6EE', borderRadius: 9, padding: '0 12px', fontSize: 13, color: '#1A2B4A', background: '#fff', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
const ghostBtn: React.CSSProperties = { height: 40, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 18px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
