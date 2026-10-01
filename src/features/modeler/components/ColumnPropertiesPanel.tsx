import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { sanitizeLogicalName } from '@/lib/logicalName';
import { ArrowLeft } from 'lucide-react';
import Icon from '@/components/ui/Icon';
import { useModelerStore } from '@/store/useModelerStore';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import * as gov from '@/services/governance.service';
import type { CanonicalColumn, CanonicalTable, ParentDomain } from '@/services/governance.service';
import { isComplexTypeStart } from '../lib/complexTypes';
import { mirrorComplex, syncedOtherFacet, typeFacetPatch } from '../lib/facetTypes';
import { applyDomainDefaults, type DomainDefaultsPatch } from '../lib/domainDefaults';
import { applyDomainPick } from '../lib/domainType';
import { canonicalDefaultType } from '../lib/typePick';
import { orderColumns } from '../lib/columnOrder';
import { pkInKeyOrder } from '../lib/keyOrder';
import { createNameSync, type NameSync } from '../lib/nameSync';
import { applyNamingCase } from '../lib/physicalCase';
import { syncRenamedColumnInViews } from '../lib/viewSync';
import { bestEffort, pinnedDebouncer, pinnedViewDeps } from '../lib/pinnedWrites';
import { pinSession, reportWriteError, type SessionPin } from '../lib/sessionGuard';
import AuditHistory from './AuditHistory';
import { domainOptions } from './ColumnEditor';
import ComplexTypeBuilder from './ComplexTypeBuilder';
import SearchSelect from './SearchSelect';
import TypePicker from './TypePicker';
import UdpAssign from './UdpAssign';
import DomainInheritPopup from './DomainInheritPopup';
import { confirmDeleteColumn } from './deleteConfirm';
import { facetEditable, type ColumnField } from '../lib/facetEditable';
import { domainUdpOffer, mergeInheritedUdps, type DomainUdpOffer, type DomainUdpOfferItem } from '../lib/domainInherit';
import { facetType } from '../lib/inspectorModel';
import { getUdpDefs, type UdpDefinition } from '@/features/standards/standards.service';
import { countFacetUdpValues, FACET_CAPTION, FACET_SWITCH_HINT, facetNoun, facetNouns, type Facet } from '@/lib/facets';

export type ColTab = 'definition' | 'datatype' | 'udps' | 'metadata';
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
 * definición/tipo (doc 40), regla dominio→tipo del doc 46 y flags (doc 94:
 * marcar/desmarcar PK re-ubica la columna en el orden único — lo hace el
 * store). Las acciones ESTRUCTURALES (reorden, alta) siguen en el Properties
 * de la tabla.
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
  // Hermanas en el ÚNICO orden (doc 81/94: PK primero y cada bloque por
  // ordinal, como el canvas): la Metadata y el «Position #N» las usan — así el
  // N coincide con lo que se ve en el canvas.
  const cols = useMemo(
    () => orderColumns((diagram?.columns ?? []).filter((c) => c.tableId === col?.tableId)),
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

  // Upsert changeset-aware (mismo patchCol que tenía el panel de tabla): un
  // cambio de PK lo re-ubica el store (doc 94 D2) y un rename FÍSICO re-apunta
  // las vistas que referencian el nombre viejo.
  // Doc 105: de la sesión donde empezó (H1: el re-apunte de vistas, tras el
  // upsert, corta si cambió) y su fallo espera la revalidación (H7).
  const patchCol = async (id: string, fields: Partial<CanonicalColumn>) => {
    const before = cols.find((c) => c.id === id);
    const pin = pinSession();
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save the column", 'err'));
    try {
      await updateColumn(id, fields);
      const renamedTo = fields.physicalName;
      if (before && renamedTo && renamedTo !== before.physicalName) {
        // La vista se corrige a mano si hiciera falta (best-effort).
        await bestEffort(async () => {
          const n = await syncRenamedColumnInViews(pinnedViewDeps(pin), before.tableId, before.physicalName, renamedTo);
          if (n) { pushToast(`Rename also applied to ${n} view(s)`); void reload(); }
        });
      }
    } catch (e) { await onError(e); }
  };

  // Borrado con impacto GLOBAL (spec 10 §8) — mismo flujo que tenía la card
  // expandida: relaciones donde la columna es extremo, en cualquier canvas.
  const removeCol = async () => {
    const name = col.physicalName;
    const noun = facetNouns(viewMode).member;
    // Doc 105 (ronda 4, R10-A): el borrado es de la sesión donde se pidió — si
    // mientras se lee el impacto se abre otra versión, el confirm no se abre en
    // ella, y la acción verifica el pin al clic.
    const pin = pinSession();
    // Ronda 4 (6a): con el motivo, como Properties y el Inspector (el «…nothing
    // was deleted. Try again.» de una lectura caída, un 409).
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : `Couldn't delete the ${noun}`, 'err'));
    // Doc 105 (ronda 3): sin el impacto (relaciones donde es extremo) no se
    // ofrece el borrado — con `relIds` vacío quedaban relaciones con pares
    // hacia una columna borrada.
    const onImpactError = reportWriteError(() => pushToast(`Couldn't check the relationships of this ${noun}: nothing was deleted. Try again.`, 'err'));
    try {
      let impact: gov.RelationshipImpact;
      try { impact = await gov.columnImpact(col.id); } catch (e) { await onImpactError(e); return; }
      if (!pin.holds()) return;
      const relIds = impact.relationships.map((r) => r.relId);
      // Diálogo compartido con el Object Inspector (doc 89 §3.5). Cascade: el
      // changeset registra el delete de la columna Y de cada relación
      // afectada; el store cierra este panel al terminar.
      const ok = await confirmDeleteColumn({
        name, nouns: facetNouns(viewMode), impact,
        action: () => { pin.check(); return deleteColumn(col.id, relIds); },
      });
      if (ok) pushToast(impact.total > 0 ? `${facetNouns(viewMode).Member} and its relationships deleted` : `${facetNouns(viewMode).Member} deleted`);
    } catch (e) { await onError(e); }
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
          udpDefs={udpDefs}
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
 *
 * Doc 89 §3.3: exportado — el Object Inspector lo monta tal cual (no lee el
 * diagrama: sólo `naming` del store) para editar la columna SIN canvas con la
 * misma mecánica. `switchHint` reemplaza el texto «Switch the canvas…» cuando
 * el switch de faceta es el del propio popup.
 */
export function ColumnPropsBody({ col, table, cols, tab, domains, udpDefs, view, canEdit, onPatch, onDelete, switchHint }: {
  col: CanonicalColumn;
  table: CanonicalTable;
  cols: CanonicalColumn[];
  tab: ColTab;
  domains: ParentDomain[];
  /** Doc 85: defs UDP del proyecto — oferta de UDP por defecto del dominio al asignarlo. */
  udpDefs: UdpDefinition[];
  /** Doc 69: faceta activa del canvas (UDPs de Attribute vs Column). */
  view: Facet;
  canEdit: boolean;
  onPatch: (id: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  onDelete: () => void;
  /** Hint de la faceta de solo lectura (default: el del canvas). */
  switchHint?: Record<Facet, string>;
}) {
  const hint = switchHint ?? FACET_SWITCH_HINT;
  const [logical, setLogical] = useState(col.logicalName);
  const [physical, setPhysical] = useState(col.physicalName);
  // Doc 96 D8: un complejo es el mismo en las dos facetas — datos cargados antes
  // de la regla (lógico `ARRAY<>` de Erwin) se muestran ya alineados.
  const [dataType, setDataType] = useState(() => mirrorComplex(col.logicalDataType ?? '', col.dataType ?? ''));
  const [description, setDescription] = useState(col.description ?? '');
  const [domainId, setDomainId] = useState(col.parentDomainId ?? '');
  // Doc 85: faceta física de la definición y faceta lógica del tipo.
  const [physicalDescription, setPhysicalDescription] = useState(col.physicalDescription ?? '');
  const [logicalDataType, setLogicalDataType] = useState(() => mirrorComplex(col.dataType ?? '', col.logicalDataType ?? ''));
  // Popup «Inherit from domain X» (doc 85 §3.6): guarda el patch armado por
  // onDomain hasta que el modelador elija los UDP (Skip = aplicar sin UDP).
  // Doc 105 (H1): `pin` = la sesión en que se eligió el dominio (el popup puede
  // quedar abierto mientras la versión cambia).
  const [inherit, setInherit] = useState<{ domain: ParentDomain; offer: DomainUdpOffer; also: string[]; fields: Partial<CanonicalColumn>; defaults: DomainDefaultsPatch; pin: SessionPin } | null>(null);
  const nouns = facetNouns(view);
  // Doc 85 §3.7: campo de la OTRA faceta ⇒ solo-lectura (input disabled + hint).
  const ro = (field: ColumnField) => !facetEditable('column', field, view);
  // Spinner del tipo mientras el cambio de dominio viaja al changeset.
  const [typeBusy, setTypeBusy] = useState(false);
  // Flags (PK/FK/Nullable/Partition) en vuelo: bloquea la fila + spinner.
  const [flagsBusy, setFlagsBusy] = useState(false);
  // Nombres lógico/físico: los maneja nameSync (anti-carreras, doc 18 §6) —
  // token de secuencia contra respuestas stale de physicalize, override manual
  // del físico, y UN solo upsert con AMBOS campos.
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;
  // Doc 83: la regla de case del scope column se aplica al físico TIPEADO —
  // el input muestra lo que se va a persistir (el backend normaliza igual).
  const columnCase = useModelerStore((s) => s.naming?.column.case);
  const columnCaseRef = useRef(columnCase);
  columnCaseRef.current = columnCase;
  // Doc 105 (H1): el pin de la ÚLTIMA edición de nombres — el commit de
  // nameSync (tras physicalize y su debounce) escribe sólo si sigue esa sesión.
  const namePin = useRef<SessionPin>(pinSession());
  const sync = useRef<NameSync | null>(null);
  if (!sync.current) {
    sync.current = createNameSync({
      physicalize: (l) => gov.physicalize(l),
      normalizePhysical: (v) => applyNamingCase(v, columnCaseRef.current),
      onState: (s) => { setLogical(s.logical); setPhysical(s.physical); },
      // col.id es estable por instancia (el cuerpo se monta con key=col.id).
      onCommit: (fields) => { if (namePin.current.holds()) void onPatchRef.current(col.id, fields); },
    });
    // Doc 68: re-siembra el override persistido — sin esto, tras recargar,
    // renombrar el lógico re-derivaba y pisaba el físico custom en el draft.
    sync.current.reset(col.logicalName, col.physicalName, col.physicalNameOverridden ?? false);
  }

  // Debounce de lo tipeado (definiciones, tipos). Doc 105 (H1): cada guardado
  // va con el pin de cuándo se tipeó — al cambiar de versión el panel se cierra
  // y hace flush: lo de la sesión anterior se descarta, no cae en la nueva.
  const deferred = useRef<ReturnType<typeof pinnedDebouncer<Partial<CanonicalColumn>>> | null>(null);
  if (!deferred.current) {
    deferred.current = pinnedDebouncer((fields: Partial<CanonicalColumn>) => onPatchRef.current(col.id, fields), 400);
  }
  const debounced = (key: string, fields: Partial<CanonicalColumn>) => deferred.current?.schedule(key, fields);
  useEffect(() => () => {
    // Flush (doc 40): cerrar el panel o cambiar de columna DENTRO de la
    // ventana del debounce no pierde lo tipeado (description/dataType).
    deferred.current?.flush();
    sync.current?.dispose();
  }, []);

  const onLogical = (v: string) => { namePin.current = pinSession(); sync.current?.setLogical(sanitizeLogicalName(v)); };   // doc 92 D8
  const onPhysical = (v: string) => { namePin.current = pinSession(); sync.current?.setPhysical(v); };
  const onDescription = (v: string) => { setDescription(v); debounced('description', { description: v.trim() || undefined }); };
  const onPhysicalDescription = (v: string) => { setPhysicalDescription(v); debounced('physicalDescription', { physicalDescription: v.trim() || undefined }); };
  // Doc 96 D8: los DOS tipos viajan juntos en un solo parche ('types'): un
  // complejo es el mismo en las dos facetas y dos upserts separados podrían
  // pisarse. El flag de override se recalcula solo en la faceta que cambia
  // respecto de lo guardado (`typeFacetPatch`).
  const typeFields = (phys: string, logi: string): Partial<CanonicalColumn> =>
    typeFacetPatch(phys, logi, col, domains.find((d) => d.id === domainId));
  const onLogicalDataType = (v: string) => {
    const phys = syncedOtherFacet(v, logicalDataType, dataType);
    setLogicalDataType(v);
    setDataType(phys);
    debounced('types', typeFields(phys, v));
  };
  const onDataType = (v: string) => {
    const logi = syncedOtherFacet(v, dataType, logicalDataType);
    setDataType(v);
    setLogicalDataType(logi);
    debounced('types', typeFields(v, logi));
  };
  const onDomain = async (id: string) => {
    const pin = pinSession();   // doc 105 (H1): la sesión de ESTA elección
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
    // pisaría el default re-aplicado con el tipo viejo (lost-update). Doc 96:
    // los dos tipos viajan juntos ('types'); el lógico en pantalla se re-envía abajo.
    deferred.current?.cancel('types');
    setDataType(next.dataType);
    const fields: Partial<CanonicalColumn> = { parentDomainId: id || undefined, ...next };
    const changed = !!id && id !== (col.parentDomainId ?? '');
    // Doc 69 §4.9 / doc 85: faceta LÓGICA del tipo — al cambiar de dominio
    // hereda su tipo lógico (override lógico off); el mismo dominio se respeta.
    if (changed) {
      const lt = dom?.logicalDataType ? canonicalDefaultType(dom.logicalDataType) : '';
      setLogicalDataType(lt);
      fields.logicalDataType = lt || undefined;
      fields.logicalTypeOverridden = false;
    } else {
      // Mismo dominio (o sin dominio): el lógico en pantalla —quizá un tipeo que
      // estaba en el parche 'types' descartado arriba— viaja igual; su flag solo
      // se recalcula si el valor cambió (minor #5).
      const lp = typeFacetPatch(next.dataType, logicalDataType, col, dom);
      fields.logicalDataType = lp.logicalDataType;
      fields.logicalTypeOverridden = lp.logicalTypeOverridden;
    }
    // Doc 79/85: SOLO los dominios "atributo estándar" (`inheritsName`) RE-APLICAN
    // nombres (lógico y físico) y descripciones (lógica y física) al cambiar de
    // dominio; el MISMO dominio respeta lo manual; los genéricos no tocan nada.
    const defaults = applyDomainDefaults({
      prevDomain: prev, nextDomain: dom,
      current: { logicalName: logical, description, physicalName: physical, physicalDescription },
    });
    if (defaults.description !== undefined) {
      deferred.current?.cancel('description');
      setDescription(defaults.description);
      fields.description = defaults.description;
    }
    if (defaults.physicalDescription !== undefined) {
      deferred.current?.cancel('physicalDescription');
      setPhysicalDescription(defaults.physicalDescription ?? '');
      fields.physicalDescription = defaults.physicalDescription ?? undefined;   // undefined = limpiar en el upsert
    }
    // Doc 85 §3.6: UDP por defecto del dominio nuevo → el modelador elige (popup).
    const offer: DomainUdpOffer = changed ? domainUdpOffer(dom, udpDefs) : { logical: [], physical: [], total: 0 };
    if (offer.total > 0 && dom) {
      const also = [`type ${next.dataType || '—'}${fields.logicalDataType ? ` / ${fields.logicalDataType}` : ''}`];
      if (dom.inheritsName) also.push('names + definitions (standard attribute)');
      setInherit({ domain: dom, offer, also, fields, defaults, pin });
      return;
    }
    await commitDomain(fields, defaults, pin);
  };

  /** Aplica el patch de dominio (un solo upsert: evita lost-update). Doc 85 D2:
   *  el físico heredado es el override del dominio o el DERIVADO del lógico
   *  nuevo por glosario; `physicalNameOverridden` = heredado ≠ derivado (así el
   *  rephysicalize del Glosario respeta un físico custom y re-deriva uno derivable). */
  const commitDomain = async (fields: Partial<CanonicalColumn>, defaults: DomainDefaultsPatch, pin: SessionPin) => {
    setTypeBusy(true);
    try {
      if (defaults.logicalName !== undefined) {
        let phys = physical;
        let overridden = col.physicalNameOverridden ?? false;
        try {
          const derived = (await gov.physicalize(defaults.logicalName)).physical;
          phys = defaults.physicalName ?? derived;
          overridden = phys !== derived;
        } catch {
          if (defaults.physicalName) { phys = defaults.physicalName; overridden = true; }
        }
        sync.current?.reset(defaults.logicalName, phys, overridden);
        setLogical(defaults.logicalName);
        setPhysical(phys);
        Object.assign(fields, { logicalName: defaults.logicalName, physicalName: phys, physicalNameOverridden: overridden });
      }
      // Doc 105 (H1): si mientras se derivaba el físico (o con el popup abierto)
      // se abrió otra versión, la elección ya no es de ésta: no se escribe.
      if (!pin.holds()) return;
      await onPatch(col.id, fields);
    } finally { setTypeBusy(false); }
  };
  const confirmInherit = async (picked: DomainUdpOfferItem[]) => {
    if (!inherit) return;
    const fields = { ...inherit.fields };
    if (picked.length) fields.udpValues = mergeInheritedUdps(col.udpValues, picked);
    setInherit(null);
    await commitDomain(fields, inherit.defaults, inherit.pin);
  };
  const skipInherit = async () => {
    if (!inherit) return;
    const { fields, defaults, pin } = inherit;
    setInherit(null);
    await commitDomain(fields, defaults, pin);
  };
  const toggle = (field: 'isPrimaryKey' | 'isForeignKey' | 'isNullable' | 'isPartition', cur?: boolean) => () => {
    setFlagsBusy(true);
    // Doc 94 D2: entrar/salir de la llave la re-ubica en la frontera del bloque
    // de PK (lo hace el store, en un solo lote con Undo).
    const patch = { [field]: !cur };
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
          <p className="wk-pp-cap" style={{ marginTop: 0 }}>
            <b>{view === 'logical' ? 'Logical facet' : 'Physical facet'}</b> — fields of the other facet are read-only here. {hint[view]}
          </p>
          <div className="wk-props-field"><label>Logical name</label>
            <input className="rd-input" disabled={!canEdit || ro('logicalName')} title={ro('logicalName') ? hint[view] : undefined} placeholder="Logical name" value={logical} onChange={(e) => onLogical(e.target.value)} />
          </div>
          <div className="wk-props-field"><label>Physical name</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input className="rd-input rd-mono" disabled={!canEdit || ro('physicalName')} title={ro('physicalName') ? hint[view] : undefined} placeholder="Physical name" value={physical} onChange={(e) => onPhysical(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              {/* Doc 88 §3: mismo «rayo» que en Properties de tabla — re-deriva del lógico (glosario) y apaga el override. */}
              {canEdit && !ro('physicalName') && (
                <button className="rd-btn rd-btn-ghost rd-btn-sm" title="Derive from logical (glossary)" disabled={!logical.trim()} onClick={() => { namePin.current = pinSession(); sync.current?.derive(); }}>
                  <Icon name="bolt" size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="wk-props-field"><label>Functional definition</label>
            <textarea className="wk-pp-textarea" disabled={!canEdit || ro('description')} title={ro('description') ? hint[view] : undefined} placeholder="What this attribute represents…" value={description} onChange={(e) => onDescription(e.target.value)} />
          </div>
          {/* Doc 85: comment FÍSICO (Erwin Comment) — el DDL lo emite como COMMENT; vacío = igual a la definición. */}
          <div className="wk-props-field"><label>Comment (physical)</label>
            <textarea className="wk-pp-textarea" disabled={!canEdit || ro('physicalDescription')} title={ro('physicalDescription') ? hint[view] : undefined}
              placeholder={description.trim() ? `Same as the functional definition: ${description.trim()}` : 'Physical comment (defaults to the functional definition)'}
              value={physicalDescription} onChange={(e) => onPhysicalDescription(e.target.value)} />
          </div>
          <div className="wk-props-field"><label>Flags</label>
            <div className="wk-pp-flags" style={flagsBusy ? { opacity: 0.7 } : undefined}>
              <label className={`wk-pp-flag pk${col.isPrimaryKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isPrimaryKey} onChange={toggle('isPrimaryKey', col.isPrimaryKey)} /><Icon name="key" size={11} /> PK</label>
              <label className={`wk-pp-flag fk${col.isForeignKey ? ' on' : ''}`}><input type="checkbox" disabled={!canEdit || flagsBusy} checked={!!col.isForeignKey} onChange={toggle('isForeignKey', col.isForeignKey)} /><Icon name="link" size={11} /> FK</label>
              <label className={`wk-pp-flag nl${col.isNullable !== false ? ' on' : ''}`} title={ro('isNullable') ? hint[view] : undefined}><input type="checkbox" disabled={!canEdit || flagsBusy || ro('isNullable')} checked={col.isNullable !== false} onChange={toggle('isNullable', col.isNullable !== false)} /> Nullable</label>
              <label className={`wk-pp-flag pt${col.isPartition ? ' on' : ''}`} title={ro('isPartition') ? hint[view] : undefined}><input type="checkbox" disabled={!canEdit || flagsBusy || ro('isPartition')} checked={!!col.isPartition} onChange={toggle('isPartition', col.isPartition)} /><Icon name="grid" size={11} /> Partition</label>
              {flagsBusy && <span className="rd-spin" style={{ marginLeft: 'auto', color: 'var(--primary)' }} aria-hidden />}
            </div>
          </div>
          {canEdit && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5' }}>
              <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--error, #C4314B)' }} disabled={flagsBusy} onClick={onDelete}>
                <Icon name="trash" size={12} /> Delete {nouns.member}…
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
              options={domainOptions(domains, view)}
              valueLabel={domains.find((d) => d.id === domainId)?.name ?? ''}
              placeholder="— Parent Domain —"
              emptyLabel="(none)"
              disabled={!canEdit}
              onPick={onDomain}
            />
          </div>
          {/* Doc 85 §3.7: el tipo de la faceta activa se edita; el de la otra se ve en solo-lectura. */}
          <div className="wk-props-field"><label>Logical data type</label>
            <span className="wk-pp-typewrap">
              <TypePicker value={ro('logicalDataType') ? (logicalDataType || dataType) : logicalDataType} onChange={onLogicalDataType}
                placeholder={dataType ? `Same as physical (${dataType})` : 'Logical data type'} disabled={!canEdit || typeBusy || ro('logicalDataType')} />
            </span>
            {ro('logicalDataType') && <p className="wk-pp-cap">{hint[view]}</p>}
          </div>
          {!ro('logicalDataType') && isComplexTypeStart(logicalDataType) && (
            <ComplexTypeBuilder value={logicalDataType} onChange={onLogicalDataType} disabled={!canEdit || typeBusy} />
          )}
          <div className="wk-props-field"><label>Physical data type</label>
            <span className="wk-pp-typewrap">
              <TypePicker value={dataType} onChange={onDataType} placeholder="dataType" disabled={!canEdit || typeBusy || ro('dataType')} />
              {typeBusy && <span className="wk-spin" aria-hidden />}
            </span>
            {ro('dataType') && <p className="wk-pp-cap">{hint[view]}</p>}
          </div>
          {/* Builder visual de tipos complejos: edita STRUCT/ARRAY/MAP campo a
              campo (persiste vía onDataType). */}
          {!ro('dataType') && isComplexTypeStart(dataType) && (
            <ComplexTypeBuilder value={dataType} onChange={onDataType} disabled={!canEdit || typeBusy} />
          )}
        </>
      )}

      {/* ── UDPs (etiquetas key-value definidas en Data Standards) ── */}
      {tab === 'udps' && (
        <>
          <p className="wk-pp-cap" style={{ marginTop: 0 }}>
            <b>{FACET_CAPTION.column[view]}</b> — {hint[view]}
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
            <dt>{nouns.One}</dt><dd className="rd-mono">{table.schema ? `${table.schema}.` : ''}{table.physicalName}</dd>
            <dt>Data type</dt><dd className="rd-mono">{facetType(col, view) || '—'}</dd>
            <dt>Parent Domain</dt><dd>{domainName ?? '—'}</dd>
            <dt>Keys</dt><dd>{col.isPrimaryKey || col.isForeignKey
              ? [col.isPrimaryKey ? `PK${keyPos ? ` · #${keyPos} of ${keyPks.length} in the key` : ''}` : null, col.isForeignKey ? 'FK' : null].filter(Boolean).join(' · ')
              : '—'}</dd>
            <dt>Nullable</dt><dd>{col.isNullable !== false ? 'Yes' : 'No'}</dd>
            <dt>Partition</dt><dd>{col.isPartition ? 'Yes' : 'No'}</dd>
            <dt>Position</dt><dd>#{cols.findIndex((c) => c.id === col.id) + 1} <span style={{ color: 'var(--muted)' }}>of {cols.length}</span></dd>
            <dt>Definition</dt><dd>{col.description || '—'}</dd>
            <dt>Physical comment</dt><dd>{col.physicalDescription || '—'}</dd>
            <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{col.id}</dd>
          </dl>
          {/* Historial de auditoría (doc 51): acciones PUBLICADAS sobre la
              columna — quién / qué / cuándo / qué versión, detalle bajo demanda. */}
          <AuditHistory kind="column" entityId={col.id} />
        </>
      )}
      {inherit && (
        <DomainInheritPopup domain={inherit.domain} offer={inherit.offer} also={inherit.also}
          onConfirm={(picked) => void confirmInherit(picked)} onSkip={() => void skipInherit()} />
      )}
    </>
  );
}
