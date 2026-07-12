import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import * as gov from '@/features/governance/services/governance.service';
import type { ParentDomain, CanonicalColumn } from '@/features/governance/services/governance.service';
import { apiErrorMessage } from '@/services/http';
import { COLUMN_DATA_TYPES } from '@/types/model';
import UdpAssign from './UdpAssign';

/** Plantillas rápidas de tipos complejos (F4 #6). */
const TYPE_TEMPLATES = ['STRUCT<>', 'ARRAY<>', 'MAP<>'] as const;
/** Umbral a partir del cual el tipo se edita en textarea monospace expandida. */
const LONG_TYPE_LEN = 40;

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { gov.listDomains().then(setDomains).catch(() => {}); }, []);
  useEffect(() => {
    if (mode === 'logical' && name.trim()) gov.physicalize(name.trim()).then((r) => setPreview(r.physical)).catch(() => {});
    else setPreview('');
  }, [mode, name]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(tableId, { logicalName: name.trim(), mode, parentDomainId: parentDomainId || undefined, dataType: dataType || undefined });
      onClose();
    } catch (e) {
      // 409 de duplicado (spec 10 §9) u otro error: mensaje INLINE con el
      // detail real del backend — el modal NO se cierra.
      setError(apiErrorMessage(e, "Couldn't add the column"));
    } finally { setBusy(false); }
  };

  return (
    <Modal title="New column (Attribute)" icon="columns" onClose={onClose}
      footer={<>
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
        <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={submit}>Add</button>
      </>}>
      <div className="rd-seg" style={{ marginBottom: 10 }}>
        <button className={mode === 'logical' ? 'active' : ''} onClick={() => setMode('logical')}>Logical</button>
        <button className={mode === 'physical' ? 'active' : ''} onClick={() => setMode('physical')}>Physical</button>
      </div>
      <input className="rd-input" autoFocus placeholder={mode === 'logical' ? 'Words (e.g. monto deuda dólares)' : 'Physical name (e.g. MTO_DEU_USD)'} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} style={{ width: '100%' }} />
      {mode === 'logical' && preview && <div className="rd-small" style={{ marginTop: 8 }}>Physical: <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{preview}</span></div>}
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <select className="rd-input" value={parentDomainId} onChange={(e) => setParentDomainId(e.target.value)}>
          <option value="">— Parent Domain (type) —</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.defaultDataType})</option>)}
        </select>
        <div>
          {dataType.length > LONG_TYPE_LEN ? (
            <textarea
              className="rd-input rd-mono"
              rows={3}
              placeholder="Type override (optional)"
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              style={{ width: '100%', resize: 'vertical', lineHeight: 1.5 }}
            />
          ) : (
            <input
              className="rd-input rd-mono"
              list="col-type-options"
              placeholder="Type override (optional)"
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              style={{ width: '100%' }}
            />
          )}
          <datalist id="col-type-options">
            {COLUMN_DATA_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {TYPE_TEMPLATES.map((t) => (
              <button key={t} type="button" className="rd-btn rd-btn-ghost rd-btn-sm rd-mono" title={`Insertar plantilla ${t}`} onClick={() => setDataType(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <div className="rd-small" role="alert" style={{ color: 'var(--error, #C4314B)', marginTop: 8 }}>
          {error}
        </div>
      )}
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
  /** Fila expandida (editor completo); colapsada muestra la fila compacta del diseño p8. */
  expanded: boolean;
  /** Expande (`id`) o colapsa (`null`) esta fila. */
  onToggle: (id: string | null) => void;
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
 * Fila de columna en el PropertiesPanel · Columns (diseño p8).
 * COLAPSADA (default): fila compacta grip · icono PK/FK/PART · lógico · físico ·
 * tipo · badges; click expande. EXPANDIDA: card "Editing column" con el editor
 * completo. Inputs debounced (~400ms) → upsert changeset-aware. Parent Domain se
 * refleja al instante (estado local) y el tipo muestra un spinner mientras el
 * cambio viaja al changeset. Drag por el grip para reordenar.
 */
export function ColumnRow({ col, domains, canEdit, expanded, onToggle, onPatch, onDelete, isDragging, dropHint, onDragStart, onDragOver, onDrop, onDragEnd }: ColumnRowProps) {
  const [logical, setLogical] = useState(col.logicalName);
  const [physical, setPhysical] = useState(col.physicalName);
  const [dataType, setDataType] = useState(col.dataType);
  const [description, setDescription] = useState(col.description ?? '');
  const [domainId, setDomainId] = useState(col.parentDomainId ?? '');
  // Spinner del tipo mientras el cambio de dominio viaja al changeset (user feeling).
  const [typeBusy, setTypeBusy] = useState(false);
  // Flags (PK/FK/Nullable/Partition) en vuelo: bloquea la fila de flags + spinner.
  const [flagsBusy, setFlagsBusy] = useState(false);
  // Resincroniza si la columna cambió por fuera (reload). No pisa lo que tipea el usuario:
  // los inputs son no controlados respecto al server salvo cuando cambia la identidad.
  useEffect(() => { setLogical(col.logicalName); setPhysical(col.physicalName); setDataType(col.dataType); setDescription(col.description ?? ''); setDomainId(col.parentDomainId ?? ''); }, [col.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // DEBOUNCED: antes disparaba un POST /physicalize por KEYSTROKE (escribir
    // "monto deuda cliente" = 19 requests); ahora uno por pausa de tipeo.
    clearTimeout(timers.current.__phys);
    if (v.trim()) {
      timers.current.__phys = setTimeout(() => {
        gov.physicalize(v.trim()).then((r) => { setPhysical(r.physical); debounced('physical', { physicalName: r.physical }); }).catch(() => {});
      }, 400);
    }
  };
  const onPhysical = (v: string) => { setPhysical(v); debounced('physical', { physicalName: v }); };
  const onDescription = (v: string) => { setDescription(v); debounced('description', { description: v.trim() || undefined }); };
  const onDataType = (v: string) => {
    setDataType(v);
    const dom = domains.find((d) => d.id === domainId);
    debounced('dataType', { dataType: v, typeOverridden: !!dom && v.trim() !== (dom.defaultDataType ?? '') });
  };
  const onDomain = (id: string) => {
    // El select refleja el cambio AL INSTANTE (estado local); el reload del
    // overlay confirma después. El spinner vive en el input de tipo.
    setDomainId(id);
    const dom = domains.find((d) => d.id === id);
    // Al elegir dominio: hereda su defaultDataType salvo que ya haya override.
    const nextType = dom && !col.typeOverridden ? (dom.defaultDataType ?? dataType) : dataType;
    setDataType(nextType);
    setTypeBusy(true);
    // Recalcula el override contra el NUEVO dominio: si el tipo resultante coincide
    // con su default, la conexión queda "sana" (typeOverridden=false); si difiere
    // (el usuario ya lo había pisado), sigue roto (true) → la cascada lo respeta.
    onPatch(col.id, { parentDomainId: id || undefined, dataType: nextType,
                      typeOverridden: !!dom && nextType.trim() !== (dom.defaultDataType ?? '') })
      .finally(() => setTypeBusy(false));
  };
  const toggle = (field: 'isPrimaryKey' | 'isForeignKey' | 'isNullable' | 'isPartition', cur?: boolean) => () => {
    setFlagsBusy(true);
    onPatch(col.id, { [field]: !cur }).finally(() => setFlagsBusy(false));
  };

  const dndProps = {
    onDragOver: (e: React.DragEvent) => { if (canEdit) onDragOver(col.id, e); },
    onDrop: () => { if (canEdit) onDrop(col.id); },
  };
  const grip = (
    <span
      className="wk-pp-grip"
      title={canEdit ? 'Drag to reorder' : undefined}
      draggable={canEdit}
      onClick={(e) => e.stopPropagation()}
      onDragStart={() => onDragStart(col.id)}
      onDragEnd={onDragEnd}
    ><Grip /></span>
  );

  // ── Fila compacta (diseño p8): click para expandir ──
  if (!expanded) {
    return (
      <div
        className={`wk-pp-colrow${col.isPartition ? ' pt' : ''}${isDragging ? ' dragging' : ''}${dropHint ? ` drop${dropHint}` : ''}`}
        role="button"
        title={canEdit ? 'Click to edit' : 'Click to view'}
        onClick={() => onToggle(col.id)}
        {...dndProps}
      >
        {grip}
        <span className="wk-pp-colrow-ic" aria-hidden>
          {col.isPrimaryKey ? <Icon name="key" size={12} style={{ color: 'var(--k-pk)' }} />
            : col.isForeignKey ? <Icon name="link" size={12} style={{ color: 'var(--k-fk)' }} />
            : col.isPartition ? <Icon name="grid" size={12} style={{ color: 'var(--k-pt)' }} /> : null}
        </span>
        <span className={`wk-pp-colrow-name${col.isPrimaryKey ? ' pk' : ''}`}>{logical || physical}</span>
        <span className="wk-pp-colrow-phys rd-mono">{physical}</span>
        <span className="wk-pp-colrow-dt rd-mono">{dataType}</span>
        {col.isPrimaryKey && <span className="wk-pp-badge pk">PK</span>}
        {col.isForeignKey && <span className="wk-pp-badge fk">FK</span>}
        {col.isPartition && <span className="wk-pp-badge pt">PART</span>}
      </div>
    );
  }

  // ── Card expandida (diseño p8 · "Editing column") ──
  return (
    <div
      className={`wk-pp-colcard${isDragging ? ' dragging' : ''}${dropHint ? ` drop${dropHint}` : ''}`}
      {...dndProps}
    >
      <button type="button" className="wk-pp-colcard-head" title="Collapse" onClick={() => onToggle(null)}>
        {canEdit ? <Icon name="edit" size={12} /> : <Icon name="eye" size={12} />}
        <span className="wk-pp-colcard-ttl">{canEdit ? 'Editing column' : 'Column details'}</span>
        <span className="wk-pp-colcard-sub rd-mono">{physical}</span>
        <Icon name="chevD" size={13} style={{ transform: 'rotate(180deg)' }} />
      </button>
      <div className="wk-pp-colcard-body">
        <div className="wk-pp-row2">
          <input className="rd-input" disabled={!canEdit} placeholder="Logical name" value={logical} onChange={(e) => onLogical(e.target.value)} />
          <input className="rd-input rd-mono" disabled={!canEdit} placeholder="Physical name" value={physical} onChange={(e) => onPhysical(e.target.value)} />
        </div>
        <div className="wk-pp-row2">
          <select className="rd-input" disabled={!canEdit} value={domainId} onChange={(e) => onDomain(e.target.value)}>
            <option value="">— Parent Domain —</option>
            {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <span className="wk-pp-typewrap">
            <input className="rd-input rd-mono" disabled={!canEdit || typeBusy} placeholder="dataType" value={dataType} onChange={(e) => onDataType(e.target.value)} />
            {typeBusy && <span className="wk-spin" aria-hidden />}
          </span>
        </div>
        <input className="rd-input" disabled={!canEdit} placeholder="Functional definition" value={description} onChange={(e) => onDescription(e.target.value)} />
        <div className="wk-pp-flags" style={flagsBusy ? { opacity: 0.7 } : undefined}>
          <label className={`wk-pp-flag pk${col.isPrimaryKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isPrimaryKey} onChange={toggle('isPrimaryKey', col.isPrimaryKey)} /><Icon name="key" size={11} /> PK</label>
          <label className={`wk-pp-flag fk${col.isForeignKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isForeignKey} onChange={toggle('isForeignKey', col.isForeignKey)} /><Icon name="link" size={11} /> FK</label>
          <label className={`wk-pp-flag nl${col.isNullable !== false ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={col.isNullable !== false} onChange={toggle('isNullable', col.isNullable !== false)} /> Nullable</label>
          <label className={`wk-pp-flag pt${col.isPartition ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isPartition} onChange={toggle('isPartition', col.isPartition)} /><Icon name="grid" size={11} /> Partition</label>
          {flagsBusy && <span className="rd-spin" style={{ marginLeft: 'auto', color: 'var(--primary)' }} aria-hidden />}
          {canEdit && <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={flagsBusy ? undefined : { marginLeft: 'auto' }} title="Delete column" disabled={flagsBusy} onClick={() => onDelete(col.id, col.physicalName)}><Icon name="trash" size={11} style={{ color: 'var(--error)' }} /></button>}
        </div>
        {/* UDP a nivel columna (etiquetas key-value definidas en Data Standards). */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #EEF1F6' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#8A93A5', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>User Defined Properties</div>
          <UdpAssign level="column" values={col.udpValues ?? {}} disabled={!canEdit} onChange={(next) => onPatch(col.id, { udpValues: next })} />
        </div>
      </div>
    </div>
  );
}
