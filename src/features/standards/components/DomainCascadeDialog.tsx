/**
 * DomainCascadeDialog — «Apply changes · <dominio>» (docs F2 #2 · 95 D7): la lista
 * EXACTA de columnas que re-tipa el apply (misma regla que la cascada), una fila
 * por columna, paginada en el servidor y con buscador. «Show skipped columns»
 * suma las que no cambian (override o tipo ya distinto) con su motivo.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Boxes, UploadCloud } from 'lucide-react';
import { AffectedTable, Button, Dialog, type AffectedColumn } from '@/components/ui';
import { mergePage } from '@/components/ui/affectedRows';
import { getDomainColumnImpact, type DomainColumnImpact, type DomainColumnImpactRow } from '@/services/naming.service';
import { STATUS_LABEL, impactBanner, tableLabel, typeCell, typeChanges, type TypeTargets } from '../domainImpact';

const PAGE = 500;
const STATUS_COLOR = { change: '#0E8C6A', override: '#9A6B00', differs: '#8A93A5' } as const;

export default function DomainCascadeDialog({ projectId, domainId, domainName, targets, busy, title, onCancel, onApply }: {
  projectId: string; domainId: string; domainName: string; targets: TypeTargets;
  busy: boolean; title?: string; onCancel: () => void; onApply: () => void;
}) {
  const hasChange = Boolean(targets.physicalTo || targets.logicalTo);
  const [q, setQ] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [impact, setImpact] = useState<DomainColumnImpact | null>(null);
  const [rows, setRows] = useState<DomainColumnImpactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const paging = useRef(false);

  const load = useCallback(async (offset: number, id: number) => {
    const res = await getDomainColumnImpact(projectId, domainId, {
      physicalTo: targets.physicalTo, logicalTo: targets.logicalTo, q: q.trim() || undefined,
      status: showSkipped ? undefined : 'change', offset, limit: PAGE,
    });
    if (id !== reqId.current) return;             // respuesta vieja: el usuario siguió escribiendo
    setImpact(res);
    setRows((prev) => mergePage(prev, res.rows, offset));
  }, [projectId, domainId, targets.physicalTo, targets.logicalTo, q, showSkipped]);

  // Primera página (y cada vez que cambian la búsqueda o el filtro), con debounce.
  useEffect(() => {
    if (!hasChange) return undefined;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const h = setTimeout(() => {
      load(0, id)
        .catch((e) => { if (id === reqId.current) setError(e instanceof Error ? e.message : "Couldn't load the impact"); })
        .finally(() => { if (id === reqId.current) setLoading(false); });
    }, 300);
    return () => clearTimeout(h);
  }, [hasChange, load]);

  // Una página a la vez: `loading` (estado) recién cambia en el próximo render y
  // un segundo scroll antes de él pediría el mismo offset (final review #9).
  const loadMore = () => {
    if (paging.current || loading || !impact || rows.length >= impact.matched) return;
    paging.current = true;
    const id = reqId.current;
    setLoading(true);
    load(rows.length, id).catch(() => undefined).finally(() => {
      paging.current = false;
      if (id === reqId.current) setLoading(false);
    });
  };

  const itargets = impact?.targets ?? {};
  const columns: AffectedColumn<DomainColumnImpactRow>[] = [
    { key: 'table', header: 'Table', width: '1.3fr', mono: true, render: (r) => tableLabel(r) },
    { key: 'column', header: 'Column', width: '1fr', mono: true, render: (r) => r.column },
    { key: 'attribute', header: 'Attribute', width: '1fr', render: (r) => r.attribute },
    ...(targets.physicalTo
      ? [{ key: 'physical', header: 'Physical type', width: '1.1fr', mono: true,
          render: (r: DomainColumnImpactRow) => typeCell(r, 'physical', itargets) }]
      : []),
    ...(targets.logicalTo
      ? [{ key: 'logical', header: 'Logical type', width: '1.1fr', mono: true,
          render: (r: DomainColumnImpactRow) => typeCell(r, 'logical', itargets) }]
      : []),
    {
      key: 'status', header: 'Status', width: '160px', title: (r) => STATUS_LABEL[r.status],
      render: (r) => <span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{STATUS_LABEL[r.status]}</span>,
    },
  ];

  const sameType = impact !== null && Object.keys(impact.targets).length === 0;
  let body: React.ReactNode;
  if (!hasChange) {
    body = <div style={muted}>Names, descriptions and UDP defaults of the domain are updated. No column is re-typed.</div>;
  } else if (error) {
    body = <div style={{ fontSize: 12.5, color: '#C0392B' }}>{error}</div>;
  } else if (!impact) {
    body = <div style={muted}>Calculating impact…</div>;
  } else if (sameType) {
    body = <div style={muted}>Once normalized, the new type is the same as the current one — no column is re-typed.</div>;
  } else {
    body = (
      <>
        {typeChanges(impact).map((l) => <div key={l} style={typeLine}>{l}</div>)}
        <div style={banner}>{impactBanner(impact)}</div>
        <AffectedTable rows={rows} total={impact.matched} columns={columns} rowKey={(r) => r.columnId}
          query={q} onQuery={setQ} searchPlaceholder="Search table or column…" onEndReached={loadMore}
          loading={loading} height={360}
          emptyText={q.trim() ? 'No column matches the search.' : 'No column is re-typed.'}
          toolbar={(
            <label style={toggleLabel}>
              <input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />
              Show skipped columns
            </label>
          )} />
      </>
    );
  }

  return (
    <Dialog open title={title ?? `Apply changes · ${domainName}`} icon={Boxes} onClose={onCancel} width={1000}
      subtitle={hasChange ? 'Cascades the new type to the columns that follow this domain.'
        : 'No column type changes — only the domain definition is updated.'}
      footer={<>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon={UploadCloud} onClick={onApply} disabled={busy}>
          {busy ? 'Applying…' : hasChange && !sameType ? 'Apply cascade' : 'Apply'}
        </Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{body}</div>
    </Dialog>
  );
}

const muted: React.CSSProperties = { fontSize: 13, color: '#56607A', lineHeight: 1.5 };
const typeLine: React.CSSProperties = { fontFamily: 'var(--mono, monospace)', fontSize: 13, fontWeight: 600, color: '#1A2B4A' };
const banner: React.CSSProperties = { background: '#FFF9EE', border: '1px solid #F1E2BD', borderRadius: 11, padding: '12px 15px', fontSize: 13, fontWeight: 600, color: '#7A6220' };
const toggleLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#56607A', cursor: 'pointer', whiteSpace: 'nowrap' };
