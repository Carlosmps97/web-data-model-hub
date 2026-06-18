'use client';

import React from 'react';
import Icon from '@/components/ui/Icon';
import { Th } from './GridBits';
import type { CatalogRow, ViewRow, Selection } from '../lib/catalog';
import type { UseSort } from '../hooks/useSort';

export interface ViewsGridProps {
  rows: { v: ViewRow; t: CatalogRow }[];
  sort: UseSort;
  sel: Selection;
  onSelect: (s: Selection) => void;
}

/** The "Views" tab grid — one row per SQL view across all projects. */
export default function ViewsGrid({ rows, sort, sel, onSelect }: ViewsGridProps) {
  return (
    <div className="mc-gridwrap">
      <table className="mc-grid">
        <thead><tr>
          <Th label="Vista" k="name" {...sort} />
          <Th label="Sobre la tabla" k="table" {...sort} />
          <Th label="Proyecto" k="project" {...sort} w={150} />
          <Th label="Tipo" k="type" {...sort} w={110} />
          <Th label="Rol" k="role" {...sort} w={150} />
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={sel?.kind === 'view' && sel.view === r.v ? 'active' : ''} onClick={() => onSelect({ kind: 'view', row: r.t, view: r.v })}>
              <td><span className="mc-name"><span className="mc-tico" style={{ background: 'var(--flow-soft)', color: 'var(--flow-700)' }}><Icon name="eye" size={12} /></span><span className="rd-mono" style={{ fontSize: 12.5 }}>{r.v.name}</span></span></td>
              <td className="mc-dim">{r.t.schema}.{r.t.table}</td>
              <td className="mc-dim">{r.t.project}</td>
              <td><span className={`rd-badge ${r.v.type === 'business' ? 'rd-badge-primary' : 'rd-badge-flow'}`}>{r.v.type}</span></td>
              <td className="mc-dim">{r.v.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="dmh-empty" style={{ padding: 40 }}>Ninguna vista coincide con la búsqueda.</div>}
    </div>
  );
}
