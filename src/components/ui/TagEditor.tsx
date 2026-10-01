'use client';

import React, { useState } from 'react';
import Icon from './Icon';
import type { Tag } from '@/types/model';
import { normalizeTags, tagId } from '@/lib/tags';

interface TagEditorProps {
  value?: Tag[];
  onChange: (tags: Tag[]) => void;
  /** Tighter spacing for in-row contexts (e.g. the column detail panel). */
  compact?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/**
 * Reusable key/value tag editor — chips + a "key = value" add row. Built on
 * `@/lib/tags`. Used at three levels (domain, table, column) per the
 * governance spec; tags are secondary metadata so callers render this last.
 */
export default function TagEditor({
  value,
  onChange,
  compact,
  keyPlaceholder = 'key',
  valuePlaceholder = 'value',
}: TagEditorProps) {
  const tags = normalizeTags(value) ?? [];
  const [k, setK] = useState('');
  const [v, setV] = useState('');

  const add = () => {
    const key = k.trim();
    const val = v.trim();
    if (!key && !val) return;
    if (tags.some((t) => t.key === key && t.value === val)) { setK(''); setV(''); return; }
    onChange([...tags, { key, value: val }]);
    setK(''); setV('');
  };
  const remove = (t: Tag) => onChange(tags.filter((x) => !(x.key === t.key && x.value === t.value)));
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };

  return (
    <div className={`tag-editor${compact ? ' compact' : ''}`}>
      {tags.length > 0 && (
        <div className="tag-chips">
          {tags.map((t) => (
            <span className="tag-chip" key={tagId(t)}>
              {t.key && <span className="tag-chip-k">{t.key}</span>}
              <span className="tag-chip-v">{t.value || '—'}</span>
              <button type="button" className="tag-chip-x" onClick={() => remove(t)} aria-label="Remove tag"><Icon name="x" size={11} sw={2.4} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-add">
        <input className="rd-input" value={k} placeholder={keyPlaceholder} onChange={(e) => setK(e.target.value)} onKeyDown={onKeyDown} />
        <span className="tag-eq">=</span>
        <input className="rd-input" value={v} placeholder={valuePlaceholder} onChange={(e) => setV(e.target.value)} onKeyDown={onKeyDown} />
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={add} disabled={!k.trim() && !v.trim()}><Icon name="plus" size={13} sw={2.6} />Add</button>
      </div>
    </div>
  );
}
