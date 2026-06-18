'use client';

import React from 'react';
import Icon from '@/components/ui/Icon';
import { layerName } from '@/lib/hierarchy';
import type { Table, ModelLevel } from '@/types/model';

export interface EditorListViewProps {
  scopedTables: Table[];
  layers: ModelLevel[];
  onEditTable: (t: Table) => void;
}

/** The editor's "List" view — a card grid of the in-scope tables. */
export default function EditorListView({ scopedTables, layers, onEditTable }: EditorListViewProps) {
  return (
    <div className="lv">
      <div className="lv-grid">
        {scopedTables.map((t) => (
          <div className="lv-card" key={t.id} onClick={() => onEditTable(t)}>
            <div className="lv-card-head">
              <span className="lv-card-ico" style={{ background: (t.color ?? '#4f46e5') + '1a', color: t.color }}><Icon name="table" size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{t.schema}.{t.name}</div>
                <div className="rd-small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.functionalDefinition || '—'}</div>
              </div>
              {t.layer && <span className="ed-layer-pill" style={{ color: layers.find((l) => l.id === t.layer)?.color, borderColor: layers.find((l) => l.id === t.layer)?.color }}>{layerName(layers, t.layer)}</span>}
            </div>
            {t.columns.slice(0, 5).map((c) => {
              const k = c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : c.isSurrogateKey ? 'SK' : c.isPartitionKey ? 'PT' : '';
              return (
                <div className="lv-col" key={c.id}>
                  {k ? <span className={`rd-key ${k.toLowerCase()}`} style={{ minWidth: 19, height: 16, fontSize: 8.5 }}>{k}</span> : <span className="rd-key none"><span className="d" /></span>}
                  <span className="nm">{c.name}</span><span className="ty">{c.dataType}</span>
                </div>
              );
            })}
            {t.columns.length > 5 && <div className="lv-col" style={{ color: 'var(--subtle)', fontWeight: 600 }}>+{t.columns.length - 5} más</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
