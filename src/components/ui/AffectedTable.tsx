/**
 * AffectedTable — lista de afectados compartida (doc 95 D4): cabecera fija,
 * buscador, filas virtualizadas (decenas de miles sin congelar el navegador) y
 * pie con el conteo. Presentacional: el padre decide si filtra en memoria
 * (`filterRows`) o pagina en el servidor (`total` + `onEndReached`).
 */
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { countLabel } from './affectedRows';

export interface AffectedColumn<T> {
  key: string;
  header: string;
  /** Ancho de la columna en `grid-template-columns` (p. ej. '1fr' o '120px'). */
  width: string;
  render: (row: T) => React.ReactNode;
  /** Tooltip de la celda; por defecto, el texto cuando `render` devuelve un string. */
  title?: (row: T) => string;
  mono?: boolean;
}

export interface AffectedTableProps<T> {
  rows: T[];
  columns: AffectedColumn<T>[];
  rowKey: (row: T, index: number) => string;
  /** Total real cuando `rows` es una página o un filtro (default: `rows.length`). */
  total?: number;
  query?: string;
  onQuery?: (q: string) => void;
  searchPlaceholder?: string;
  /** Controles extra junto al buscador (p. ej. «Show skipped columns»). */
  toolbar?: React.ReactNode;
  /** Pide la página siguiente al acercarse al final (paginado del servidor). */
  onEndReached?: () => void;
  loading?: boolean;
  emptyText?: string;
  /** Alto del área con scroll, en px. */
  height?: number;
}

const ROW_H = 36;

export default function AffectedTable<T>({
  rows, columns, rowKey, total, query, onQuery, searchPlaceholder = 'Search…', toolbar,
  onEndReached, loading = false, emptyText = 'Nothing to show.', height = 320,
}: AffectedTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12,
  });
  const grid = columns.map((c) => c.width).join(' ');
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (onEndReached && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 8) onEndReached();
  };

  return (
    <div>
      {(onQuery || toolbar) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          {onQuery && (
            <div style={searchBox}>
              <Search size={13} color="#9AA3B2" aria-hidden />
              <input value={query ?? ''} onChange={(e) => onQuery(e.target.value)} placeholder={searchPlaceholder}
                aria-label={searchPlaceholder} style={searchInput} />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll}
        style={{ height, overflow: 'auto', border: '1px solid #E6EAF0', borderRadius: 10, background: '#fff' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'grid', gridTemplateColumns: grid,
          background: '#F7F9FC', borderBottom: '1px solid #E6EAF0' }}>
          {columns.map((c) => <div key={c.key} style={headCell}>{c.header}</div>)}
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12.5, color: '#9AA3B2' }}>{loading ? 'Loading…' : emptyText}</div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div key={rowKey(row, vi.index)} style={{ position: 'absolute', top: 0, left: 0, width: '100%',
                  height: ROW_H, transform: `translateY(${vi.start}px)`, display: 'grid', gridTemplateColumns: grid,
                  alignItems: 'center', borderBottom: '1px solid #F2F4F8', background: vi.index % 2 ? '#FCFDFE' : '#fff' }}>
                  {columns.map((c) => {
                    const content = c.render(row);
                    const title = c.title ? c.title(row) : typeof content === 'string' ? content : undefined;
                    return (
                      <div key={c.key} title={title}
                        style={{ ...cell, fontFamily: c.mono ? 'var(--mono, monospace)' : 'inherit' }}>{content}</div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: '#9AA3B2', marginTop: 6 }}>
        {countLabel(rows.length, total ?? rows.length)}{loading && rows.length > 0 ? ' · loading…' : ''}
      </div>
    </div>
  );
}

const searchBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', background: '#fff', border: '1px solid #E6EAF0', borderRadius: 8, flex: 1 };
const searchInput: React.CSSProperties = { flex: 1, border: 0, outline: 'none', fontSize: 12.5, background: 'transparent', fontFamily: 'inherit' };
const headCell: React.CSSProperties = { padding: '9px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A93A5' };
const cell: React.CSSProperties = { padding: '0 10px', fontSize: 12.5, color: '#1A2B4A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
