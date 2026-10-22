/**
 * DomainHistory — historial de un parent domain: las versiones de Data
 * Standards que modificaron este dominio, qué se modificó en cada una y «Revert
 * to vN», que carga esos valores en el editor (se aplican con el mismo popup de
 * cascada: misma regla, una versión más, auditada).
 */
import { useEffect, useMemo, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { getDomainHistory, type DomainHistoryEntry } from '../standards.service';
import { historyLines } from '../domainHistory';

export default function DomainHistory({ projectId, domainId, canEdit, onRevert }: {
  projectId: string; domainId: string; canEdit: boolean; onRevert: (entry: DomainHistoryEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DomainHistoryEntry[] | null>(null);

  useEffect(() => { setEntries(null); }, [domainId]);
  useEffect(() => {
    if (!open || entries !== null) return undefined;
    let alive = true;
    getDomainHistory(projectId, domainId)
      .then((e) => { if (alive) setEntries(e); })
      .catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [open, entries, projectId, domainId]);

  const lines = useMemo(() => historyLines(entries ?? []), [entries]);

  let body: React.ReactNode = null;
  if (open && entries === null) body = <div style={muted}>Loading…</div>;
  else if (open && entries?.length === 0) body = <div style={muted}>No versions recorded for this domain yet.</div>;
  else if (open && entries) {
    body = (
      <div style={{ marginTop: 8 }}>
        {entries.map((e, i) => (
          <div key={e.seq} style={row}>
            <span style={label}>{e.label}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#1A2B4A' }}>{e.title}</div>
              <div style={{ fontSize: 11.5, color: '#8A93A5', marginTop: 2 }}>
                {e.author}{e.createdAt ? ` · ${e.createdAt.slice(0, 16).replace('T', ' ')}` : ''}
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#56607A' }}>
                {lines[i].map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
            {i === 0 && e.state && <Badge tone="green">Current</Badge>}
            {i > 0 && e.state && canEdit && (
              <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => onRevert(e)}>Revert to {e.label}</Button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={box}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={toggle} aria-expanded={open}>
        <History size={14} /> History {open ? '▾' : '▸'}
      </button>
      {body}
    </div>
  );
}

const box: React.CSSProperties = { background: '#fff', border: '1px solid #E2E6EE', borderRadius: 12, padding: '12px 15px', margin: '4px 0 18px' };
const toggle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', padding: 0, fontSize: 13, fontWeight: 600, color: '#1A2B4A', cursor: 'pointer', fontFamily: 'inherit' };
const muted: React.CSSProperties = { fontSize: 12.5, color: '#8A93A5', marginTop: 8 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderTop: '1px solid #F2F4F8' };
const label: React.CSSProperties = { fontFamily: 'var(--mono, monospace)', fontSize: 10.5, fontWeight: 600, color: '#56607A', background: '#F2F4F8', borderRadius: 5, padding: '1px 6px', marginTop: 2 };
