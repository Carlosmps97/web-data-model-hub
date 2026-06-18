'use client';

import React from 'react';
import Icon from '@/components/ui/Icon';
import { formatTag } from '@/lib/tags';
import { Th } from './GridBits';
import { PII, type CatalogRow, type ColRow, type Selection } from '../lib/catalog';
import type { UseSort } from '../hooks/useSort';

export interface ColumnsGridProps {
  rows: { c: ColRow; t: CatalogRow }[];
  sort: UseSort;
  onSelect: (s: Selection) => void;
}

/** The "Columns" tab grid — one row per column (capped at 400 for perf). */
export default function ColumnsGrid({ rows, sort, onSelect }: ColumnsGridProps) {
  return (
    <div className="mc-gridwrap">
      <table className="mc-grid">
        <thead><tr>
          <Th label="Columna" k="name" {...sort} />
          <Th label="Tipo" k="dataType" {...sort} w={130} />
          <Th label="Clave" k="key" {...sort} w={64} />
          <Th label="Definición · tags" k="def" {...sort} />
          <Th label="Tabla" k="table" {...sort} w={170} />
          <Th label="Proyecto" k="project" {...sort} w={140} />
        </tr></thead>
        <tbody>
          {rows.slice(0, 400).map((r, i) => (
            <tr key={i} onClick={() => onSelect({ kind: 'table', row: r.t })}>
              <td><span className="mc-name" style={{ fontWeight: 600 }}>{PII.test(r.c.name) && <span title="Sensible (PII)" style={{ color: 'var(--error)', display: 'inline-flex' }}><Icon name="key" size={12} /></span>}{r.c.name}</span></td>
              <td><span className="rd-mono mc-dim" style={{ fontSize: 11.5 }}>{r.c.dataType}</span></td>
              <td>{r.c.key ? <span className={`rd-key ${r.c.key.toLowerCase()}`}>{r.c.key}</span> : <span className="mc-dim">—</span>}</td>
              <td>
                <span className="mc-coldef" title={r.c.def || undefined}>{r.c.def || <span className="mc-dim">—</span>}</span>
                {r.c.tags.length > 0 && <span className="mc-tagdot" title={r.c.tags.map(formatTag).join(' · ')}><Icon name="tag" size={9} />{r.c.tags.length}</span>}
              </td>
              <td className="mc-dim">{r.t.schema}.{r.t.table}</td>
              <td className="mc-dim">{r.t.project}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="dmh-empty" style={{ padding: 40 }}>Ninguna columna coincide con la búsqueda.</div>}
    </div>
  );
}
