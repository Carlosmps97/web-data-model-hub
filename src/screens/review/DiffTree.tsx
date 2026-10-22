/**
 * DiffTree: jerarquía navegable de los cambios de un request para el popup
 * "Change details": icono por tipo de entidad, verbo como pill discreta, filas
 * tintadas suaves, filtros por verbo + búsqueda por nombre (una fila es visible
 * si coincide ella o algún descendiente; buscar auto-expande las tablas) y
 * contadores por sección. La selección lleva además el `path` de ancestros
 * (breadcrumb del panel) y el `iconType` crudo. Si el backend no envía la
 * jerarquía, cae al listado plano (mismo contrato).
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Boxes, ChevronDown, ChevronRight, Columns3, Database, Eye, Folder, Layers,
  Link2, Table2, Tags,
} from 'lucide-react';
import type { DiffStructureEntry, DiffTreeNode } from '@/types/versioning';

/** Lo que el árbol necesita de un diff: lo cumplen tanto el diff de
 *  un request (`ChangesetDiff`) como el compare de versiones (`VersionCompare`). */
export interface DiffEntityLike {
  id: string; name?: string | null; conflict?: boolean; restores?: boolean; deletedInProduction?: boolean;
}
export interface DiffBucketLike { added: DiffEntityLike[]; edited: DiffEntityLike[]; deleted: DiffEntityLike[] }
export interface DiffLike {
  collections: Record<string, DiffBucketLike>;
  tree?: DiffTreeNode[];
  orphans?: DiffTreeNode[];
  structure?: DiffStructureEntry[];
}

export type DiffVerb = 'added' | 'edited' | 'deleted';

/** Selección de una fila del árbol (alimenta el panel derecho del modal). */
export interface TreeSelection {
  key: string;
  collection: string;
  entityId: string;
  name: string;
  /** Label de tipo para el header del detalle (Table / Column / …). */
  type: string;
  /** Tipo crudo para el icono (table / column / view / …). */
  iconType?: string;
  change?: DiffVerb | null;
  /** Ids de columnas cambiadas bajo una tabla (para el fetch por lote). */
  childColumnIds?: string[];
  /** Ruta de ancestros (Proyecto › Folder › Canvas) para el breadcrumb. */
  path?: string[];
}

export const TYPE_LABEL: Record<string, string> = {
  project: 'Project', folder: 'Folder', canvas: 'Canvas', schema: 'Schema',
  table: 'Table', view: 'View', column: 'Column', relationship: 'Relationship',
};
export const TYPE_ICON: Record<string, ReactNode> = {
  project: <Boxes size={13} strokeWidth={1.7} />,
  folder: <Folder size={13} strokeWidth={1.7} />,
  canvas: <Layers size={13} strokeWidth={1.7} />,
  schema: <Database size={13} strokeWidth={1.7} />,
  table: <Table2 size={13} strokeWidth={1.7} />,
  view: <Eye size={13} strokeWidth={1.7} />,
  column: <Columns3 size={13} strokeWidth={1.7} />,
  relationship: <Link2 size={13} strokeWidth={1.7} />,
  other: <Tags size={13} strokeWidth={1.7} />,
};
const NODE_COLLECTION: Record<string, string> = {
  table: 'canonical_tables', column: 'canonical_columns', view: 'views',
  // Los nodos de estructura que cambiaron en el request se marcan y
  // se seleccionan en el árbol (su entidad versionada viaja en `entityId`).
  folder: 'folders', canvas: 'subject_areas', schema: 'schemas', project: 'projects',
};
/** `structure[].type` ya es el nombre de colección (projects/folders/…). */
const PILL: Record<string, string> = { added: 'added', edited: 'modified', deleted: 'deleted' };
const COLL_LBL: Record<string, string> = {
  canonical_tables: 'Table', canonical_columns: 'Column', views: 'View',
  relationships: 'Relationship', schemas: 'Schema', projects: 'Project',
  folders: 'Folder', subject_areas: 'Canvas', parent_domains: 'Parent Domain',
  abbreviation_dict: 'Glossary term',
};
/** Colección → tipo crudo del icono (para structure y el fallback plano). */
const COLL_TYPE: Record<string, string> = {
  canonical_tables: 'table', canonical_columns: 'column', views: 'view',
  relationships: 'relationship', schemas: 'schema', projects: 'project',
  folders: 'folder', subject_areas: 'canvas',
};

const FLAT_PAGE = 150;

interface RelRow {
  entity: DiffEntityLike;
  change: DiffVerb;
  name: string;
}

/** ¿El nodo (o algún descendiente) sobrevive búsqueda + filtro de verbos? */
function nodeVisible(n: DiffTreeNode, q: string, verbs: Set<DiffVerb>): boolean {
  const selfHit = !!n.change && verbs.has(n.change) && (!q || n.name.toLowerCase().includes(q));
  if (selfHit) return true;
  return (n.children ?? []).some((c) => nodeVisible(c, q, verbs));
}

export default function DiffTree({ diff, relationshipNames, selectedKey, onSelect, search, verbs }: {
  diff: DiffLike;
  /** entityId → "PARENT → CHILD" (resuelto por el prefetch del modal). */
  relationshipNames: Record<string, string | undefined>;
  selectedKey: string | null;
  onSelect: (sel: TreeSelection) => void;
  /** Búsqueda por nombre (contiene, case-insensitive). */
  search: string;
  /** Verbos visibles (chips del modal). */
  verbs: Set<DiffVerb>;
}) {
  const q = search.trim().toLowerCase();
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
  // Lo que ya está en el árbol (con su pill) no se repite abajo.
  const structure = (diff.structure ?? [])
    .filter((s) => !s.inTree && verbs.has(s.change) && (!q || s.name.toLowerCase().includes(q)));
  const relRows = useMemo<RelRow[]>(() => {
    const b = diff.collections.relationships;
    if (!b) return [];
    return (['added', 'edited', 'deleted'] as const)
      .filter((v) => verbs.has(v))
      .flatMap((v) => b[v].map((entity) => ({
        entity, change: v,
        name: relationshipNames[entity.id] ?? entity.name ?? 'Relationship',
      })))
      .filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [diff, relationshipNames, verbs, q]);
  const hasHierarchy = tree.length > 0 || orphans.length > 0 || (diff.structure ?? []).length > 0;

  const row = (opts: {
    key: string;
    depth: number;
    /** Tipo crudo (table/column/…) para icono + tooltip. */
    iconType: string;
    name: string;
    change?: DiffVerb | null;
    selectable: boolean;
    mono?: boolean;
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
      style={{ paddingLeft: 6 + opts.depth * 14 }}
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
        <span className="dmh-rvd-chevsp" />
      )}
      <span className="dmh-rvd-ico" title={TYPE_LABEL[opts.iconType] ?? opts.iconType} aria-hidden>
        {TYPE_ICON[opts.iconType] ?? TYPE_ICON.other}
      </span>
      <span className={`dmh-rvd-name${opts.mono ? ' mono' : ''}${opts.change === 'deleted' ? ' strike' : ''}`}>
        {opts.name}
      </span>
      {opts.change && <span className="dmh-rvd-verb">{PILL[opts.change]}</span>}
      {opts.right}
    </div>
  );

  const renderNode = (node: DiffTreeNode, depth: number, keyPath: string, namePath: string[]): React.ReactNode => {
    if (!nodeVisible(node, q, verbs)) return null;
    const key = `${keyPath}/${node.type}:${node.id}`;
    const kids = node.children ?? [];
    const visKids = kids.filter((c) => nodeVisible(c, q, verbs));
    const isTable = node.type === 'table';
    // Buscar/filtrar auto-expande: el hit puede estar en una columna interna.
    const expanded = !isTable || openTables.has(key) || q !== '';
    const collection = NODE_COLLECTION[node.type];
    const changedCols = isTable
      ? kids.filter((c) => c.type === 'column' && c.change && verbs.has(c.change)).map((c) => c.id)
      : undefined;
    const selectable = Boolean(collection && (node.change || (changedCols?.length ?? 0) > 0));
    return (
      <div key={key}>
        {row({
          key,
          depth,
          iconType: node.type,
          name: node.name,
          change: node.change,
          selectable,
          mono: node.type === 'table' || node.type === 'column' || node.type === 'view' || node.type === 'schema',
          onClick: () => {
            if (isTable && !expanded) toggle(key);
            if (collection) {
              onSelect({
                key, collection, entityId: node.entityId ?? node.id, name: node.name,
                type: TYPE_LABEL[node.type] ?? node.type, iconType: node.type,
                change: node.change, childColumnIds: changedCols, path: namePath,
              });
            }
          },
          chevron: isTable && visKids.length > 0 ? (expanded ? 'open' : 'closed') : null,
          onChevron: isTable ? () => toggle(key) : undefined,
          right: isTable && visKids.length > 0 ? (
            <span className="dmh-rvd-count">{visKids.length} col{visKids.length === 1 ? '' : 's'}</span>
          ) : node.type === 'column' && node.dataType ? (
            // El tipo se lee en la fila, sin abrir cada columna.
            <span className="dmh-rvd-dtype" title="Data type">{node.dataType}</span>
          ) : undefined,
        })}
        {expanded && visKids.map((c) => renderNode(c, depth + 1, key, [...namePath, node.name]))}
      </div>
    );
  };

  const section = (label: string, count: number) => (
    <div className="dmh-rvd-section" key={`section-${label}`}>
      {label}
      <span className="dmh-rvd-seccount">{count}</span>
    </div>
  );

  if (hasHierarchy || relRows.length > 0) {
    const treeVisible = tree.filter((n) => nodeVisible(n, q, verbs));
    const orphVisible = orphans.filter((n) => nodeVisible(n, q, verbs));
    const nothing = treeVisible.length === 0 && orphVisible.length === 0
      && relRows.length === 0 && structure.length === 0;
    return (
      <div className="dmh-rvd-tree">
        {treeVisible.map((n) => renderNode(n, 0, '', []))}
        {orphVisible.length > 0 && (
          <>
            {section('Not on any canvas', orphVisible.length)}
            {orphVisible.map((n) => renderNode(n, 0, 'orphan', []))}
          </>
        )}
        {relRows.length > 0 && (
          <>
            {section('Relationships', relRows.length)}
            {relRows.map(({ entity, change, name }) =>
              row({
                key: `rel:${entity.id}`,
                depth: 0,
                iconType: 'relationship',
                name,
                change,
                selectable: true,
                mono: true,
                onClick: () => onSelect({
                  key: `rel:${entity.id}`, collection: 'relationships', entityId: entity.id,
                  name, type: 'Relationship', iconType: 'relationship', change,
                }),
              }))}
          </>
        )}
        {structure.length > 0 && (
          <>
            {section('Structure changes', structure.length)}
            {structure.map((s) =>
              row({
                key: `struct:${s.type}:${s.id}`,
                depth: 0,
                iconType: COLL_TYPE[s.type] ?? 'other',
                name: s.name,
                change: s.change,
                selectable: true,
                onClick: () => onSelect({
                  key: `struct:${s.type}:${s.id}`, collection: s.type, entityId: s.id,
                  name: s.name, type: s.kind, iconType: COLL_TYPE[s.type] ?? 'other', change: s.change,
                }),
              }))}
          </>
        )}
        {nothing && <div className="dmh-rvd-noresults">No changes match the current filters.</div>}
      </div>
    );
  }

  // ── Fallback plano (backend sin jerarquía) ──
  const flat: { change: DiffVerb; entity: DiffEntityLike; collection: string }[] = [];
  Object.entries(diff.collections).forEach(([collection, bucket]) => {
    (['added', 'edited', 'deleted'] as const).forEach((v) => {
      if (!verbs.has(v)) return;
      bucket[v].forEach((entity) => {
        const nm = entity.name ?? entity.id;
        if (q && !nm.toLowerCase().includes(q)) return;
        flat.push({ change: v, entity, collection });
      });
    });
  });
  if (flat.length === 0) {
    return <div className="dmh-rvd-noresults">No changes match the current filters.</div>;
  }
  return (
    <div className="dmh-rvd-tree">
      {flat.slice(0, shown).map(({ change, entity, collection }) =>
        row({
          key: `flat:${collection}:${entity.id}`,
          depth: 0,
          iconType: COLL_TYPE[collection] ?? 'other',
          name: entity.name ?? entity.id,
          change,
          selectable: true,
          mono: true,
          onClick: () => onSelect({
            key: `flat:${collection}:${entity.id}`, collection, entityId: entity.id,
            name: entity.name ?? entity.id, type: COLL_LBL[collection] ?? collection,
            iconType: COLL_TYPE[collection] ?? 'other', change,
          }),
        }))}
      {flat.length > shown && (
        <button
          type="button"
          className="dmh-rv-act dmh-rv-act--comment"
          style={{ margin: '8px auto' }}
          onClick={() => setShown((n) => n + FLAT_PAGE)}
        >
          Show {Math.min(FLAT_PAGE, flat.length - shown)} more ({flat.length - shown} remaining)
        </button>
      )}
    </div>
  );
}
