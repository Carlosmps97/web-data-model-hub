import { useState } from 'react';
import { validateSql, type ReportSpec } from '../query.service';

/** Caja de texto SQL-like. El SERVER es la autoridad de la gramática: valida →
 *  QuerySpec (mismo IR que el builder). Errores con línea para el usuario. */
export default function SqlEditor({ text, onText, onValidated }: {
  text: string; onText: (t: string) => void; onValidated: (spec: ReportSpec) => void;
}) {
  const [errors, setErrors] = useState<{ line: number; col: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const v = await validateSql(text);
      setErrors(v.errors);
      if (v.spec) onValidated(v.spec);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#8A93A5' }}>
        SQL-like over the views <code>columns · tables · relationships · views · view_columns · models</code>. UDP: <code>udp."Name"</code>. No JOIN/subquery.
      </div>
      <textarea value={text} onChange={(e) => onText(e.target.value)} spellCheck={false}
        style={{ width: '100%', height: 130, padding: 12, border: `1px solid ${errors.length ? '#E5B4B4' : '#DCE1EA'}`, borderRadius: 9, fontFamily: 'var(--mono, monospace)', fontSize: 13, color: '#1A2B4A', resize: 'vertical', boxSizing: 'border-box' }}
        placeholder={"SELECT physicalName, dataType, udp.\"Clasificación del Dato\"\nFROM columns\nWHERE schema = 'core' AND udp.\"Clasificación del Dato\" IN ('DAC','Sensible')\nORDER BY physicalName\nLIMIT 100"} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={check} disabled={busy} style={{ height: 32, padding: '0 14px', border: '1px solid #DCE1EA', background: '#fff', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: '#48526A' }}>{busy ? 'Validating…' : 'Validate → builder'}</button>
        {errors.length === 0 && text.trim() && <span style={{ fontSize: 12, color: '#2E9E5B' }}>✓ Valid SQL</span>}
        {errors.map((e, i) => <span key={i} style={{ fontSize: 12, color: '#C0392B' }}>line {e.line}: {e.message}</span>)}
      </div>
    </div>
  );
}
