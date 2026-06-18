'use client';

import React from 'react';
import Icon from '@/components/ui/Icon';
import { getEngine } from '@/features/engines';
import { formatTag } from '@/lib/tags';
import { Th } from './GridBits';
import type { CatalogRow, Selection } from '../lib/catalog';
import type { UseSort } from '../hooks/useSort';

export interface TablesGridProps {
  rows: CatalogRow[];
  sort: UseSort;
  sel: Selection;
  onSelect: (s: Selection) => void;
}

/** The "Tables" tab grid — one row per table across all projects. */
export default function TablesGrid({ rows, sort, sel, onSelect }: TablesGridProps) {
  return (
    <div className="mc-gridwrap">
      <table className="mc-grid">
        <thead><tr>
          <Th label="Tabla" k="table" {...sort} />
          <Th label="Proyecto · Modelo" k="project" {...sort} />
          <Th label="Modelo" k="layer" {...sort} w={86} />
          <Th label="Engine" k="engine" {...sort} w={116} />
          <Th label="Dominio" k="domain" {...sort} w={130} />
          <Th label="Owner" k="owner" {...sort} w={110} />
          <Th label="Cols" k="columns" {...sort} align="right" w={56} />
          <Th label="Vistas" k="views" {...sort} align="right" w={64} />
          <Th label="FKs" k="fks" {...sort} align="right" w={50} />
        </tr></thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={i} className={sel?.kind === 'table' && sel.row === t ? 'active' : ''} onClick={() => onSelect({ kind: 'table', row: t })}>
              <td><span className="mc-name"><span className="mc-tico"><Icon name="table" size={12} /></span>{t.schema}.{t.table}{t.tags.length > 0 && <span className="mc-tagdot" title={t.tags.map(formatTag).join(' · ')}><Icon name="tag" size={9} />{t.tags.length}</span>}</span></td>
              <td className="mc-dim">{t.project} · {t.model}</td>
              <td>{t.layerId ? <span className="rd-badge" style={{ background: t.layerColor + '1a', color: t.layerColor }}>{t.model}</span> : <span className="mc-dim">—</span>}</td>
              <td><span className="rd-engine" style={{ padding: '2px 8px 2px 6px' }}><span className="dot" style={{ background: getEngine(t.engine)?.color }} />{getEngine(t.engine)?.shortLabel ?? '—'}</span></td>
              <td>{t.domainId ? <span className="rd-badge" style={{ background: t.domainColor + '1a', color: t.domainColor }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: t.domainColor }} />{t.domainName}</span> : <span className="mc-dim">—</span>}</td>
              <td className="mc-dim">{t.owner || '—'}</td>
              <td className="mc-num">{t.columns.length}</td>
              <td className="mc-num">{t.views.length || '—'}</td>
              <td className="mc-num">{t.fkCount || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="dmh-empty" style={{ padding: 40 }}>Ninguna tabla coincide con los filtros.</div>}
    </div>
  );
}
