'use client';

import React from 'react';
import Icon from '@/components/ui/Icon';
import type { SortDir } from '../hooks/useSort';

/** Sortable header cell shared by the Model Center grids. */
export function Th({ label, k, sortKey, sortDir, onSort, align, w }: {
  label: string; k: string; sortKey: string; sortDir: SortDir; onSort: (k: string) => void; align?: 'right'; w?: number;
}) {
  const active = sortKey === k;
  return (
    <th className={`mc-th${active ? ' active' : ''}`} style={{ textAlign: align ?? 'left', width: w }} onClick={() => onSort(k)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {label}{active && <Icon name="chevD" size={11} style={{ transform: sortDir === 'asc' ? 'none' : 'rotate(180deg)' }} />}
      </span>
    </th>
  );
}

/** Compact dropdown used in the Model Center filter bar. */
export function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="dmh-select">
      <select className="rd-input" style={{ padding: '7px 28px 7px 11px', fontSize: 12.5, width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
      </select>
      <Icon name="chevD" size={13} className="chev" />
    </div>
  );
}
