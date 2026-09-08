import { Fragment } from 'react';
import { Tags } from 'lucide-react';
import type { UdpDefinition, UdpLevel } from '@/features/standards/standards.service';
import { FACET_CLASS_LABEL, facetUdpDefs, type Facet } from '@/lib/facets';

/** Valores UDP de SOLO LECTURA (Object Inspector, doc 72): nombre de la
 *  definición → valor, o el default en cursiva si no hay valor. Lista las defs
 *  del `level` y la faceta (doc 69), igual que `UdpAssign` pero sin inputs. */
export default function UdpReadonly({ defs, level, facet, values }: {
  defs: UdpDefinition[]; level: UdpLevel; facet: Facet; values: Record<string, string>;
}) {
  const list = facetUdpDefs(defs, level, facet);
  if (list.length === 0) {
    return (
      <div className="rd-small" style={{ color: 'var(--muted)' }}>
        No UDPs defined for <b>{FACET_CLASS_LABEL[level][facet]}</b>.
      </div>
    );
  }
  return (
    <dl className="wk-pp-meta wk-insp-udps">
      {list.map((d) => {
        const v = values[d.id];
        return (
          <Fragment key={d.id}>
            <dt title={d.description ?? undefined}><Tags size={11} color="#7A4DD6" /> {d.name}</dt>
            <dd>
              {v ? v : d.defaultValue
                ? <span className="wk-insp-default">{d.defaultValue} (default)</span>
                : <span className="wk-insp-empty">—</span>}
            </dd>
          </Fragment>
        );
      })}
    </dl>
  );
}
