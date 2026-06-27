import { useEffect, useState } from 'react';
import Icon from '@/components/ui/Icon';
import * as gov from '../services/governance.service';
import type { CanonicalTable, CanonicalColumn, ParentDomain } from '../services/governance.service';

export default function CatalogPanel({ pushToast, canEdit }: { pushToast: (m: string, k?: 'err') => void; canEdit: boolean }) {
  const [tables, setTables] = useState<CanonicalTable[]>([]);
  const [domains, setDomains] = useState<ParentDomain[]>([]);
  const [openTable, setOpenTable] = useState(false);
  const [tForm, setTForm] = useState({ logicalName: '', schema: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [columns, setColumns] = useState<CanonicalColumn[]>([]);
  const [cForm, setCForm] = useState({ logicalName: '', parentDomainId: '', dataType: '', isPrimaryKey: false });

  const load = async () => {
    try { const [t, d] = await Promise.all([gov.listTables(), gov.listDomains()]); setTables(t); setDomains(d); }
    catch { pushToast('No se pudo cargar el catálogo', 'err'); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveTable = async () => {
    if (!tForm.logicalName.trim()) { pushToast('El nombre lógico es obligatorio', 'err'); return; }
    try {
      const id = crypto.randomUUID();
      const physical = (await gov.physicalize(tForm.logicalName.trim())).physical;
      await gov.createTable({ id, logicalName: tForm.logicalName.trim(), physicalName: physical, schema: tForm.schema.trim() || undefined });
      setOpenTable(false); setTForm({ logicalName: '', schema: '' }); await load(); pushToast('Tabla canónica creada (en draft)');
    } catch { pushToast('No se pudo crear la tabla', 'err'); }
  };
  const toggle = async (t: CanonicalTable) => {
    if (expanded === t.id) { setExpanded(null); return; }
    setExpanded(t.id);
    try { setColumns(await gov.listColumns(t.id)); } catch { pushToast('No se pudieron cargar las columnas', 'err'); }
  };
  const addColumn = async (tableId: string) => {
    if (!cForm.logicalName.trim()) { pushToast('El nombre lógico es obligatorio', 'err'); return; }
    try {
      const id = crypto.randomUUID();
      const physical = (await gov.physicalize(cForm.logicalName.trim())).physical;
      const dom = domains.find((d) => d.id === cForm.parentDomainId);
      const override = cForm.dataType.trim();
      const dataType = override || dom?.defaultDataType || '';
      await gov.createColumn({
        id, tableId, logicalName: cForm.logicalName.trim(), physicalName: physical,
        parentDomainId: cForm.parentDomainId || undefined, dataType, typeOverridden: !!override,
        isPrimaryKey: cForm.isPrimaryKey || undefined, ordinal: columns.length,
      });
      setCForm({ logicalName: '', parentDomainId: '', dataType: '', isPrimaryKey: false });
      setColumns(await gov.listColumns(tableId)); pushToast('Columna agregada (en draft)');
    } catch { pushToast('No se pudo agregar la columna', 'err'); }
  };

  return (
    <div className="rd-card mc-panel">
      <div className="mc-cardhead">
        <span className="mc-cardlbl"><Icon name="grid" size={13} />Tablas canónicas</span>
        <span className="mc-pill">{tables.length}</span>
        {canEdit && <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpenTable(!openTable)}><Icon name="plus" size={13} sw={2.6} />Nueva tabla</button>}
      </div>
      {canEdit && openTable && (
        <div className="rd-card" style={{ padding: 10, margin: '8px 0', display: 'grid', gap: 6 }}>
          <input className="rd-input" placeholder="Nombre lógico (ej. deuda cliente)" value={tForm.logicalName} onChange={(e) => setTForm({ ...tForm, logicalName: e.target.value })} />
          <input className="rd-input" placeholder="Schema (opcional, ej. riesgos)" value={tForm.schema} onChange={(e) => setTForm({ ...tForm, schema: e.target.value })} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setOpenTable(false)}>Cancelar</button>
            <button className="rd-btn rd-btn-primary rd-btn-sm" onClick={saveTable}>Crear</button>
          </div>
        </div>
      )}
      {!canEdit && <div className="rd-small" style={{ padding: '4px 2px', color: 'var(--muted)' }}>Vista publicada (read-only). Creá o seleccioná un changeset para editar.</div>}
      <div className="meta-list">
        {tables.map((t) => (
          <div key={t.id}>
            <div className="meta-item" style={{ cursor: 'pointer' }} onClick={() => toggle(t)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="meta-name"><span className="rd-mono">{t.physicalName}</span></div>
                <div className="meta-sub">{t.logicalName}{t.schema ? ` · ${t.schema}` : ''}</div>
              </div>
              <Icon name="chevR" size={13} style={{ transform: expanded === t.id ? 'rotate(90deg)' : 'none' }} />
            </div>
            {expanded === t.id && (
              <div style={{ padding: '4px 0 8px 12px', display: 'grid', gap: 4 }}>
                {columns.map((c) => (
                  <div key={c.id} className="rd-small" style={{ display: 'flex', gap: 8 }}>
                    <span className="rd-mono" style={{ minWidth: 160 }}>{c.physicalName}</span>
                    <span style={{ flex: 1, color: 'var(--muted)' }}>{c.logicalName}</span>
                    <span className="rd-mono" style={{ color: c.typeOverridden ? 'var(--warning)' : 'var(--flow-700)' }}>{c.dataType}{c.typeOverridden ? ' *' : ''}</span>
                  </div>
                ))}
                {canEdit && (
                  <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr', marginTop: 6 }}>
                    <input className="rd-input" placeholder="Columna lógica (ej. monto deuda)" value={cForm.logicalName} onChange={(e) => setCForm({ ...cForm, logicalName: e.target.value })} />
                    <select className="rd-input" value={cForm.parentDomainId} onChange={(e) => setCForm({ ...cForm, parentDomainId: e.target.value })}>
                      <option value="">— Parent Domain —</option>
                      {domains.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.defaultDataType})</option>)}
                    </select>
                    <input className="rd-input rd-mono" placeholder="Tipo override (opcional)" value={cForm.dataType} onChange={(e) => setCForm({ ...cForm, dataType: e.target.value })} />
                    <label className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={cForm.isPrimaryKey} onChange={(e) => setCForm({ ...cForm, isPrimaryKey: e.target.checked })} /> PK</label>
                    <button className="rd-btn rd-btn-secondary rd-btn-sm" style={{ gridColumn: '1 / -1' }} onClick={() => addColumn(t.id)}><Icon name="plus" size={12} sw={2.6} />Agregar columna</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {tables.length === 0 && <div className="rd-small" style={{ padding: '8px 2px' }}>Sin tablas canónicas. Crea una (su nombre físico se deriva del diccionario).</div>}
      </div>
    </div>
  );
}
