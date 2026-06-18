'use client';

import { useState } from 'react';

export type SortDir = 'asc' | 'desc';

/** Sortable-column state + a stable `sortBy` for the Model Center grids. */
export function useSort(initial: string) {
  const [sortKey, setSortKey] = useState(initial);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const onSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };
  function sortBy<T>(arr: T[], get: (row: T, k: string) => string | number): T[] {
    return [...arr].sort((a, b) => {
      const x = get(a, sortKey); const y = get(b, sortKey);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return c * (sortDir === 'asc' ? 1 : -1);
    });
  }
  return { sortKey, sortDir, onSort, sortBy };
}

export type UseSort = ReturnType<typeof useSort>;
