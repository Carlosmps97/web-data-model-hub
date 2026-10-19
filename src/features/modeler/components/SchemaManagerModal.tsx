import { runBlocking } from '@/store/useBusyStore';
import { useMemo, useState } from 'react';
import { Check, FolderCog, Layers, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { confirmDialog } from '@/components/ui/dialogs';
import { apiErrorMessage } from '@/services/http';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as schemasSvc from '@/features/modeler/services/schemas.service';
import type { DbSchema, SchemaImpact } from '@/features/modeler/services/schemas.service';
import { schemaNameError } from '../lib/schemaCreate';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { invalidateTableSchemas } from '../services/schemaPartition';
import {
  editCreate, orderedForSave, pendingFor, stageCreate, stageDelete, stageRename, stageSetKind,
  takenNames, unstage, visibleSchemas, type SchemaKind, type StagedOp,
} from '../lib/schemaStaging';

/**
 * Gestión de esquemas (doc 18 v2, botón "Esquemas" de Structure) con STAGING:
 * crear / renombrar / cambiar qué contiene / eliminar quedan como cambios
 * PENDIENTES en el modal y se registran TODOS JUNTOS en la versión activa con
 * "Save" — igual que los canvases: forman parte de TU versión y los demás los
 * ven recién al publicar (no hay una capa de versionado aparte). Antes de
 * guardar, cada pendiente sobre un esquema existente muestra su IMPACTO
 * efectivo (tablas · vistas · canvases). El rename propaga server-side a todas
 * las tablas/vistas del esquema dentro del draft; el delete se rechaza (409
 * legible) si tiene tablas o vistas.
 *
 * Doc 119: un esquema contiene tablas, vistas o ambas (`both`, badge «tables +
 * views»); se elige al crearlo y se puede cambiar desde la fila. Es lo que
 * filtran los combos de esquema de tablas y de vistas.
 *
 * Doc 80 §2: el campo "New schema" hace DOBLE trabajo — mientras escribes
 * filtra la lista de abajo por «contiene» (con ~390 esquemas, buscar el que
 * quieres renombrar era scrollear a ciegas) y, si nada coincide, ese texto es
 * el nombre del esquema nuevo. El alta de UN esquema desde un combo (antes el
 * atajo `_VU` del doc 80 §1) va por `SchemaCreateDialog` (doc 96).
 */
export default function SchemaManagerModal({ onClose, pushToast }: {
  onClose: () => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const schemas = useModelerStore((s) => s.schemas);
  const loadSchemas = useModelerStore((s) => s.loadSchemas);
  const reload = useModelerStore((s) => s.reload);
  const markDirty = useModelerStore((s) => s.markDirty);
  const versionLabel = useSessionStore((s) => s.activeVersionLabel);

  const [staged, setStaged] = useState<StagedOp[]>([]);
  const [newName, setNewName] = useState('');
  // Qué contendrá el esquema nuevo (doc 44) — Erwin no trae este dato, nace acá.
  const [newKind, setNewKind] = useState<SchemaKind>('tables');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Edición inline de nombre: fila existente ({id}) o create pendiente ({key}).
  const [editing, setEditing] = useState<{ id?: string; key?: string; name: string } | null>(null);
  // Fila con el selector de qué contiene abierto (doc 119).
  const [kindEdit, setKindEdit] = useState<string | null>(null);
  // Impacto por esquema existente (se muestra en el pendiente, ANTES del Save).
  const [impacts, setImpacts] = useState<Record<string, SchemaImpact | 'loading'>>({});

  const vLabel = versionLabel ?? 'current';

  // Doc 96: la MISMA validación que el alta desde un combo (schemaNameError).
  const nameError = (name: string, exclude?: string): string | null => {
    const names = takenNames(schemas, staged);
    if (exclude) names.delete(exclude.toLowerCase());
    return schemaNameError(name, names);
  };

  const ensureImpact = (id: string) => {
    if (impacts[id]) return;
    setImpacts((m) => ({ ...m, [id]: 'loading' }));
    schemasSvc.schemaImpact(id)
      .then((imp) => setImpacts((m) => ({ ...m, [id]: imp })))
      .catch(() => setImpacts((m) => { const rest = { ...m }; delete rest[id]; return rest; }));
  };

  const addCreate = () => {
    const err = nameError(newName);
    if (err) { setError(err); return; }
    setError(null);
    setStaged((ops) => stageCreate(ops, newName.trim(), newKind));
    setNewName('');
  };

  const confirmEdit = () => {
    if (!editing) return;
    const n = editing.name.trim();
    if (editing.key) {   // create pendiente: editar su nombre
      const cur = staged.find((o) => o.key === editing.key);
      const err = nameError(n, cur?.kind === 'create' ? cur.name : undefined);
      if (err) { setError(err); return; }
      setStaged((ops) => editCreate(ops, editing.key!, n));
    } else if (editing.id) {   // rename de un esquema existente
      const sch = schemas.find((s) => s.id === editing.id);
      if (!sch) { setEditing(null); return; }
      if (n !== sch.name) {
        const prev = pendingFor(staged, sch.id);
        const err = nameError(n, prev?.kind === 'rename' ? prev.to : sch.name);
        if (err) { setError(err); return; }
        ensureImpact(sch.id);
      }
      setStaged((ops) => stageRename(ops, sch, n));
    }
    setError(null);
    setEditing(null);
  };

  const removeSchema = (id: string) => {
    const sch = schemas.find((s) => s.id === id);
    if (!sch) return;
    ensureImpact(id);
    setError(null);
    setStaged((ops) => stageDelete(ops, sch));
  };

  const save = async () => {
    const ops = orderedForSave(staged);
    if (ops.length === 0) return;
    setBusy(true); setError(null);
    const done = new Set<string>();
    // Doc 105 (H1): varias escrituras seguidas — todas en la sesión donde
    // empezó: si en el medio se abrió otra versión (o la revalidación la
    // degradó), lo que falta NO se aplica y el diálogo se cierra (ya no es de
    // la versión en pantalla). Un fallo espera antes la revalidación (H7).
    const pin = pinSession();
    const onError = reportWriteError((e) => {
      // Los ya aplicados salen del staging; el que falló (y los que siguen) quedan.
      setStaged((s) => s.filter((o) => !done.has(o.key)));
      setError(apiErrorMessage(e, "Couldn't save all the changes"));
    });
    try {
      markDirty();
      // Doc 75 D18: renombrar propaga a todas las tablas/vistas del esquema — bloqueante.
      await runBlocking('Applying schema changes…', async () => {
        for (const op of ops) {
          pin.check();
          if (op.kind === 'create') {
            await schemasSvc.createSchema(op.name, undefined, op.schemaKind);
          } else if (op.kind === 'setKind') await schemasSvc.setSchemaKind(op.id, op.to);
          else if (op.kind === 'rename') await schemasSvc.renameSchema(op.id, op.to);
          else await schemasSvc.deleteSchema(op.id);
          done.add(op.key);
        }
      });
      setStaged([]);
      setImpacts({});
      setKindEdit(null);
      setEditing(null);
      pushToast(`${ops.length} schema change(s) recorded in your version ${vLabel}`);
    } catch (e) {
      await onError(e);
      if (!pin.holds()) onClose();
    } finally {
      setBusy(false);
      // Lo guardado (o parte, si algo falló) cambia el catálogo: el filtro de
      // esquemas de CTAS / Import existing vuelve a consultarlo.
      invalidateTableSchemas();
      await loadSchemas().catch(() => {});
      void reload();
    }
  };

  const close = async () => {
    if (staged.length === 0) { onClose(); return; }
    const ok = await confirmDialog({
      title: 'Discard pending changes',
      message: <>You have <strong>{staged.length}</strong> unsaved schema change(s). If you close, they are discarded.</>,
      confirmLabel: 'Discard', cancelLabel: 'Keep editing', variant: 'danger',
    }).catch(() => false);
    if (ok) onClose();
  };

  const impactLine = (id: string) => {
    const imp = impacts[id];
    if (!imp) return null;
    if (imp === 'loading') return <div className="rd-small wk-schx-impact">Calculating impact…</div>;
    return (
      <div className="rd-small wk-schx-impact">
        Affects <strong>{imp.tables}</strong> table(s) · <strong>{imp.views}</strong> view(s) · in <strong>{imp.canvases}</strong> canvas(es)
      </div>
    );
  };

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted, #56607A)', marginBottom: 5, display: 'block' };
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 9 };
  const pendingBadge = (text: string, color: string) => (
    <span className="rd-small" style={{ flexShrink: 0, fontWeight: 700, color }}>{text}</span>
  );

  const iconBtn = (title: string, onClick: () => void, node: React.ReactNode) => (
    <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title={title} disabled={busy} onClick={onClick}>{node}</button>
  );

  // Badge de lo que contiene el esquema (doc 44 / doc 119); sin kind no se muestra.
  const kindLabel = (k: SchemaKind) => (k === 'both' ? 'tables + views' : k);
  const kindBadge = (k?: SchemaKind | null) => (k ? (
    <span className="rd-small rd-mono" style={{ flexShrink: 0, padding: '1px 7px', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 999, color: 'var(--text-muted, #8A93A5)', background: 'var(--fill-4, #F7F9FC)' }}>
      {kindLabel(k)}
    </span>
  ) : null);
  const KINDS: readonly SchemaKind[] = ['tables', 'views', 'both'];
  const segLabel = (k: SchemaKind) => (k === 'tables' ? 'Tables' : k === 'views' ? 'Views' : 'Both');
  // Selector inline de qué contiene un esquema existente (doc 119): preselecciona
  // su kind actual, elegir stagea y cierra; Escape sólo cierra el selector.
  const kindRow = (s: DbSchema) => {
    const current = s.kind ?? null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setKindEdit(null); } }}>
        <div className="rd-seg" role="group" aria-label="What the schema holds">
          {KINDS.map((k) => (
            <button key={k} type="button" className={current === k ? 'active' : ''} aria-pressed={current === k}
              disabled={busy} autoFocus={k === (current ?? 'tables')}
              onClick={() => { setStaged((ops) => stageSetKind(ops, s, k)); setKindEdit(null); }}>{segLabel(k)}</button>
          ))}
        </div>
        {iconBtn('Cancel', () => setKindEdit(null), <X size={13} />)}
      </div>
    );
  };

  const editRow = (onCancel: () => void) => (
    <>
      <input className="rd-input rd-mono" value={editing!.name} autoFocus
        onChange={(e) => setEditing((ed) => (ed ? { ...ed, name: e.target.value } : ed))}
        onKeyDown={(e) => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') onCancel(); }}
        style={{ flex: 1 }} />
      {iconBtn('Confirm', confirmEdit, <Check size={13} />)}
      {iconBtn('Cancel', onCancel, <X size={13} />)}
    </>
  );

  const creates = staged.filter((o): o is Extract<StagedOp, { kind: 'create' }> => o.kind === 'create');
  // Doc 80 §2: lo que escribes en "New schema" filtra la lista (contiene, CI).
  // Los pendientes siguen visibles: trabajo sin guardar no se esconde.
  const filter = newName.trim();
  // La fila con un editor abierto (nombre o kind) tampoco se esconde: si se
  // desmontara, al reaparecer su editor volvería a tomar el foco mientras se tipea.
  const open = useMemo(() => [kindEdit, editing?.id].filter((id): id is string => !!id), [kindEdit, editing?.id]);
  const visible = useMemo(() => visibleSchemas(schemas, staged, filter, open), [schemas, staged, filter, open]);
  const hiddenCount = schemas.length - visible.length;

  return (
    <Dialog
      open
      title="Schemas"
      subtitle={`Changes stay pending here and enter YOUR version ${vLabel} on save — they publish on approve, like canvases`}
      icon={FolderCog}
      backdrop="canvas"
      canvasTop={136}
      width={580}
      onClose={() => void close()}
      footer={
        <>
          <button className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy} onClick={() => void close()}>
            {staged.length ? 'Cancel' : 'Close'}
          </button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || staged.length === 0} onClick={() => void save()}>
            {busy && <span className="rd-spin" aria-hidden />}
            {busy ? 'Saving…' : `Save${staged.length ? ` ${staged.length} change${staged.length === 1 ? '' : 's'}` : ''}`}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>New schema · type to filter the list</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="rd-input rd-mono" autoFocus placeholder="search or new name, e.g. bcp_ddv_clientes" value={newName}
            onChange={(e) => { setNewName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') addCreate(); }}
            style={{ flex: 1 }} />
          {/* Qué contendrá (doc 44): separa tablas de vistas al acotar por esquema. */}
          <div className="rd-seg" style={{ flexShrink: 0 }}>
            <button type="button" className={newKind === 'tables' ? 'active' : ''} onClick={() => setNewKind('tables')}>Tables</button>
            <button type="button" className={newKind === 'views' ? 'active' : ''} onClick={() => setNewKind('views')}>Views</button>
            <button type="button" className={newKind === 'both' ? 'active' : ''} onClick={() => setNewKind('both')}>Both</button>
          </div>
          <button className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy || !newName.trim()} onClick={addCreate}>
            <Plus size={14} /> Add
          </button>
        </div>
        {filter !== '' && (
          <div className="rd-small" style={{ marginTop: 6, color: 'var(--text-muted, #8A93A5)' }}>
            {hiddenCount > 0
              ? <>Showing <strong>{visible.length}</strong> of {schemas.length} schemas · {hiddenCount} hidden by the filter</>
              : <>Showing all {schemas.length} schema(s)</>}
          </div>
        )}
      </div>

      <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {schemas.length === 0 && creates.length === 0 && (
          <div className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)', padding: 8 }}>
            No schemas yet — add the first one above.
          </div>
        )}
        {schemas.length > 0 && visible.length === 0 && (
          <div className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)', padding: 8 }}>
            No schema contains <strong className="rd-mono">{filter}</strong> — press <strong>Add</strong> to create it.
          </div>
        )}

        {visible.map((s) => {
          const pending = pendingFor(staged, s.id);
          const isDelete = pending?.kind === 'delete';
          const isRename = pending?.kind === 'rename';
          const imp = impacts[s.id];
          const deleteBlocked = isDelete && imp && imp !== 'loading' && (imp.tables > 0 || imp.views > 0);
          return (
            <div key={s.id} style={{ ...rowStyle, ...(pending ? { background: isDelete ? 'var(--error-soft, #FDF1F3)' : 'var(--blue-tint, #EAF0FF)' } : {}) }}>
              {editing?.id === s.id ? editRow(() => setEditing(null)) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="rd-mono" style={{ fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', ...(isDelete ? { textDecoration: 'line-through', color: 'var(--error, #C4314B)' } : {}) }}>
                        {s.name}
                      </span>
                      {isRename && <span className="rd-mono" style={{ fontSize: 13, color: 'var(--primary-700, #2E5BFF)' }}>→ {pending.to}</span>}
                      {kindBadge(s.kind)}
                      {pending?.kind === 'setKind' && pendingBadge(`${kindLabel(pending.to)} · pending`, 'var(--primary-700, #2E5BFF)')}
                      {isRename && pendingBadge('rename · pending', 'var(--primary-700, #2E5BFF)')}
                      {isDelete && pendingBadge('delete · pending', 'var(--error, #C4314B)')}
                    </div>
                    {pending && impactLine(s.id)}
                    {deleteBlocked && (
                      <div className="rd-small" style={{ color: 'var(--error, #C4314B)' }}>
                        It can't be deleted: the schema has content (empty it or move its tables/views first).
                      </div>
                    )}
                  </div>
                  {kindEdit === s.id ? kindRow(s) : pending
                    ? iconBtn('Undo this change', () => setStaged((ops) => unstage(ops, pending.key)), <Undo2 size={13} />)
                    : (
                      <>
                        {iconBtn('Change what it holds: tables, views or both', () => { setError(null); setEditing(null); setKindEdit(s.id); }, <Layers size={13} />)}
                        {iconBtn('Rename (propagates to its tables and views on save)', () => { setError(null); setKindEdit(null); ensureImpact(s.id); setEditing({ id: s.id, name: s.name }); }, <Pencil size={13} />)}
                        {iconBtn('Delete (only if empty)', () => removeSchema(s.id), <Trash2 size={13} style={{ color: 'var(--error, #C4314B)' }} />)}
                      </>
                    )}
                </>
              )}
            </div>
          );
        })}

        {creates.map((op) => (
          <div key={op.key} style={{ ...rowStyle, background: 'var(--blue-tint, #EAF0FF)' }}>
            {editing?.key === op.key ? editRow(() => setEditing(null)) : (
              <>
                <span className="rd-mono" style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{op.name}</span>
                {kindBadge(op.schemaKind)}
                {pendingBadge('create · pending', 'var(--primary-700, #2E5BFF)')}
                {iconBtn('Edit name', () => { setError(null); setKindEdit(null); setEditing({ key: op.key, name: op.name }); }, <Pencil size={13} />)}
                {iconBtn('Undo', () => setStaged((ops) => unstage(ops, op.key)), <Undo2 size={13} />)}
              </>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="rd-small" role="alert" style={{ color: 'var(--error, #C4314B)', marginTop: 10 }}>
          {error}
        </div>
      )}
    </Dialog>
  );
}
