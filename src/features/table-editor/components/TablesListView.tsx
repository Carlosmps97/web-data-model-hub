'use client';

import React, { useMemo, useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { Table, Relationship, ModelLevel, Domain } from '@/types/model';
import { layerName, layerColor, domainName, domainColor } from '@/lib/hierarchy';

export type CreateKind = 'table' | 'fromsql' | 'dbml' | 'excel';

interface TablesListViewProps {
  scopedTables: Table[];
  scopedRels: Relationship[];
  layers: ModelLevel[];
  domains: Domain[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEditTable: (t: Table) => void;
  onCreate: (kind: CreateKind) => void;
  canEdit: boolean;
}

function tableKey(t: Table): 'PK' | 'FK' {
  if (t.columns.some((c) => c.isPrimaryKey)) return 'PK';
  return t.columns.some((c) => c.isForeignKey) ? 'FK' : 'PK';
}

export default function TablesListView({ scopedTables, scopedRels, layers, domains, selectedId, onSelect, onEditTable, onCreate, canEdit }: TablesListViewProps) {
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<'domain' | 'layer'>('domain');
  const [addOpen, setAddOpen] = useState(false);

  const groups = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = scopedTables.filter((t) => !q || t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)));
    const g: Record<string, Table[]> = {};
    filtered.forEach((t) => {
      const key = groupBy === 'layer' ? (t.layer ?? '∅') : (t.domain ?? '∅');
      (g[key] = g[key] ?? []).push(t);
    });
    const orderKeys = groupBy === 'layer' ? layers.map((l) => l.id) : domains.map((d) => d.id);
    return Object.keys(g).sort((a, b) => orderKeys.indexOf(a) - orderKeys.indexOf(b)).map((k) => [k, g[k]] as [string, Table[]]);
  }, [scopedTables, query, groupBy, layers, domains]);

  const colCount = scopedTables.reduce((a, t) => a + t.columns.length, 0);

  const createItems: { kind: CreateKind; icon: 'table' | 'database' | 'code' | 'upload'; label: string; section: string }[] = [
    { kind: 'table', icon: 'table', label: 'Nueva tabla', section: 'Crear' },
    { kind: 'fromsql', icon: 'database', label: 'Desde tablas existentes', section: 'Crear' },
    { kind: 'dbml', icon: 'code', label: 'Escribir DBML', section: 'Importar' },
    { kind: 'excel', icon: 'upload', label: 'Importar Excel', section: 'Importar' },
  ];

  return (
    <div className="ed-side">
      <div className="ed-side-head">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Tablas</span>
            <span className="rd-badge rd-badge-primary" style={{ padding: '2px 7px' }}>{scopedTables.length}</span>
          </div>
          {canEdit && (
            <div style={{ position: 'relative' }}>
              <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ padding: '6px 10px' }} onClick={() => setAddOpen((o) => !o)}>
                <Icon name="plus" size={14} sw={2.6} />New<Icon name="chevD" size={11} />
              </button>
              {addOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setAddOpen(false)} />
                  <div className="rd-menu" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, width: 218 }}>
                    {createItems.map((it, i) => (
                      <React.Fragment key={it.kind}>
                        {(i === 0 || createItems[i - 1].section !== it.section) && <div className="rd-menu-label">{it.section}</div>}
                        <button className="rd-menu-item" onClick={() => { setAddOpen(false); onCreate(it.kind); }}><Icon name={it.icon} size={15} />{it.label}</button>
                      </React.Fragment>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="rd-search"><Icon name="search" size={14} /><input className="rd-input" style={{ padding: '7px 10px 7px 32px', fontSize: 12.5 }} placeholder="Buscar tablas y columnas…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <span className="rd-small" style={{ fontWeight: 700, color: 'var(--muted)' }}>Agrupar</span>
          <div className="rd-seg" style={{ marginLeft: 'auto', padding: 2 }}>
            <button className={groupBy === 'domain' ? 'active' : ''} style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setGroupBy('domain')}>Dominio</button>
            <button className={groupBy === 'layer' ? 'active' : ''} style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setGroupBy('layer')}>Modelo</button>
          </div>
        </div>
      </div>

      <div className="ed-side-list">
        {groups.length === 0 && <div className="rd-small" style={{ padding: 14, textAlign: 'center' }}>Sin tablas en este scope.</div>}
        {groups.map(([key, tabs]) => {
          const isLayer = groupBy === 'layer';
          const c = isLayer ? layerColor(layers, key) : domainColor(domains, key);
          const label = isLayer ? layerName(layers, key) : domainName(domains, key);
          return (
            <div key={key}>
              <div className="ed-group-head"><Icon name="chevD" size={12} style={{ color: 'var(--subtle)' }} /><span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} /><span className="lbl">{label === '∅' ? 'Sin asignar' : label}</span><span className="cnt">{tabs.length}</span></div>
              {tabs.map((t) => {
                const k = tableKey(t);
                return (
                  <div key={t.id} className={`ed-side-item${selectedId === t.id ? ' active' : ''}`} onClick={() => onSelect(t.id)} onDoubleClick={() => onEditTable(t)}>
                    <span className={`rd-key ${k.toLowerCase()}`} style={{ minWidth: 20, height: 17, fontSize: 9 }}>{k}</span>
                    <span className="nm">{t.name}</span>
                    {t.layer && <span className="ed-layer-pill" style={{ color: layerColor(layers, t.layer), borderColor: layerColor(layers, t.layer) }}>{layerName(layers, t.layer)}</span>}
                    <span className="cc">{t.columns.length}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="ed-side-foot">
        <span className="rd-badge rd-badge-flow"><Icon name="merge" size={11} />{scopedRels.length} relaciones</span>
        <span className="rd-badge rd-badge-neutral"><Icon name="columns" size={11} />{colCount} columnas</span>
      </div>
    </div>
  );
}
