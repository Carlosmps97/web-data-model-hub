/**
 * DiffTree (doc 31) — jerarquía de cambios de un request para el popup
 * "Change details". Extraído del viejo DiffBody inline de ReviewScreen y
 * enriquecido: filas TINTADAS por verbo (verde/ámbar/rojo, como las cards del
 * diseño original), selección para el panel de detalle, y secciones
 * RELATIONSHIPS (antes invisibles en modo jerárquico), Structure changes y
 * Not on any canvas. Con backend sin jerarquía cae al listado plano.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  ChangesetDiff,
  DiffEntity,
  DiffTreeNode,
} from '@/types/versioning';

/** Selección de una fila del árbol (alimenta el panel derecho del modal). */
export interface TreeSelection {
  key: string;
  collection: string;
  entityId: string;
  name: string;
  /** Label de tipo para el header del detalle (Table / Column / …). */
  type: string;
  change?: 'added' | 'edited' | 'deleted' | null;
  /** Ids de columnas cambiadas bajo una tabla (para el fetch por lote). */
  childColumnIds?: string[];
}

export const TYPE_LABEL: Record<string, string> = {
  project: 'Project', folder: 'Folder', canvas: 'Canvas', schema: 'Schema',
  table: 'Table', view: 'View', column: 'Column',
};
const NODE_COLLECTION: Record<string, string> = {
  table: 'canonical_tables', column: 'canonical_columns', view: 'views',
};
/** `structure[].type` YA es el nombre de colección (projects/folders/…). */
const PILL: Record<string, string> = { added: 'added', edited: 'modified', deleted: 'deleted' };
const COLL_LBL: Record<string, string> = {
  canonical_tables: 'Table', canonical_columns: 'Column', views: 'View',
  relationships: 'Relationship', schemas: 'Schema', projects: 'Project',
  folders: 'Folder', subject_areas: 'Canvas', parent_domains: 'Parent Domain',
  abbreviation_dict: 'Glossary term',
};

const FLAT_PAGE = 150;

interface RelRow {
  entity: DiffEntity;
  change: 'added' | 'edited' | 'deleted';
}

export default function DiffTree({ diff, relationshipNames, selectedKey, onSelect }: {
  diff: ChangesetDiff;
  /** entityId → "PARENT → CHILD" (resuelto por el prefetch del modal). */
  relationshipNames: Record<string, string | undefined>;
  selectedKey: string | null;
  onSelect: (sel: TreeSelection) => void;
}) {
  const [openTables, setOpenTables] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(FLAT_PAGE);
  const toggle = (k: string) =>
    setOpenTables((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const tree = diff.tree ?? [];
  const orphans = diff.orphans ?? [];
  const structure = diff.structure ?? [];
  const relRows = useMemo<RelRow[]>(() => {
    const b = diff.collections.relationships;
    if (!b) return [];
    return (['added', 'edited', 'deleted'] as const).flatMap((v) =>
      b[v].map((entity) => ({ entity, change: v })),
    );
  }, [diff]);
  const hasHierarchy = tree.length > 0 || orphans.length > 0 || structure.length > 0;

  const row = (opts: {
    key: string;
    depth: number;
    typeLabel: string;
    name: string;
    change?: 'added' | 'edited' | 'deleted' | null;
    selectable: boolean;
    onClick?: () => void;
    chevron?: 'open' | 'closed' | null;
    onChevron?: () => void;
    right?: React.ReactNode;
  }) => (
    <div
      key={opts.key}
      className={[
        'dmh-rvd-row',
        opts.change ? `is-${opts.change}` : '',
        selectedKey === opts.key ? 'is-selected' : '',
        opts.selectable ? 'is-selectable' : '',
      ].filter(Boolean).join(' ')}
      style={{ paddingLeft: 8 + opts.depth * 15 }}
      onClick={opts.selectable ? opts.onClick : opts.onChevron}
      role={opts.selectable || opts.chevron ? 'button' : undefined}
    >
      {opts.chevron ? (
        <button
          type="button"
          className="dmh-rvd-chev"
          onClick={(e) => { e.stopPropagation(); opts.onChevron?.(); }}
          aria-label={opts.chevron === 'open' ? 'Collapse' : 'Expand'}
        >
          {opts.chevron === 'open'
            ? <ChevronDown size={13} aria-hidden />
            : <ChevronRight size={13} aria-hidden />}
        </button>
      ) : (
        <span style={{ width: 17, flex: 'none' }} />
      )}
      <span className="dmh-rvd-type">{opts.typeLabel}</span>
      <span className={`dmh-rvd-name mono${opts.change === 'deleted' ? ' strike' : ''}`}>
        {opts.name}
      </span>
      {opts.change && <span className={`dmh-rv-diffrow-pill is-${opts.change}`}>{PILL[opts.change]}</span>}
      {opts.right}
    </div>
  );

  const renderNode = (node: DiffTreeNode, depth: number, path: string): React.ReactNode => {
    const key = `${path}/${node.type}:${node.id}`;
    const kids = node.children ?? [];
    const isTable = node.type === 'table';
    const expanded = !isTable || openTables.has(key);
    const collection = NODE_COLLECTION[node.type];
    const changedCols = isTable
      ? kids.filter((c) => c.type === 'column' && c.change).map((c) => c.id)
      : undefined;
    const selectable = Boolean(collection && (node.change || (changedCols?.length ?? 0) > 0));
    return (
      <div key={key}>
        {row({
          key,
          depth,
          typeLabel: TYPE_LABEL[node.type] ?? node.type,
          name: node.name,
          change: node.change,
          selectable,
          onClick: () => {
            if (isTable && !expanded) toggle(key);
            if (collection) {
              onSelect({
                key, collection, entityId: node.id, name: node.name,
                type: TYPE_LABEL[node.type] ?? node.type, change: node.change,
                childColumnIds: changedCols,
              });
            }
          },
          chevron: isTable && kids.length > 0 ? (expanded ? 'open' : 'closed') : null,
          onChevron: isTable ? () => toggle(key) : undefined,
          right: isTable && kids.length > 0 ? (
            <span className="dmh-rvd-count">{kids.length} col{kids.length === 1 ? '' : 's'}</span>
          ) : undefined,
        })}
        {expanded && kids.map((c) => renderNode(c, depth + 1, key))}
      </div>
    );
  };

  const section = (label: string) => (
    <div className="dmh-rvd-section" key={`section-${label}`}>{label}</div>
  );

  if (hasHierarchy || relRows.length > 0) {
    return (
      <div className="dmh-rvd-tree">
        {tree.map((n) => renderNode(n, 0, ''))}
        {orphans.length > 0 && (
          <>
            {section('Not on any canvas')}
            {orphans.map((n) => renderNode(n, 0, 'orphan'))}
          </>
        )}
        {relRows.length > 0 && (
          <>
            {section('Relationships')}
            {relRows.map(({ entity, change }) =>
              row({
                key: `rel:${entity.id}`,
                depth: 0,
                typeLabel: 'Rel',
                name: relationshipNames[entity.id] ?? entity.name ?? 'Relationship',
                change,
                selectable: true,
                onClick: () => onSelect({
                  key: `rel:${entity.id}`, collection: 'relationships', entityId: entity.id,
                  name: relationshipNames[entity.id] ?? 'Relationship',
                  type: 'Relationship', change,
                }),
              }))}
          </>
        )}
        {structure.length > 0 && (
          <>
            {section('Structure changes')}
            {structure.map((s) =>
              row({
                key: `struct:${s.type}:${s.id}`,
                depth: 0,
                typeLabel: s.kind,
                name: s.name,
                change: s.change,
                selectable: true,
                onClick: () => onSelect({
                  key: `struct:${s.type}:${s.id}`, collection: s.type, entityId: s.id,
                  name: s.name, type: s.kind, change: s.change,
                }),
              }))}
          </>
        )}
      </div>
    );
  }

  // ── Fallback plano (backend sin jerarquía) ──
  const flat: { change: 'added' | 'edited' | 'deleted'; entity: DiffEntity; collection: string }[] = [];
  Object.entries(diff.collections).forEach(([collection, bucket]) => {
    (['added', 'edited', 'deleted'] as const).forEach((v) => {
      bucket[v].forEach((entity) => flat.push({ change: v, entity, collection }));
    });
  });
  if (flat.length === 0) {
    return <div className="dmh-rv-diff-empty">No structural changes in this request.</div>;
  }
  return (
    <div className="dmh-rvd-tree">
      {flat.slice(0, shown).map(({ change, entity, collection }) =>
        row({
          key: `flat:${collection}:${entity.id}`,
          depth: 0,
          typeLabel: COLL_LBL[collection] ?? collection,
          name: entity.name ?? entity.id,
          change,
          selectable: true,
          onClick: () => onSelect({
            key: `flat:${collection}:${entity.id}`, collection, entityId: entity.id,
            name: entity.name ?? entity.id, type: COLL_LBL[collection] ?? collection, change,
          }),
        }))}
      {flat.length > shown && (
        <button
          type="button"
          className="dmh-rv-act"
          style={{ margin: '8px auto' }}
          onClick={() => setShown((n) => n + FLAT_PAGE)}
        >
          Show {Math.min(FLAT_PAGE, flat.length - shown)} more ({flat.length - shown} remaining)
        </button>
      )}
    </div>
  );
}
