/**
 * Diálogos de borrado compartidos por los Properties del canvas y el Object
 * Inspector: un solo texto de impacto para tabla/entidad, columna/atributo y
 * vista. El trabajo corre dentro del diálogo (`action`): queda con spinner y
 * bloqueado hasta terminar (evita reclics durante la espera); si `action`
 * lanza, la promesa rechaza y el caller muestra el motivo.
 */
import type { ReactNode } from 'react';
import { confirmDialog } from '@/components/ui/dialogs';
import * as gov from '@/services/governance.service';
import type { RelationshipImpact } from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import type { FacetNouns } from '@/lib/facets';

/** Conteos del impacto de borrar una tabla (Properties los consulta; el
 *  inspector los saca del dossier, `tableDeleteImpact`). null = no se pudo
 *  contar (el diálogo lo dice en vez de mostrar «0»). */
export interface TableDeleteCounts { canvases: number | null; related: number | null; views: number | null }

/** Pre-conteo de Properties. Una lectura que falla queda en null, no en 0:
 *  el borrado se llevaría igual lo que el diálogo no mostró. */
export async function readTableDeleteCounts(tableId: string): Promise<TableDeleteCounts> {
  const [usage, rels, views] = await Promise.all([
    gov.tableUsage(tableId).then((u) => u.usage).catch(() => null),
    gov.listRelationships(tableId).catch(() => null),
    viewsSvc.listViews(tableId).catch(() => null),
  ]);
  return {
    canvases: usage ? usage.length : null,
    related: rels ? new Set(rels.flatMap((r) => [r.parentTableId, r.childTableId]).filter((t) => t !== tableId)).size : null,
    views: views ? views.length : null,
  };
}

/** Una línea del impacto: el número con su texto, o qué no se pudo contar. */
const impactLine = (n: number | null, counted: (n: number) => ReactNode, uncounted: string) =>
  n == null ? <li>{uncounted}</li> : <li><strong>{n}</strong> {counted(n)}</li>;

export function confirmDeleteTable(o: {
  name: string; nouns: FacetNouns; impact: TableDeleteCounts; action: () => Promise<unknown>;
}): Promise<boolean> {
  const { nouns, impact: { canvases, related, views: nViews } } = o;
  return confirmDialog({
    title: `Delete ${nouns.one}`,
    variant: 'danger',
    confirmLabel: `Delete ${nouns.one}`,
    cancelLabel: 'Cancel',
    message: <>
      {nouns.One} <strong>“{o.name}”</strong> will be deleted from the model. This affects:
      <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
        {impactLine(canvases, (n) => `canvas${n === 1 ? '' : 'es'} it appears on`,
          "Couldn't count the canvases it appears on")}
        {impactLine(related, (n) => `related ${n === 1 ? nouns.one : nouns.many} (their relationships are removed)`,
          `Couldn't count its related ${nouns.many} (their relationships are removed)`)}
        {impactLine(nViews, (n) => `view${n === 1 ? '' : 's'} (also deleted)`,
          "Couldn't count its views (they are deleted too)")}
      </ul>
      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>Its {nouns.members} and relationships go too. This change is part of the current version.</div>
    </>,
    action: o.action,
  });
}

/** Las relaciones que pierden pares: la otra punta y los canvases donde se ven. */
const relationshipList = (impact: RelationshipImpact) => (
  <ul style={{ margin: '8px 0 0', paddingLeft: 18, maxHeight: 180, overflow: 'auto' }}>
    {impact.relationships.map((r) => (
      <li key={r.relId} style={{ marginBottom: 4 }}>
        <span className="rd-mono">{r.otherTableName}.{r.otherColumnName}</span>
        {r.canvases.length > 0 && (
          <span className="rd-small" style={{ color: 'var(--muted)' }}>
            {' '}— in {r.canvases.map((c) => c.name).join(', ')}
          </span>
        )}
      </li>
    ))}
  </ul>
);

/** Las vistas que el borrado deja sin columnas (el Export DDL las escribiría
 *  como `SELECT *`): se avisan y el borrado sigue. null = no se pudo revisar;
 *  sin dato o sin vistas, nada. */
const emptiedViewsNote = (names: string[] | null | undefined) => {
  if (names === undefined || names?.length === 0) return null;
  const style = { margin: '10px 0 0' };
  if (names === null) return <p style={style}>{"Couldn't check which views would be left without columns."}</p>;
  const one = names.length === 1;
  return (
    <p style={style}>
      {one ? 'This view will be left without columns: ' : `These ${names.length} views will be left without columns: `}
      <span className="rd-mono">{names.join(', ')}</span>
      {one ? '. Edit or delete it afterwards.' : '. Edit or delete them afterwards.'}
    </p>
  );
};

/** Borrado de columna con impacto global: relaciones donde la columna es
 *  extremo, en cualquier canvas; cada una pierde el par (o se borra si era el
 *  último). `emptiedViews`: las vistas que quedan sin columnas. */
export function confirmDeleteColumn(o: {
  name: string; nouns: FacetNouns; impact: RelationshipImpact; emptiedViews?: string[] | null; action: () => Promise<unknown>;
}): Promise<boolean> {
  const { impact } = o;
  return confirmDialog({
    title: `Delete ${o.nouns.member}`,
    message: impact.total > 0 ? (
      <>
        <p style={{ margin: 0 }}>
          {o.nouns.Member} <strong>“{o.name}”</strong> participates in <strong>{impact.total}</strong> relationship{impact.total === 1 ? '' : 's'} — each will lose this pair (or be deleted if it was the last one):
        </p>
        {relationshipList(impact)}
        {emptiedViewsNote(o.emptiedViews)}
      </>
    ) : (
      <>{o.nouns.Member} <strong>“{o.name}”</strong> will be removed from this {o.nouns.one}.{emptiedViewsNote(o.emptiedViews)}</>
    ),
    confirmLabel: impact.total > 0 ? 'Delete anyway' : 'Delete',
    cancelLabel: 'Cancel', variant: 'danger',
    action: o.action,
  });
}

/** Borrado de varias columnas de una tabla (menú del canvas): todas en un
 *  diálogo, con las relaciones que pierden pares y las vistas que quedan sin
 *  columnas. Con una sola, el diálogo de `confirmDeleteColumn`. */
export function confirmDeleteColumns(o: {
  names: string[]; tableName: string; nouns: FacetNouns; impact: RelationshipImpact;
  emptiedViews?: string[] | null; action: () => Promise<unknown>;
}): Promise<boolean> {
  const { names, nouns, impact } = o;
  if (names.length === 1) return confirmDeleteColumn({ name: names[0], nouns, impact, emptiedViews: o.emptiedViews, action: o.action });
  return confirmDialog({
    title: `Delete ${names.length} ${nouns.members}`,
    message: (
      <>
        <p style={{ margin: 0 }}>{names.length} {nouns.members} of <strong>“{o.tableName}”</strong> will be deleted:</p>
        <ul className="rd-mono" style={{ margin: '8px 0 0', paddingLeft: 18, maxHeight: 140, overflow: 'auto' }}>
          {names.map((name, i) => <li key={i}>{name}</li>)}
        </ul>
        {impact.total > 0 && (
          <>
            <p style={{ margin: '10px 0 0' }}>
              They participate in <strong>{impact.total}</strong> relationship{impact.total === 1 ? '' : 's'} — each will lose the pairs of these {nouns.members} (or be deleted if none remain):
            </p>
            {relationshipList(impact)}
          </>
        )}
        {emptiedViewsNote(o.emptiedViews)}
      </>
    ),
    confirmLabel: impact.total > 0 ? 'Delete anyway' : 'Delete',
    cancelLabel: 'Cancel', variant: 'danger',
    action: o.action,
  });
}

/** Borrado de vista del modelo (todos los canvases). */
export function confirmDeleteView(o: { name: string; action: () => Promise<unknown> }): Promise<boolean> {
  return confirmDialog({
    title: 'Delete view',
    message: <>View <strong>“{o.name}”</strong> will be deleted from the model (every canvas).</>,
    confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger',
    action: o.action,
  });
}
