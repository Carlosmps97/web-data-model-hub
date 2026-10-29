import { facetNouns } from '@/lib/facets';
import { useModelerStore } from '@/store/useModelerStore';

/** Cuántas tablas tiene el grupo seleccionado y qué se puede hacer con él (doc 134 §3.3). */
export default function GroupPill() {
  const count = useModelerStore((s) => s.groupIds.length);
  const nouns = facetNouns(useModelerStore((s) => s.viewMode));
  if (count < 2) return null;
  return (
    <div className="wk-group-pill" role="status">
      {count} {nouns.many} selected · Right-click for actions · Esc to clear
    </div>
  );
}
