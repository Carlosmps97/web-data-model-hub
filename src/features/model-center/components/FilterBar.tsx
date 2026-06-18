'use client';

import React from 'react';
import Icon from '@/components/ui/Icon';
import { FilterSelect } from './GridBits';
import type { Tab } from '../lib/catalog';

type Flag = 'none' | 'nopk' | 'nodomain' | 'noview';

export interface FilterBarProps {
  tab: Tab;
  q: string; setQ: (v: string) => void;
  engine: string; setEngine: (v: string) => void; engOpts: [string, string][];
  layerF: string; setLayerF: (v: string) => void; layerOpts: [string, string][];
  domain: string; setDomain: (v: string) => void; domOpts: [string, string][];
  flag: Flag; setFlag: (f: Flag) => void;
  rowCount: number;
}

/** Search + engine/model/domain filters + active-flag chip for the table/view/column tabs. */
export default function FilterBar({ tab, q, setQ, engine, setEngine, engOpts, layerF, setLayerF, layerOpts, domain, setDomain, domOpts, flag, setFlag, rowCount }: FilterBarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
      <div className="rd-search" style={{ flex: 1, minWidth: 240 }}>
        <Icon name="search" size={15} />
        <input className="rd-input" placeholder={`Buscar ${tab}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <FilterSelect value={engine} onChange={setEngine} options={engOpts} />
      {tab === 'tables' && <FilterSelect value={layerF} onChange={setLayerF} options={layerOpts} />}
      {tab === 'tables' && <FilterSelect value={domain} onChange={setDomain} options={domOpts} />}
      {tab === 'tables' && flag !== 'none' && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setFlag('none')}><Icon name="x" size={13} />Quitar filtro</button>}
      <span className="rd-small" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{rowCount} filas</span>
    </div>
  );
}
