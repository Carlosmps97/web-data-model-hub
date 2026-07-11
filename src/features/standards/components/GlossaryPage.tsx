import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, Lock, Pencil, Plus, Search, ShieldCheck, Trash2, Unlock, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import type { StandardsSnapshot, SnapshotTerm, ApplyStandardsBody } from '../standards.service';
import { applyStandards } from '../standards.service';
import { validateTerm, lockTerm, unlockTerm } from '@/services/naming.service';
import type { UdpScope, WordType } from '@/services/naming.service';
import { useAuthStore } from '@/store/useAuthStore';
import { termsToValidate, conflictLines } from '../glossaryValidation';

// ── Preview físico client-side (para el edit en vivo, antes de aplicar) ──
// Réplica mínima del motor: longest-match sobre los términos del scope + case + separador.
function previewPhysical(logical: string, terms: SnapshotTerm[], sep: string, casing: string): string {
  const map = new Map(terms.map((t) => [t.term.toLowerCase(), t.abbrev]));
  const words = logical.trim().split(/\s+/).filter(Boolean);
  const maxN = Math.max(1, ...[...map.keys()].map((k) => k.split(' ').length));
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let n = Math.min(maxN, words.length - i); n >= 1; n--) {
      const phrase = words.slice(i, i + n).join(' ').toLowerCase();
      if (map.has(phrase)) { out.push(map.get(phrase)!); i += n; matched = true; break; }
    }
    if (!matched) { out.push(words[i]); i += 1; }
  }
  // Descarta segmentos vacíos (un término con abreviatura en blanco): sin esto,
  // la rama camelCase hace s[0] de un string vacío y rompe el render.
  const segs = out.filter((s) => s.length > 0);
  const cased = segs.map((s) => (casing === 'lower' ? s.toLowerCase() : s.toUpperCase()));
  return casing === 'camel'
    ? cased.map((s, idx) => (idx === 0 ? s.toLowerCase() : s[0].toUpperCase() + s.slice(1).toLowerCase())).join('')
    : cased.join(sep);
}

const WORD_TONE: Record<string, { c: string; b: string }> = {
  prime: { c: '#2E5BFF', b: '#EAF0FF' },
  class: { c: '#0E8C6A', b: '#E4F6EF' },
  modifier: { c: '#8B5CF6', b: '#F3EEFF' },
};

// _orig: término original al entrar en edición — permite detectar renombres
// de texto para validarlos antes de aplicar (F2 #1, ver termsToValidate).
type Draft = SnapshotTerm & { _new?: boolean; _deleted?: boolean; _orig?: string };

export default function GlossaryPage({ snapshot, canEdit, onApplied }: {
  snapshot: StandardsSnapshot;
  canEdit: boolean;
  onApplied: () => void;
}) {
  const [scope, setScope] = useState<UdpScope>('column');
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // F2 #1: candado admin + dialog de conflictos de validación.
  const isAdmin = useAuthStore((s) => s.has('admin.manage'));
  const [conflicts, setConflicts] = useState<{ term: string; lines: string[] } | null>(null);
  const [checking, setChecking] = useState<string | null>(null); // id de la fila validándose

  // Config editable (separador/case por scope).
  const cfg0 = snapshot.namingConfig[scope];
  const [sep, setSep] = useState<string>(String(cfg0.separator ?? '_'));
  const [casing, setCasing] = useState<string>(String(cfg0.case ?? 'upper'));

  // Borrador EDITABLE de términos (vacío hasta entrar en modo edición; la vista
  // read-only usa `snapshot.dict` directamente vía `live`).
  const [terms, setTerms] = useState<Draft[]>([]);

  // Re-sincroniza los chips read-only de separador/case al cambiar de scope
  // (cuando NO se está editando): sin esto mostraban las reglas del scope viejo.
  useEffect(() => {
    if (editing) return;
    setSep(String(snapshot.namingConfig[scope].separator ?? '_'));
    setCasing(String(snapshot.namingConfig[scope].case ?? 'upper'));
  }, [scope, editing, snapshot]);

  const enterEdit = () => {
    // Se estampa _orig al entrar en edición: si el texto del término cambia,
    // termsToValidate lo trata como renombre y también se valida al aplicar.
    setTerms(snapshot.dict.filter((t) => t.scope === scope).map((t) => ({ ...t, _orig: t.term })));
    setSep(String(snapshot.namingConfig[scope].separator ?? '_'));
    setCasing(String(snapshot.namingConfig[scope].case ?? 'upper'));
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setConfirm(false); };
  const switchScope = (s: UdpScope) => { if (editing) return; setScope(s); };

  const live: Draft[] = editing ? terms.filter((t) => !t._deleted) : snapshot.dict.filter((t) => t.scope === scope);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return !n ? live : live.filter((t) => t.term.toLowerCase().includes(n) || t.abbrev.toLowerCase().includes(n));
  }, [live, q]);

  const preview = previewPhysical('monto deuda dólares', live, editing ? sep : String(cfg0.separator ?? '_'), editing ? casing : String(cfg0.case ?? 'upper'));

  // ── Diff para el diálogo de apply ──
  const diff = useMemo(() => {
    const before = new Map(snapshot.dict.filter((t) => t.scope === scope).map((t) => [t.id, t]));
    const added: string[] = [], edited: string[] = [], removed: string[] = [];
    for (const t of terms) {
      if (t._deleted) { if (!t._new) removed.push(`${t.term} → ${t.abbrev}`); continue; }
      if (t._new) added.push(`${t.term} → ${t.abbrev}`);
      else { const b = before.get(t.id); if (b && (b.term !== t.term || b.abbrev !== t.abbrev || b.wordType !== t.wordType)) edited.push(`${t.term} → ${t.abbrev}`); }
    }
    const cfgChanged = sep !== String(cfg0.separator ?? '_') || casing !== String(cfg0.case ?? 'upper');
    if (cfgChanged) edited.push(`${scope === 'column' ? 'Column' : 'Table'} naming · sep '${sep || '(none)'}' · ${casing}`);
    return { added, edited, removed, cfgChanged, count: added.length + edited.length + removed.length };
  }, [terms, sep, casing, snapshot.dict, scope, cfg0]);

  // Validación on-demand de una fila NUEVA (botón junto al alta). El backend
  // igual re-valida al guardar: esto es cortesía de UX.
  const validateDraft = async (t: Draft) => {
    const term = t.term.trim();
    if (!term) { toast.error('Escribí el término antes de validar'); return; }
    setChecking(t.id);
    try {
      const v = await validateTerm(term, scope);
      if (v.ok) toast.success(`'${term}' no tiene conflictos`);
      else setConflicts({ term, lines: conflictLines(v) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo validar');
    } finally { setChecking(null); }
  };

  const toggleLock = async (t: SnapshotTerm) => {
    try {
      if (t.locked) await unlockTerm(t.id); else await lockTerm(t.id);
      toast.success(t.locked ? `'${t.term}' desbloqueado` : `'${t.term}' bloqueado`);
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el bloqueo');
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      // F2 #1: validación automática al guardar — cada término NUEVO se chequea
      // contra el glosario y el corpus; el primero con conflictos corta el apply
      // (dialog con la lista de dónde aparece). El backend re-valida igual.
      for (const term of termsToValidate(terms)) {
        const v = await validateTerm(term, scope);
        if (!v.ok) {
          setConflicts({ term, lines: conflictLines(v) });
          setConfirm(false);
          return;
        }
      }
      const body: ApplyStandardsBody = { kind: 'glossary' };
      // Solo se envían términos NUEVOS o realmente EDITADOS (antes se reenviaban
      // TODOS como upsert → inflaba el diff/impacto y re-derivaba de más).
      const before = new Map(snapshot.dict.filter((t) => t.scope === scope).map((t) => [t.id, t]));
      const changed = (t: Draft) => {
        if (t._new) return true;
        const b = before.get(t.id);
        return !b || b.term !== t.term || b.abbrev !== t.abbrev || (b.wordType ?? null) !== (t.wordType ?? null);
      };
      body.termsUpsert = terms
        .filter((t) => !t._deleted && changed(t))
        .map((t) => ({ id: t._new ? undefined : t.id, term: t.term.trim(), abbrev: t.abbrev.trim(), scope, wordType: t.wordType ?? undefined }))
        .filter((t) => t.term && t.abbrev);
      body.termsDelete = terms.filter((t) => t._deleted && !t._new).map((t) => t.id);
      if (diff.cfgChanged) body.namingConfig = { [scope]: { separator: sep, case: casing } };
      const v = await applyStandards(body);
      toast.success(`Standards applied · ${v.label} · ${v.impact.columns} names re-derived`);
      setEditing(false); setConfirm(false); onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo aplicar');
    } finally { setBusy(false); }
  };

  // estilos
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #E6EAF0', borderRadius: 12, padding: '16px 17px' };
  const th: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' };

  // Columnas de la grilla: en edición hay celda de acciones (validar + borrar);
  // en lectura, el admin ve la celda del candado.
  const gridCols = editing ? '1.4fr 1fr 1.3fr 76px' : isAdmin ? '1.4fr 1fr 1.3fr 40px' : '1.4fr 1fr 1.3fr';

  return (
    <div style={{ padding: '24px 34px', maxWidth: 1000 }}>
      {/* heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: '#EAF0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2E5BFF' }}><BookOpenText size={20} /></div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1A2B4A' }}>Glossary — Terms &amp; Abbreviations</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#8A93A5' }}>Naming rules and abbreviations applied to every physical name</p>
        </div>
        <div style={{ display: 'flex', background: '#EFF1F5', border: '1px solid #E4E8EF', borderRadius: 10, padding: 3 }}>
          {(['column', 'table'] as UdpScope[]).map((s) => (
            <button key={s} onClick={() => switchScope(s)} disabled={editing}
              style={{ height: 32, padding: '0 14px', border: 'none', borderRadius: 7, cursor: editing ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
                background: scope === s ? '#fff' : 'transparent', color: scope === s ? '#56607A' : '#A9B1BE', boxShadow: scope === s ? '0 1px 2px rgba(16,27,48,0.06)' : 'none' }}>
              Per {s}
            </button>
          ))}
        </div>
        {canEdit && !editing && (
          <button onClick={enterEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Pencil size={14} />Edit standards</button>
        )}
      </div>

      {/* banner */}
      <div style={{ display: 'flex', gap: 12, background: editing ? '#EAF0FF' : '#F4F6F9', border: `1px solid ${editing ? '#D4E0FF' : '#E6EAF0'}`, borderRadius: 12, padding: '12px 15px', marginBottom: 20, fontSize: 12.5, color: '#56607A', lineHeight: 1.5 }}>
        {editing
          ? <span><strong style={{ color: '#2E5BFF' }}>Edit mode.</strong> Add / edit / delete terms and change the separator or case. Nothing changes until you <strong>Save &amp; apply</strong> — then names re-derive catalog-wide.</span>
          : <span><strong style={{ color: '#3A4658' }}>Read-only view.</strong> {canEdit ? 'Click Edit standards to change rules or terms.' : 'Your role can view the naming rules but not edit them.'}</span>}
      </div>

      {/* config + preview */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{ ...card, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#56607A', marginBottom: 8 }}>Separator between terms</div>
          {editing ? (
            <select value={sep} onChange={(e) => setSep(e.target.value)} className="rd-input" style={{ height: 36 }}>
              <option value="_">_ underscore</option><option value="">(none) · join</option><option value="-">- hyphen</option>
            </select>
          ) : <div style={chip}>{sep === '' ? '(none) · join' : `${sep} ${sep === '_' ? 'underscore' : 'hyphen'}`}</div>}
          <div style={{ fontSize: 12, fontWeight: 600, color: '#56607A', margin: '15px 0 8px' }}>Upper / lower case</div>
          {editing ? (
            <select value={casing} onChange={(e) => setCasing(e.target.value)} className="rd-input" style={{ height: 36 }}>
              <option value="upper">UPPER</option><option value="lower">lower</option><option value="camel">camelCase</option>
            </select>
          ) : <div style={chip}>{casing.toUpperCase()}</div>}
        </div>
        <div style={{ width: 340, flex: 'none', background: '#1A2B4A', borderRadius: 12, padding: '16px 17px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#9DB0D6', marginBottom: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Preview · physical name</div>
          <div style={{ fontSize: 13, color: '#C7D3E8', marginBottom: 12 }}>monto deuda dólares →</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 50, background: 'rgba(255,255,255,0.08)', borderRadius: 9, fontFamily: 'var(--mono, monospace)', fontSize: 19, fontWeight: 600, color: '#fff' }}>{preview}</div>
        </div>
      </div>

      {/* terms table */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B4A' }}>Terms &amp; abbreviations</div>
        <span style={{ fontSize: 11.5, color: '#9AA3B2' }}>{live.length} terms</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 11px', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 9, width: 240 }}>
          <Search size={14} color="#9AA3B2" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms…" style={{ flex: 1, border: 0, outline: 'none', fontSize: 12.5, background: 'transparent' }} />
        </div>
        {editing && <button onClick={() => setTerms((ts) => [{ id: `new-${Date.now()}`, term: '', abbrev: '', scope, wordType: 'prime', _new: true }, ...ts])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', border: '1px solid #D4E0FF', background: '#EAF0FF', color: '#2E5BFF', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Plus size={14} />Add term</button>}
      </div>
      <div style={{ border: '1px solid #EAEDF2', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', padding: '10px 16px', ...th }}>
          <div>Term</div><div>Abbrev.</div><div>Word type</div>{(editing || isAdmin) && <div />}
        </div>
        {shown.map((t) => {
          const tone = WORD_TONE[t.wordType ?? 'prime'] ?? WORD_TONE.prime;
          const locked = Boolean(t.locked);
          return (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #F2F4F8', fontSize: 13, background: locked ? '#F1F3F6' : undefined }}>
              {editing && !locked ? <>
                <input className="rd-input" style={inp} value={t.term} onChange={(e) => upd(setTerms, t.id, { term: e.target.value })} placeholder="término" />
                <input className="rd-input" style={{ ...inp, fontFamily: 'var(--mono, monospace)' }} value={t.abbrev} onChange={(e) => upd(setTerms, t.id, { abbrev: e.target.value })} placeholder="ABR" />
                <select className="rd-input" style={inp} value={t.wordType ?? 'prime'} onChange={(e) => upd(setTerms, t.id, { wordType: e.target.value as WordType })}>
                  <option value="prime">prime</option><option value="class">class</option><option value="modifier">modifier</option>
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  {t._new && (
                    <button onClick={() => validateDraft(t)} disabled={checking === t.id} title="Validar contra glosario y catálogo"
                      style={{ width: 28, height: 28, border: '1px solid #D4E0FF', background: '#EAF0FF', borderRadius: 7, color: '#2E5BFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {checking === t.id ? <span className="rd-spin" /> : <ShieldCheck size={13} />}
                    </button>
                  )}
                  <button onClick={() => del(setTerms, t.id)} style={{ width: 28, height: 28, border: '1px solid #F1D4D4', background: '#fff', borderRadius: 7, color: '#C0392B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={13} /></button>
                </div>
              </> : <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: locked ? '#9AA3B2' : '#1A2B4A' }}>
                  {locked && <Lock size={12} color="#9AA3B2" />}{t.term}
                </div>
                <div style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 600, color: locked ? '#9AA3B2' : '#2E5BFF' }}>{t.abbrev}</div>
                <div><span style={{ fontSize: 11, fontWeight: 600, color: locked ? '#9AA3B2' : tone.c, background: locked ? '#E7EAEF' : tone.b, borderRadius: 999, padding: '3px 10px' }}>{t.wordType ?? 'prime'}</span></div>
                {editing && locked && <div />}
                {!editing && isAdmin && (
                  <button onClick={() => toggleLock(t)} title={locked ? `Bloqueado por ${t.lockedBy ?? 'ADMIN'} — desbloquear` : 'Bloquear término'}
                    style={{ width: 28, height: 28, border: '1px solid #E6EAF0', background: '#fff', borderRadius: 7, color: locked ? '#9A6B00' : '#8A93A5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                )}
              </>}
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: '#9AA3B2' }}>No hay términos que coincidan.</div>}
      </div>

      {/* footer edit actions */}
      {editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 16, borderTop: '1px solid #EAEDF2' }}>
          <span style={{ fontSize: 12.5, color: diff.count ? '#9A6B00' : '#8A93A5' }}>{diff.count ? `${diff.count} unsaved change${diff.count > 1 ? 's' : ''}` : 'No changes yet'}</span>
          <span style={{ flex: 1 }} />
          <button onClick={cancel} style={btnGhost}>Cancel</button>
          <button onClick={() => setConfirm(true)} disabled={!diff.count} style={{ ...btnPrimary, opacity: diff.count ? 1 : 0.5 }}><UploadCloud size={15} />Save &amp; apply</button>
        </div>
      )}

      {/* confirm dialog (15d) */}
      {confirm && (
        <div style={backdrop} onClick={() => !busy && setConfirm(false)}>
          <div style={{ width: 560, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 14, padding: '22px 24px 18px', borderBottom: '1px solid #EEF1F6' }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: '#EAF0FF', color: '#2E5BFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UploadCloud size={21} /></div>
              <div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>Apply naming rules to catalog</h2><p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5' }}>These edits re-derive physical names everywhere the rules apply.</p></div>
              <button onClick={() => setConfirm(false)} style={iconClose}><X size={13} /></button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div style={{ ...th, marginBottom: 10 }}>What changes</div>
              {[['added', diff.added], ['edited', diff.edited], ['removed', diff.removed]].map(([k, list]) => (list as string[]).map((s, i) => (
                <div key={`${k}-${i}`} style={{ fontSize: 13, color: '#1A2B4A', padding: '4px 0' }}>· <span style={{ color: k === 'removed' ? '#C0392B' : k === 'added' ? '#0E8C6A' : '#56607A', fontWeight: 600 }}>{k}</span> {s}</div>
              )))}
              <div style={{ display: 'flex', gap: 12, background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 11, padding: '12px 15px', marginTop: 14, fontSize: 12.5, color: '#7A6220' }}>
                Se re-derivan los nombres físicos afectados en todo el catálogo. Esto no se puede deshacer parcialmente (pero podés hacer rollback de la versión).
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '16px 24px 20px' }}>
              <span style={{ flex: 1 }} />
              <button onClick={() => setConfirm(false)} disabled={busy} style={btnGhost}>Cancel</button>
              <button onClick={apply} disabled={busy} style={btnPrimary}>{busy ? <span className="rd-spin" /> : <UploadCloud size={15} />}{busy ? 'Applying…' : 'Apply to catalog'}</button>
            </div>
          </div>
        </div>
      )}

      {/* dialog de conflictos de validación (F2 #1) */}
      {conflicts && (
        <div style={backdrop} onClick={() => setConflicts(null)}>
          <div style={{ width: 560, maxHeight: '78vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 14, padding: '22px 24px 18px', borderBottom: '1px solid #EEF1F6' }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: '#FBEEF0', color: '#D6455D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShieldCheck size={21} /></div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>El término &lsquo;{conflicts.term}&rsquo; tiene conflictos</h2>
                <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5' }}>Ya existe en el glosario o aparece como frase completa en nombres lógicos del catálogo. No se puede aplicar.</p>
              </div>
              <button onClick={() => setConflicts(null)} style={iconClose}><X size={13} /></button>
            </div>
            <div style={{ padding: '16px 24px', overflowY: 'auto' }}>
              {conflicts.lines.map((line, i) => (
                <div key={i} style={{ fontSize: 13, color: '#1A2B4A', padding: '5px 0', borderBottom: '1px solid #F5F7FA' }}>· {line}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '14px 24px 20px' }}>
              <span style={{ flex: 1 }} />
              <button onClick={() => setConflicts(null)} style={btnPrimary}>Entendido</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// helpers de estado
function upd(set: React.Dispatch<React.SetStateAction<Draft[]>>, id: string, patch: Partial<Draft>) {
  set((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}
function del(set: React.Dispatch<React.SetStateAction<Draft[]>>, id: string) {
  set((ts) => ts.flatMap((t) => (t.id === id ? (t._new ? [] : [{ ...t, _deleted: true }]) : [t])));
}

const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 14px', border: '1px solid #E2E6EE', background: '#F7F9FC', color: '#1A2B4A', borderRadius: 8, fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--mono, monospace)' };
const inp: React.CSSProperties = { height: 32, fontSize: 13, marginRight: 8 };
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,28,45,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
const iconClose: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { height: 40, padding: '0 18px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 20px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
