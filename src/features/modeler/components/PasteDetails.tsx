import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, KeyRound, Search } from 'lucide-react';
import { facetNouns, type Facet } from '@/lib/facets';
import { collapseComplexType, isComplexType } from '../lib/complexTypes';
import type { PasteColumnItem, PasteOptions, PasteReview, PasteUdpItem } from '../lib/pasteReview';

/** Columnas por página en la lista del popup (10 y «cargar más»). */
export const PASTE_PAGE = 10;

/** Filas a la vista: búsqueda «contiene» sobre el nombre lógico o físico (sin
 *  mayúsculas) y las primeras `shown`. Pura. */
export function visibleColumns(cols: PasteColumnItem[], q: string, shown: number): { rows: PasteColumnItem[]; matched: number } {
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? cols.filter((c) => c.logicalName.toLowerCase().includes(needle) || c.physicalName.toLowerCase().includes(needle))
    : cols;
  return { rows: hits.slice(0, shown), matched: hits.length };
}

/**
 * Lo que va a viajar en un pegado, compartido por «Paste table» y
 * «Paste columns»: checks por grupo (UDPs lógicos, UDPs físicos, parent
 * domains), selector Lógico | Físico con la metadata de esa faceta, la tabla
 * agrupada y las columnas una por una (10 por página, «cargar más» y buscador),
 * y lo que no se puede copiar.
 */
export default function PasteDetails({ review, options, onOptions, facet, onFacet, rowTag }: {
  review: PasteReview;
  options: PasteOptions;
  onOptions: (next: PasteOptions) => void;
  facet: Facet;
  onFacet: (next: Facet) => void;
  /** Etiqueta por columna (pegar columnas: New / Logical name exists / skipped). */
  rowTag?: (c: PasteColumnItem) => ReactNode;
}) {
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PASTE_PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const n = facetNouns(facet);
  const { rows, matched } = visibleColumns(review.columns, q, shown);
  const { counts } = review;
  const facetUdps = (items: PasteUdpItem[]) => items.filter((u) => u.facet === facet && u.status !== 'missing');

  return (
    <div className="wk-paste-details">
      <div className="wk-paste-checks" role="group" aria-label="What to copy">
        <span className="wk-paste-checks-cap">Copy</span>
        <Check label={`Logical UDPs (${counts.logicalUdps})`} on={options.logicalUdps}
          onChange={(v) => onOptions({ ...options, logicalUdps: v })} />
        <Check label={`Physical UDPs (${counts.physicalUdps})`} on={options.physicalUdps}
          onChange={(v) => onOptions({ ...options, physicalUdps: v })} />
        <Check label={`Parent domains (${counts.domains})`} on={options.domains}
          onChange={(v) => onOptions({ ...options, domains: v })} />
      </div>
      <p className="wk-pp-cap wk-paste-always">
        Names, definitions, comments, data types and keys of both models are always copied. Relationships and views are not.
      </p>

      <div className="rd-seg wk-paste-facet" role="tablist" aria-label="Model">
        {(['logical', 'physical'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={facet === f} className={facet === f ? 'active' : ''}
            onClick={() => onFacet(f)}>
            {f === 'logical' ? 'Logical' : 'Physical'}
          </button>
        ))}
      </div>

      {review.table && (
        <section className="wk-paste-sec" aria-label={n.One}>
          <h4>{n.One}</h4>
          {facet === 'physical' && review.table.schema && (
            <div className="wk-paste-kv">
              <span>Schema</span>
              <span className="rd-mono">{review.table.schema.name}</span>
              {review.table.schema.create && <span className="wk-paste-tag ok">Created in your version</span>}
            </div>
          )}
          <UdpList items={facetUdps(review.table.udps)} empty={`No ${facet} UDPs on this ${n.one}.`} />
        </section>
      )}

      <section className="wk-paste-sec" aria-label={n.Members}>
        <h4>{n.Members} <span className="wk-paste-count">{review.columns.length}</span></h4>
        {review.columns.length > PASTE_PAGE && (
          <div className="wk-findres-search wk-paste-search">
            <Search size={14} aria-hidden />
            <input value={q} placeholder={`Search ${n.members}…`} aria-label={`Search ${n.members}`}
              onChange={(e) => { setQ(e.target.value); setShown(PASTE_PAGE); }} />
          </div>
        )}
        <div className="wk-paste-list">
          {rows.map((c) => {
            const isOpen = openId === c.sourceId;
            const name = facet === 'logical' ? c.logicalName : c.physicalName;
            const type = facet === 'logical' ? c.logicalType : c.physicalType;
            // La fila muestra lo que viaja: sin su check (o si la columna se omite), ni el dominio ni los UDP.
            const domain = !c.skipped && c.domain?.status === 'copy' ? (facet === 'logical' ? c.domain.name : c.domain.physicalName) : '';
            const udps = facetUdps(c.udps);
            const copied = c.skipped ? 0 : udps.filter((u) => u.status === 'copy').length;
            return (
              <div key={c.sourceId} className={`wk-paste-item${c.skipped ? ' blocked' : ''}`}>
                <button type="button" className="wk-paste-row" aria-expanded={isOpen}
                  onClick={() => setOpenId(isOpen ? null : c.sourceId)}>
                  {isOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                  <span className="wk-node-key" aria-hidden>
                    {c.isPrimaryKey && <KeyRound size={11} strokeWidth={2} style={{ color: 'var(--k-pk)' }} />}
                  </span>
                  <span className="wk-paste-name" title={`${c.logicalName} · ${c.physicalName}`}>
                    <span>{name}</span>
                    {domain && <span className="wk-paste-phys">{domain}</span>}
                  </span>
                  <span className="wk-paste-dt rd-mono" title={isComplexType(type) ? type : undefined}>{collapseComplexType(type)}</span>
                  {copied > 0 && <span className="wk-paste-tag ok" title={`${copied} ${facet} UDPs`}>{copied} UDP</span>}
                  {rowTag?.(c)}
                </button>
                {isOpen && <ColumnDetail c={c} facet={facet} udps={udps} />}
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="wk-paste-empty">{review.columns.length ? `No ${n.members} match «${q.trim()}».` : `No ${n.members}.`}</div>
          )}
        </div>
        {matched > rows.length && (
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm wk-paste-more" onClick={() => setShown(shown + PASTE_PAGE)}>
            Load {Math.min(PASTE_PAGE, matched - rows.length)} more · {rows.length} of {matched}
          </button>
        )}
      </section>

      {review.warnings.length > 0 && (
        <div className="wk-paste-note warn" role="status">
          <strong>Can&apos;t be copied</strong>
          <ul>{review.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {review.blockers.length > 0 && (
        <div className="wk-paste-note err" role="alert">
          <strong>Fix before pasting</strong>
          <ul>{review.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`wk-paste-check${on ? ' on' : ''}`}>
      <input type="checkbox" checked={on} onChange={() => onChange(!on)} /> {label}
    </label>
  );
}

function UdpList({ items, empty }: { items: PasteUdpItem[]; empty: string }) {
  if (!items.length) return <p className="wk-paste-none">{empty}</p>;
  return (
    <ul className="wk-paste-udps">
      {items.map((u, i) => (
        <li key={`${i}:${u.defId}`} className={u.status === 'off' ? 'off' : ''}>
          <span>{u.name}</span>
          <span className="wk-paste-udpval">{u.value}</span>
          {u.status === 'off' && <span className="wk-paste-tag blocked">Not copied</span>}
        </li>
      ))}
    </ul>
  );
}

function ColumnDetail({ c, facet, udps }: { c: PasteColumnItem; facet: Facet; udps: PasteUdpItem[] }) {
  const domain = c.domain && c.domain.status !== 'missing' ? c.domain : null;
  return (
    <div className="wk-paste-detail">
      {facet === 'logical' ? (
        <div className="wk-paste-kv"><span>Definition</span><span>{c.description || '—'}</span></div>
      ) : (
        <>
          <div className="wk-paste-kv">
            <span>Physical name</span><span className="rd-mono">{c.physicalName}</span>
            {c.caseChanged && <span className="wk-paste-tag warn" title="Adjusted to this project's naming case">Case adjusted</span>}
          </div>
          <div className="wk-paste-kv"><span>Comment</span><span>{c.physicalDescription || 'Same as the definition'}</span></div>
        </>
      )}
      <div className="wk-paste-kv">
        <span>Parent domain</span>
        <span>{domain ? (facet === 'logical' ? domain.name : domain.physicalName) : '—'}</span>
        {domain?.status === 'off' && <span className="wk-paste-tag blocked">Not copied</span>}
      </div>
      <UdpList items={udps} empty={`No ${facet} UDPs.`} />
    </div>
  );
}
