import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, Lock, Pencil, Plus, Search, ShieldCheck, Trash2, Unlock, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import type { StandardsSnapshot, SnapshotTerm, ApplyStandardsBody } from '../standards.service';
import { applyStandards } from '../standards.service';
import { validateTerm, lockTerm, unlockTerm, glossaryImpact } from '@/services/naming.service';
import type { GlossaryImpact, GlossaryValidation, UdpScope } from '@/services/naming.service';
import { useAuthStore } from '@/store/useAuthStore';
import {
  termsToValidate, needsConfirm, incompleteRows, incompleteMessage, termGap, gapToast, termEdited, termsToUpsert, maxLengthLabel,
} from '../glossaryValidation';
import GlossaryApplyDialog from './GlossaryApplyDialog';
import GlossaryConflictDialog from './GlossaryConflictDialog';

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

// _orig: término original al entrar en edición — permite detectar renombres
// de texto para validarlos antes de aplicar (F2 #1, ver termsToValidate).
type Draft = SnapshotTerm & { _new?: boolean; _deleted?: boolean; _orig?: string };

export default function GlossaryPage({ projectId, snapshot, canEdit, onApplied }: {
  projectId: string;
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
  const [conflicts, setConflicts] = useState<{ term: string; validation: GlossaryValidation } | null>(null);
  // Doc 95 D5: resultado de Validate por fila (id → término que pasó sin conflictos).
  const [validated, setValidated] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState<string | null>(null); // id de la fila validándose
  // Doc 94 D7: impacto REAL del apply (dry-run); el aviso solo sale si > 0.
  const [impact, setImpact] = useState<GlossaryImpact | null>(null);
  // Doc 102: filas donde el usuario pidió Validar (se marcan en rojo aunque estén vacías).
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  // Config del scope. La REGLA CORPORATIVA está bloqueada en join + UPPER
  // (así se derivan los físicos reales del catálogo: CODCLAVESUJETOCLI); los
  // combos se muestran pero las demás opciones quedan deshabilitadas.
  const cfg0 = snapshot.namingConfig[scope];
  const [sep, setSep] = useState<string>(String(cfg0.separator ?? ''));
  const [casing, setCasing] = useState<string>(String(cfg0.case ?? 'upper'));
  // Límite de caracteres del nombre FÍSICO (default 150; se versiona en Data Standards).
  const [maxLen, setMaxLen] = useState<number>(Number(cfg0.maxLength ?? 150));

  // Borrador EDITABLE de términos (vacío hasta entrar en modo edición; la vista
  // read-only usa `snapshot.dict` directamente vía `live`).
  const [terms, setTerms] = useState<Draft[]>([]);

  // Re-sincroniza los chips read-only de separador/case al cambiar de scope
  // (cuando NO se está editando): sin esto mostraban las reglas del scope viejo.
  useEffect(() => {
    if (editing) return;
    setSep(String(snapshot.namingConfig[scope].separator ?? ''));
    setCasing(String(snapshot.namingConfig[scope].case ?? 'upper'));
    setMaxLen(Number(snapshot.namingConfig[scope].maxLength ?? 150));
  }, [scope, editing, snapshot]);

  const enterEdit = () => {
    // Se estampa _orig al entrar en edición: si el texto del término cambia,
    // termsToValidate lo trata como renombre y también se valida al aplicar.
    setTerms(snapshot.dict.filter((t) => t.scope === scope).map((t) => ({ ...t, _orig: t.term })));
    setSep(String(snapshot.namingConfig[scope].separator ?? ''));
    setCasing(String(snapshot.namingConfig[scope].case ?? 'upper'));
    setMaxLen(Number(snapshot.namingConfig[scope].maxLength ?? 150));
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setConfirm(false); setImpact(null); setValidated({}); setFlagged(new Set()); };
  const switchScope = (s: UdpScope) => { if (editing) return; setScope(s); };

  const live: Draft[] = editing ? terms.filter((t) => !t._deleted) : snapshot.dict.filter((t) => t.scope === scope);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return !n ? live : live.filter((t) => t.term.toLowerCase().includes(n) || t.abbrev.toLowerCase().includes(n));
  }, [live, q]);

  const preview = previewPhysical('monto deuda dólares', live, editing ? sep : String(cfg0.separator ?? ''), editing ? casing : String(cfg0.case ?? 'upper'));

  // ── Diff para el diálogo de apply ──
  const diff = useMemo(() => {
    const before = new Map(snapshot.dict.filter((t) => t.scope === scope).map((t) => [t.id, t]));
    const added: string[] = [], edited: string[] = [], removed: string[] = [];
    for (const t of terms) {
      if (t._deleted) { if (!t._new) removed.push(`${t.term} → ${t.abbrev}`); continue; }
      if (t._new) added.push(`${t.term} → ${t.abbrev}`);
      // Doc 105 (P1-bis): recortado — un blanco alrededor no es una edición.
      else { const b = before.get(t.id); if (b && termEdited(t, b)) edited.push(`${t.term} → ${t.abbrev}`); }
    }
    const cfgChanged = sep !== String(cfg0.separator ?? '') || casing !== String(cfg0.case ?? 'upper') || maxLen !== Number(cfg0.maxLength ?? 150);
    if (cfgChanged) edited.push(`${scope === 'column' ? 'Column' : 'Table'} naming · sep '${sep || '(none)'}' · ${casing} · max ${maxLen}`);
    return { added, edited, removed, cfgChanged, count: added.length + edited.length + removed.length };
  }, [terms, sep, casing, maxLen, snapshot.dict, scope, cfg0]);

  // Doc 102: término Y abreviatura obligatorios en toda fila nueva o editada.
  const before = useMemo(() => new Map(snapshot.dict.filter((t) => t.scope === scope).map((t) => [t.id, t])), [snapshot.dict, scope]);
  const incomplete = useMemo(() => (editing ? incompleteRows(terms, before) : []), [editing, terms, before]);
  const incompleteIds = useMemo(() => new Set(incomplete.map((t) => t.id)), [incomplete]);
  /** ¿Marcar en rojo ese campo? Fila incompleta con el campo vacío, si ya tiene algo escrito o se pidió validar. */
  const showGap = (t: Draft, field: 'term' | 'abbrev') =>
    incompleteIds.has(t.id) && t[field].trim() === ''
    && (flagged.has(t.id) || t.term.trim() !== '' || t.abbrev.trim() !== '');

  // Validación on-demand de una fila NUEVA (botón junto al alta). El backend
  // igual re-valida al guardar: esto es cortesía de UX. Doc 95 D5: el resultado
  // queda visible en la fila (chip), no en un toast que se pierde.
  const validateDraft = async (t: Draft) => {
    const term = t.term.trim();
    const gap = termGap(t);
    if (gap) {
      setFlagged((s) => new Set(s).add(t.id));
      toast.error(gapToast(gap));
      return;
    }
    setChecking(t.id);
    try {
      const v = await validateTerm(projectId, term, scope);
      if (v.ok) setValidated((m) => ({ ...m, [t.id]: term }));
      else setConflicts({ term, validation: v });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't validate");
    } finally { setChecking(null); }
  };

  const toggleLock = async (t: SnapshotTerm) => {
    try {
      if (t.locked) await unlockTerm(projectId, t.id); else await lockTerm(projectId, t.id);
      toast.success(t.locked ? `'${t.term}' unlocked` : `'${t.term}' locked`);
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't toggle the lock");
    }
  };

  // Batch del borrador: solo términos NUEVOS o realmente EDITADOS (antes se
  // reenviaban TODOS como upsert → inflaba el diff/impacto y re-derivaba de más).
  // Doc 105 (P1-bis): «realmente» = comparado recortado (`termsToUpsert`).
  const buildBody = (): ApplyStandardsBody => {
    const body: ApplyStandardsBody = { kind: 'glossary' };
    const before = new Map(snapshot.dict.filter((t) => t.scope === scope).map((t) => [t.id, t]));
    body.termsUpsert = termsToUpsert(terms, before, scope);
    body.termsDelete = terms.filter((t) => t._deleted && !t._new).map((t) => t.id);
    if (diff.cfgChanged) body.namingConfig = { [scope]: { separator: sep, case: casing, maxLength: maxLen } };
    return body;
  };

  const commit = async (body: ApplyStandardsBody) => {
    const v = await applyStandards(projectId, body);
    const renamed = v.impact.columns + v.impact.tables;
    toast.success(renamed
      ? `Standards applied · ${v.label} · ${renamed} physical name${renamed === 1 ? '' : 's'} changed`
      : `Saved · ${v.label} — no physical names change`);
    setEditing(false); setConfirm(false); setImpact(null); setValidated({}); setFlagged(new Set()); onApplied();
  };

  /** «Save & apply» (doc 94 D7): valida los términos nuevos/renombrados, mide el
   *  impacto REAL (dry-run del mismo re-derivado que corre el apply) y SOLO si
   *  algún nombre físico cambia pide confirmación, con los números. */
  const saveAndApply = async () => {
    setBusy(true);
    try {
      if (incomplete.length) { toast.error(incompleteMessage(incomplete.length)); return; }   // doc 102
      // F2 #1: cada término NUEVO o renombrado se chequea contra el glosario y
      // el corpus; el primero con conflictos corta (el backend re-valida igual).
      for (const term of termsToValidate(terms)) {
        const v = await validateTerm(projectId, term, scope);
        if (!v.ok) { setConflicts({ term, validation: v }); return; }
      }
      const body = buildBody();
      const cfg = body.namingConfig?.[scope];
      const imp = await glossaryImpact(projectId, {
        scope,
        termsUpsert: (body.termsUpsert ?? []).map(({ id, term, abbrev }) => ({ id, term, abbrev })),
        termsDelete: body.termsDelete ?? [],
        ...(cfg ? { namingConfig: { separator: cfg.separator, case: cfg.case } } : {}),
      });
      if (!needsConfirm(imp)) { await commit(body); return; }
      setImpact(imp); setConfirm(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply");
    } finally { setBusy(false); }
  };

  /** Botón del diálogo: el usuario ya vio qué nombres cambian. */
  const apply = async () => {
    setBusy(true);
    try {
      await commit(buildBody());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't apply");
    } finally { setBusy(false); }
  };

  // estilos
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #E6EAF0', borderRadius: 12, padding: '16px 17px' };
  const th: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' };

  // Columnas de la grilla: en edición hay celda de acciones (validar + borrar);
  // en lectura, el admin ve la celda del candado.
  const gridCols = editing ? '1.4fr 1fr 76px' : isAdmin ? '1.4fr 1fr 40px' : '1.4fr 1fr';

  return (
    <div style={{ padding: '24px 34px', maxWidth: 1000 }}>
      {/* heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: '#EAF0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2E5BFF' }}><BookOpenText size={20} /></div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1A2B4A' }}>Glossary — Terms &amp; Abbreviations</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#8A93A5' }}>{scope === 'column'
            ? 'Terms and abbreviations that derive column (field) physical names — they never rename tables'
            : 'Terms and abbreviations that derive table physical names — they never rename columns'}</p>
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
          ? <span><strong style={{ color: '#2E5BFF' }}>Edit mode.</strong> Add / edit / delete terms. The naming rule is fixed at <strong>join + UPPER</strong> (corporate standard). Nothing changes until you <strong>Save &amp; apply</strong>. If your changes rename existing {scope === 'column' ? 'column (field)' : 'table'} names, you'll see which ones before applying (manually overridden names are kept).</span>
          : <span><strong style={{ color: '#3A4658' }}>Read-only view.</strong> {canEdit ? 'Click Edit standards to change rules or terms.' : 'Your role can view the naming rules but not edit them.'}</span>}
      </div>

      {/* config + preview */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div style={{ ...card, flex: 1 }}>
          {/* Regla corporativa BLOQUEADA en join + UPPER (column y table): los
              combos se ven, pero las otras opciones están deshabilitadas. */}
          <div style={{ fontSize: 12, fontWeight: 600, color: '#56607A', marginBottom: 8 }}>Separator between terms</div>
          {editing ? (
            <select value={sep} onChange={(e) => setSep(e.target.value)} className="rd-input" style={{ height: 36 }} title="Regla corporativa fija: (none) · join">
              <option value="_" disabled>_ underscore</option><option value="">(none) · join</option><option value="-" disabled>- hyphen</option>
            </select>
          ) : <div style={chip}>{sep === '' ? '(none) · join' : `${sep} ${sep === '_' ? 'underscore' : 'hyphen'}`}</div>}
          <div style={{ fontSize: 12, fontWeight: 600, color: '#56607A', margin: '15px 0 8px' }}>Upper / lower case</div>
          {editing ? (
            <select value={casing} onChange={(e) => setCasing(e.target.value)} className="rd-input" style={{ height: 36 }} title="Regla corporativa fija: UPPER">
              <option value="upper">UPPER</option><option value="lower" disabled>lower</option><option value="camel" disabled>camelCase</option>
            </select>
          ) : <div style={chip}>{casing.toUpperCase()}</div>}
          {/* F: límite de caracteres del físico (tabla/columna). Al crear, si
              el físico lo excede, el backend rechaza con error. Versionado. */}
          <div style={{ fontSize: 12, fontWeight: 600, color: '#56607A', margin: '15px 0 8px' }}>Max physical length (chars)</div>
          {editing ? (
            <input type="number" min={1} max={1000} value={maxLen}
              onChange={(e) => setMaxLen(Math.max(1, Number(e.target.value) || 0))}
              className="rd-input" style={{ height: 36 }}
              title="Maximum characters of the physical name (table/column): a longer name is rejected on create or rename." />
          ) : <div style={chip}>{maxLengthLabel(maxLen)}</div>}
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
        {editing && <button onClick={() => setTerms((ts) => [{ id: `new-${Date.now()}`, term: '', abbrev: '', scope, _new: true }, ...ts])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', border: '1px solid #D4E0FF', background: '#EAF0FF', color: '#2E5BFF', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Plus size={14} />Add term</button>}
      </div>
      <div style={{ border: '1px solid #EAEDF2', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', padding: '10px 16px', ...th }}>
          <div>Term</div><div>Abbrev.</div>{(editing || isAdmin) && <div />}
        </div>
        {shown.map((t) => {
          const locked = Boolean(t.locked);
          return (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid #F2F4F8', fontSize: 13, background: locked ? '#F1F3F6' : undefined }}>
              {editing && !locked ? <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <input className="rd-input" style={{ ...inp, ...(showGap(t, 'term') ? invalidInp : {}) }} aria-invalid={showGap(t, 'term')}
                    value={t.term} onChange={(e) => upd(setTerms, t.id, { term: e.target.value })} placeholder="term" />
                  {t._new && t.term.trim() !== '' && t.abbrev.trim() !== '' && validated[t.id] === t.term.trim() && (
                    <span style={okChip}>✓ No conflicts — renames nothing</span>
                  )}
                </div>
                <input className="rd-input" style={{ ...inp, fontFamily: 'var(--mono, monospace)', ...(showGap(t, 'abbrev') ? invalidInp : {}) }}
                  aria-invalid={showGap(t, 'abbrev')} value={t.abbrev} onChange={(e) => upd(setTerms, t.id, { abbrev: e.target.value })} placeholder="ABR" />
                <div style={{ display: 'flex', gap: 6 }}>
                  {t._new && (
                    <button onClick={() => validateDraft(t)} disabled={checking === t.id} title="Check conflicts (glossary and logical names)"
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
                {editing && locked && <div />}
                {!editing && isAdmin && (
                  <button onClick={() => toggleLock(t)} title={locked ? `Locked by ${t.lockedBy ?? 'ADMIN'} — unlock` : 'Lock term'}
                    style={{ width: 28, height: 28, border: '1px solid #E6EAF0', background: '#fff', borderRadius: 7, color: locked ? '#9A6B00' : '#8A93A5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                )}
              </>}
            </div>
          );
        })}
        {shown.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: '#9AA3B2' }}>No matching terms.</div>}
      </div>

      {/* footer edit actions */}
      {editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 16, borderTop: '1px solid #EAEDF2' }}>
          {/* Doc 102: con filas incompletas el pie dice por qué no se puede guardar. */}
          <span style={{ fontSize: 12.5, color: incomplete.length ? '#C0392B' : diff.count ? '#9A6B00' : '#8A93A5' }}>
            {incomplete.length ? incompleteMessage(incomplete.length)
              : diff.count ? `${diff.count} unsaved change${diff.count > 1 ? 's' : ''}` : 'No changes yet'}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={cancel} style={btnGhost}>Cancel</button>
          <button onClick={saveAndApply} disabled={!diff.count || busy || incomplete.length > 0}
            style={{ ...btnPrimary, opacity: diff.count && !incomplete.length ? 1 : 0.5 }}>{busy ? <span className="rd-spin" /> : <UploadCloud size={15} />}{busy ? 'Checking…' : 'Save & apply'}</button>
        </div>
      )}

      {/* Doc 95 D3/D4: qué renombra el borrador y qué ya estaba desfasado, completo */}
      {confirm && impact && (
        <GlossaryApplyDialog scope={scope} impact={impact} diff={diff} busy={busy}
          onCancel={() => { setConfirm(false); setImpact(null); }} onApply={apply} />
      )}

      {/* Doc 95 D1: el término no se puede agregar — por qué y todas las columnas */}
      {conflicts && (
        <GlossaryConflictDialog term={conflicts.term} scope={scope} validation={conflicts.validation}
          onClose={() => setConflicts(null)} />
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
const invalidInp: React.CSSProperties = { borderColor: '#E0A39B', background: '#FFF6F5' };   // doc 102: campo obligatorio vacío
const okChip: React.CSSProperties = { alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, color: '#0E8C6A', background: '#E8F7F1', border: '1px solid #C6EADC', borderRadius: 6, padding: '1px 7px' };
const btnGhost: React.CSSProperties = { height: 40, padding: '0 18px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 20px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
