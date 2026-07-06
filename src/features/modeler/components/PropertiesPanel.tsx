import { useEffect, useMemo, useState } from 'react';
import { Eye, Pencil, Table2, Trash2 } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import UdpAssign from './UdpAssign';
import { useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/features/governance/services/governance.service';
import type { ParentDomain } from '@/features/governance/services/governance.service';
import { ColumnRow } from './ColumnEditor';
import ViewEditor from './ViewEditor';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';

type Tab = 'definition' | 'columns' | 'views' | 'links' | 'metadata';
const TABS: { id: Tab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'views', label: 'Views' },
  { id: 'links', label: 'Links' },
  { id: 'metadata', label: 'Metadata' },
];

// Etiqueta compacta por extremo (diseño pp3: "1 : N · identifying").
const CARD_LBL: Record<gov.Cardinality, string> = {
  one: '1', 'one-only': '1', 'zero-one': '0..1', many: 'N', 'one-many': '1..N', 'zero-many': '0..N',
};

/**
 * Panel lateral de propiedades (diseño p8 + pp1–pp4): header con glyph navy +
 * "schema X · table", 5 pestañas SUBRAYADAS (underline, no pill) con contador
 * en Columns/Views, y cuerpo scrolleable. En read-only (sin changeset activo)
 * el panel abre igual pero como reader: inputs deshabilitados y sin acciones.
 */
export default function PropertiesPanel({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  // Selectores individuales (no el store entero): el panel vive junto al canvas
  // y suscribirse a TODO el store lo re-renderizaba en cada hover/drag/dirty.
  const diagram = useModelerStore((s) => s.diagram);
  const selectedTableId = useModelerStore((s) => s.selectedTableId);
  const setSelectedTable = useModelerStore((s) => s.setSelectedTable);
  const reload = useModelerStore((s) => s.reload);
  const updateColumn = useModelerStore((s) => s.updateColumn);
  const reorderColumns = useModelerStore((s) => s.reorderColumns);
  const deleteColumn = useModelerStore((s) => s.deleteColumn);
  const setColumnTarget = useModelerStore((s) => s.setColumnTarget);
  const deleteRelationship = useModelerStore((s) => s.deleteRelationship);
  // En modo visor puede haber changeset activo (viendo un request desde Review):
  // el panel abre como reader igual que sin changeset.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  const table = diagram?.tables.find((t) => t.id === selectedTableId) ?? null;
  const cols = useMemo(
    () => (diagram?.columns ?? []).filter((c) => c.tableId === selectedTableId).slice().sort((a, b) => a.ordinal - b.ordinal),
    [diagram, selectedTableId],
  );
  const links = useMemo(
    () => (diagram?.relationships ?? []).filter((r) => r.sourceTableId === selectedTableId || r.targetTableId === selectedTableId),
    [diagram, selectedTableId],
  );

  const [tab, setTab] = useState<Tab>('definition');
  const [domains, setDomains] = useState<ParentDomain[]>([]);
  useEffect(() => { gov.listDomains().then(setDomains).catch(() => {}); }, []);

  // ── Definition: form local de la tabla ──
  const [form, setForm] = useState({ logicalName: '', physicalName: '', schema: '', description: '' });
  const [savingDef, setSavingDef] = useState(false);
  useEffect(() => {
    if (table) setForm({ logicalName: table.logicalName, physicalName: table.physicalName, schema: table.schema ?? '', description: table.description ?? '' });
  }, [table]);

  // ── DnD reorder (HTML5 nativo) ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [after, setAfter] = useState(false);

  // ── Columns: fila expandida (default TODO contraído; se resetea al cambiar de tabla) ──
  const [expandedColId, setExpandedColId] = useState<string | null>(null);
  useEffect(() => { setExpandedColId(null); }, [selectedTableId]);
  // Reorden persistiéndose en background (la lista ya se movió de forma optimista).
  const [reordering, setReordering] = useState(false);

  // ── Views (pp2) — se cargan al seleccionar la tabla para el contador del tab ──
  const [views, setViews] = useState<View[]>([]);
  const [viewEditor, setViewEditor] = useState<{ view?: View } | null>(null);
  const reloadViews = () => { if (selectedTableId) viewsSvc.listViews(selectedTableId).then(setViews).catch(() => {}); };
  useEffect(() => {
    if (selectedTableId) viewsSvc.listViews(selectedTableId).then(setViews).catch(() => setViews([]));
    else setViews([]);
  }, [selectedTableId]);

  if (!table) return null;

  const lookup = (id: string) => diagram?.tables.find((t) => t.id === id);
  const tableName = (id: string) => { const t = lookup(id); return t?.physicalName || t?.logicalName || id; };
  const colName = (id: string) => diagram?.columns.find((c) => c.id === id)?.physicalName ?? id;
  const counts: Partial<Record<Tab, number>> = { columns: cols.length, views: views.length };
  const parents = links.filter((r) => r.targetTableId === table.id).length;
  const children = links.length - parents;

  const saveDef = async () => {
    setSavingDef(true);
    try {
      // `updateTable` sólo cubre name/schema; un único upsert changeset-aware (merge
      // sobre la tabla actual) cubre además `description`, y luego reload.
      await gov.createTable({ ...table, logicalName: form.logicalName.trim(), physicalName: form.physicalName.trim(), schema: form.schema.trim() || undefined, description: form.description.trim() || undefined });
      await reload();
      pushToast('Table updated');
    // Propaga el motivo real (p.ej. 409: la versión ya no está en borrador) en
    // vez de un "Couldn't save" genérico que esconde POR QUÉ no se guardó.
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'); }
    finally { setSavingDef(false); }
  };
  const derivePhysical = async () => {
    try { const p = (await gov.physicalize(form.logicalName.trim(), 'table')).physical; setForm((f) => ({ ...f, physicalName: p })); }
    catch { pushToast("Couldn't derive the physical name", 'err'); }
  };
  const saveTableUdp = async (next: Record<string, string>) => {
    if (!table) return;
    try { await gov.createTable({ ...table, udpValues: next }); await reload(); }
    catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save UDP", 'err'); }
  };

  const patchCol = async (id: string, fields: Parameters<typeof updateColumn>[1]) => {
    try { await updateColumn(id, fields); } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save the column", 'err'); }
  };
  const removeCol = async (id: string, name: string) => {
    try {
      const ok = await confirmDialog({
        title: 'Delete column',
        message: <>Column <strong>“{name}”</strong> will be removed from this table.</>,
        confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger',
        action: () => deleteColumn(id),
      });
      if (ok) pushToast('Column deleted');
    } catch { pushToast("Couldn't delete", 'err'); }
  };

  // DnD: al pasar por encima decide si el drop va antes/después según la mitad del row.
  const handleDragOver = (id: string, e: React.DragEvent) => {
    e.preventDefault();
    if (id === dragId) { setOverId(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setOverId(id);
    setAfter(e.clientY > r.top + r.height / 2);
  };
  const handleDrop = async (targetId: string) => {
    const src = dragId; const wasAfter = after;
    setDragId(null); setOverId(null);
    if (!src || src === targetId || reordering) return;
    const ids = cols.map((c) => c.id).filter((x) => x !== src);
    let idx = ids.indexOf(targetId);
    if (idx < 0) return;
    if (wasAfter) idx += 1;
    ids.splice(idx, 0, src);
    setReordering(true);
    try { await reorderColumns(table.id, ids); }
    catch { pushToast("Couldn't reorder", 'err'); }
    finally { setReordering(false); }
  };

  return (
    <aside className="wk-props">
      {/* ── Header fijo: glyph + nombre + schema · table + close (diseño p8) ── */}
      <div className="wk-props-top">
        <div className="wk-props-head">
          <div className="wk-props-glyph" aria-hidden><Table2 size={17} strokeWidth={1.6} /></div>
          <div className="wk-props-id">
            <div className="wk-props-title">{table.physicalName || table.logicalName}</div>
            <div className="wk-props-sub">
              schema <span className="rd-mono">{table.schema || '—'}</span> · table
              {!canEdit && <span className="wk-props-ro">Read-only</span>}
            </div>
          </div>
          <button className="wk-props-close" title="Close" onClick={() => setSelectedTable(null)}><Icon name="x" size={14} /></button>
        </div>

        <div className="wk-pp-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="wk-props-body">
        {/* ── Definition (pp1) ── */}
        {tab === 'definition' && (
          <>
            <div className="wk-props-field"><label>Logical name</label>
              <input className="rd-input" disabled={!canEdit} value={form.logicalName} onChange={(e) => setForm({ ...form, logicalName: e.target.value })} />
            </div>
            <div className="wk-props-field"><label>Physical name</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="rd-input rd-mono" disabled={!canEdit} value={form.physicalName} onChange={(e) => setForm({ ...form, physicalName: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" title="Derive from logical (glossary)" onClick={derivePhysical}><Icon name="bolt" size={12} /></button>}
              </div>
            </div>
            <div className="wk-props-field"><label>Schema</label>
              <input className="rd-input rd-mono" disabled={!canEdit} placeholder="schema_name" value={form.schema} onChange={(e) => setForm({ ...form, schema: e.target.value })} />
            </div>
            <div className="wk-props-field"><label>Functional definition</label>
              <textarea className="wk-pp-textarea" disabled={!canEdit} placeholder="What this entity represents…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            {canEdit && (
              <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%' }} disabled={savingDef} onClick={saveDef}>
                {savingDef && <span className="rd-spin" aria-hidden />}{savingDef ? 'Saving…' : 'Save'}
              </button>
            )}
          </>
        )}

        {/* ── Columns ── */}
        {tab === 'columns' && (
          <>
            <div className="wk-props-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                Table columns
                {reordering && <span className="rd-spin" style={{ color: 'var(--primary)' }} aria-hidden />}
              </span>
              {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setColumnTarget(table.id)}><Icon name="plus" size={12} sw={2.6} /> Add column</button>}
            </div>
            <p className="wk-pp-cap">{canEdit ? 'Drag the handle to reorder · click a column to edit.' : 'Click a column to view its details.'}</p>
            {cols.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>No columns yet.{canEdit ? ' Use “Add column”.' : ''}</div>}
            <div className="wk-pp-collist">
              {cols.map((c) => (
                <ColumnRow
                  key={c.id}
                  col={c}
                  domains={domains}
                  canEdit={canEdit}
                  expanded={expandedColId === c.id}
                  onToggle={setExpandedColId}
                  onPatch={patchCol}
                  onDelete={removeCol}
                  isDragging={dragId === c.id}
                  dropHint={overId === c.id ? (after ? 'after' : 'before') : null}
                  onDragStart={setDragId}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Views (pp2) ── */}
        {tab === 'views' && (
          <>
            <div className="wk-props-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
              <span>Associated views</span>
              {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setViewEditor({})}><Icon name="plus" size={12} sw={2.6} /> New view</button>}
            </div>
            {views.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>No views for this table{canEdit ? '. Use “New view”.' : '.'}</div>}
            {views.map((v) => (
              <div className="wk-pp-link" key={v.id}>
                <div className="wk-pp-link-head">
                  <Eye size={13} style={{ color: 'var(--purple)', flex: 'none' }} />
                  <span className="rd-mono">{v.schema ? `${v.schema}.` : ''}{v.name}</span>
                  {canEdit && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Edit" onClick={() => setViewEditor({ view: v })}><Pencil size={12} /></button>
                      <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Delete" onClick={async () => { try { const ok = await confirmDialog({ title: 'Delete view', message: <>View <strong>“{v.name}”</strong> will be deleted.</>, confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger', action: async () => { await viewsSvc.deleteView(v.id); reloadViews(); } }); if (ok) pushToast('View deleted'); } catch { pushToast("Couldn't delete", 'err'); } }}><Trash2 size={12} /></button>
                    </span>
                  )}
                </div>
                {v.tags && v.tags.length > 0 && <div className="wk-pp-link-card"><span className="rd-small" style={{ color: 'var(--muted)' }}>{v.tags.length} tag{v.tags.length === 1 ? '' : 's'}</span></div>}
              </div>
            ))}
          </>
        )}

        {/* ── Links (pp3: cards PARENT/CHILD) ── */}
        {tab === 'links' && (
          <>
            <div className="wk-props-sec" style={{ marginTop: 0 }}>Relationships · {links.length} link{links.length === 1 ? '' : 's'}</div>
            {links.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>This table has no relationships yet.</div>}
            {links.map((r) => {
              const outgoing = r.sourceTableId === table.id;
              // Rol de la OTRA tabla respecto de la actual: entrante ⇒ su padre; saliente ⇒ su hija.
              const role = outgoing ? 'child' : 'parent';
              const ownCol = outgoing ? r.sourceColumnId : r.targetColumnId;
              return (
                <div className="wk-pp-link" key={r.id}>
                  <div className="wk-pp-link-head">
                    <span className={`wk-pp-role ${role}`}>{role.toUpperCase()}</span>
                    <span className="rd-mono">{tableName(r.sourceTableId)}</span>
                    <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                    <span className="rd-mono">{tableName(r.targetTableId)}</span>
                    {canEdit && (
                      <button
                        type="button"
                        className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm"
                        style={{ marginLeft: 'auto' }}
                        title="Delete relationship"
                        onClick={async () => { try { const ok = await confirmDialog({ title: 'Delete relationship', message: 'This relationship will be removed from the model.', confirmLabel: 'Delete', cancelLabel: 'Cancel', variant: 'danger', action: () => deleteRelationship(r.id) }); if (ok) pushToast('Relationship deleted'); } catch { pushToast("Couldn't delete", 'err'); } }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div className="wk-pp-link-card">
                    <span className="rd-mono">on {colName(ownCol)}</span>
                    <span className="wk-pp-card-lbl">
                      {CARD_LBL[r.sourceCardinality]} : {CARD_LBL[r.targetCardinality]}{r.identifying ? ' · identifying' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── Metadata (pp4, solo lectura) ── */}
        {tab === 'metadata' && (
          <>
            <dl className="wk-pp-meta">
              <dt>Physical name</dt><dd className="rd-mono">{table.physicalName}</dd>
              <dt>Logical name</dt><dd>{table.logicalName}</dd>
              <dt>Schema</dt><dd className="rd-mono">{table.schema || '—'}</dd>
              <dt>Columns</dt><dd>{cols.length}</dd>
              <dt>Relationships</dt><dd>{links.length === 0 ? '—' : `${links.length} link${links.length === 1 ? '' : 's'} · ${parents} parent${parents === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'}`}</dd>
              <dt>Definition</dt><dd>{table.description || '—'}</dd>
              <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{table.id}</dd>
            </dl>
            {/* User Defined Properties (etiquetas key-value para clasificar el dato). */}
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid #EAEDF2' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1A2B4A', marginBottom: 10 }}>User Defined Properties</div>
              <UdpAssign level="table" values={table.udpValues ?? {}} disabled={!canEdit} onChange={saveTableUdp} />
            </div>
          </>
        )}
      </div>

      {viewEditor && (
        <ViewEditor
          tableId={table.id}
          defaultName={table.physicalName}
          defaultSchema={table.schema ?? ''}
          view={viewEditor.view}
          onClose={() => setViewEditor(null)}
          onSaved={reloadViews}
          pushToast={pushToast}
        />
      )}
    </aside>
  );
}
