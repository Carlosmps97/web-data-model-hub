import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import * as gov from '@/features/governance/services/governance.service';
import type { ParentDomain, CanonicalColumn } from '@/features/governance/services/governance.service';
import { apiErrorMessage } from '@/services/http';
import { isComplexTypeStart } from '../lib/complexTypes';
import type { AddColumnInput } from '@/store/useModelerStore';
import ComplexTypeBuilder from './ComplexTypeBuilder';
import SearchSelect from './SearchSelect';
import TypePicker from './TypePicker';
import UdpAssign from './UdpAssign';

/** Opciones del combobox de Parent Domain: alfabético, con el tipo por defecto
 *  como detalle a la derecha (doc 41). */
export const domainOptions = (domains: ParentDomain[]) =>
  [...domains]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ value: d.id, label: d.name, detail: d.defaultDataType }));

export default function ColumnEditor({ tableId, onClose, onAdd }: {
  tableId: string;
  onClose: () => void;
  onAdd: (tableId: string, input: AddColumnInput) => Promise<void>;
}) {
  const [mode, setMode] = useState<'logical' | 'physical'>('logical');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState('');
  const [parentDomainId, setParentDomainId] = useState('');
  const [dataType, setDataType] = useState('');
  const [domains, setDomains] = useState<ParentDomain[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Metadata del alta (doc 40): definición funcional, flags y UDPs en el MISMO
  // popup — antes había que crear la columna y luego ir a Properties · Columns.
  const [description, setDescription] = useState('');
  const [isPrimaryKey, setIsPrimaryKey] = useState(false);
  const [isForeignKey, setIsForeignKey] = useState(false);
  const [isNullable, setIsNullable] = useState(true);
  const [isPartition, setIsPartition] = useState(false);
  const [udpValues, setUdpValues] = useState<Record<string, string>>({});
  // Ref espejo de los UDP: el blur del input (commit de UdpAssign) dispara en
  // el MISMO gesto que el click en "Add" — el submit lee el ref (sincrónico)
  // para no perder ese último valor contra el batching del estado.
  const udpRef = useRef<Record<string, string>>({});
  // Token de secuencia: al escribir rápido, la respuesta de physicalize de un
  // texto MÁS CORTO podía llegar DESPUÉS y pisar el preview (carrera fuera de
  // orden → "colcomplicado2" mostraba "COLCOMPLIC"). Debounce + guarda: solo
  // la respuesta del ÚLTIMO input actualiza el preview.
  const previewSeq = useRef(0);

  useEffect(() => { gov.listDomains().then(setDomains).catch(() => {}); }, []);
  useEffect(() => {
    if (mode !== 'logical' || !name.trim()) { setPreview(''); return; }
    const mySeq = ++previewSeq.current;
    const t = setTimeout(() => {
      gov.physicalize(name.trim())
        .then((r) => { if (mySeq === previewSeq.current) setPreview(r.physical); })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [mode, name]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(tableId, {
        logicalName: name.trim(), mode, parentDomainId: parentDomainId || undefined, dataType: dataType || undefined,
        description: description.trim() || undefined,
        isPrimaryKey, isForeignKey, isNullable, isPartition,
        udpValues: udpRef.current,
      });
      onClose();
    } catch (e) {
      // 409 de duplicado (spec 10 §9) u otro error: mensaje INLINE con el
      // detail real del backend — el modal NO se cierra.
      setError(apiErrorMessage(e, "Couldn't add the column"));
    } finally { setBusy(false); }
  };
  const setUdp = (next: Record<string, string>) => { udpRef.current = next; setUdpValues(next); };

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
        {/* Combobox con buscador (doc 41): contiene, lista acotada con
            scroll, nombre + tipo default a la derecha. */}
        <SearchSelect
          options={domainOptions(domains)}
          valueLabel={domains.find((d) => d.id === parentDomainId)?.name ?? ''}
          placeholder="— Parent Domain (type) —"
          emptyLabel="(none)"
          onPick={setParentDomainId}
        />
        <div>
          {/* Catálogo cerrado con argumentos puntuales; STRUCT/ARRAY/MAP están
              EN la lista (los botones-plantilla se retiraron, doc 41). */}
          <TypePicker
            value={dataType}
            onChange={setDataType}
            placeholder="Type override (optional)"
            emptyLabel="(none — domain default)"
          />
          {/* Builder visual: al elegir STRUCT/ARRAY/MAP se abre la cajita para
              declarar la estructura campo a campo (recompone el texto). */}
          {isComplexTypeStart(dataType) && (
            <ComplexTypeBuilder value={dataType} onChange={setDataType} />
          )}
        </div>
        <input className="rd-input" placeholder="Functional definition (optional)" value={description}
          onChange={(e) => setDescription(e.target.value)} style={{ width: '100%' }} />
        {/* Flags — misma fila que Properties · Columns. Marcar PK des-marca
            Nullable (una PK no es nullable); sigue editable por si acaso. */}
        <div className="wk-pp-flags">
          <label className={`wk-pp-flag pk${isPrimaryKey ? ' on' : ''}`}><input type="checkbox" checked={isPrimaryKey} onChange={() => { const on = !isPrimaryKey; setIsPrimaryKey(on); if (on) setIsNullable(false); }} /><Icon name="key" size={11} /> PK</label>
          <label className={`wk-pp-flag fk${isForeignKey ? ' on' : ''}`}><input type="checkbox" checked={isForeignKey} onChange={() => setIsForeignKey(!isForeignKey)} /><Icon name="link" size={11} /> FK</label>
          <label className={`wk-pp-flag nl${isNullable ? ' on' : ''}`}><input type="checkbox" checked={isNullable} onChange={() => setIsNullable(!isNullable)} /> Nullable</label>
          <label className={`wk-pp-flag pt${isPartition ? ' on' : ''}`}><input type="checkbox" checked={isPartition} onChange={() => setIsPartition(!isPartition)} /><Icon name="grid" size={11} /> Partition</label>
        </div>
        {/* UDP a nivel columna: BUFFER local (como el modal de Model properties)
            — nada viaja hasta el Add; el alta va en un solo payload. */}
        <div style={{ paddingTop: 10, borderTop: '1px solid #EEF1F6' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#8A93A5', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>User Defined Properties</div>
          <UdpAssign level="column" values={udpValues} onChange={setUdp} />
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
  canEdit: boolean;
  /** Doc 42: con el buscador de columnas activo el reorder se apaga — el drop
   *  se resuelve contra la lista COMPLETA y una lista filtrada lo corrompería. */
  dragDisabled?: boolean;
  /** Doc 49: el click abre el Properties de ESTA columna (sidebar propio) —
   *  la edición inline (fila expandida) se retiró de este listado. */
  onOpen: (id: string) => void;
  // DnD vertical (HTML5 nativo).
  isDragging: boolean;
  dropHint: 'before' | 'after' | null;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, e: React.DragEvent) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
}

/**
 * Fila de columna en el PropertiesPanel · Columns (diseño p8): fila compacta
 * grip · icono PK/FK/PART · lógico · físico · tipo · badges. El click abre el
 * Properties de la columna (doc 49) — la card expandida "Editing column" se
 * retiró: la edición vive en ColumnPropertiesPanel. Drag por el grip para
 * reordenar (acción estructural, se queda en el panel de tabla).
 */
export function ColumnRow({ col, canEdit, dragDisabled, onOpen, isDragging, dropHint, onDragStart, onDragOver, onDrop, onDragEnd }: ColumnRowProps) {
  const canDrag = canEdit && !dragDisabled;
  const dndProps = {
    onDragOver: (e: React.DragEvent) => { if (canDrag) onDragOver(col.id, e); },
    onDrop: () => { if (canDrag) onDrop(col.id); },
  };
  const grip = (
    <span
      className={`wk-pp-grip${canEdit && dragDisabled ? ' nodrag' : ''}`}
      title={canDrag ? 'Drag to reorder' : (canEdit && dragDisabled ? 'Clear the search to reorder' : undefined)}
      draggable={canDrag}
      onClick={(e) => e.stopPropagation()}
      onDragStart={() => { if (canDrag) onDragStart(col.id); }}
      onDragEnd={onDragEnd}
    ><Grip /></span>
  );

  return (
    <div
      className={`wk-pp-colrow${col.isPartition ? ' pt' : ''}${isDragging ? ' dragging' : ''}${dropHint ? ` drop${dropHint}` : ''}`}
      role="button"
      title={canEdit ? 'Click to edit its properties' : 'Click to view its properties'}
      onClick={() => onOpen(col.id)}
      data-colid={col.id}
      {...dndProps}
    >
      {grip}
      <span className="wk-pp-colrow-ic" aria-hidden>
        {col.isPrimaryKey ? <Icon name="key" size={12} style={{ color: 'var(--k-pk)' }} />
          : col.isForeignKey ? <Icon name="link" size={12} style={{ color: 'var(--k-fk)' }} />
          : col.isPartition ? <Icon name="grid" size={12} style={{ color: 'var(--k-pt)' }} /> : null}
      </span>
      <span className={`wk-pp-colrow-name${col.isPrimaryKey ? ' pk' : ''}`}>{col.logicalName || col.physicalName}</span>
      <span className="wk-pp-colrow-phys rd-mono">{col.physicalName}</span>
      <span className="wk-pp-colrow-dt rd-mono">{col.dataType}</span>
      {col.isPrimaryKey && <span className="wk-pp-badge pk">PK</span>}
      {col.isForeignKey && <span className="wk-pp-badge fk">FK</span>}
      {col.isPartition && <span className="wk-pp-badge pt">PART</span>}
    </div>
  );
}
