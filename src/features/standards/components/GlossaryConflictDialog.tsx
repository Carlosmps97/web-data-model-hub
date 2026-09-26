/**
 * GlossaryConflictDialog — el término no se puede agregar (doc 95 D1): por qué
 * (duplicado y/o uso en nombres lógicos) y TODOS los nombres involucrados en una
 * tabla — tabla · columna · nombre lógico con la frase marcada.
 */
import { useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { AffectedTable, Badge, Button, Dialog, type AffectedColumn } from '@/components/ui';
import { filterRows } from '@/components/ui/affectedRows';
import type { GlossaryValidation, UdpScope } from '@/services/naming.service';
import { conflictMessage, conflictRows, highlightParts, type ConflictRow } from '../glossaryValidation';

export default function GlossaryConflictDialog({ term, scope, validation, onClose }: {
  term: string; scope: UdpScope; validation: GlossaryValidation; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => conflictRows(validation), [validation]);
  const shown = useMemo(() => filterRows(rows, q, (r) => [r.table, r.column, r.logical]), [rows, q]);
  const columns: AffectedColumn<ConflictRow>[] = [
    { key: 'table', header: 'Table', width: '1fr', mono: true, render: (r) => r.table },
    ...(scope === 'column'
      ? [{ key: 'column', header: 'Column', width: '1fr', mono: true, render: (r: ConflictRow) => r.column ?? '' }]
      : []),
    {
      key: 'logical', header: 'Logical name', width: '1.3fr', title: (r) => r.logical,
      render: (r) => highlightParts(r.logical, term).map((p, i) => (p.hit
        ? <mark key={i} style={mark}>{p.text}</mark>
        : <span key={i}>{p.text}</span>)),
    },
  ];

  return (
    <Dialog open title={`'${term}' can't be added`} subtitle="Glossary terms can't rename names that already exist."
      icon={ShieldAlert} onClose={onClose} width={780}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge tone="red">Blocked</Badge>
          <span style={{ fontSize: 12.5, color: '#56607A' }}>This term is not allowed in the glossary.</span>
        </div>
        {conflictMessage(validation, scope).map((line) => (
          <p key={line} style={{ margin: 0, fontSize: 13, color: '#1A2B4A', lineHeight: 1.5 }}>{line}</p>
        ))}
        {rows.length > 0 && (
          <AffectedTable rows={shown} total={rows.length} columns={columns}
            rowKey={(r, i) => `${r.table}.${r.column ?? ''}.${i}`} query={q} onQuery={setQ}
            searchPlaceholder={scope === 'column' ? 'Search table or column…' : 'Search table…'}
            height={Math.min(340, 44 + rows.length * 36)} />
        )}
      </div>
    </Dialog>
  );
}

const mark: React.CSSProperties = { background: '#FFE9A8', color: 'inherit', borderRadius: 3, padding: '0 1px' };
