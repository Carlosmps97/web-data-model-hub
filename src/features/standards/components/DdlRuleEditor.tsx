/**
 * Editor de una regla del Export DDL: nombre, descripción, «For each» (cada
 * tabla o cada vista del export), «When» (condición Jinja opcional), los
 * archivos que escribe (nombre y contenido son plantillas Jinja; un contenido
 * vacío no genera el archivo) y si está activa. Valida en vivo (errores con su
 * campo y línea) y muestra la vista previa con una tabla real del catálogo:
 * corre la lista completa con esta regla en su lugar, así se ve qué archivos
 * salen, qué regla escribió cada uno y cuáles reemplaza. Al lado, la referencia
 * de datos y funciones. Guardar registra una versión de Data Standards.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, SegmentedControl } from '@/components/ui';
import { confirmDialog } from '@/components/ui/dialogs';
import { udpView } from '@/lib/facets';
import { ruleErrorText, type RenderedExport, type RulesPayload } from '@/features/ddl';

import {
  deleteDdlRule, previewDdlRules, previewPayloadFor, saveDdlRule, searchPreviewTables, toEditInput, validateDdlRule,
  type DdlPreviewTable, type DdlValidation,
} from '../ddlRules.service';
import { RULE_REFERENCE, ruleCompletions } from '../ddlRuleReference';
import type { DdlRule, DdlRuleEditInput, DdlRuleScope, DdlRulesetConfig, UdpDefinition } from '../standards.service';
import { applyErrorNotice, NO_CHANGES_HINT, ruleChanged } from '../standardsDiff';
import CodeEditor from './CodeEditor';
import { sortRules } from './DdlRuleList';

const SCOPES: { value: DdlRuleScope; label: string }[] = [{ value: 'table', label: 'Each table' }, { value: 'view', label: 'Each view' }];

/** Una regla nueva: debajo de todas (las posiciones no son correlativas tras
 *  un borrado), con un archivo por tabla. */
export const newRuleDraft = (rules: DdlRule[]): DdlRuleEditInput => ({
  name: '', description: '', scope: 'table', when: '', enabled: true,
  order: rules.length ? Math.max(...rules.map((r) => r.order)) + 1 : 0,
  files: [{ name: '{{ tabla.carpeta }}/TABLE-{{ tabla.nombre | upper }}.sql', content: '' }],
});

/** La lista que corre la vista previa: las reglas guardadas en orden, con la
 *  regla en edición en su lugar (activa aunque esté apagada, para verla). Pura. */
export function previewRules(rules: DdlRule[], draft: DdlRuleEditInput): DdlRuleEditInput[] {
  const shown = { ...draft, enabled: true };
  const sorted = sortRules(rules);
  const others = sorted.filter((r) => r.id !== draft.id).map(toEditInput);
  const at = draft.id ? sorted.findIndex((r) => r.id === draft.id) : others.filter((r) => r.order <= draft.order).length;
  return [...others.slice(0, Math.max(0, at)), shown, ...others.slice(Math.max(0, at))];
}

type PreviewState = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; out: RenderedExport } | { state: 'error'; text: string };

export default function DdlRuleEditor({ projectId, rule, rules, config, udpDefs, canEdit, canPreview, onBack, onSaved }: {
  projectId: string;
  rule: DdlRule | null;
  rules: DdlRule[];
  config: DdlRulesetConfig;
  udpDefs: UdpDefinition[];
  canEdit: boolean;
  /** La vista previa es el DDL del export: requiere el permiso `export`. */
  canPreview: boolean;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const isNew = !rule;
  const [draft, setDraft] = useState<DdlRuleEditInput>(() => (rule ? toEditInput(rule) : newRuleDraft(rules)));
  // Clave estable de cada archivo: al quitar uno, cada editor sigue con su texto.
  const [fileKeys, setFileKeys] = useState<number[]>(() => draft.files.map((_, i) => i));
  const nextKey = useRef(draft.files.length);
  // La última tabla elegida para la vista previa (una respuesta anterior no la pisa).
  const pickSeq = useRef(0);
  const [validation, setValidation] = useState<DdlValidation | null>(null);
  const [saving, setSaving] = useState(false);
  const [side, setSide] = useState<'preview' | 'reference'>('preview');
  const [tableQ, setTableQ] = useState('');
  const [tableHits, setTableHits] = useState<DdlPreviewTable[]>([]);
  const [table, setTable] = useState<DdlPreviewTable | null>(null);
  const [payload, setPayload] = useState<RulesPayload | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ state: 'idle' });

  const patch = (p: Partial<DdlRuleEditInput>) => setDraft((d) => ({ ...d, ...p }));
  const patchFile = (i: number, p: Partial<DdlRuleEditInput['files'][number]>) =>
    setDraft((d) => ({ ...d, files: d.files.map((f, j) => (j === i ? { ...f, ...p } : f)) }));

  const dirty = ruleChanged(draft, rule);
  const errors = validation?.errors ?? [];
  const errorsOf = (field: string) => errors.filter((e) => e.field === field);
  const udpNames = useMemo(
    () => [...new Set(udpDefs.filter((d) => udpView(d) === 'physical').map((d) => d.name))].sort(),
    [udpDefs],
  );
  const completions = useMemo(() => ruleCompletions(config.pieces ?? '', config.variables ?? {}), [config.pieces, config.variables]);
  const runList = useMemo(() => previewRules(rules, draft), [rules, draft]);

  // Validación en vivo (no guarda): errores con su campo y línea, y avisos.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      validateDdlRule(projectId, draft)
        .then((v) => { if (alive) setValidation(v); })
        .catch(() => { if (alive) setValidation(null); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [projectId, draft]);

  // Buscador de tablas del catálogo para la vista previa.
  useEffect(() => {
    if (table) return;
    let alive = true;
    const t = setTimeout(() => {
      searchPreviewTables(projectId, tableQ)
        .then((hits) => { if (alive) setTableHits(hits); })
        .catch(() => { if (alive) setTableHits([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [projectId, tableQ, table]);

  const pickTable = (t: DdlPreviewTable) => {
    const seq = ++pickSeq.current;
    setTable(t); setPayload(null); setPreview({ state: 'loading' });
    previewPayloadFor(t.id)
      .then((p) => { if (pickSeq.current === seq) setPayload(p); })
      .catch((e) => {
        if (pickSeq.current === seq) setPreview({ state: 'error', text: e instanceof Error && e.message ? e.message : "Couldn't read the table" });
      });
  };
  const changeTable = () => { pickSeq.current += 1; setTable(null); setPayload(null); setPreview({ state: 'idle' }); };
  const addFile = () => {
    patch({ files: [...draft.files, { name: '', content: '' }] });
    setFileKeys((k) => [...k, nextKey.current++]);
  };
  const removeFile = (i: number) => {
    patch({ files: draft.files.filter((_, j) => j !== i) });
    setFileKeys((k) => k.filter((_, j) => j !== i));
  };

  // Vista previa: la lista completa con esta regla en su lugar, sobre la tabla elegida.
  useEffect(() => {
    if (!payload) return;
    let alive = true;
    const t = setTimeout(() => {
      setPreview({ state: 'loading' });
      previewDdlRules(projectId, { rules: runList, pieces: config.pieces ?? '', variables: config.variables ?? {}, payload })
        .then((out) => { if (alive) setPreview({ state: 'ok', out }); })
        .catch((e) => {
          if (alive) setPreview({ state: 'error', text: ruleErrorText(e) ?? (e instanceof Error && e.message ? e.message : "Couldn't run the preview") });
        });
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [projectId, payload, runList, config.pieces, config.variables]);

  /** Tras guardar o borrar, vuelve a la lista con los estándares recargados;
   *  si la recarga falla, lo guardado ya quedó y se avisa aparte. */
  const reload = async () => {
    try { await onSaved(); } catch { toast.error("Saved, but couldn't reload the standards — reopen the tab"); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveDdlRule(projectId, { ...draft, name: draft.name.trim() }, isNew);
    } catch (e) {
      const n = applyErrorNotice(e, "Couldn't save the rule"); toast[n.kind](n.text);
      setSaving(false);
      return;
    }
    toast.success(isNew ? 'Rule added' : 'Rule saved');
    await reload();
    setSaving(false);
  };

  const remove = async () => {
    if (!rule) return;
    const ok = await confirmDialog({
      title: `Delete rule ${rule.name}?`, message: 'Its files stop being generated. The change is recorded as a version (rollback available).',
      confirmLabel: 'Delete', variant: 'danger', initialFocus: 'cancel',
      action: () => deleteDdlRule(projectId, rule),
    }).catch((e) => { const n = applyErrorNotice(e, "Couldn't delete the rule"); toast[n.kind](n.text); return false; });
    if (ok) { toast.success('Rule deleted'); await reload(); }
  };

  const canSave = canEdit && dirty && !saving && errors.length === 0 && draft.name.trim() !== '';

  return (
    <div style={{ padding: '22px 34px', background: '#FBFCFD', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', padding: 0, fontSize: 12, fontWeight: 600, color: '#8A93A5', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 4 }}>
            <ChevronLeft size={13} /> DDL export rules
          </button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1A2B4A', letterSpacing: '-0.01em', fontFamily: draft.name ? 'var(--mono, monospace)' : undefined }}>
            {draft.name.trim() || (isNew ? 'New rule' : rule?.name)}
          </h1>
        </div>
        {!isNew && canEdit && <Button variant="danger" icon={Trash2} onClick={remove} disabled={saving}>Delete</Button>}
        <Button variant="secondary" onClick={onBack}>{canEdit ? 'Cancel' : 'Back'}</Button>
        {canEdit && (
          <Button onClick={save} disabled={!canSave} title={dirty ? undefined : NO_CHANGES_HINT}>
            {saving ? 'Saving…' : isNew ? 'Add rule' : 'Save rule'}
          </Button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        {/* ── La regla ── */}
        <div style={card}>
          {(validation?.warnings ?? []).map((w) => (
            <div key={w} style={{ fontSize: 12, color: '#8A6D1F', background: '#FFF8E6', border: '1px solid #F3E2B3', borderRadius: 9, padding: '8px 11px', marginBottom: 12 }}>{w}</div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" errors={errorsOf('name')}>
              <input className="rd-input" style={input} value={draft.name} disabled={!canEdit} placeholder="tabla_fisica"
                onChange={(e) => patch({ name: e.target.value })} aria-label="Rule name" />
            </Field>
            <Field label="For each" errors={errorsOf('scope')}>
              <SegmentedControl options={SCOPES} value={draft.scope} aria-label="For each"
                onChange={(v) => { if (canEdit) patch({ scope: v }); }} />
            </Field>
          </div>
          <Field label="Description">
            <input className="rd-input" style={input} value={draft.description ?? ''} disabled={!canEdit}
              placeholder="What the rule writes, in one line" onChange={(e) => patch({ description: e.target.value })} aria-label="Description" />
          </Field>
          <Field label="When" hint="Optional Jinja condition; empty = always." errors={errorsOf('when')}>
            <CodeEditor singleLine expression value={draft.when} readOnly={!canEdit} onChange={(v) => patch({ when: v })}
              completions={completions} udpNames={udpNames} ariaLabel="When"
              placeholder={draft.scope === 'view' ? 'vista.en_canvas' : "tabla.udp['Clasificacion del Dato'] == 'DAC'"} />
          </Field>

          <div style={{ display: 'flex', alignItems: 'center', margin: '18px 0 8px' }}>
            <span style={{ ...lbl, flex: 1 }}>Files</span>
            {canEdit && (
              <Button variant="secondary" size="sm" icon={Plus} onClick={addFile}>Add file</Button>
            )}
          </div>
          {errorsOf('files').map((e) => <ErrorLine key={e.message} line={e.line} message={e.message} />)}
          {draft.files.map((f, i) => (
            <div key={fileKeys[i] ?? `f${i}`} style={{ border: '1px solid #EAEDF2', borderRadius: 10, padding: 12, marginBottom: 10, background: '#FCFDFE' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#56607A', flex: 1 }}>File {i + 1}</span>
                {canEdit && draft.files.length > 1 && (
                  <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove file ${i + 1}`} title="Remove file"
                    onClick={() => removeFile(i)} />
                )}
              </div>
              <Field label="Name" hint="Path in the .zip; Jinja allowed." errors={errorsOf(`files[${i}].name`)}>
                <CodeEditor singleLine value={f.name} readOnly={!canEdit} onChange={(v) => patchFile(i, { name: v })}
                  completions={completions} udpNames={udpNames} ariaLabel={`File ${i + 1} name`} />
              </Field>
              <Field label="Content" hint="The DDL of the file; when it comes out empty the file is not generated." errors={errorsOf(`files[${i}].content`)}>
                <CodeEditor value={f.content} readOnly={!canEdit} onChange={(v) => patchFile(i, { content: v })} minHeight={160}
                  completions={completions} udpNames={udpNames} ariaLabel={`File ${i + 1} content`} />
              </Field>
            </div>
          ))}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#3A4658', marginTop: 6 }}>
            <input type="checkbox" checked={draft.enabled} disabled={!canEdit} onChange={(e) => patch({ enabled: e.target.checked })} />
            Active — runs on export
          </label>
        </div>

        {/* ── Vista previa y referencia ── */}
        <div style={card}>
          <div className="wk-pp-tabs exd-tabs" role="tablist" style={{ marginBottom: 12 }}>
            <button type="button" role="tab" aria-selected={side === 'preview'} className={`wk-pp-tab${side === 'preview' ? ' active' : ''}`} onClick={() => setSide('preview')}>Preview</button>
            <button type="button" role="tab" aria-selected={side === 'reference'} className={`wk-pp-tab${side === 'reference' ? ' active' : ''}`} onClick={() => setSide('reference')}>Reference</button>
          </div>
          {side === 'reference' ? <Reference /> : !canPreview ? (
            <div style={{ fontSize: 12.5, color: '#6B7689', lineHeight: 1.5 }}>
              The preview writes the same DDL as the export, so it needs the export permission.
            </div>
          ) : (
            <>
              {table ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12.5, fontWeight: 600, color: '#1A2B4A', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {table.schema ? `${table.schema}.` : ''}{table.physicalName}
                  </span>
                  <Button variant="secondary" size="sm" onClick={changeTable}>Change table</Button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', background: '#fff', border: '1px solid #E2E6EE', borderRadius: 9, marginBottom: 6 }}>
                    <Search size={14} color="#9AA3B2" />
                    <input value={tableQ} onChange={(e) => setTableQ(e.target.value)} placeholder="Pick a table of the catalog to preview…" aria-label="Preview table"
                      style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12.5, background: 'transparent', fontFamily: 'inherit' }} />
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #F0F2F6', borderRadius: 9 }}>
                    {tableHits.map((t) => (
                      <button key={t.id} type="button" onClick={() => pickTable(t)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid #F4F6F9', background: '#fff', padding: '7px 10px', cursor: 'pointer', fontFamily: 'var(--mono, monospace)', fontSize: 12, color: '#1A2B4A' }}>
                        {t.schema ? `${t.schema}.` : ''}{t.physicalName}
                      </button>
                    ))}
                    {tableHits.length === 0 && <div style={{ padding: '10px', fontSize: 12, color: '#9AA3B2' }}>No tables.</div>}
                  </div>
                </>
              )}
              {table && <PreviewOut preview={preview} ruleName={draft.name} />}
              <p style={{ fontSize: 11, color: '#9AA3B2', margin: '10px 0 0', lineHeight: 1.5 }}>
                Runs every active rule with this one in its place (even if it is off), on the published table and its views.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewOut({ preview, ruleName }: { preview: PreviewState; ruleName: string }) {
  if (preview.state === 'idle' || preview.state === 'loading') return <div style={{ fontSize: 12, color: '#8A93A5', padding: '8px 0' }}>Running the rules…</div>;
  if (preview.state === 'error') {
    return <div style={{ fontSize: 12, color: '#B23A2E', background: '#FDF2F1', border: '1px solid #F1D9D5', borderRadius: 9, padding: '9px 11px', whiteSpace: 'pre-wrap' }}>{preview.text}</div>;
  }
  const { files, log } = preview.out;
  const mine = log.filter((e) => e.rule === ruleName);
  return (
    <div>
      {mine.map((e) => (
        <div key={`${e.status}:${e.object}:${e.path}`} style={{ fontSize: 11.5, color: '#8A6D1F', background: '#FFF8E6', borderRadius: 7, padding: '5px 9px', marginBottom: 6 }}>
          <code>{e.path}</code>{' '}
          {e.status === 'overridden' ? `is not applied for ${e.object}: ${e.by} (above) writes it`
            : e.status === 'empty' ? `came out empty for ${e.object}: not generated`
              : `renamed to ${e.to}`}
        </div>
      ))}
      {files.length === 0 && <div style={{ fontSize: 12, color: '#8A93A5', padding: '8px 0' }}>No files for this table.</div>}
      {files.map((f) => (
        <div key={f.path} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <code style={{ fontSize: 11.5, fontWeight: 600, color: '#1A2B4A', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.path}</code>
            <span style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: '2px 8px', flex: 'none', color: f.rule === ruleName ? '#2E5BFF' : '#6B7689', background: f.rule === ruleName ? '#EAF0FF' : '#F2F4F8' }}>
              {f.rule === ruleName ? 'this rule' : f.rule}
            </span>
          </div>
          <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', background: '#0F1A2E', color: '#E6ECF5', borderRadius: 9, padding: '10px 12px', fontSize: 11.5, lineHeight: 1.5 }}>{f.content}</pre>
        </div>
      ))}
    </div>
  );
}

function Reference() {
  return (
    <div style={{ maxHeight: 640, overflowY: 'auto' }}>
      {RULE_REFERENCE.map((g) => (
        <div key={g.title} style={{ marginBottom: 14 }}>
          <div style={{ ...lbl, marginBottom: 6 }}>{g.title}</div>
          {g.items.map((i) => (
            <div key={i.label} style={{ display: 'flex', gap: 10, padding: '4px 0', borderBottom: '1px solid #F4F6F9' }}>
              <code style={{ fontSize: 11.5, color: '#1A2B4A', flex: '0 0 44%', overflowWrap: 'anywhere' }}>{i.label}</code>
              <span style={{ fontSize: 11.5, color: '#6B7689', flex: 1 }}>{i.detail}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Field({ label, hint, errors = [], children }: {
  label: string; hint?: string; errors?: { line: number | null; message: string }[]; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ ...lbl, marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#9AA3B2', marginTop: 4 }}>{hint}</div>}
      {errors.map((e) => <ErrorLine key={`${e.line}:${e.message}`} line={e.line} message={e.message} />)}
    </div>
  );
}

function ErrorLine({ line, message }: { line: number | null; message: string }) {
  return <div style={{ fontSize: 11.5, color: '#B23A2E', marginTop: 4 }}>{line ? `Line ${line}: ` : ''}{message}</div>;
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '16px 18px', minWidth: 0 };
const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A93A5' };
const input: React.CSSProperties = { width: '100%', height: 34, boxSizing: 'border-box' };
