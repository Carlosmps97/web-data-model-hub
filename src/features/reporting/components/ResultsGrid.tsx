import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { QueryResult, ResultColumn } from '../query.service';

/** Grilla de resultados VIRTUALIZADA: columnas dinámicas (incl. UDP), scroll
 *  infinito por cursor (nunca trae 400k al browser), sort server-side por header. */
export default function ResultsGrid({ result, loading, onLoadMore, onSort, sort }: {
  result: QueryResult | null;
  loading: boolean;
  onLoadMore: () => void;
  onSort?: (key: string) => void;
  sort?: { field: string; dir: 'asc' | 'desc' } | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = result?.rows ?? [];
  const columns: ResultColumn[] = result?.columns ?? [];

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (result?.hasMore && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < 400) onLoadMore();
  };

  const colW = (c: ResultColumn) => (c.type === 'number' ? 110 : c.udp ? 190 : 200);
  const fmt = (v: unknown, c: ResultColumn) => {
    if (v === null || v === undefined || v === '') return '—';
    if (c.type === 'boolean') return v ? '✓' : '·';
    return String(v);
  };

  if (!result) return <div style={{ padding: 40, color: '#9AA3B2', fontSize: 13 }}>Run a query to see results.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 'none', display: 'flex', gap: 6, padding: '8px 4px', fontSize: 12, color: '#8A93A5' }}>
        {rows.length} fila{rows.length === 1 ? '' : 's'}{result.hasMore ? '+' : ''} · {columns.length} columnas
        {result.meta?.scan && <span style={{ color: result.meta.scan === 'index' ? '#2E9E5B' : '#B98600' }}> · scan: {result.meta.scan}</span>}
        {loading && <span style={{ color: '#2E5BFF' }}> · cargando…</span>}
      </div>
      <div ref={parentRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid #E6EAF0', borderRadius: 10, background: '#fff' }}>
        <div style={{ minWidth: columns.reduce((s, c) => s + colW(c), 40) }}>
          {/* header sticky */}
          <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', background: '#F7F9FC', borderBottom: '1px solid #E6EAF0' }}>
            {columns.map((c) => {
              const sortable = !c.udp && !result.meta?.grouped;   // sort server-side sólo por campos indexados
              const active = sort?.field === c.key;
              return (
                <div key={c.key} onClick={() => sortable && onSort?.(c.key)}
                  style={{ width: colW(c), flex: 'none', padding: '9px 10px', fontSize: 11.5, fontWeight: 700, color: '#48526A', cursor: sortable ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 5, userSelect: 'none' }}>
                  {c.udp && <span style={{ color: '#7A4DD6' }}>◆</span>}{c.label}
                  {active && <span style={{ color: '#2E5BFF' }}>{sort?.dir === 'asc' ? '↑' : '↓'}</span>}
                </div>
              );
            })}
          </div>
          {/* filas virtualizadas */}
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div key={vi.key} style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${vi.start}px)`, display: 'flex', width: '100%', height: 34, borderBottom: '1px solid #F2F4F8', background: vi.index % 2 ? '#FCFDFE' : '#fff' }}>
                  {columns.map((c) => (
                    <div key={c.key} title={String(row[c.key] ?? '')}
                      style={{ width: colW(c), flex: 'none', padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: 12.5, color: '#2B3346', fontFamily: c.type === 'number' ? 'var(--mono, monospace)' : 'inherit', justifyContent: c.type === 'number' ? 'flex-end' : 'flex-start', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {fmt(row[c.key], c)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
