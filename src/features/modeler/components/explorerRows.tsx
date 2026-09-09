import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { EllipsisVertical, KeyRound, Link as LinkIcon } from 'lucide-react';
import type { DbxColumn, DbxViewCol } from '../services/explorer.service';

/**
 * Filas compartidas del Explorer unificado (docs 71/72) — columnas de tabla y
 * salidas de vista de las ramas del proyecto (`ProjectCatalog`).
 */

/** Indentación por nivel (mismos valores que ModelExplorer). */
export const INDENT = 14;
export const PAD_BASE = 6;
export const padFor = (depth: number) => PAD_BASE + depth * INDENT;

export function Spin() {
  return <span className="rd-spin" style={{ color: 'var(--primary)', marginLeft: 'auto' }} aria-hidden />;
}

export function EmptyLine({ depth, children }: { depth: number; children: ReactNode }) {
  return <div className="wk-exp-empty" style={{ paddingLeft: padFor(depth) }}>{children}</div>;
}

const colIcon = (c: DbxColumn): ReactNode =>
  c.isPrimaryKey ? <KeyRound size={11} style={{ color: 'var(--k-pk)' }} />
    : c.isForeignKey ? <LinkIcon size={11} style={{ color: 'var(--k-fk)' }} /> : null;

/** Columna de tabla: PK/FK · nombre físico · tipo. Con `onClick` es navegable
 *  (ir al canvas y abrir su Properties). */
export function ColumnLine({ col, depth, onClick, onMenu }: {
  col: DbxColumn; depth: number; onClick?: (e: ReactMouseEvent<HTMLElement>) => void;
  /** Doc 72: menú ⋮ (Inspect metadata · Locate on canvas). */
  onMenu?: (e: ReactMouseEvent<HTMLElement>) => void;
}) {
  const title = col.logicalName
    ? `${col.logicalName}${col.description ? ` — ${col.description}` : ''}`
    : (col.description || undefined);
  return (
    <div className={`wk-exp-row wk-dbx-col${onClick ? ' wk-exp-clickable' : ''}`}
      style={{ paddingLeft: padFor(depth), cursor: onClick ? 'pointer' : 'default' }} title={title} onClick={onClick}>
      <span className="wk-exp-ico" style={{ width: 12, justifyContent: 'center' }}>{colIcon(col)}</span>
      <span className="wk-exp-label rd-mono" style={{ fontSize: 12 }}>{col.physicalName}</span>
      <span className="wk-dbx-type rd-mono">{col.dataType}</span>
      {onMenu && (
        <button type="button" className="wk-exp-dots" title="Inspect metadata · Locate on canvas" aria-label="Options"
          onClick={(e) => { e.stopPropagation(); onMenu(e); }}>
          <EllipsisVertical size={13} />
        </button>
      )}
    </div>
  );
}

/** Columnas de salida de una vista (alias · cast), solo lectura. `tableName`
 *  traduce el id de la tabla fuente para el tooltip. */
export function ViewColumnLines({ viewId, cols, depth, tableName }: {
  viewId: string; cols: DbxViewCol[]; depth: number; tableName?: (id: string) => string;
}) {
  return (
    <>
      {cols.map((c, i) => (
        <div key={`${viewId}:${i}`} className="wk-exp-row wk-dbx-col" style={{ paddingLeft: padFor(depth), cursor: 'default' }}
          title={c.expression || (c.sourceTable ? `${tableName ? tableName(c.sourceTable) : c.sourceTable}.${c.sourceColumn ?? ''}` : undefined)}>
          <span className="wk-exp-ico" style={{ width: 12 }} />
          <span className="wk-exp-label rd-mono" style={{ fontSize: 12 }}>{c.outputAlias || c.sourceColumn || '—'}</span>
          {c.castType && <span className="wk-dbx-type rd-mono">{c.castType}</span>}
        </div>
      ))}
    </>
  );
}
