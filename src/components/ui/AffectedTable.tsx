/**
 * AffectedTable — lista de afectados compartida (doc 95 D4): cabecera fija,
 * buscador, filas virtualizadas (decenas de miles sin congelar el navegador) y
 * pie con el conteo. Presentacional: el padre decide si filtra en memoria
 * (`filterRows`) o pagina en el servidor (`total` + `onEndReached`).
 *
 * Doc 96 D7: los bordes del encabezado se arrastran — una columna crece y la
 * vecina se achica en lo mismo (el ancho total no cambia, sin scroll
 * horizontal); doble clic en el borde vuelve a los anchos declarados.
 */
import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { countLabel, resizeColumns } from './affectedRows';

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
/** Ancho mínimo de una columna al arrastrar su borde (px). */
const MIN_COL = 72;

export default function AffectedTable<T>({
  rows, columns, rowKey, total, query, onQuery, searchPlaceholder = 'Search…', toolbar,
  onEndReached, loading = false, emptyText = 'Nothing to show.', height = 320,
}: AffectedTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Anchos arrastrados en px (null = los declarados por el popup).
  const headRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [widths, setWidths] = useState<number[] | null>(null);
  const colKeys = columns.map((c) => c.key).join('|');
  useEffect(() => { setWidths(null); }, [colKeys]);
  const startResize = (i: number) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;                 // solo botón principal (el derecho no arrastra)
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    // Solo las columnas actuales (si el popup cambió sus columnas, sobran refs viejas).
    const start = columns.map((_, j) => headRefs.current[j]?.getBoundingClientRect().width ?? 0);
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => setWidths(resizeColumns(start, i, ev.clientX - x0, MIN_COL));
    const end = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  };
  const virt = useVirtualizer({
    count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 12,
  });
  // `fr` proporcionales a los px medidos: la grilla sigue fluida si cambia el
  // ancho del popup y nunca suma más que el contenedor.
  const grid = widths && widths.length === columns.length
    ? widths.map((w) => `${Math.max(1, Math.round(w))}fr`).join(' ')
    : columns.map((c) => c.width).join(' ');
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
          {columns.map((c, i) => (
            <div key={c.key} ref={(el) => { headRefs.current[i] = el; }} style={headCell} title={c.header}>
              {c.header}
              {i < columns.length - 1 && (
                <span role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset"
                  onPointerDown={startResize(i)} onDoubleClick={() => setWidths(null)} style={resizeHandle} />
              )}
            </div>
          ))}
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
const headCell: React.CSSProperties = { position: 'relative', padding: '9px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A93A5', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const resizeHandle: React.CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 8, cursor: 'col-resize', borderRight: '2px solid #DDE3EC', touchAction: 'none' };
const cell: React.CSSProperties = { padding: '0 10px', fontSize: 12.5, color: '#1A2B4A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
