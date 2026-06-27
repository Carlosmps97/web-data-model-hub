import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import * as gov from '@/features/governance/services/governance.service';
import type { CanonicalTable } from '@/features/governance/services/governance.service';

export default function AddTablesModal({ excludeIds, onClose, onAdd }: {
  excludeIds: string[];
  onClose: () => void;
  onAdd: (tableIds: string[]) => Promise<void>;
}) {
  const [tables, setTables] = useState<CanonicalTable[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    gov.listTables().then((all) => setTables(all.filter((t) => !excludeIds.includes(t.id)))).catch(() => {});
  }, [excludeIds]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = async () => { setBusy(true); try { await onAdd([...sel]); onClose(); } finally { setBusy(false); } };

  return (
    <Modal title="Agregar tablas existentes" subtitle="Tablas canónicas del pool — una tabla puede estar en varias (universal)" icon="plus" onClose={onClose}
      footer={<>
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancelar</button>
        <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || sel.size === 0} onClick={submit}>Agregar ({sel.size})</button>
      </>}>
      <div className="meta-list" style={{ maxHeight: 320, overflow: 'auto' }}>
        {tables.map((t) => (
          <label className="meta-item" key={t.id} style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="meta-name"><span className="rd-mono">{t.physicalName}</span></div>
              <div className="meta-sub">{t.logicalName}</div>
            </div>
          </label>
        ))}
        {tables.length === 0 && <div className="rd-small" style={{ padding: '8px 2px' }}>No hay otras tablas en el pool.</div>}
      </div>
    </Modal>
  );
}
