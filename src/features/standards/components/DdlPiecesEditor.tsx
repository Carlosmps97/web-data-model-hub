/**
 * Piezas y variables de las reglas del Export DDL. Las piezas son macros y
 * constantes Jinja que todas las reglas pueden usar (`crear_tabla(tabla, …)`,
 * `DAC`); las variables, valores del proyecto (`variables.location`). Valida
 * en vivo (errores con su línea) y guardar registra una versión de Data
 * Standards.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { udpView } from '@/lib/facets';

import { saveDdlConfig, validateDdlRule, type DdlValidation } from '../ddlRules.service';
import { ruleCompletions } from '../ddlRuleReference';
import type { DdlRulesetConfig, UdpDefinition } from '../standards.service';
import { applyErrorNotice, ddlConfigChanged, NO_CHANGES_HINT, sameValue } from '../standardsDiff';
import CodeEditor from './CodeEditor';

type VarRow = { key: string; value: string };

/** Las filas del editor como variables; null si un nombre se repite. Pura. */
export function rowsToVariables(rows: VarRow[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    if (k in out) return null;
    out[k] = r.value;
  }
  return out;
}

export default function DdlPiecesEditor({ projectId, config, udpDefs, canEdit, onBack, onSaved }: {
  projectId: string;
  config: DdlRulesetConfig;
  udpDefs: UdpDefinition[];
  canEdit: boolean;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [pieces, setPieces] = useState(config.pieces ?? '');
  const [rows, setRows] = useState<VarRow[]>(() => Object.entries(config.variables ?? {}).map(([key, value]) => ({ key, value })));
  const [validation, setValidation] = useState<DdlValidation | null>(null);
  const [saving, setSaving] = useState(false);

  const variables = useMemo(() => rowsToVariables(rows), [rows]);
  const dirty = variables !== null && ddlConfigChanged(pieces, variables, config);
  const errors = validation?.errors ?? [];
  const udpNames = useMemo(
    () => [...new Set(udpDefs.filter((d) => udpView(d) === 'physical').map((d) => d.name))].sort(),
    [udpDefs],
  );
  const completions = useMemo(() => ruleCompletions(pieces, variables ?? {}), [pieces, variables]);

  useEffect(() => {
    if (variables === null) return;
    let alive = true;
    const t = setTimeout(() => {
      validateDdlRule(projectId, null, pieces, variables)
        .then((v) => { if (alive) setValidation(v); })
        .catch(() => { if (alive) setValidation(null); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [projectId, pieces, variables]);

  const save = async () => {
    if (variables === null) return;
    setSaving(true);
    try {
      await saveDdlConfig(projectId, {
        ...(pieces !== (config.pieces ?? '') ? { pieces } : {}),
        ...(!sameValue(variables, config.variables ?? {}) ? { variables } : {}),
      });
      toast.success('Pieces & variables saved');
      await onSaved();
    } catch (e) { const n = applyErrorNotice(e, "Couldn't save"); toast[n.kind](n.text); }
    finally { setSaving(false); }
  };

  const setRow = (i: number, p: Partial<VarRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const canSave = canEdit && dirty && !saving && errors.length === 0;

  return (
    <div style={{ padding: '22px 34px', background: '#FBFCFD', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', padding: 0, fontSize: 12, fontWeight: 600, color: '#8A93A5', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 4 }}>
            <ChevronLeft size={13} /> DDL export rules
          </button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1A2B4A', letterSpacing: '-0.01em' }}>Pieces &amp; variables</h1>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#6B7689', lineHeight: 1.55, maxWidth: 640 }}>
            Pieces are Jinja macros and constants every rule can use; variables are values of this project
            (<code>variables.location</code>).
          </p>
        </div>
        <Button variant="secondary" onClick={onBack}>{canEdit ? 'Cancel' : 'Back'}</Button>
        {canEdit && <Button onClick={save} disabled={!canSave} title={dirty ? undefined : NO_CHANGES_HINT}>{saving ? 'Saving…' : 'Save changes'}</Button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        <div style={card}>
          <div style={{ ...lbl, marginBottom: 6 }}>Pieces</div>
          {(validation?.warnings ?? []).map((w) => (
            <div key={w} style={{ fontSize: 12, color: '#8A6D1F', background: '#FFF8E6', border: '1px solid #F3E2B3', borderRadius: 9, padding: '8px 11px', marginBottom: 10 }}>{w}</div>
          ))}
          <CodeEditor value={pieces} onChange={setPieces} readOnly={!canEdit} minHeight={420}
            completions={completions} udpNames={udpNames} ariaLabel="Pieces" />
          {errors.filter((e) => e.field === 'pieces').map((e) => (
            <div key={`${e.line}:${e.message}`} style={err}>{e.line ? `Line ${e.line}: ` : ''}{e.message}</div>
          ))}
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ ...lbl, flex: 1 }}>Variables</span>
            {canEdit && <Button variant="secondary" size="sm" icon={Plus} onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])}>Add variable</Button>}
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <input className="rd-input" style={{ ...cell, flex: '0 0 38%', fontFamily: 'var(--mono, monospace)' }} value={r.key} disabled={!canEdit}
                placeholder="name" aria-label={`Variable ${i + 1} name`} onChange={(e) => setRow(i, { key: e.target.value })} />
              <input className="rd-input" style={{ ...cell, flex: 1 }} value={r.value} disabled={!canEdit}
                placeholder="value" aria-label={`Variable ${i + 1} value`} onChange={(e) => setRow(i, { value: e.target.value })} />
              {canEdit && (
                <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Remove variable ${r.key || i + 1}`} title="Remove"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
              )}
            </div>
          ))}
          {rows.length === 0 && <div style={{ fontSize: 12, color: '#9AA3B2' }}>No variables.</div>}
          {variables === null && <div style={err}>Two variables have the same name.</div>}
          {errors.filter((e) => e.field.startsWith('variables.')).map((e) => <div key={e.field} style={err}>{e.message}</div>)}
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E6EAF0', borderRadius: 14, padding: '16px 18px', minWidth: 0 };
const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A93A5' };
const cell: React.CSSProperties = { height: 32, boxSizing: 'border-box', minWidth: 0 };
const err: React.CSSProperties = { fontSize: 11.5, color: '#B23A2E', marginTop: 6 };
