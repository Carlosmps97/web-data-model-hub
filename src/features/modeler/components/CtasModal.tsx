import { useEffect, useMemo, useState } from 'react';
import { Combine } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { useModelerStore } from '@/store/useModelerStore';
import * as gov from '@/features/governance/services/governance.service';
import type { CanonicalColumn } from '@/features/governance/services/governance.service';

/**
 * CTAS — Create Table As Select (Pantalla 06). Dos secciones:
 *  1) elegir tablas fuente y, por checkbox, las columnas a heredar;
 *  2) definir la nueva tabla (Table Name + Schema free-text) + preview SQL en vivo.
 * Crea vía `createTableFromSources` (escribe al changeset de la sesión).
 */
export default function CtasModal({ onClose, pushToast }: { onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const { diagram, createTableFromSources } = useModelerStore();
  const tables = diagram?.tables ?? [];
  const allCols = diagram?.columns ?? [];
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [schema, setSchema] = useState('');
  const [physName, setPhysName] = useState('');
  const [busy, setBusy] = useState(false);

  const toggleSrc = (id: string) => setSources((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePick = (id: string) => setPicks((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Columnas candidatas: de las tablas fuente, dedup por physicalName (primera gana).
  const candidates = useMemo(() => {
    const seen = new Set<string>(); const out: CanonicalColumn[] = [];
    for (const c of allCols) {
      if (!sources.has(c.tableId)) continue;
      if (seen.has(c.physicalName)) continue;
      seen.add(c.physicalName); out.push(c);
    }
    return out;
  }, [allCols, sources]);

  // Preview físico del nombre (scope table), debounced.
  useEffect(() => {
    const t = name.trim();
    if (!t) { setPhysName(''); return; }
    const h = setTimeout(() => { gov.physicalize(t, 'table').then((r) => setPhysName(r.physical)).catch(() => {}); }, 300);
    return () => clearTimeout(h);
  }, [name]);

  const pickedCols = useMemo(() => candidates.filter((c) => picks.has(c.id)), [candidates, picks]);
  const srcTables = useMemo(() => tables.filter((t) => sources.has(t.id)), [tables, sources]);

  const sql = useMemo(() => {
    const tbl = `${schema.trim() || 'schema'}.${physName || 'new_table'}`;
    const cols = pickedCols.length ? pickedCols.map((c) => `  ${c.physicalName}`).join(',\n') : '  *';
    const from = srcTables.map((t) => (t.schema ? `${t.schema}.${t.physicalName}` : t.physicalName)).join(', ') || '<source tables>';
    return `CREATE TABLE ${tbl} AS\nSELECT\n${cols}\nFROM ${from};`;
  }, [schema, physName, pickedCols, srcTables]);

  const create = async () => {
    if (!name.trim()) { pushToast('Table name is required', 'err'); return; }
    if (pickedCols.length === 0) { pushToast('Pick at least one column', 'err'); return; }
    setBusy(true);
    try {
      await createTableFromSources({ logicalName: name.trim(), schema: schema.trim() || undefined, columns: pickedCols });
      pushToast('Table created from sources'); onClose();
    } catch { pushToast('Could not create the table', 'err'); } finally { setBusy(false); }
  };

  const step: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--ink, #1A2B4A)', marginBottom: 6 };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted, #56607A)', marginBottom: 5, display: 'block' };
  const listBox: React.CSSProperties = { maxHeight: 150, overflow: 'auto', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 9, padding: 4 };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px', cursor: 'pointer', borderRadius: 6 };

  return (
    <Dialog
      open
      title="New table · CTAS"
      subtitle="Create a new table from columns of several tables"
      icon={Combine}
      backdrop="canvas"
      canvasTop={136}
      width={820}
      onClose={onClose}
      footer={(
        <>
          <div className="dmh-dialog-foot-left rd-small" style={{ color: 'var(--text-muted, #8A93A5)' }}>Added to the canvas as an unpublished change.</div>
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={create}>Create table</button>
        </>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* 1 · Choose source tables and columns */}
        <div>
          <div style={step}>1 · Choose source tables and columns</div>
          <div className="rd-small" style={{ marginBottom: 10, color: 'var(--text-muted, #8A93A5)' }}>
            Check the columns to inherit. Useful when the new table draws ~90% of its columns from others.
          </div>
          <label style={lbl}>Source tables</label>
          <div style={{ ...listBox, marginBottom: 12 }}>
            {tables.map((t) => (
              <label key={t.id} style={row}>
                <input type="checkbox" checked={sources.has(t.id)} onChange={() => toggleSrc(t.id)} />
                {/* esquema.tabla completo (dos tablas pueden llamarse igual en
                    esquemas distintos); sin nowrap/ellipsis → nunca se trunca */}
                <span className="rd-mono" style={{ flex: 1, fontSize: 12, wordBreak: 'break-all' }}>
                  {t.schema && <span style={{ opacity: 0.62 }}>{t.schema}.</span>}
                  {t.physicalName}
                </span>
              </label>
            ))}
            {tables.length === 0 && <div className="rd-small" style={{ padding: 6 }}>No tables in this canvas.</div>}
          </div>
          <label style={lbl}>Columns to inherit</label>
          <div style={listBox}>
            {candidates.map((c) => (
              <label key={c.id} style={row}>
                <input type="checkbox" checked={picks.has(c.id)} onChange={() => togglePick(c.id)} />
                <span className="rd-mono" style={{ flex: 1, fontSize: 12 }}>{c.physicalName}</span>
                <span className="rd-mono" style={{ color: 'var(--text-muted-2, #8A93A5)', fontSize: 10 }}>{c.dataType}</span>
              </label>
            ))}
            {sources.size === 0 && <div className="rd-small" style={{ padding: 6 }}>Pick source tables first.</div>}
          </div>
        </div>

        {/* 2 · Define the new table */}
        <div>
          <div style={step}>2 · Define the new table</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Schema</label>
              <input className="rd-input rd-mono" placeholder="schema_name" value={schema} onChange={(e) => setSchema(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Table Name</label>
              <input className="rd-input" autoFocus placeholder="e.g. resumen cliente" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
          <label style={{ ...lbl, marginTop: 14 }}>Generated SQL</label>
          <pre style={{
            margin: 0, padding: 12, borderRadius: 10, background: '#0F1B30', color: '#CBD6EA',
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 150,
          }}>{sql}</pre>
          <div className="rd-small" style={{ marginTop: 8, color: 'var(--text-muted, #8A93A5)' }}>
            {pickedCols.length} column{pickedCols.length === 1 ? '' : 's'} from {srcTables.length} source table{srcTables.length === 1 ? '' : 's'}.
          </div>
        </div>
      </div>
    </Dialog>
  );
}
