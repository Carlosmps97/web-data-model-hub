import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import * as gov from '@/features/governance/services/governance.service';
import type { ParentDomain, CanonicalColumn } from '@/features/governance/services/governance.service';
import { apiErrorMessage } from '@/services/http';
import { isComplexTypeStart } from '../lib/complexTypes';
import { applyDomainPick } from '../lib/domainType';
import { createNameSync, type NameSync } from '../lib/nameSync';
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
        {/* Combobox con buscador (doc 41): empieza-por, lista acotada con
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
  domains: ParentDomain[];
  canEdit: boolean;
  /** Doc 42: con el buscador de columnas activo el reorder se apaga — el drop
   *  se resuelve contra la lista COMPLETA y una lista filtrada lo corrompería. */
  dragDisabled?: boolean;
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
export function ColumnRow({ col, domains, canEdit, dragDisabled, expanded, onToggle, onPatch, onDelete, isDragging, dropHint, onDragStart, onDragOver, onDrop, onDragEnd }: ColumnRowProps) {
  const [logical, setLogical] = useState(col.logicalName);
  const [physical, setPhysical] = useState(col.physicalName);
  const [dataType, setDataType] = useState(col.dataType);
  const [description, setDescription] = useState(col.description ?? '');
  const [domainId, setDomainId] = useState(col.parentDomainId ?? '');
  // Spinner del tipo mientras el cambio de dominio viaja al changeset (user feeling).
  const [typeBusy, setTypeBusy] = useState(false);
  // Flags (PK/FK/Nullable/Partition) en vuelo: bloquea la fila de flags + spinner.
  const [flagsBusy, setFlagsBusy] = useState(false);
  // Nombres lógico/físico: los maneja nameSync (anti-carreras, doc 18 §6) —
  // token de secuencia contra respuestas stale de physicalize, override manual
  // del físico, y UN solo upsert con AMBOS campos (sin lost-update entre dos
  // patches read-modify-write concurrentes). Un POST /physicalize por pausa de
  // tipeo (debounce interno), no por keystroke.
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;
  const sync = useRef<NameSync | null>(null);
  if (!sync.current) {
    sync.current = createNameSync({
      physicalize: (l) => gov.physicalize(l),
      onState: (s) => { setLogical(s.logical); setPhysical(s.physical); },
      // col.id es estable por instancia (la fila se monta con key=col.id).
      onCommit: (fields) => { void onPatchRef.current(col.id, fields); },
    });
    sync.current.reset(col.logicalName, col.physicalName);
  }
  // Resincroniza si la columna cambió por fuera (reload). No pisa lo que tipea el usuario:
  // los inputs son no controlados respecto al server salvo cuando cambia la identidad.
  useEffect(() => { setLogical(col.logicalName); setPhysical(col.physicalName); setDataType(col.dataType); setDescription(col.description ?? ''); setDomainId(col.parentDomainId ?? ''); sync.current?.reset(col.logicalName, col.physicalName); }, [col.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingDeb = useRef<Record<string, Partial<CanonicalColumn>>>({});
  const debounced = (key: string, fields: Partial<CanonicalColumn>) => {
    clearTimeout(timers.current[key]);
    pendingDeb.current[key] = fields;
    timers.current[key] = setTimeout(() => { delete pendingDeb.current[key]; void onPatch(col.id, fields); }, 400);
  };
  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    // Flush (doc 40): colapsar la fila o cerrar el panel DENTRO de la ventana
    // del debounce ya no pierde lo tipeado (description/dataType pendientes).
    for (const fields of Object.values(pendingDeb.current)) void onPatchRef.current(col.id, fields);
    pendingDeb.current = {};
    sync.current?.dispose();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onLogical = (v: string) => sync.current?.setLogical(v);
  const onPhysical = (v: string) => sync.current?.setPhysical(v);
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
    // Regla dominio→tipo (doc 46, applyDomainPick): elegir OTRO dominio
    // RE-APLICA su default aunque hubiera override manual (bug reportado: el
    // tipo personalizado se quedaba "pegado" — pertenecía a la combinación
    // anterior); re-elegir el MISMO dominio respeta el override; quitar el
    // dominio conserva el tipo. La cascada de Standards sigue respetando
    // typeOverridden — acá solo se recalcula contra el dominio NUEVO.
    const next = applyDomainPick({
      currentDomainId: col.parentDomainId ?? '',
      typeOverridden: !!col.typeOverridden,
      currentType: dataType,
      nextDomainId: id,
      nextDefault: dom?.defaultDataType,
    });
    // Un tipeo de tipo aún en debounce quedó obsoleto: si volara después,
    // pisaría el default re-aplicado con el tipo viejo (lost-update).
    clearTimeout(timers.current['dataType']);
    delete pendingDeb.current['dataType'];
    setDataType(next.dataType);
    setTypeBusy(true);
    onPatch(col.id, { parentDomainId: id || undefined, ...next })
      .finally(() => setTypeBusy(false));
  };
  const toggle = (field: 'isPrimaryKey' | 'isForeignKey' | 'isNullable' | 'isPartition', cur?: boolean) => () => {
    setFlagsBusy(true);
    // Al SACAR una columna de la PK se limpia su posición de llave (pkPosition,
    // metadata de la migración Erwin): si la vuelven a marcar, ordena por el
    // orden físico como cualquier PK creada a mano (doc 19 §12b).
    const patch = field === 'isPrimaryKey' && cur
      ? { isPrimaryKey: false, pkPosition: null }
      : { [field]: !cur };
    onPatch(col.id, patch).finally(() => setFlagsBusy(false));
  };

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

  // ── Fila compacta (diseño p8): click para expandir ──
  if (!expanded) {
    return (
      <div
        className={`wk-pp-colrow${col.isPartition ? ' pt' : ''}${isDragging ? ' dragging' : ''}${dropHint ? ` drop${dropHint}` : ''}`}
        role="button"
        title={canEdit ? 'Click to edit' : 'Click to view'}
        onClick={() => onToggle(col.id)}
        data-colid={col.id}
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
      data-colid={col.id}
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
          {/* Mismos combobox del alta (doc 41): buscador empieza-por, dominio
              con su tipo default al costado, tipo por catálogo + argumentos. */}
          <SearchSelect
            options={domainOptions(domains)}
            valueLabel={domains.find((d) => d.id === domainId)?.name ?? ''}
            placeholder="— Parent Domain —"
            emptyLabel="(none)"
            disabled={!canEdit}
            onPick={onDomain}
          />
          <span className="wk-pp-typewrap">
            <TypePicker value={dataType} onChange={onDataType} placeholder="dataType" disabled={!canEdit || typeBusy} />
            {typeBusy && <span className="wk-spin" aria-hidden />}
          </span>
        </div>
        {/* Builder visual de tipos complejos: misma cajita que el modal de alta
            (edita la estructura campo a campo; persiste vía onDataType). */}
        {isComplexTypeStart(dataType) && (
          <ComplexTypeBuilder value={dataType} onChange={onDataType} disabled={!canEdit || typeBusy} />
        )}
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
