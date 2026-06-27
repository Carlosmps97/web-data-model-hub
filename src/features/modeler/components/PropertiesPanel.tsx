import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/Icon';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import * as gov from '@/features/governance/services/governance.service';
import type { ParentDomain } from '@/features/governance/services/governance.service';
import { ColumnRow } from './ColumnEditor';
import ViewEditor from './ViewEditor';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';
import { Eye, Pencil, Trash2 } from 'lucide-react';

type Tab = 'definition' | 'columns' | 'views' | 'links' | 'metadata';
const TABS: { id: Tab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'views', label: 'Views' },
  { id: 'links', label: 'Links' },
  { id: 'metadata', label: 'Metadata' },
];

// Símbolo crow's-foot compacto para cada extremo de la relación.
const CROW: Record<gov.Cardinality, string> = {
  one: '|', 'one-only': '||', 'zero-one': 'o|', many: '<', 'one-many': '|<', 'zero-many': 'o<',
};

export default function PropertiesPanel({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const { diagram, selectedTableId, setSelectedTable, reload, updateColumn, reorderColumns, deleteColumn, setColumnTarget } = useModelerStore();
  const canEdit = useChangesetStore((s) => s.activeId) != null;
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
  useEffect(() => {
    if (table) setForm({ logicalName: table.logicalName, physicalName: table.physicalName, schema: table.schema ?? '', description: table.description ?? '' });
  }, [table]);

  // ── DnD reorder (HTML5 nativo) ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [after, setAfter] = useState(false);

  // ── Views (pp2) ──
  const [views, setViews] = useState<View[]>([]);
  const [viewEditor, setViewEditor] = useState<{ view?: View } | null>(null);
  const reloadViews = () => { if (selectedTableId) viewsSvc.listViews(selectedTableId).then(setViews).catch(() => {}); };
  useEffect(() => { if (tab === 'views' && selectedTableId) viewsSvc.listViews(selectedTableId).then(setViews).catch(() => setViews([])); }, [tab, selectedTableId]);

  if (!table) return null;

  const lookup = (id: string) => diagram?.tables.find((t) => t.id === id);
  const colName = (id: string) => diagram?.columns.find((c) => c.id === id)?.physicalName ?? id;

  const saveDef = async () => {
    try {
      // `updateTable` sólo cubre name/schema; un único upsert changeset-aware (merge
      // sobre la tabla actual) cubre además `description`, y luego reload.
      await gov.createTable({ ...table, logicalName: form.logicalName.trim(), physicalName: form.physicalName.trim(), schema: form.schema.trim() || undefined, description: form.description.trim() || undefined });
      await reload();
      pushToast('Tabla actualizada');
    } catch { pushToast('No se pudo guardar', 'err'); }
  };
  const derivePhysical = async () => {
    try { const p = (await gov.physicalize(form.logicalName.trim(), 'table')).physical; setForm((f) => ({ ...f, physicalName: p })); }
    catch { pushToast('No se pudo derivar', 'err'); }
  };

  const patchCol = async (id: string, fields: Parameters<typeof updateColumn>[1]) => {
    try { await updateColumn(id, fields); } catch { pushToast('No se pudo guardar la columna', 'err'); }
  };
  const removeCol = (id: string, name: string) => {
    if (!confirm(`¿Eliminar la columna “${name}”?`)) return;
    deleteColumn(id).then(() => pushToast('Columna eliminada')).catch(() => pushToast('No se pudo eliminar', 'err'));
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
    if (!src || src === targetId) return;
    const ids = cols.map((c) => c.id).filter((x) => x !== src);
    let idx = ids.indexOf(targetId);
    if (idx < 0) return;
    if (wasAfter) idx += 1;
    ids.splice(idx, 0, src);
    try { await reorderColumns(table.id, ids); } catch { pushToast('No se pudo reordenar', 'err'); }
  };

  return (
    <div className="wk-props">
      <div className="wk-props-head">
        <span className="wk-props-title">{table.logicalName || table.physicalName}</span>
        <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setSelectedTable(null)}><Icon name="x" size={14} /></button>
      </div>

      <div className="wk-pp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── Definition ── */}
      {tab === 'definition' && (
        <>
          <div className="wk-props-field"><label>Nombre lógico</label>
            <input className="rd-input" disabled={!canEdit} value={form.logicalName} onChange={(e) => setForm({ ...form, logicalName: e.target.value })} />
          </div>
          <div className="wk-props-field"><label>Nombre físico</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input className="rd-input rd-mono" disabled={!canEdit} value={form.physicalName} onChange={(e) => setForm({ ...form, physicalName: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
              {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" title="Derivar del lógico (glossary)" onClick={derivePhysical}><Icon name="bolt" size={12} /></button>}
            </div>
          </div>
          <div className="wk-props-field"><label>Schema</label>
            <input className="rd-input rd-mono" disabled={!canEdit} placeholder="schema_name" value={form.schema} onChange={(e) => setForm({ ...form, schema: e.target.value })} />
          </div>
          <div className="wk-props-field"><label>Definición funcional</label>
            <textarea className="wk-pp-textarea" disabled={!canEdit} placeholder="Descripción de la entidad…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {canEdit && <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%' }} onClick={saveDef}>Guardar</button>}
        </>
      )}

      {/* ── Columns ── */}
      {tab === 'columns' && (
        <>
          <div className="wk-props-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
            <span>Columnas ({cols.length})</span>
            {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setColumnTarget(table.id)}><Icon name="plus" size={12} sw={2.6} /> Add column</button>}
          </div>
          <p className="wk-pp-cap">Drag the handle to reorder columns.</p>
          {cols.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>Sin columnas. Usá “Add column”.</div>}
          <div className="wk-pp-collist">
            {cols.map((c) => (
              <ColumnRow
                key={c.id}
                col={c}
                domains={domains}
                canEdit={canEdit}
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
            <span>Vistas ({views.length})</span>
            {canEdit && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setViewEditor({})}><Icon name="plus" size={12} sw={2.6} /> New view</button>}
          </div>
          {views.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>Sin vistas{canEdit ? '. Usá “New view”.' : '.'}</div>}
          {views.map((v) => (
            <div className="wk-pp-link" key={v.id}>
              <div className="wk-pp-link-head">
                <Eye size={13} />
                <span className="rd-mono">{v.schema ? `${v.schema}.` : ''}{v.name}</span>
                {canEdit && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                    <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Editar" onClick={() => setViewEditor({ view: v })}><Pencil size={12} /></button>
                    <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Eliminar" onClick={() => { if (confirm(`¿Eliminar la vista “${v.name}”?`)) viewsSvc.deleteView(v.id).then(reloadViews).then(() => pushToast('Vista eliminada')).catch(() => pushToast('No se pudo eliminar', 'err')); }}><Trash2 size={12} /></button>
                  </span>
                )}
              </div>
              {v.tags && v.tags.length > 0 && <div className="wk-pp-link-card"><span className="rd-small" style={{ color: 'var(--muted)' }}>{v.tags.length} tag{v.tags.length === 1 ? '' : 's'}</span></div>}
            </div>
          ))}
        </>
      )}

      {/* ── Links (solo lectura) ── */}
      {tab === 'links' && (
        <>
          <div className="wk-props-sec" style={{ marginTop: 0 }}>Relaciones ({links.length})</div>
          {links.length === 0 && <div className="rd-small" style={{ color: 'var(--muted)' }}>Esta tabla no participa en ninguna relación.</div>}
          {links.map((r) => {
            const outgoing = r.sourceTableId === table.id;
            const otherId = outgoing ? r.targetTableId : r.sourceTableId;
            const other = lookup(otherId);
            return (
              <div className="wk-pp-link" key={r.id}>
                <div className="wk-pp-link-head">
                  <Icon name="link" size={13} />
                  <span>{outgoing ? '→ ' : '← '}{other?.logicalName || other?.physicalName || otherId}</span>
                </div>
                <div className="wk-pp-link-card">
                  <span className="rd-mono">{colName(r.sourceColumnId)}</span>
                  <span className="rd-mono" style={{ color: 'var(--k-fk)' }}>{CROW[r.sourceCardinality]}—{CROW[r.targetCardinality]}</span>
                  <span className="rd-mono">{colName(r.targetColumnId)}</span>
                  {r.identifying && <span style={{ fontSize: 10, color: 'var(--amber-deep)' }}>identifying</span>}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── Metadata (solo lectura) ── */}
      {tab === 'metadata' && (
        <dl className="wk-pp-meta">
          <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{table.id}</dd>
          <dt>Físico</dt><dd className="rd-mono">{table.physicalName}</dd>
          <dt>Lógico</dt><dd>{table.logicalName}</dd>
          <dt>Schema</dt><dd className="rd-mono">{table.schema || '—'}</dd>
          <dt>Columnas</dt><dd>{cols.length}</dd>
          <dt>Relaciones</dt><dd>{links.length}</dd>
          <dt>Definición</dt><dd>{table.description || '—'}</dd>
        </dl>
      )}

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
    </div>
  );
}
