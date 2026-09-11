/**
 * Diálogos de borrado COMPARTIDOS (doc 89 §3.5) por los Properties del canvas y
 * el Object Inspector: un solo texto de impacto para tabla/entidad, columna/
 * atributo y vista. El trabajo corre DENTRO del diálogo (`action`): queda con
 * spinner y bloqueado hasta terminar (el owner reportó reclicks por el delay);
 * si `action` lanza, la promesa rechaza y el caller muestra el motivo.
 */
import { confirmDialog } from '@/components/ui/dialogs';
import type { RelationshipImpact } from '@/services/governance.service';
import type { FacetNouns } from '@/lib/facets';

/** Conteos del impacto de borrar una tabla (Properties los consulta; el
 *  inspector los saca del dossier — `tableDeleteImpact`). */
export interface TableDeleteCounts { canvases: number; related: number; views: number }

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
        <li><strong>{canvases}</strong> canvas{canvases === 1 ? '' : 'es'} it appears on</li>
        <li><strong>{related}</strong> related {related === 1 ? nouns.one : nouns.many} (their relationships are removed)</li>
        <li><strong>{nViews}</strong> view{nViews === 1 ? '' : 's'} (also deleted)</li>
      </ul>
      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>Its columns and relationships go too. This change is part of the current version.</div>
    </>,
    action: o.action,
  });
}

/** Borrado de columna con impacto GLOBAL (spec 10 §8): relaciones donde la
 *  columna es extremo, en cualquier canvas — cada una pierde el par (o se
 *  borra si era el último). */
export function confirmDeleteColumn(o: {
  name: string; nouns: FacetNouns; impact: RelationshipImpact; action: () => Promise<unknown>;
}): Promise<boolean> {
  const { impact } = o;
  return confirmDialog({
    title: `Delete ${o.nouns.member}`,
    message: impact.total > 0 ? (
      <>
        <p style={{ margin: 0 }}>
          Column <strong>“{o.name}”</strong> participates in <strong>{impact.total}</strong> relationship{impact.total === 1 ? '' : 's'} — each will lose this pair (or be deleted if it was the last one):
        </p>
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
      </>
    ) : (
      <>Column <strong>“{o.name}”</strong> will be removed from this table.</>
    ),
    confirmLabel: impact.total > 0 ? 'Delete anyway' : 'Delete',
    cancelLabel: 'Cancel', variant: 'danger',
    action: o.action,
  });
}

/** Borrado de vista del MODELO (todos los canvases). */
export function confirmDeleteView(o: { name: string; action: () => Promise<unknown> }): Promise<boolean> {
  return confirmDialog({
    title: 'Delete view',
    message: <>View <strong>“{o.name}”</strong> will be deleted from the model (every canvas).</>,
    confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger',
    action: o.action,
  });
}
