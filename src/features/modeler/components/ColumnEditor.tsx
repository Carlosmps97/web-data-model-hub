import { useEffect, useRef, useState } from 'react';
import { sanitizeLogicalName } from '@/lib/logicalName';
import { sessionProjectId } from '@/store/useSessionStore';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import * as gov from '@/services/governance.service';
import type { ParentDomain, CanonicalColumn } from '@/services/governance.service';
import { apiErrorMessage } from '@/services/http';
import { isComplexTypeStart } from '../lib/complexTypes';
import { applyDomainDefaults } from '../lib/domainDefaults';
import { applyDomainPick } from '../lib/domainType';
import { applyNamingCase } from '../lib/physicalCase';
import { canonicalDefaultType } from '../lib/typePick';
import { useModelerStore, type AddColumnInput } from '@/store/useModelerStore';
import { FACET_CAPTION, type Facet } from '@/lib/facets';
import { columnCreateInput } from '../lib/createInputs';
import { facetType } from '../lib/inspectorModel';
import { domainUdpOffer, mergeInheritedUdps, type DomainUdpOffer, type DomainUdpOfferItem } from '../lib/domainInherit';
import DomainInheritPopup from './DomainInheritPopup';
import ComplexTypeBuilder from './ComplexTypeBuilder';
import SearchSelect from './SearchSelect';
import TypePicker from './TypePicker';
import UdpAssign from './UdpAssign';

/** Opciones del combobox de Parent Domain: alfabético, con el tipo por defecto
 *  como detalle a la derecha, homologado a la grafía canónica (un dominio con
 *  `Array` se muestra como `ARRAY<>`). */
export const domainOptions = (domains: ParentDomain[], facet: Facet = 'physical') =>
  [...domains]
    .sort((a, b) => a.name.localeCompare(b.name))
    // El detalle es el tipo de la faceta activa (lógico en Logical).
    .map((d) => ({ value: d.id, label: d.name, detail: facetDomainDefault(d, facet) }));

/** Default de tipo del dominio en la faceta: lógico (con fallback al físico) o físico. Homologado. */
export const facetDomainDefault = (d: { defaultDataType: string; logicalDataType?: string | null } | undefined, facet: Facet): string =>
  canonicalDefaultType(facet === 'logical' ? (d?.logicalDataType || d?.defaultDataType) : d?.defaultDataType);

export default function ColumnEditor({ tableId, onClose, onAdd }: {
  tableId: string;
  onClose: () => void;
  onAdd: (tableId: string, input: AddColumnInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [preview, setPreview] = useState('');
  const [parentDomainId, setParentDomainId] = useState('');
  const [dataType, setDataType] = useState('');
  // Override local vivo, con la misma regla del panel. El campo de tipo
  // siempre muestra el vigente (default del dominio u override manual).
  const [typeOverridden, setTypeOverridden] = useState(false);
  const [domains, setDomains] = useState<ParentDomain[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Metadata del alta: definición funcional, flags y UDPs en el mismo popup,
  // sin tener que crear la columna y luego ir a Properties · Columns.
  const [description, setDescription] = useState('');
  const [isPrimaryKey, setIsPrimaryKey] = useState(false);
  const [isForeignKey, setIsForeignKey] = useState(false);
  const [isNullable, setIsNullable] = useState(true);
  const [isPartition, setIsPartition] = useState(false);
  const [udpValues, setUdpValues] = useState<Record<string, string>>({});
  // Descripción física heredada del dominio estándar (viaja en el alta; se edita luego en Properties).
  const [physicalDescription, setPhysicalDescription] = useState('');
  const [udpDefs, setUdpDefs] = useState<UdpDefinition[]>([]);
  useEffect(() => {
    let alive = true;
    getUdpDefs(sessionProjectId()).then((d) => { if (alive) setUdpDefs(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const [inherit, setInherit] = useState<{ domain: ParentDomain; offer: DomainUdpOffer; also: string[] } | null>(null);
  // Ref espejo de los UDP: el blur del input (commit de UdpAssign) dispara en
  // el mismo gesto que el click en "Add" — el submit lee el ref (sincrónico)
  // para no perder ese último valor contra el batching del estado.
  const udpRef = useRef<Record<string, string>>({});
  // Token de secuencia: al escribir rápido, la respuesta de physicalize de un
  // texto más corto puede llegar después y pisar el preview (carrera fuera de
  // orden: "colcomplicado2" mostraría "COLCOMPLIC"). Debounce + guarda: solo
  // la respuesta del último input actualiza el preview.
  const previewSeq = useRef(0);
  // Los UDPs del alta siguen la faceta activa del canvas.
  const viewMode = useModelerStore((s) => s.viewMode);
  // El popup no tiene selector propio: sigue el selector global. En Logical lo
  // tipeado es el nombre lógico y el tipo es el lógico; en Physical lo tipeado
  // es el físico (con la regla de case) y el tipo es el físico.
  const mode = viewMode;
  // Regla de case del scope column (naming config del proyecto).
  const columnCase = useModelerStore((s) => s.naming?.column.case);

  useEffect(() => { gov.listDomains().then(setDomains).catch(() => {}); }, []);
  useEffect(() => {
    if (!name.trim()) { setPreview(''); return; }
    if (mode === 'physical') {
      // El físico tipeado se persiste con la regla de case del scope
      // (store + backend); el preview avisa solo cuando cambia lo tipeado.
      ++previewSeq.current;                       // anula un physicalize lógico en vuelo
      const cased = applyNamingCase(name.trim(), columnCase);
      setPreview(cased !== name.trim() ? cased : '');
      return;
    }
    const mySeq = ++previewSeq.current;
    const t = setTimeout(() => {
      gov.physicalize(name.trim())
        .then((r) => { if (mySeq === previewSeq.current) setPreview(r.physical); })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(t);
  }, [mode, name, columnCase]);

  // Dupla dominio+tipo como Properties · Data Type: elegir el dominio muestra
  // su default al instante (argumentos puntuales y builder de complejos
  // editables de frente); editar el tipo deslinda (applyDomainPick: otro
  // dominio re-aplica su default aunque hubiera override).
  const activeDomain = domains.find((d) => d.id === parentDomainId);
  // El default se consume homologado (canonicalDefaultType): un dominio con
  // `Array` hereda `ARRAY<>` (y abre el builder), no el texto crudo de la BD
  // sin homologar.
  const domainDefault = facetDomainDefault(activeDomain, mode);
  const onDomainPick = (id: string) => {
    const dom = domains.find((d) => d.id === id);
    const prev = domains.find((d) => d.id === parentDomainId);
    const next = applyDomainPick({
      currentDomainId: parentDomainId,
      typeOverridden,
      currentType: dataType,
      nextDomainId: id,
      nextDefault: dom ? facetDomainDefault(dom, mode) : undefined,
    });
    // Solo un dominio "atributo estándar" (Erwin `Attribute_Definition`
    // ⇒ `inheritsName`) re-aplica nombre lógico y definición; los genéricos de
    // tipo no tocan nada. Re-elegir el mismo respeta lo tipeado. En modo
    // «Physical» el input es un físico: el nombre no aplica.
    const defaults = applyDomainDefaults({
      prevDomain: prev, nextDomain: dom,
      current: { logicalName: mode === 'logical' ? name : '', description, physicalName: mode === 'physical' ? name : undefined, physicalDescription },
    });
    if (mode === 'logical' && defaults.logicalName !== undefined) setName(defaults.logicalName);
    if (defaults.description !== undefined) setDescription(defaults.description);
    // La descripción física va con la misma marca (`defaults.physicalName` se
    // ignora en el alta: el store deriva/casea el físico).
    if (defaults.physicalDescription !== undefined) setPhysicalDescription(defaults.physicalDescription ?? '');
    setParentDomainId(id);
    setDataType(next.dataType);
    setTypeOverridden(next.typeOverridden);
    // UDP por defecto del dominio recién elegido → el modelador elige (popup);
    // lo elegido entra al buffer local y viaja en el mismo alta.
    const offer = dom && id !== parentDomainId ? domainUdpOffer(dom, udpDefs) : null;
    if (dom && offer && offer.total > 0) {
      const also = [`type ${next.dataType || '—'}`];
      if (dom.inheritsName) also.push('names + definitions (standard attribute)');
      setInherit({ domain: dom, offer, also });
    }
  };
  const onTypeChange = (v: string) => {
    // '' desde "(domain default)": limpia el override y repone el default.
    const next = v === '' && activeDomain ? domainDefault : v;
    setDataType(next);
    setTypeOverridden(activeDomain ? next.trim() !== domainDefault : next.trim() !== '');
  };

  // Un alta a la vez: `busy` sigue en false dentro del mismo render, y sin esta
  // guarda un doble Enter (o uno sostenido) crearía columnas duplicadas.
  const inFlight = useRef(false);
  const submit = async () => {
    if (!name.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // Payload por faceta (createInputs, puro y testeado).
      await onAdd(tableId, columnCreateInput(mode, {
        name, parentDomainId, typeText: dataType, description, physicalDescription,
        isPrimaryKey, isForeignKey, isNullable, isPartition, udpValues: udpRef.current,
      }, activeDomain));
      onClose();
    } catch (e) {
      // 409 de duplicado u otro error: mensaje inline con el detail real del
      // backend; el modal no se cierra.
      setError(apiErrorMessage(e, "Couldn't add the column"));
    } finally { inFlight.current = false; setBusy(false); }
  };
  const setUdp = (next: Record<string, string>) => { udpRef.current = next; setUdpValues(next); };

  return (
    <Modal title={viewMode === 'logical' ? 'New attribute' : 'New column'} icon="columns" onClose={onClose}
      footer={<>
        <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onClose}>Cancel</button>
        <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={submit}>Add</button>
      </>}>
      <input className="rd-input" autoFocus placeholder={mode === 'logical' ? 'Attribute name (e.g. monto deuda dólares)' : 'Column name (e.g. MTO_DEU_USD)'} value={name} onChange={(e) => setName(mode === 'logical' ? sanitizeLogicalName(e.target.value) : e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} style={{ width: '100%' }} />
      {preview && <div className="rd-small" style={{ marginTop: 8 }}>Physical: <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{preview}</span></div>}
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {/* Combobox con buscador: contiene, lista acotada con
            scroll, nombre + tipo default a la derecha. */}
        <SearchSelect
          options={domainOptions(domains, mode)}
          valueLabel={domains.find((d) => d.id === parentDomainId)?.name ?? ''}
          placeholder={mode === 'logical' ? '— Parent Domain (logical type) —' : '— Parent Domain (type) —'}
          emptyLabel="(none)"
          onPick={onDomainPick}
        />
        <div>
          {/* El tipo siempre visible (default del dominio u override):
              catálogo cerrado con argumentos puntuales; STRUCT/ARRAY/MAP
              están en la lista. */}
          <TypePicker
            value={dataType}
            onChange={onTypeChange}
            placeholder={parentDomainId ? (mode === 'logical' ? 'Logical data type' : 'Data type') : (mode === 'logical' ? 'Logical data type (or pick a Parent Domain)' : 'Data type (or pick a Parent Domain)')}
            emptyLabel={parentDomainId ? '(domain default)' : '(none)'}
          />
          {parentDomainId && dataType.trim() !== '' && (
            <div className="rd-small" style={{ marginTop: 4, color: typeOverridden ? 'var(--amber-deep, #8A5A00)' : 'var(--text-muted, #8A93A5)' }}>
              {typeOverridden
                ? <>Override — the domain default is <span className="rd-mono">{domainDefault || '—'}</span></>
                : 'Domain default — edit to override'}
            </div>
          )}
          {/* Builder visual: STRUCT/ARRAY/MAP se declaran campo a campo
              (recompone el texto del tipo). */}
          {isComplexTypeStart(dataType) && (
            <ComplexTypeBuilder value={dataType} onChange={onTypeChange} />
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
        {/* UDP a nivel columna: buffer local (como el modal de Model properties)
            — nada viaja hasta el Add; el alta va en un solo payload. */}
        <div style={{ paddingTop: 10, borderTop: '1px solid #EEF1F6' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#8A93A5', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>{FACET_CAPTION.column[viewMode]}</div>
          <UdpAssign level="column" view={viewMode} values={udpValues} onChange={setUdp} />
        </div>
      </div>
      {error && (
        <div className="rd-small" role="alert" style={{ color: 'var(--error, #C4314B)', marginTop: 8 }}>
          {error}
        </div>
      )}
      {inherit && (
        <DomainInheritPopup domain={inherit.domain} offer={inherit.offer} also={inherit.also}
          onConfirm={(picked: DomainUdpOfferItem[]) => { setUdp(mergeInheritedUdps(udpRef.current, picked)); setInherit(null); }}
          onSkip={() => setInherit(null)} />
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
  /** Faceta activa: la celda de tipo muestra el tipo de esa faceta (default physical). */
  facet?: Facet;
  /** Con el buscador de columnas activo el reorder se apaga: el drop se
   *  resuelve contra la lista completa y una lista filtrada lo corrompería. */
  dragDisabled?: boolean;
  /** Motivo del drag apagado (tooltip del grip). Sin él se asume filtro. */
  dragDisabledReason?: string;
  /** El click abre el Properties de esta columna (sidebar propio); este
   *  listado no tiene edición inline. */
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
 * Fila de columna en el PropertiesPanel · Columns: fila compacta
 * grip · icono PK/FK/PART · lógico · físico · tipo · badges. El click abre el
 * Properties de la columna; la edición vive en ColumnPropertiesPanel. Drag por
 * el grip para reordenar (acción estructural, se queda en el panel de tabla).
 */
export function ColumnRow({ col, canEdit, facet, dragDisabled, dragDisabledReason, onOpen, isDragging, dropHint, onDragStart, onDragOver, onDrop, onDragEnd }: ColumnRowProps) {
  const canDrag = canEdit && !dragDisabled;
  const dndProps = {
    onDragOver: (e: React.DragEvent) => { if (canDrag) onDragOver(col.id, e); },
    onDrop: () => { if (canDrag) onDrop(col.id); },
  };
  const grip = (
    <span
      className={`wk-pp-grip${canEdit && dragDisabled ? ' nodrag' : ''}`}
      title={canDrag ? 'Drag to reorder' : (canEdit && dragDisabled ? (dragDisabledReason ?? 'Clear the search to reorder') : undefined)}
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
      <span className="wk-pp-colrow-dt rd-mono">{facetType(col, facet ?? 'physical')}</span>
      {col.isPrimaryKey && <span className="wk-pp-badge pk">PK</span>}
      {col.isForeignKey && <span className="wk-pp-badge fk">FK</span>}
      {col.isPartition && <span className="wk-pp-badge pt">PART</span>}
    </div>
  );
}
