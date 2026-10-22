/**
 * SchemaCreateDialog: alta de un esquema desde un combo de esquema. Mismo
 * camino que Structure · Schemas: el esquema entra a la versión del usuario
 * (cambio `schemas` en el changeset activo) y se publica al aprobar. Solo
 * cuando queda registrado y el catálogo se recarga se selecciona en el combo
 * de origen (`createSchemaAndPick`). No recarga el canvas: el formulario de
 * origen conserva sus demás campos.
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FolderPlus } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { apiErrorMessage } from '@/services/http';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as schemasSvc from '../services/schemas.service';
import { createSchemaAndPick, schemaNameError } from '../lib/schemaCreate';
import type { SchemaKind } from '../lib/schemaStaging';

export default function SchemaCreateDialog({ kind, initialName, onCreated, onClose }: {
  /** Qué contendrá el esquema: lo fija el combo de origen (tablas o vistas). */
  kind: SchemaKind;
  /** Lo tipeado en el combo (puede venir vacío). */
  initialName: string;
  onCreated: (name: string) => void;
  onClose: () => void;
}) {
  const schemas = useModelerStore((s) => s.schemas);
  const loadSchemas = useModelerStore((s) => s.loadSchemas);
  const markDirty = useModelerStore((s) => s.markDirty);
  const vLabel = useSessionStore((s) => s.activeVersionLabel) ?? 'current';
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = useMemo(() => new Set(schemas.map((s) => s.name.toLowerCase())), [schemas]);

  const submit = async () => {
    if (busy) return;
    const err = schemaNameError(name, taken);
    if (err) { setError(err); return; }
    setBusy(true);
    setError(null);
    try {
      await createSchemaAndPick({
        name, kind,
        create: async (n, k) => { await schemasSvc.createSchemaInVersion(n, k); markDirty(); },
        refresh: loadSchemas,
        pick: (n) => { toast.success(`Schema ${n} added to your version ${vLabel}`); onCreated(n); onClose(); },
      });
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't create the schema"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open title="New schema" icon={FolderPlus} width={460} backdrop="canvas" canvasTop={136}
      onClose={() => { if (!busy) onClose(); }}
      subtitle={`Enters your version ${vLabel} now — like Structure · Schemas — and publishes on approve. It stays even if you cancel the form you came from.`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon={FolderPlus} onClick={() => void submit()} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create & select'}
        </Button>
      </>}>
      <label style={lbl}>
        Schema name <span style={kindChip}>for {kind}</span>
      </label>
      <input className="rd-input rd-mono" autoFocus value={name} placeholder="e.g. stg_clientes"
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          // Enter crea acá y no llega al formulario de origen (New table, New view…).
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void submit(); }
        }}
        style={{ width: '100%' }} />
      {error && <div role="alert" style={errStyle}>{error}</div>}
    </Dialog>
  );
}

const lbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted, #56607A)', marginBottom: 6 };
const kindChip: React.CSSProperties = { textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontSize: 11, padding: '1px 8px', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 999, color: 'var(--text-muted, #8A93A5)', background: 'var(--fill-4, #F7F9FC)' };
const errStyle: React.CSSProperties = { marginTop: 8, fontSize: 12, color: 'var(--error, #C4314B)' };
