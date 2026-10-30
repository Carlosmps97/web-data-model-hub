/**
 * Lista de las reglas del Export DDL, en orden: arriba = más prioridad (si dos
 * reglas escriben el mismo archivo para la misma tabla o vista, gana la de
 * arriba). Se ordena arrastrando o con las flechas; cada cambio de orden o de
 * on/off es una versión de Data Standards. Fila → editor. Con la lista vacía,
 * el CTA restaura el set base.
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Braces, GripVertical, Plus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';

import { reorderDdlRules, restoreBaseRuleSet, toggleDdlRule } from '../ddlRules.service';
import type { DdlRule, DdlRulesetConfig, StandardsVersion } from '../standards.service';
import { applyErrorNotice } from '../standardsDiff';

/** Orden de la lista: posición y, ante un empate, nombre (como el backend). */
export const sortRules = (rules: DdlRule[]): DdlRule[] =>
  [...rules].sort((a, b) => a.order - b.order || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

/** La lista con la regla de la posición `from` movida a `to`. Pura. */
export function moveRule(rules: DdlRule[], from: number, to: number): DdlRule[] {
  const out = [...rules];
  const [r] = out.splice(from, 1);
  out.splice(to, 0, r);
  return out;
}

export default function DdlRuleList({ projectId, rules, config, canEdit, onOpen, onNew, onPieces, onOutput, onApplied }: {
  projectId: string;
  rules: DdlRule[];
  config: DdlRulesetConfig;
  canEdit: boolean;
  onOpen: (rule: DdlRule) => void;
  onNew: () => void;
  onPieces: () => void;
  onOutput: () => void;
  onApplied: () => Promise<void> | void;
}) {
  const ordered = useMemo(() => sortRules(rules), [rules]);
  const [busy, setBusy] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const run = async (work: Promise<StandardsVersion> | null, done?: string) => {
    if (!work) return;
    setBusy(true);
    try { await work; if (done) toast.success(done); await onApplied(); }
    catch (e) { const n = applyErrorNotice(e, "Couldn't save"); toast[n.kind](n.text); }
    finally { setBusy(false); }
  };
  const move = (from: number, to: number) => {
    if (busy || to < 0 || to >= ordered.length || from === to) return;
    void run(reorderDdlRules(projectId, moveRule(ordered, from, to)));
  };
  const toggle = (rule: DdlRule) => { if (!busy) void run(toggleDdlRule(projectId, rule, !rule.enabled)); };
  const restore = () => { if (!busy) void run(restoreBaseRuleSet(projectId, config), 'Base rule set restored'); };

  return (
    <div style={{ padding: '22px 34px', background: '#FBFCFD', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1040 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8A93A5', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Governance</div>
            <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, color: '#1A2B4A', letterSpacing: '-0.015em' }}>DDL export rules</h1>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#6B7689', lineHeight: 1.55, maxWidth: 640 }}>
              With <strong style={{ color: '#1A2B4A' }}>Use export rules</strong> in Export DDL, these rules write every
              file of the export: each one runs for every table or view. If two rules write the same file for the same
              table or view, the upper one wins.
            </p>
          </div>
          <Button variant="secondary" icon={Braces} onClick={onPieces}>Pieces &amp; variables</Button>
          <Button variant="secondary" icon={SlidersHorizontal} onClick={onOutput}>Output settings</Button>
          {canEdit && <Button icon={Plus} onClick={onNew} disabled={busy}>New rule</Button>}
        </div>

        {ordered.length === 0 ? (
          <div style={{ border: '1px dashed #C9D2E0', borderRadius: 12, background: '#fff', padding: '38px 24px', textAlign: 'center' }}>
            <Sparkles size={22} color="#8B5CF6" />
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1A2B4A', marginTop: 8 }}>No export rules yet</div>
            <div style={{ fontSize: 12.5, color: '#8A93A5', margin: '6px auto 14px', maxWidth: 480, lineHeight: 1.5 }}>
              Restore the base rule set: the DDL of the reference macro (table, rejected table, technical, DAC and
              rejected views, business views) and the common pieces they use. You can edit, reorder or turn off any
              of them later.
            </div>
            {canEdit && <Button onClick={restore} disabled={busy}>{busy ? 'Restoring…' : 'Restore the base rule set'}</Button>}
          </div>
        ) : (
          <div style={{ border: '1px solid #EAEDF2', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            {ordered.map((r, i) => (
              <div
                key={r.id}
                onClick={() => onOpen(r)}
                draggable={canEdit && !busy}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', r.id); setDragFrom(i); }}
                onDragOver={(e) => { if (dragFrom !== null) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
                onDragEnd={() => setDragFrom(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer',
                  borderBottom: i < ordered.length - 1 ? '1px solid #F2F4F8' : 'none',
                  background: dragFrom === i ? '#F6F9FF' : '#fff', opacity: r.enabled ? 1 : 0.62,
                }}
              >
                {canEdit && <GripVertical size={15} color="#B6BECD" style={{ flex: 'none', cursor: 'grab' }} aria-hidden />}
                <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11.5, fontWeight: 700, color: '#9AA3B2', width: 26, flex: 'none' }}>#{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {/* El nombre abre el editor también con el teclado (la fila, con el mouse). */}
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(r); }}
                      style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono, monospace)', fontSize: 13, fontWeight: 600, color: '#1A2B4A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                      {r.name}
                    </button>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: r.scope === 'view' ? '#8B5CF6' : '#2E5BFF', background: r.scope === 'view' ? '#F3EEFF' : '#EAF0FF', borderRadius: 999, padding: '2px 9px', flex: 'none' }}>
                      {r.scope === 'view' ? 'Each view' : 'Each table'}
                    </span>
                    <span style={{ fontSize: 11, color: '#9AA3B2', flex: 'none' }}>{r.files.length} file{r.files.length === 1 ? '' : 's'}</span>
                  </div>
                  {r.description && <div style={{ fontSize: 12, color: '#6B7689', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>}
                  <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: '#8A93A5', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.when.trim() ? `when ${r.when.trim()}` : 'always'}
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }} onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" icon={ArrowUp} aria-label={`Move ${r.name} up`} title="Move up"
                      disabled={busy || i === 0} onClick={() => move(i, i - 1)} />
                    <Button variant="ghost" size="sm" icon={ArrowDown} aria-label={`Move ${r.name} down`} title="Move down"
                      disabled={busy || i === ordered.length - 1} onClick={() => move(i, i + 1)} />
                  </div>
                )}
                <div onClick={(e) => e.stopPropagation()} style={{ flex: 'none' }}>
                  <Toggle on={r.enabled} disabled={!canEdit || busy} onFlip={() => toggle(r)} label={r.name} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, disabled, onFlip, label }: { on: boolean; disabled?: boolean; onFlip: () => void; label: string }) {
  return (
    <button type="button" onClick={() => !disabled && onFlip()} disabled={disabled} role="switch" aria-checked={on}
      aria-label={`${on ? 'Turn off' : 'Turn on'} ${label}`} title={on ? 'On' : 'Off'}
      style={{ width: 30, height: 17, borderRadius: 999, border: 'none', padding: 2, background: on ? '#2E5BFF' : '#C7CFDB', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background 0.15s' }}>
      <span style={{ width: 13, height: 13, borderRadius: '50%', background: '#fff', display: 'block' }} />
    </button>
  );
}
