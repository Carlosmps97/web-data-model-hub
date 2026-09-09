import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import { confirmDialog } from '@/components/ui/dialogs';
import { useModelerStore } from '@/store/useModelerStore';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/services/governance.service';
import type { CanonicalColumn, CanonicalTable, ParentDomain } from '@/services/governance.service';
import { isComplexTypeStart } from '../lib/complexTypes';
import { applyDomainDefaults } from '../lib/domainDefaults';
import { applyDomainPick } from '../lib/domainType';
import { canonicalDefaultType } from '../lib/typePick';
import { sortByOrdinal } from '../lib/columnOrder';
import { nextPkPosition, pkInKeyOrder } from '../lib/keyOrder';
import { createNameSync, type NameSync } from '../lib/nameSync';
import { syncRenamedColumnInViews } from '../lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import AuditHistory from './AuditHistory';
import { domainOptions } from './ColumnEditor';
import ComplexTypeBuilder from './ComplexTypeBuilder';
import SearchSelect from './SearchSelect';
import TypePicker from './TypePicker';
import UdpAssign from './UdpAssign';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import { countFacetUdpValues, FACET_CAPTION, FACET_SWITCH_HINT, facetNoun, type Facet } from '@/lib/facets';

type ColTab = 'definition' | 'datatype' | 'udps' | 'metadata';
const TABS: { id: ColTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'datatype', label: 'Data Type' },
  { id: 'udps', label: 'UDPs' },
  { id: 'metadata', label: 'Metadata' },
];

/**
 * Panel lateral de propiedades de UNA COLUMNA (doc 49) — contexto propio,
 * separado del Properties de la tabla. Ocupa la misma área `props` del grid:
 * mientras `selectedColumnId` esté seteado, este panel reemplaza al de tabla.
 * Misma estética (header + tabs subrayadas + cuerpo scrolleable) y mismo
 * contrato read-only: sin changeset editable abre como reader.
 *
 * La edición reutiliza EXACTAMENTE la mecánica de la card expandida que
 * reemplaza (ColumnRow, hoy retirada): nameSync anti-carreras para los
 * nombres (doc 18 §6), debounce 400ms con flush al desmontar para
 * definición/tipo (doc 40), regla dominio→tipo del doc 46 y flags con
 * pkPosition (doc 19 §12b). Las acciones ESTRUCTURALES (reorden físico,
 * orden de la llave, alta) siguen en el Properties de la tabla.
 */
export default function ColumnPropertiesPanel({ pushToast, onResize }: {
  pushToast: (m: string, k?: 'err') => void;
  onResize?: (width: number) => void;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const selectedColumnId = useModelerStore((s) => s.selectedColumnId);
  const setSelectedColumn = useModelerStore((s) => s.setSelectedColumn);
  const setSelectedTable = useModelerStore((s) => s.setSelectedTable);
  const setPanelFocusCol = useModelerStore((s) => s.setPanelFocusCol);
  const updateColumn = useModelerStore((s) => s.updateColumn);
  const deleteColumn = useModelerStore((s) => s.deleteColumn);
  const reload = useModelerStore((s) => s.reload);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  // Doc 69: faceta activa (switch Logical/Physical del canvas) → UDPs y rótulos.
  const viewMode = useModelerStore((s) => s.viewMode);
  const [udpDefs, setUdpDefs] = useState<UdpDefinition[]>([]);
  useEffect(() => {
    let alive = true;
    getUdpDefs(sessionProjectId()).then((d) => { if (alive) setUdpDefs(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const col = diagram?.columns.find((c) => c.id === selectedColumnId) ?? null;
  const table = diagram?.tables.find((t) => t.id === col?.tableId) ?? null;
  // Hermanas en el orden de la tabla: nextPkPosition (marcar PK) y la Metadata las usan.
  const cols = useMemo(
    () => sortByOrdinal((diagram?.columns ?? []).filter((c) => c.tableId === col?.tableId)),
    [diagram, col?.tableId],
  );

  const [tab, setTab] = useState<ColTab>('definition');
  const [domains, setDomains] = useState<ParentDomain[]>([]);
  useEffect(() => { gov.listDomains().then(setDomains).catch(() => {}); }, []);

  // La columna dejó de existir en el diagrama (borrada en otra vista o el
  // contexto cambió por debajo): cerrar y dejar a la vista el panel de tabla.
  useEffect(() => {
    if (diagram && selectedColumnId && !diagram.columns.some((c) => c.id === selectedColumnId)) {
      setSelectedColumn(null);
    }
  }, [diagram, selectedColumnId, setSelectedColumn]);

  // Resize del panel: mismo contrato que PropertiesPanel (WorkspaceScreen
  // clampa y persiste; ambos paneles comparten --props-w).
  const [resizing, setResizing] = useState(false);
  const startResize = (e: ReactPointerEvent) => {
    if (!onResize) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    setResizing(true);
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => onResize(window.innerWidth - ev.clientX);
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      setResizing(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  if (!col || !table) return null;

  // Upsert changeset-aware (mismo patchCol que tenía el panel de tabla): PK
  // nueva entra al final de la llave si hay orden explícito (doc 19 §12b) y un
  // rename FÍSICO re-apunta las vistas que referencian el nombre viejo.
  const patchCol = async (id: string, fields: Partial<CanonicalColumn>) => {
    if (fields.isPrimaryKey === true && fields.pkPosition === undefined) {
      const pos = nextPkPosition(cols, id);
      if (pos != null) fields = { ...fields, pkPosition: pos };
    }
    const before = cols.find((c) => c.id === id);
    try {
      await updateColumn(id, fields);
      if (before && fields.physicalName && fields.physicalName !== before.physicalName) {
        try {
          const n = await syncRenamedColumnInViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            before.tableId, before.physicalName, fields.physicalName);
          if (n) { pushToast(`Rename also applied to ${n} view(s)`); void reload(); }
        } catch { /* la vista se corrige a mano si hiciera falta */ }
      }
    } catch (e) { pushToast(e instanceof Error && e.message ? e.message : "Couldn't save the column", 'err'); }
  };

  // Borrado con impacto GLOBAL (spec 10 §8) — mismo flujo que tenía la card
  // expandida: relaciones donde la columna es extremo, en cualquier canvas.
  const removeCol = async () => {
    const name = col.physicalName;
    try {
      let impact: gov.RelationshipImpact = { relationships: [], total: 0 };
      try { impact = await gov.columnImpact(col.id); } catch { /* confirm genérico */ }
      const relIds = impact.relationships.map((r) => r.relId);
      const ok = await confirmDialog({
        title: 'Delete column',
        message: impact.total > 0 ? (
          <>
            <p style={{ margin: 0 }}>
              Column <strong>“{name}”</strong> participates in <strong>{impact.total}</strong> relationship{impact.total === 1 ? '' : 's'} — each will lose this pair (or be deleted if it was the last one):
            </p>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, maxHeight: 180, overflow: 'auto' }}>
              {impact.relationships.map((r) => (
                <li key={r.relId} style={{ marginBottom: 4 }}>
                  <span className="rd-mono">{r.otherTableName}.{r.otherColumnName}</span>
                  {r.canvases.length > 0 && (
                    <span className="rd-small" style={{ color: 'var(--muted)' }}>
                      {' '}— in {r.canvases.map((c) => c.name).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>Column <strong>“{name}”</strong> will be removed from this table.</>
        ),
        confirmLabel: impact.total > 0 ? 'Delete anyway' : 'Delete',
        cancelLabel: 'Cancel', variant: 'danger',
        // Cascade: el changeset registra el delete de la columna Y de cada
        // relación afectada; el store cierra este panel al terminar.
        action: () => deleteColumn(col.id, relIds),
      });
      if (ok) pushToast(impact.total > 0 ? 'Column and its relationships deleted' : 'Column deleted');
    } catch { pushToast("Couldn't delete", 'err'); }
  };

  // Back: vuelve al Properties de la tabla directo en Columns, con esta fila a
  // la vista (deep-link panelFocusColId — el panel de tabla lo consume).
  const backToTable = () => { setPanelFocusCol(col.id); setSelectedColumn(null); };

  const udpCount = countFacetUdpValues(col.udpValues, udpDefs, 'column', viewMode);   // doc 69: faceta activa
  const counts: Partial<Record<ColTab, number>> = { udps: udpCount };

  return (
    <aside className="wk-props">
      {onResize && (
        <div className={`wk-props-resizer${resizing ? ' dragging' : ''}`}
          onPointerDown={startResize} title="Drag to resize" />
      )}
      {/* ── Header: back + glyph + nombre + "table X · column" + close ── */}
      <div className="wk-props-top">
        <div className="wk-props-head">
          <button className="wk-props-close wk-props-back" title="Back to table properties" onClick={backToTable}>
            <ArrowLeft size={14} />
          </button>
          <div className="wk-props-glyph" aria-hidden><Icon name="columns" size={17} /></div>
          <div className="wk-props-id">
            {/* Doc 69: en Lógico es el ATRIBUTO de la entidad; en Físico, la COLUMNA de la tabla. */}
            <div className="wk-props-title">{viewMode === 'logical' ? (col.logicalName || col.physicalName) : (col.physicalName || col.logicalName)}</div>
            <div className="wk-props-sub">
              {facetNoun('table', viewMode)} <span className="rd-mono">{viewMode === 'logical' ? (table.logicalName || table.physicalName) : (table.physicalName || table.logicalName)}</span> · {facetNoun('column', viewMode)}
              {!canEdit && <span className="wk-props-ro">Read-only</span>}
            </div>
          </div>
          <button className="wk-props-close" title="Close" onClick={() => setSelectedTable(null)}><Icon name="x" size={14} /></button>
        </div>

        <div className="wk-pp-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="wk-props-body">
        {/* key=col.id: cambiar de columna remonta el editor — estado local,
            nameSync y debounces arrancan limpios (y el flush del desmontaje
            persiste lo pendiente de la columna anterior, doc 40). */}
        <ColumnPropsBody
          key={col.id}
          col={col}
          table={table}
          cols={cols}
          tab={tab}
          domains={domains}
          view={viewMode}
          canEdit={canEdit}
          onPatch={patchCol}
          onDelete={removeCol}
        />
      </div>
    </aside>
  );
}

/**
 * Cuerpo del panel (montado por columna vía `key`): estado de edición portado
 * 1:1 de la card expandida de ColumnRow. Todas las pestañas comparten esta
 * instancia — cambiar de pestaña NO pierde un tipeo en vuelo.
 */
function ColumnPropsBody({ col, table, cols, tab, domains, view, canEdit, onPatch, onDelete }: {
  col: CanonicalColumn;
  table: CanonicalTable;
  cols: CanonicalColumn[];
  tab: ColTab;
  domains: ParentDomain[];
  /** Doc 69: faceta activa del canvas (UDPs de Attribute vs Column). */
  view: Facet;
  canEdit: boolean;
  onPatch: (id: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  onDelete: () => void;
}) {
  const [logical, setLogical] = useState(col.logicalName);
  const [physical, setPhysical] = useState(col.physicalName);
  const [dataType, setDataType] = useState(col.dataType);
  const [description, setDescription] = useState(col.description ?? '');
  const [domainId, setDomainId] = useState(col.parentDomainId ?? '');
  // Spinner del tipo mientras el cambio de dominio viaja al changeset.
  const [typeBusy, setTypeBusy] = useState(false);
  // Flags (PK/FK/Nullable/Partition) en vuelo: bloquea la fila + spinner.
  const [flagsBusy, setFlagsBusy] = useState(false);
  // Nombres lógico/físico: los maneja nameSync (anti-carreras, doc 18 §6) —
  // token de secuencia contra respuestas stale de physicalize, override manual
  // del físico, y UN solo upsert con AMBOS campos.
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;
  const sync = useRef<NameSync | null>(null);
  if (!sync.current) {
    sync.current = createNameSync({
      physicalize: (l) => gov.physicalize(l),
      onState: (s) => { setLogical(s.logical); setPhysical(s.physical); },
      // col.id es estable por instancia (el cuerpo se monta con key=col.id).
      onCommit: (fields) => { void onPatchRef.current(col.id, fields); },
    });
    // Doc 68: re-siembra el override persistido — sin esto, tras recargar,
    // renombrar el lógico re-derivaba y pisaba el físico custom en el draft.
    sync.current.reset(col.logicalName, col.physicalName, col.physicalNameOverridden ?? false);
  }

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingDeb = useRef<Record<string, Partial<CanonicalColumn>>>({});
  const debounced = (key: string, fields: Partial<CanonicalColumn>) => {
    clearTimeout(timers.current[key]);
    pendingDeb.current[key] = fields;
    timers.current[key] = setTimeout(() => { delete pendingDeb.current[key]; void onPatch(col.id, fields); }, 400);
  };
  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    // Flush (doc 40): cerrar el panel o cambiar de columna DENTRO de la
    // ventana del debounce no pierde lo tipeado (description/dataType).
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
    // Doc 64 r2: el override se compara contra el default HOMOLOGADO (un
    // dominio legacy `Array` equivale a `ARRAY<>` en la plataforma).
    debounced('dataType', { dataType: v, typeOverridden: !!dom && v.trim() !== canonicalDefaultType(dom.defaultDataType) });
  };
  const onDomain = async (id: string) => {
    // El select refleja el cambio AL INSTANTE (estado local); el reload del
    // overlay confirma después. El spinner vive en el input de tipo.
    setDomainId(id);
    const dom = domains.find((d) => d.id === id);
    const prev = domains.find((d) => d.id === (col.parentDomainId ?? ''));
    // Regla dominio→tipo (doc 46, applyDomainPick): elegir OTRO dominio
    // RE-APLICA su default aunque hubiera override manual; re-elegir el MISMO
    // dominio respeta el override; quitar el dominio conserva el tipo. El
    // default viaja HOMOLOGADO (doc 64 r2).
    const next = applyDomainPick({
      currentDomainId: col.parentDomainId ?? '',
      typeOverridden: !!col.typeOverridden,
      currentType: dataType,
      nextDomainId: id,
      nextDefault: dom?.defaultDataType != null ? canonicalDefaultType(dom.defaultDataType) : undefined,
    });
    // Un tipeo de tipo aún en debounce quedó obsoleto: si volara después,
    // pisaría el default re-aplicado con el tipo viejo (lost-update).
    clearTimeout(timers.current['dataType']);
    delete pendingDeb.current['dataType'];
    setDataType(next.dataType);
    const fields: Partial<CanonicalColumn> = { parentDomainId: id || undefined, ...next };
    // Doc 69 §4.9: faceta LÓGICA del tipo — al cambiar de dominio hereda su
    // tipo lógico (sin UI de edición en Fase 1); el mismo dominio se respeta.
    if (id && id !== (col.parentDomainId ?? '')) {
      fields.logicalDataType = dom?.logicalDataType ? canonicalDefaultType(dom.logicalDataType) : undefined;
      fields.logicalTypeOverridden = false;
    }
    // Doc 79: SOLO los dominios "atributo estándar" (Erwin `Attribute_Definition`,
    // p.ej. FecRutina/CodMes ⇒ `inheritsName`) RE-APLICAN nombre lógico y
    // definición al cambiar de dominio (misma filosofía del tipo, doc 46); el
    // MISMO dominio respeta lo manual. Los genéricos de tipo NO tocan nada
    // (applyDomainDefaults devuelve {}). Un solo upsert con TODO (evita lost-update).
    const defaults = applyDomainDefaults({ prevDomain: prev, nextDomain: dom, current: { logicalName: logical, description } });
    if (defaults.description !== undefined) {
      clearTimeout(timers.current['description']);
      delete pendingDeb.current['description'];
      setDescription(defaults.description);
      fields.description = defaults.description;
    }
    setTypeBusy(true);
    try {
      if (defaults.logicalName !== undefined) {
        // El físico se RE-DERIVA del lógico nuevo por el glosario: el override
        // anterior (doc 68) pertenecía al nombre anterior — al re-aplicar la
        // regla, el físico vuelve a ser derivable (flag off). Si el naming no
        // responde, se conserva el físico actual.
        let phys = physical;
        let overridden = col.physicalNameOverridden ?? false;
        try {
          phys = (await gov.physicalize(defaults.logicalName)).physical;
          overridden = false;
        } catch { /* mantener el actual */ }
        sync.current?.reset(defaults.logicalName, phys, overridden);
        setLogical(defaults.logicalName);
        setPhysical(phys);
        Object.assign(fields, { logicalName: defaults.logicalName, physicalName: phys, physicalNameOverridden: overridden });
      }
      await onPatch(col.id, fields);
    } finally { setTypeBusy(false); }
  };
  const toggle = (field: 'isPrimaryKey' | 'isForeignKey' | 'isNullable' | 'isPartition', cur?: boolean) => () => {
    setFlagsBusy(true);
    // Al SACAR una columna de la PK se limpia su posición de llave (pkPosition):
    // si la vuelven a marcar, ordena por el orden físico (doc 19 §12b).
    const patch = field === 'isPrimaryKey' && cur
      ? { isPrimaryKey: false, pkPosition: null }
      : { [field]: !cur };
    onPatch(col.id, patch).finally(() => setFlagsBusy(false));
  };

  const domainName = domains.find((d) => d.id === (col.parentDomainId ?? ''))?.name;
  const keyPks = pkInKeyOrder(cols);
  const keyPos = col.isPrimaryKey ? keyPks.findIndex((c) => c.id === col.id) + 1 : 0;

  return (
    <>
      {/* ── Definition: nombres + definición funcional + flags ── */}
      {tab === 'definition' && (
        <>
          <div className="wk-props-field"><label>Logical name</label>
            <input className="rd-input" disabled={!canEdit} placeholder="Logical name" value={logical} onChange={(e) => onLogical(e.target.value)} />
          </div>
          <div className="wk-props-field"><label>Physical name</label>
            <input className="rd-input rd-mono" disabled={!canEdit} placeholder="Physical name" value={physical} onChange={(e) => onPhysical(e.target.value)} />
          </div>
          <div className="wk-props-field"><label>Functional definition</label>
            <textarea className="wk-pp-textarea" disabled={!canEdit} placeholder="What this attribute represents…" value={description} onChange={(e) => onDescription(e.target.value)} />
          </div>
          <div className="wk-props-field"><label>Flags</label>
            <div className="wk-pp-flags" style={flagsBusy ? { opacity: 0.7 } : undefined}>
              <label className={`wk-pp-flag pk${col.isPrimaryKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isPrimaryKey} onChange={toggle('isPrimaryKey', col.isPrimaryKey)} /><Icon name="key" size={11} /> PK</label>
              <label className={`wk-pp-flag fk${col.isForeignKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isForeignKey} onChange={toggle('isForeignKey', col.isForeignKey)} /><Icon name="link" size={11} /> FK</label>
              <label className={`wk-pp-flag nl${col.isNullable !== false ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={col.isNullable !== false} onChange={toggle('isNullable', col.isNullable !== false)} /> Nullable</label>
              <label className={`wk-pp-flag pt${col.isPartition ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isPartition} onChange={toggle('isPartition', col.isPartition)} /><Icon name="grid" size={11} /> Partition</label>
              {flagsBusy && <span className="rd-spin" style={{ marginLeft: 'auto', color: 'var(--primary)' }} aria-hidden />}
            </div>
          </div>
          {canEdit && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5' }}>
              <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--error, #C4314B)' }} disabled={flagsBusy} onClick={onDelete}>
                <Icon name="trash" size={12} /> Delete column…
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Data Type: Parent Domain + tipo (misma dupla del alta, doc 41) ── */}
      {tab === 'datatype' && (
        <>
          <div className="wk-props-field"><label>Parent Domain</label>
            <SearchSelect
              options={domainOptions(domains)}
              valueLabel={domains.find((d) => d.id === domainId)?.name ?? ''}
              placeholder="— Parent Domain —"
              emptyLabel="(none)"
              disabled={!canEdit}
              onPick={onDomain}
            />
          </div>
          <div className="wk-props-field"><label>Data type</label>
            <span className="wk-pp-typewrap">
              <TypePicker value={dataType} onChange={onDataType} placeholder="dataType" disabled={!canEdit || typeBusy} />
              {typeBusy && <span className="wk-spin" aria-hidden />}
            </span>
          </div>
          {/* Builder visual de tipos complejos: edita STRUCT/ARRAY/MAP campo a
              campo (persiste vía onDataType). */}
          {isComplexTypeStart(dataType) && (
            <ComplexTypeBuilder value={dataType} onChange={onDataType} disabled={!canEdit || typeBusy} />
          )}
        </>
      )}

      {/* ── UDPs (etiquetas key-value definidas en Data Standards) ── */}
      {tab === 'udps' && (
        <>
          <p className="wk-pp-cap" style={{ marginTop: 0 }}>
            <b>{FACET_CAPTION.column[view]}</b> — {FACET_SWITCH_HINT[view]}
          </p>
          <UdpAssign key={view} level="column" view={view} values={col.udpValues ?? {}} disabled={!canEdit} onChange={(next) => onPatch(col.id, { udpValues: next })} />
        </>
      )}

      {/* ── Metadata (solo lectura — espejo del concepto de la tabla) ── */}
      {tab === 'metadata' && (
        <>
          <dl className="wk-pp-meta">
            <dt>Physical name</dt><dd className="rd-mono">{col.physicalName}</dd>
            <dt>Logical name</dt><dd>{col.logicalName}</dd>
            <dt>Table</dt><dd className="rd-mono">{table.schema ? `${table.schema}.` : ''}{table.physicalName}</dd>
            <dt>Data type</dt><dd className="rd-mono">{col.dataType || '—'}</dd>
            <dt>Parent Domain</dt><dd>{domainName ?? '—'}</dd>
            <dt>Keys</dt><dd>{col.isPrimaryKey || col.isForeignKey
              ? [col.isPrimaryKey ? `PK${keyPos ? ` · #${keyPos} of ${keyPks.length} in the key` : ''}` : null, col.isForeignKey ? 'FK' : null].filter(Boolean).join(' · ')
              : '—'}</dd>
            <dt>Nullable</dt><dd>{col.isNullable !== false ? 'Yes' : 'No'}</dd>
            <dt>Partition</dt><dd>{col.isPartition ? 'Yes' : 'No'}</dd>
            <dt>Position</dt><dd>#{cols.findIndex((c) => c.id === col.id) + 1} <span style={{ color: 'var(--muted)' }}>of {cols.length}</span></dd>
            <dt>Definition</dt><dd>{col.description || '—'}</dd>
            <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{col.id}</dd>
          </dl>
          {/* Historial de auditoría (doc 51): acciones PUBLICADAS sobre la
              columna — quién / qué / cuándo / qué versión, detalle bajo demanda. */}
          <AuditHistory kind="column" entityId={col.id} />
        </>
      )}
    </>
  );
}
