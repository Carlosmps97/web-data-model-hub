/**
 * GlossaryApplyDialog — confirmación del apply del glosario (docs 94 D7 · 95 D3/D4):
 * los nombres que renombra el borrador y, APARTE, los que ya estaban desfasados
 * de la regla vigente (p. ej. un U+00A0 venido del XML) y el apply repara de
 * paso. Listas completas, con buscador, y los invisibles se ven.
 */
import { useMemo, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { AffectedTable, Button, Dialog, type AffectedColumn } from '@/components/ui';
import { filterRows, showInvisible } from '@/components/ui/affectedRows';
import type { GlossaryImpact, GlossaryImpactRow, UdpScope } from '@/services/naming.service';
import { NO_RENAMES, applyTitle, impactNote, impactSummary, outOfSyncReason } from '../glossaryValidation';

export interface TermDiff { added: string[]; edited: string[]; removed: string[] }

const KIND_COLOR = { added: '#0E8C6A', edited: '#56607A', removed: '#C0392B' } as const;

function columnsFor(withReason: boolean): AffectedColumn<GlossaryImpactRow>[] {
  return [
    { key: 'type', header: 'Type', width: '76px', render: (r) => (r.entity === 'column' ? 'Column' : 'Table') },
    { key: 'table', header: 'Table', width: '1fr', mono: true, render: (r) => showInvisible(r.table), title: (r) => r.table },
    { key: 'from', header: 'Current name', width: '1fr', mono: true, render: (r) => showInvisible(r.from), title: (r) => r.from },
    { key: 'to', header: 'New name', width: '1fr', mono: true, render: (r) => r.to },
    ...(withReason
      ? [{ key: 'reason', header: 'Why', width: '1fr', render: (r: GlossaryImpactRow) => outOfSyncReason(r) }]
      : []),
  ];
}

function ImpactSection({ title, rows, withReason }: { title: string; rows: GlossaryImpactRow[]; withReason: boolean }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => filterRows(rows, q, (r) => [r.table, r.from, r.to]), [rows, q]);
  return (
    <div>
      <div style={sectionTitle}>{title}</div>
      {impactSummary(rows).map((line) => (
        <div key={line} style={{ fontSize: 13, fontWeight: 600, color: '#1A2B4A', padding: '2px 0 6px' }}>{line}</div>
      ))}
      <AffectedTable rows={shown} total={rows.length} columns={columnsFor(withReason)}
        rowKey={(r, i) => `${r.entity}.${r.tableId}.${r.from}.${i}`} query={q} onQuery={setQ}
        searchPlaceholder="Search table or name…" height={Math.min(280, 44 + rows.length * 36)} />
    </div>
  );
}

export default function GlossaryApplyDialog({ scope, impact, diff, busy, onCancel, onApply }: {
  scope: UdpScope; impact: GlossaryImpact; diff: TermDiff; busy: boolean; onCancel: () => void; onApply: () => void;
}) {
  const renames = impact.renamed.length > 0;
  return (
    <Dialog open title={applyTitle(impact)} subtitle="Manually overridden names are kept." icon={UploadCloud}
      onClose={onCancel} width={900}
      footer={<>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon={UploadCloud} onClick={onApply} disabled={busy}>
          {busy ? 'Applying…' : renames ? 'Apply & rename' : 'Apply'}
        </Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={sectionTitle}>What changes</div>
          {(['added', 'edited', 'removed'] as const).flatMap((k) => diff[k].map((s, i) => (
            <div key={`${k}-${i}`} style={{ fontSize: 13, color: '#1A2B4A', padding: '3px 0' }}>
              · <span style={{ color: KIND_COLOR[k], fontWeight: 600 }}>{k}</span> {s}
            </div>
          )))}
        </div>
        {renames
          ? <ImpactSection title={`Names your changes rename (${impact.renamed.length.toLocaleString('en-US')})`}
              rows={impact.renamed} withReason={false} />
          : <div style={{ fontSize: 13, fontWeight: 600, color: '#0E8C6A' }}>{NO_RENAMES}</div>}
        {impact.outOfSync.length > 0 && (
          <ImpactSection title={`Already out of sync — repaired on apply (${impact.outOfSync.length.toLocaleString('en-US')})`}
            rows={impact.outOfSync} withReason />
        )}
        <div style={note}>{impactNote(scope)}</div>
      </div>
    </Dialog>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 6 };
const note: React.CSSProperties = { background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 11, padding: '12px 15px', fontSize: 12.5, color: '#7A6220' };
