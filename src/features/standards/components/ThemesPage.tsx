import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Dialog } from '@/components/ui';
import { normalColor } from '@/lib/colors';
import { applyStandards, type StandardsSnapshot } from '../standards.service';
import { applyErrorNotice, NO_CHANGES_HINT } from '../standardsDiff';
import { MAX_THEME_NAME, themeChanged, themeEditInput, themeFormError, themeFormOf, type ThemeForm } from '../themeForm';

/**
 * Data Standards → Color themes (doc 109). Un theme es un color con nombre que
 * las tablas y vistas usan por referencia, como los themes de Erwin: cambiar su
 * color repinta todas las cajas que lo usan, en todos los canvases. Acá sólo se
 * definen; las cajas se pintan en el canvas (clic derecho o Properties → Color).
 * Mismo patrón que UDP: lista + formulario, cada guardado es una versión.
 */
const NEW = '__new__';

export default function ThemesPage({ projectId, snapshot, canEdit, onApplied }: {
  projectId: string; snapshot: StandardsSnapshot; canEdit: boolean; onApplied: () => Promise<void>;
}) {
  const themes = useMemo(() => snapshot.themes ?? [], [snapshot.themes]);
  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState<ThemeForm>(themeFormOf(null));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const stored = selId && selId !== NEW ? themes.find((t) => t.id === selId) ?? null : null;

  useEffect(() => { setSelId(null); }, [projectId]);
  useEffect(() => {
    if (selId === NEW) setForm(themeFormOf(null));
    else if (stored) setForm(themeFormOf(stored));
    else if (selId) setSelId(null);          // ya no existe (rollback)
  }, [selId, stored]);

  const set = (p: Partial<ThemeForm>) => setForm((f) => ({ ...f, ...p }));
  const error = selId ? themeFormError(form, themes.filter((t) => t.id !== stored?.id)) : null;
  const dirty = selId === NEW || themeChanged(form, stored);
  const hex = normalColor(form.color);

  const save = async () => {
    if (busy || error || !dirty) return;
    setBusy(true);
    try {
      const v = await applyStandards(projectId, {
        kind: 'themes', title: `Color theme ${form.name.trim()}`, themesUpsert: [themeEditInput(form, stored)],
      });
      toast.success(`Applied · ${v.label}`);
      setSelId(null); await onApplied();
    } catch (e) { const n = applyErrorNotice(e, "Couldn't apply"); toast[n.kind](n.text); } finally { setBusy(false); }
  };

  const del = async () => {
    if (!stored) return;
    setBusy(true);
    try {
      const v = await applyStandards(projectId, { kind: 'themes', title: `Remove color theme ${stored.name}`, themesDelete: [stored.id] });
      toast.success(`Applied · ${v.label}`);
      setConfirmDel(false); setSelId(null); await onApplied();
    } catch (e) { const n = applyErrorNotice(e, "Couldn't delete"); toast[n.kind](n.text); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 24px', borderBottom: '1px solid #EAEDF2' }}>
        <div>
          <div style={cap}>Color themes</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#1A2B4A', marginTop: 2 }}>Colors for tables and views</div>
        </div>
        <span style={{ flex: 1 }} />
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setSelId(NEW)}>New theme</Button>}
      </div>
      <div style={{ flex: 'none', padding: '8px 24px', fontSize: 12, color: '#6B7486', background: '#F7FAFF', borderBottom: '1px solid #EAEDF2' }}>
        A box painted with a theme shows its color on every canvas — change the color here and every box that uses it changes.
        Boxes are painted on the canvas: right-click a box, or Properties → Color.
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 24px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#8A93A5', fontSize: 11.5, fontWeight: 600 }}>
                <th style={th}>Name</th>
                <th style={{ ...th, width: 120 }}>Color</th>
              </tr>
            </thead>
            <tbody>
              {themes.length === 0 && (
                <tr><td colSpan={2} style={{ padding: '18px 8px', color: '#9AA3B2' }}>
                  No color themes yet.{canEdit && ' Create one with “New theme”.'}
                </td></tr>
              )}
              {themes.map((t) => (
                <tr key={t.id} onClick={() => setSelId(t.id)} aria-selected={selId === t.id}
                  style={{ cursor: 'pointer', background: selId === t.id ? '#F5F8FF' : 'transparent' }}>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, color: '#1A2B4A', fontWeight: 500 }}>
                      <span style={swatch(t.color)} aria-hidden />{t.name}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#48526A', fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>{t.color.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selId && (
          <form style={{ width: 360, flex: 'none', borderLeft: '1px solid #EAEDF2', overflowY: 'auto', padding: 22 }}
            onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1A2B4A', flex: 1 }}>{stored ? stored.name : 'New theme'}</h3>
              <button type="button" aria-label="Close" title="Close" onClick={() => setSelId(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9AA3B2' }}><X size={18} /></button>
            </div>
            <fieldset disabled={!canEdit || busy} style={{ border: 'none', padding: 0, margin: 0 }}>
              <label style={lbl} htmlFor="theme-name">Name</label>
              <input id="theme-name" style={{ ...inp, marginBottom: 14 }} value={form.name} maxLength={MAX_THEME_NAME}
                onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Entidad Principal" autoComplete="off" />
              <label style={lbl} htmlFor="theme-color">Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* el selector del sistema (paleta completa) y el hex, que se puede tipear o pegar */}
                <input type="color" aria-label="Pick a color" value={(hex ?? '#FFFFFF').toLowerCase()}
                  onChange={(e) => set({ color: e.target.value.toUpperCase() })}
                  style={{ width: 40, height: 36, padding: 2, border: '1px solid #DCE1EA', borderRadius: 8, background: '#fff', cursor: 'pointer' }} />
                <input id="theme-color" style={{ ...inp, width: 120, fontFamily: 'var(--mono, monospace)' }} value={form.color}
                  maxLength={7} spellCheck={false} autoComplete="off" onChange={(e) => set({ color: e.target.value })} />
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 20 }}>
                  <Button type="submit" icon={UploadCloud} disabled={busy || !!error || !dirty}>
                    {busy ? 'Applying…' : stored ? 'Save & apply' : 'Create'}
                  </Button>
                  {stored && <Button variant="danger" icon={Trash2} onClick={() => setConfirmDel(true)}>Delete</Button>}
                </div>
              )}
              {canEdit && (error || !dirty) && (
                <div style={{ fontSize: 12, color: '#8A93A5', marginTop: 10 }}>{error ?? NO_CHANGES_HINT}</div>
              )}
            </fieldset>
          </form>
        )}
      </div>

      {confirmDel && stored && (
        <Dialog open title={`Delete color theme ${stored.name}?`} icon={Trash2} onClose={() => setConfirmDel(false)} width={480}
          subtitle="The tables and views painted with it lose that color on every canvas."
          footer={<>
            <Button variant="secondary" onClick={() => setConfirmDel(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" icon={Trash2} onClick={del} disabled={busy}>Delete</Button>
          </>}>
          <div style={{ fontSize: 13, color: '#56607A' }}>Recorded as a new Data Standards version — rolling it back brings the color back.</div>
        </Dialog>
      )}
    </div>
  );
}

const cap: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2' };
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: '#6B7486', marginBottom: 5, display: 'block' };
const inp: React.CSSProperties = { width: '100%', height: 36, padding: '0 11px', border: '1px solid #DCE1EA', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#1A2B4A', boxSizing: 'border-box' };
const th: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #EAEDF2' };
const td: React.CSSProperties = { padding: '9px 8px', borderBottom: '1px solid #F0F2F6' };
const swatch = (color: string): React.CSSProperties => ({
  width: 16, height: 16, borderRadius: 4, flex: 'none', background: color, boxShadow: 'inset 0 0 0 1px rgba(26,43,74,0.18)',
});
