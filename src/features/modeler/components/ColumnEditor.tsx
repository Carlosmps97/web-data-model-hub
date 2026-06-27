import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import * as gov from '@/features/governance/services/governance.service';
import type { ParentDomain, CanonicalColumn } from '@/features/governance/services/governance.service';

export default function ColumnEditor({ tableId, onClose, onAdd }: {
  tableId: string;
  onClose: () => void;
  onAdd: (tableId: string, input: { logicalName: string; mode: 'logical' | 'physical'; parentDomainId?: string; dataType?: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<'logical' | 'physical'>('logical');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState('');
  const [parentDomainId, setParentDomainId] = useState('');
  const [dataType, setDataType] = useState('');
  const [domains, setDomains] = useState<ParentDomain[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { gov.listDomains().then(setDomains).catch(() => {}); }, []);
  useEffect(() => {
    if (mode === 'logical' && name.trim()) gov.physicalize(name.trim()).then((r) => setPreview(r.physical)).catch(() => {});
    else setPreview('');
  }, [mode, name]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onAdd(tableId, { logicalName: name.trim(), mode, parentDomainId: parentDomainId || undefined, dataType: dataType || undefined }); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Nueva columna (Attribute)" icon="columns" onClose={onClose}
      footer={<>
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancelar</button>
        <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={submit}>Agregar</button>
      </>}>
      <div className="rd-seg" style={{ marginBottom: 10 }}>
        <button className={mode === 'logical' ? 'active' : ''} onClick={() => setMode('logical')}>Lógica</button>
        <button className={mode === 'physical' ? 'active' : ''} onClick={() => setMode('physical')}>Física</button>
      </div>
      <input className="rd-input" autoFocus placeholder={mode === 'logical' ? 'Palabras (ej. monto deuda dólares)' : 'Nombre físico (ej. MTO_DEU_USD)'} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} style={{ width: '100%' }} />
      {mode === 'logical' && preview && <div className="rd-small" style={{ marginTop: 8 }}>Físico: <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{preview}</span></div>}
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <select className="rd-input" value={parentDomainId} onChange={(e) => setParentDomainId(e.target.value)}>
          <option value="">— Parent Domain (tipo) —</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.defaultDataType})</option>)}
        </select>
        <input className="rd-input rd-mono" placeholder="Tipo override (opcional)" value={dataType} onChange={(e) => setDataType(e.target.value)} />
      </div>
    </Modal>
  );
}

// ── Grip de 6 puntos (no existe en el icon-set) ──────────────────────────
function Grip() {
  return (
    <svg width="11" height="16" viewBox="0 0 11 16" fill="currentColor" aria-hidden="true">
      {[3, 8].flatMap((x) => [3, 8, 13].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
    </svg>
  );
}

interface ColumnRowProps {
  col: CanonicalColumn;
  domains: ParentDomain[];
  canEdit: boolean;
  /** Upsert changeset-aware de campos (debe mergear sobre la columna). */
  onPatch: (id: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  onDelete: (id: string, name: string) => void;
  // DnD vertical (HTML5 nativo).
  isDragging: boolean;
  dropHint: 'before' | 'after' | null;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, e: React.DragEvent) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
}

/**
 * Fila editable de columna en el PropertiesPanel · Columns.
 * Inputs de texto debounced (~400ms) → upsert changeset-aware. Parent Domain
 * setea el dataType heredado salvo override (marca `typeOverridden`). Drag por el
 * grip para reordenar (el ordinal lo recomputa el contenedor al soltar).
 */
export function ColumnRow({ col, domains, canEdit, onPatch, onDelete, isDragging, dropHint, onDragStart, onDragOver, onDrop, onDragEnd }: ColumnRowProps) {
  const [logical, setLogical] = useState(col.logicalName);
  const [physical, setPhysical] = useState(col.physicalName);
  const [dataType, setDataType] = useState(col.dataType);
  const [description, setDescription] = useState(col.description ?? '');
  // Resincroniza si la columna cambió por fuera (reload). No pisa lo que tipea el usuario:
  // los inputs son no controlados respecto al server salvo cuando cambia la identidad.
  useEffect(() => { setLogical(col.logicalName); setPhysical(col.physicalName); setDataType(col.dataType); setDescription(col.description ?? ''); }, [col.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const debounced = (key: string, fields: Partial<CanonicalColumn>) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { void onPatch(col.id, fields); }, 400);
  };
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const onLogical = (v: string) => {
    setLogical(v);
    debounced('logical', { logicalName: v });
    // Auto-physicalize scope 'column' (el físico queda editable como override).
    if (v.trim()) gov.physicalize(v.trim()).then((r) => { setPhysical(r.physical); debounced('physical', { physicalName: r.physical }); }).catch(() => {});
  };
  const onPhysical = (v: string) => { setPhysical(v); debounced('physical', { physicalName: v }); };
  const onDescription = (v: string) => { setDescription(v); debounced('description', { description: v.trim() || undefined }); };
  const onDataType = (v: string) => {
    setDataType(v);
    const dom = domains.find((d) => d.id === col.parentDomainId);
    debounced('dataType', { dataType: v, typeOverridden: !!dom && v.trim() !== (dom.defaultDataType ?? '') });
  };
  const onDomain = (id: string) => {
    const dom = domains.find((d) => d.id === id);
    // Al elegir dominio: hereda su defaultDataType salvo que ya haya override.
    const nextType = dom && !col.typeOverridden ? (dom.defaultDataType ?? dataType) : dataType;
    setDataType(nextType);
    void onPatch(col.id, { parentDomainId: id || undefined, dataType: nextType, typeOverridden: col.typeOverridden });
  };
  const toggle = (field: 'isPrimaryKey' | 'isForeignKey' | 'isNullable' | 'isPartition', cur?: boolean) => () => { void onPatch(col.id, { [field]: !cur }); };

  return (
    <div
      className={`wk-pp-colcard${isDragging ? ' dragging' : ''}${dropHint ? ` drop${dropHint}` : ''}`}
      onDragOver={(e) => { if (canEdit) onDragOver(col.id, e); }}
      onDrop={() => { if (canEdit) onDrop(col.id); }}
    >
      <span
        className="wk-pp-grip"
        title="Arrastrá para reordenar"
        draggable={canEdit}
        onDragStart={() => onDragStart(col.id)}
        onDragEnd={onDragEnd}
      ><Grip /></span>

      <div className="wk-pp-colbody">
        <div className="wk-pp-row2">
          <input className="rd-input" disabled={!canEdit} placeholder="Lógico" value={logical} onChange={(e) => onLogical(e.target.value)} />
          <input className="rd-input rd-mono" disabled={!canEdit} placeholder="Físico" value={physical} onChange={(e) => onPhysical(e.target.value)} />
        </div>
        <div className="wk-pp-row2">
          <select className="rd-input" disabled={!canEdit} value={col.parentDomainId ?? ''} onChange={(e) => onDomain(e.target.value)}>
            <option value="">— Parent Domain —</option>
            {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input className="rd-input rd-mono" disabled={!canEdit} placeholder="dataType" value={dataType} onChange={(e) => onDataType(e.target.value)} />
        </div>
        <input className="rd-input" disabled={!canEdit} placeholder="Definición funcional" value={description} onChange={(e) => onDescription(e.target.value)} />
        <div className="wk-pp-flags">
          <label className={`wk-pp-flag pk${col.isPrimaryKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit} checked={!!col.isPrimaryKey} onChange={toggle('isPrimaryKey', col.isPrimaryKey)} /><Icon name="key" size={11} /> PK</label>
          <label className={`wk-pp-flag fk${col.isForeignKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit} checked={!!col.isForeignKey} onChange={toggle('isForeignKey', col.isForeignKey)} /><Icon name="link" size={11} /> FK</label>
          <label className={`wk-pp-flag nl${col.isNullable !== false ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit} checked={col.isNullable !== false} onChange={toggle('isNullable', col.isNullable !== false)} /> Nullable</label>
          <label className={`wk-pp-flag pt${col.isPartition ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit} checked={!!col.isPartition} onChange={toggle('isPartition', col.isPartition)} /><Icon name="grid" size={11} /> Partition</label>
          {canEdit && <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }} title="Eliminar columna" onClick={() => onDelete(col.id, col.physicalName)}><Icon name="trash" size={11} style={{ color: 'var(--error)' }} /></button>}
        </div>
      </div>
    </div>
  );
}
