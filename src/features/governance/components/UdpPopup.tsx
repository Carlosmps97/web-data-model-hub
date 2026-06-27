import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Columns3, Table2, Wand2, Info, Check } from 'lucide-react';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Badge, { type BadgeTone } from '@/components/ui/Badge';
import * as naming from '@/services/naming.service';
import type { UdpScope, WordType, Separator, Casing, DictTerm, NamingRule } from '@/services/naming.service';

// Screen 08a/08b — UDP popup. Per-column / per-table naming standards that
// physicalize logical names. Terms + config are GLOBAL (not part of a publish):
// any change re-physicalizes existing names model-wide (R5 retroactive).

const SEP_OPTS: { value: Separator; label: string }[] = [
  { value: '_', label: '_ underscore' },
  { value: '', label: '(none) · join' },
  { value: '-', label: '- dash' },
];
const CASE_OPTS: { value: Casing; label: string }[] = [
  { value: 'upper', label: 'UPPER' },
  { value: 'lower', label: 'lower' },
  { value: 'camel', label: 'camel' },
];
const WORD_TYPES: { value: WordType; label: string; tone: BadgeTone }[] = [
  { value: 'prime', label: 'prime', tone: 'blue' },
  { value: 'class', label: 'class', tone: 'green' },
  { value: 'modifier', label: 'modifier', tone: 'purple' },
];
const wordTone = (w?: WordType): BadgeTone => WORD_TYPES.find((t) => t.value === w)?.tone ?? 'neutral';

const SAMPLE: Record<UdpScope, string> = { column: 'monto deuda dolares', table: 'cuenta riesgo' };

type FormState = { term: string; abbrev: string; wordType: WordType };
const EMPTY_FORM: FormState = { term: '', abbrev: '', wordType: 'prime' };

export default function UdpPopup({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const [scope, setScope] = useState<UdpScope>('column');
  const [rule, setRule] = useState<NamingRule>({ separator: '_', case: 'upper' });
  const [terms, setTerms] = useState<DictTerm[]>([]);
  const [busy, setBusy] = useState(false);

  // editor row state
  const [editing, setEditing] = useState<DictTerm | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);

  // live preview
  const [probe, setProbe] = useState(SAMPLE.column);
  const [physical, setPhysical] = useState('');

  // ── loaders ──
  const loadConfig = useCallback(async (sc: UdpScope) => {
    try {
      const cfg = await naming.getNamingConfig();
      setRule(cfg[sc]);
    } catch {
      // sensible per-scope defaults if settings endpoint is unavailable
      setRule(sc === 'table' ? { separator: '', case: 'upper' } : { separator: '_', case: 'upper' });
    }
  }, []);
  const loadTerms = useCallback(async (sc: UdpScope) => {
    try { setTerms(await naming.listTerms(sc)); } catch { pushToast('No se pudo cargar el diccionario', 'err'); }
  }, [pushToast]);

  // on scope change: reset editor, reload config + terms + sample, recompute preview
  useEffect(() => {
    setOpen(false); setEditing(null); setForm(EMPTY_FORM);
    setProbe(SAMPLE[scope]);
    loadConfig(scope); loadTerms(scope);
  }, [scope, loadConfig, loadTerms]);

  // ── live preview (debounced); re-runs when probe / scope / terms / rule change ──
  const probeRef = useRef(probe);
  probeRef.current = probe;
  useEffect(() => {
    const t = probeRef.current.trim();
    if (!t) { setPhysical(''); return; }
    const h = setTimeout(async () => {
      try { setPhysical((await naming.physicalize(t, scope)).physical); } catch { /* keep last */ }
    }, 250);
    return () => clearTimeout(h);
  }, [probe, scope, terms, rule]);

  // ── retroactive global propagation after any term/config change ──
  const propagate = useCallback(async () => {
    try {
      const { updated } = await naming.rephysicalize(scope);
      pushToast(`Actualizado ${updated} nombre${updated === 1 ? '' : 's'}`);
    } catch { /* propagation is best-effort; the change itself already saved */ }
  }, [scope, pushToast]);

  // ── config controls: PUT then rephysicalize(scope) ──
  const changeRule = async (patch: Partial<NamingRule>) => {
    const next = { ...rule, ...patch };
    setRule(next); // optimistic so the preview updates immediately
    setBusy(true);
    try {
      await naming.setNamingConfig(scope, next);
      await propagate();
    } catch { pushToast('No se pudo guardar la configuración', 'err'); await loadConfig(scope); }
    finally { setBusy(false); }
  };

  // ── term CRUD ──
  const startNew = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); };
  const startEdit = (a: DictTerm) => { setEditing(a); setForm({ term: a.term, abbrev: a.abbrev, wordType: a.wordType ?? 'prime' }); setOpen(true); };
  const saveTerm = async () => {
    if (!form.term.trim() || !form.abbrev.trim()) { pushToast('Término y abreviatura son obligatorios', 'err'); return; }
    const body = { term: form.term.trim(), abbrev: form.abbrev.trim(), scope, wordType: form.wordType };
    setBusy(true);
    try {
      if (editing) await naming.updateTerm(editing.id, body); else await naming.createTerm(body);
      setOpen(false); setEditing(null); setForm(EMPTY_FORM);
      await loadTerms(scope);
      await propagate();
    } catch { pushToast('No se pudo guardar el término', 'err'); }
    finally { setBusy(false); }
  };
  const removeTerm = async (a: DictTerm) => {
    if (!confirm(`¿Eliminar "${a.term} → ${a.abbrev}"?`)) return;
    setBusy(true);
    try { await naming.deleteTerm(a.id); await loadTerms(scope); await propagate(); }
    catch { pushToast('No se pudo eliminar', 'err'); }
    finally { setBusy(false); }
  };

  return (
    <div className="udp">
      {/* scope toggle */}
      <div className="udp-top">
        <SegmentedControl<UdpScope>
          aria-label="UDP scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'column', label: 'Per column', icon: Columns3 },
            { value: 'table', label: 'Per table', icon: Table2 },
          ]}
        />
        <span className="udp-hint"><Info size={13} strokeWidth={1.7} aria-hidden />Cambios globales — no entran en el publish.</span>
      </div>

      {/* separator + case */}
      <div className="udp-rules">
        <div className="udp-field">
          <label className="udp-lbl">Separator</label>
          <SegmentedControl<Separator>
            aria-label="Separator"
            value={rule.separator}
            onChange={(v) => changeRule({ separator: v })}
            options={SEP_OPTS}
          />
        </div>
        <div className="udp-field">
          <label className="udp-lbl">Case</label>
          <SegmentedControl<Casing>
            aria-label="Case"
            value={rule.case}
            onChange={(v) => changeRule({ case: v })}
            options={CASE_OPTS}
          />
        </div>
      </div>

      {/* live preview */}
      <div className="udp-preview">
        <Wand2 size={15} strokeWidth={1.7} className="udp-preview-ico" aria-hidden />
        <input
          className="udp-preview-in"
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder={SAMPLE[scope]}
          aria-label="Logical name preview"
        />
        <span className="udp-preview-arrow" aria-hidden>→</span>
        <span className="udp-preview-out">{physical || '—'}</span>
      </div>

      {/* terms table */}
      <div className="udp-tablehead">
        <span className="udp-section">Terms <span className="udp-count">{terms.length}</span></span>
        <button type="button" className="udp-add" onClick={startNew} disabled={busy}>
          <Plus size={14} strokeWidth={2.2} aria-hidden />Add term
        </button>
      </div>

      {open && (
        <div className="udp-editor">
          <input className="udp-in" placeholder="Term (e.g. monto)" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} autoFocus />
          <input className="udp-in udp-mono" placeholder="Abbrev (e.g. MTO)" value={form.abbrev} onChange={(e) => setForm({ ...form, abbrev: e.target.value })} />
          <SegmentedControl<WordType>
            aria-label="Word type"
            value={form.wordType}
            onChange={(v) => setForm({ ...form, wordType: v })}
            options={WORD_TYPES.map((w) => ({ value: w.value, label: w.label }))}
          />
          <div className="udp-editor-actions">
            <button type="button" className="udp-btn udp-btn-ghost" onClick={() => { setOpen(false); setEditing(null); }} disabled={busy}>Cancel</button>
            <button type="button" className="udp-btn udp-btn-primary" onClick={saveTerm} disabled={busy}><Check size={13} strokeWidth={2.4} aria-hidden />{editing ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}

      <div className="udp-table">
        <div className="udp-tr udp-tr-head">
          <span>Term</span><span>Abbrev</span><span>Word type</span><span aria-hidden />
        </div>
        {terms.map((a) => (
          <div className="udp-tr" key={a.id}>
            <span className="udp-term">{a.term}</span>
            <span className="udp-mono udp-abbr">{a.abbrev}</span>
            <span><Badge tone={wordTone(a.wordType)}>{a.wordType ?? 'prime'}</Badge></span>
            <span className="udp-row-actions">
              <button type="button" className="udp-iconbtn" onClick={() => startEdit(a)} aria-label="Edit term" disabled={busy}><Pencil size={13} strokeWidth={1.8} /></button>
              <button type="button" className="udp-iconbtn udp-iconbtn-danger" onClick={() => removeTerm(a)} aria-label="Delete term" disabled={busy}><Trash2 size={13} strokeWidth={1.8} /></button>
            </span>
          </div>
        ))}
        {terms.length === 0 && (
          <div className="udp-empty">No terms for {scope === 'column' ? 'columns' : 'tables'} yet. Add one (e.g. "monto → MTO").</div>
        )}
      </div>
    </div>
  );
}
