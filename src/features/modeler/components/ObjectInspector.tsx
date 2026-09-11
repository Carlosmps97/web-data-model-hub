import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Crosshair, Eye, KeyRound, Link as LinkIcon, MapPin, Search, Table2, Trash2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Icon from '@/components/ui/Icon';
import { useModelerStore, type InspectTarget } from '@/store/useModelerStore';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import { pushUndo } from '@/store/useUndoStore';
import * as gov from '@/services/governance.service';
import type { CanonicalColumn, CanonicalTable, ParentDomain, TableUsageRow } from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import type { TableViewRow, View, ViewInput } from '@/services/views.service';
import { getSnapshot, getUdpDefs, type SnapshotDomain, type UdpDefinition } from '@/features/standards/standards.service';
import { isAsOfChangesetId } from '@/services/versioning.service';
import { FACET_CAPTION, facetNoun, facetNouns, type Facet } from '@/lib/facets';
import { inspectTable, inspectView, type InspectTableResult, type InspectViewResult } from '../services/inspector.service';
import * as struct from '../services/structure.service';
import type { SubjectArea } from '../services/modeler.service';
import { matchesColumn } from '../lib/columnSearch';
import { moveId, orderColumns, persistReorder, reorderPlan } from '../lib/columnOrder';
import { facetEditable, type TableField } from '../lib/facetEditable';
import { inspectorRefreshPlan } from '../lib/inspectorRefresh';
import { nextPkPosition } from '../lib/keyOrder';
import { tableNamePlan } from '../lib/nameSync';
import { VIEW_TYPE_NAME, syncViewTypeUdp } from '../lib/viewPanelLogic';
import { viewRestorePlan } from '../lib/viewRestore';
import { syncRenamedColumnInViews } from '../lib/viewSync';
import {
  cardinalityLabel, facetName, facetOnly, facetType, linkRole, otherFacet, ownColumns,
  positionIn, primaryCanvas, tableDeleteImpact, usagePath,
} from '../lib/inspectorModel';
import AuditHistory from './AuditHistory';
import { ColumnPropsBody, type ColTab } from './ColumnPropertiesPanel';
import { confirmDeleteColumn, confirmDeleteTable, confirmDeleteView } from './deleteConfirm';
import SchemaSelect from './SchemaSelect';
import UdpAssign from './UdpAssign';
import UdpReadonly from './UdpReadonly';

/**
 * Object Inspector (doc 72 §3 · r2 · doc 89) — popup con la metadata completa
 * de una tabla/entidad (con sus columnas/atributos) o de una vista, SIN
 * necesidad de canvas: el estado efectivo de la versión abierta llega en UNA
 * request (`/api/catalog/inspect/…`). Tiene su propio switch Logical/Physical
 * (arranca en la faceta del canvas activo, o física sin canvas) y NO cambia el
 * modo del canvas. Lo que en el sidebar dependía del canvas («this canvas»,
 * posición) se reemplaza por «Where used» + «Open in canvas».
 *
 * Doc 89: en sesión de edición sobre un draft propio EDITA como los Properties
 * del canvas (nombres por faceta con rayo del glosario, esquema, definición,
 * tipos/dominios/llaves/UDPs de la columna vía `ColumnPropsBody`, definición y
 * UDPs de la vista) y BORRA tablas, columnas y vistas por el mismo camino
 * versionado que el sidebar (`gov.*` / `viewsSvc.*` = cambios del changeset →
 * diff, revisión, historial, Undo). Borrar tabla/columna reusa las cascadas del
 * store con la pre-imagen del dossier (sin canvas no hay diagrama).
 */
export default function ObjectInspector() {
  const target = useModelerStore((s) => s.inspect);
  const close = useModelerStore((s) => s.closeInspector);
  if (!target) return null;
  return target.kind === 'view'
    ? <ViewInspector key={target.id} target={target} onClose={close} />
    : <TableInspector key={`${target.id}:${target.colId ?? ''}`} target={target} onClose={close} />;
}

interface Standards { udp: UdpDefinition[]; domains: SnapshotDomain[] }

/** Definiciones UDP + dominios (nombres) del snapshot de Data Standards. */
function useStandards(): Standards | null {
  const [std, setStd] = useState<Standards | null>(null);
  useEffect(() => {
    let alive = true;
    getSnapshot(sessionProjectId())
      .then((s) => { if (alive) setStd({ udp: s.udp ?? [], domains: s.domains ?? [] }); })
      .catch(() => { if (alive) setStd({ udp: [], domains: [] }); });
    return () => { alive = false; };
  }, []);
  return std;
}

/** Misma puerta de edición que el sidebar: sesión de edición sobre un draft
 *  (no un snapshot `asof:`). `writableCs()` del service vuelve a comprobarlo. */
function useCanEdit(): boolean {
  const openMode = useSessionStore((s) => s.openMode);
  const activeCs = useSessionStore((s) => s.activeChangesetId);
  return openMode === 'editing' && !!activeCs && !isAsOfChangesetId(activeCs);
}

/** Doc 89 §3.3: dominios + defs UDP del proyecto — los insumos de
 *  `ColumnPropsBody` (los mismos que carga el sidebar de columna). */
function useEditorInputs(enabled: boolean): { domains: ParentDomain[]; udpDefs: UdpDefinition[] } {
  const [domains, setDomains] = useState<ParentDomain[]>([]);
  const [udpDefs, setUdpDefs] = useState<UdpDefinition[]>([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    gov.listDomains().then((d) => { if (alive) setDomains(d); }).catch(() => {});
    getUdpDefs(sessionProjectId()).then((d) => { if (alive) setUdpDefs(d); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return { domains, udpDefs };
}

/** Doc 89 §3.1: la regla de case del físico tipeado (doc 83) necesita `naming`,
 *  que sólo se carga al abrir un canvas — sin canvas el inspector lo pide. */
function useNamingLoaded(): void {
  const naming = useModelerStore((s) => s.naming);
  const loadNaming = useModelerStore((s) => s.loadNaming);
  useEffect(() => { if (!naming) void loadNaming(sessionProjectId()); }, [naming, loadNaming]);
}

/** Hint de la faceta de solo lectura: acá el switch es el del propio popup. */
const INSPECTOR_SWITCH_HINT: Record<Facet, string> = {
  logical: 'Switch this inspector to Physical to edit the physical facet.',
  physical: 'Switch this inspector to Logical to edit the logical facet.',
};
const CANVAS_ONLY_HINT = 'Relationships and canvas placement are edited on the canvas — everything else can be changed here.';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const muted = (text: ReactNode) => <div className="rd-small" style={{ color: 'var(--muted)' }}>{text}</div>;

/** Pre-imagen POR VALOR de una vista para el Undo (doc 50) — el payload es el
 *  doc completo; `canvases` (fila del inspector de tabla) no es parte del doc. */
function viewPre(v: View): View {
  const copy: View & { canvases?: unknown } = {
    ...v,
    tags: v.tags ? [...v.tags] : undefined,
    sources: v.sources?.map((s) => ({ ...s })),
    sourceTableIds: v.sourceTableIds ? [...v.sourceTableIds] : undefined,
    customColumns: v.customColumns?.map((c) => ({ ...c })),
    udpValues: v.udpValues ? { ...v.udpValues } : undefined,
  };
  delete copy.canvases;
  return copy;
}

/** Doc 89 §3.4: borra la vista en el changeset (el backend poda sus membresías,
 *  doc 88 §4) y apila el Undo: re-graba el doc previo y vuelve a listarla en
 *  los canvases donde estaba (best-effort, mismo patrón del Undo de
 *  `deleteTable`). El refresco de la inversa sigue la regla del doc 89 §3.6. */
async function deleteViewVersioned(pre: View, canvasIds: string[], onActiveCanvas: boolean): Promise<void> {
  await viewsSvc.deleteView(pre.id);
  pushUndo(`Delete view ${pre.name}`, async () => {
    await viewsSvc.updateView(pre.id, pre as ViewInput);
    const canvases = (await Promise.all(canvasIds.map((id) => struct.getSubjectArea(id).catch(() => null))))
      .filter((c): c is SubjectArea => !!c);
    for (const p of viewRestorePlan(pre.id, canvases)) {
      try { await struct.setSubjectAreaViews(p.canvasId, p.viewIds); } catch { /* el canvas pudo desaparecer */ }
    }
    const store = useModelerStore.getState();
    await store.reload();
    store.syncExplorer(onActiveCanvas);
  });
}

function Footer({ usage, canEdit, onOpen, onClose }: { usage: TableUsageRow[] | null; canEdit: boolean; onOpen: () => void; onClose: () => void }) {
  const n = usage?.length ?? 0;
  const tip = !usage ? 'Loading…' : n === 0 ? 'Not placed on any canvas' : n > 1 ? 'Several canvases — pick one in “Where used”' : 'Open the canvas and center on the object';
  return (
    <>
      <span className="dmh-dialog-foot-left wk-insp-foot-note">
        {canEdit
          ? 'Effective state of the open version. Edits and deletions made here join the version like any canvas edit (review, diff, history, undo).'
          : 'Read-only · effective state of the open version. Open the model in edit mode to change or delete objects here.'}
      </span>
      <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Close</button>
      <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={!usage || n === 0} title={tip} onClick={onOpen}>
        <Crosshair size={12} /> Open in canvas{n > 1 ? '…' : ''}
      </button>
    </>
  );
}

function FacetSwitch({ facet, onChange }: { facet: Facet; onChange: (f: Facet) => void }) {
  return (
    <div className="rd-seg" role="tablist" aria-label="Facet">
      {(['logical', 'physical'] as Facet[]).map((f) => (
        <button key={f} type="button" role="tab" aria-selected={facet === f} className={facet === f ? 'active' : ''} onClick={() => onChange(f)}>
          {f === 'logical' ? 'Logical' : 'Physical'}
        </button>
      ))}
    </div>
  );
}

function UsageList({ usage, activeSaId, noun, onOpen }: {
  usage: TableUsageRow[]; activeSaId: string | null; noun: string; onOpen: (u: TableUsageRow) => void;
}) {
  if (usage.length === 0) {
    return muted(<>This {noun} is not placed on any canvas — it lives only in the catalog. Draw it with “New table → Import existing” on a canvas.</>);
  }
  return (
    <>
      {usage.map((u) => {
        const here = u.canvasId === activeSaId;
        return (
          <div key={u.canvasId} className="wk-insp-usage">
            <MapPin size={13} style={{ color: here ? 'var(--primary)' : 'var(--text-muted-3)', flex: 'none' }} />
            <span className="path" title={usagePath(u)}>
              {u.project || '—'}<span className="sep">›</span>{u.folder || 'root'}<span className="sep">›</span><b className="rd-mono">{u.canvas}</b>
              {here && <span className="wk-insp-chip accent" style={{ marginLeft: 8 }}>open now</span>}
            </span>
            <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => onOpen(u)}>
              <Crosshair size={12} /> {here ? 'Center' : 'Open'}
            </button>
          </div>
        );
      })}
    </>
  );
}

// ── Tabla / entidad ─────────────────────────────────────────────────────────

type TTab = 'definition' | 'columns' | 'links' | 'views' | 'udps' | 'usage' | 'history';
const T_TABS: { id: TTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'links', label: 'Links' },
  { id: 'views', label: 'Views' },
  { id: 'udps', label: 'UDPs' },
  { id: 'usage', label: 'Where used' },
  { id: 'history', label: 'History' },
];

function TableInspector({ target, onClose }: { target: InspectTarget; onClose: () => void }) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const canvasFacet = useModelerStore((s) => s.viewMode);
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const openInspector = useModelerStore((s) => s.openInspector);
  const reloadDiagram = useModelerStore((s) => s.reload);
  const markDirty = useModelerStore((s) => s.markDirty);
  const bumpExplorer = useModelerStore((s) => s.bumpExplorer);
  const deleteTable = useModelerStore((s) => s.deleteTable);
  const deleteColumn = useModelerStore((s) => s.deleteColumn);
  const onActiveCanvas = useModelerStore((s) => !!s.diagram?.tables.some((t) => t.id === target.id));
  const canEdit = useCanEdit();
  useNamingLoaded();
  const { domains, udpDefs } = useEditorInputs(canEdit);
  // D5: arranca en la faceta del canvas activo (o física sin canvas); no toca el canvas.
  const [facet, setFacet] = useState<Facet>(activeSaId ? canvasFacet : 'physical');
  const [data, setData] = useState<InspectTableResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TTab>(target.colId ? 'columns' : 'definition');
  const [selCol, setSelCol] = useState<string | null>(target.colId ?? null);
  const [colQ, setColQ] = useState('');
  // Doc 89 §3.2: form de Definition como el Properties (doc 68: `physTouched` =
  // intención sobre el físico en ESTA edición; null = manda el flag persistido).
  const [form, setForm] = useState({ logicalName: '', physicalName: '', schema: '', description: '' });
  const [physTouched, setPhysTouched] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const std = useStandards();

  useEffect(() => {
    let alive = true;
    inspectTable(target.id)
      .then((d) => {
        if (!alive) return;
        setData(d);
        // Se siembra SOLO al cargar (doc 40): un refresco tras guardar no pisa lo que se está tipeando.
        setForm({ logicalName: d.table.logicalName, physicalName: d.table.physicalName, schema: d.table.schema ?? '', description: d.table.description ?? '' });
        setPhysTouched(null);
      })
      .catch((e: unknown) => { if (alive) setError(errMsg(e, "Couldn't load the table")); });
    return () => { alive = false; };
  }, [target.id]);

  const table = data?.table;
  // Doc 81: mismo orden que el canvas y el properties — bloque PK primero +
  // resto por ordinal (antes era puro ordinal y con la carga Excel divergía).
  const cols = useMemo(() => (data ? orderColumns(data.columns) : []), [data]);
  const visible = useMemo(() => cols.filter((c) => matchesColumn(c, colQ)), [cols, colQ]);
  const col = selCol ? (data?.columns.find((c) => c.id === selCol) ?? null) : null;
  const domainName = (id?: string | null) => (id ? (std ? (std.domains.find((d) => d.id === id)?.name ?? id) : '…') : '—');
  const noun = facetNoun('table', facet);
  const nouns = facetNouns(facet);
  // Doc 85 §3.7: Views solo en físico; Columns se rotula Attributes en lógico.
  const tTabs = T_TABS.filter((t) => t.id !== 'views' || facet === 'physical')
    .map((t) => (t.id === 'columns' ? { ...t, label: nouns.Members } : t));
  useEffect(() => { if (tab === 'views' && facet !== 'physical') setTab('definition'); }, [tab, facet]);
  // Doc 85 §3.7: campo de la OTRA faceta ⇒ solo-lectura (input disabled + hint del popup).
  const ro = (field: TableField) => !facetEditable('table', field, facet);

  // ── Refresco (doc 89 §3.6): el dossier siempre; el canvas si lo contiene, si
  // no, el Explorer sólo ante cambios estructurales — nunca ambos. ──
  const refresh = async () => { setData(await inspectTable(target.id)); };
  const afterEdit = async (structural: boolean) => {
    markDirty();
    await refresh();
    const plan = inspectorRefreshPlan({ onActiveCanvas, structural });
    if (plan === 'reload') await reloadDiagram();
    else if (plan === 'bump') bumpExplorer();
  };
  const tablePre = (t: CanonicalTable): CanonicalTable => ({ ...t, ...(t.udpValues ? { udpValues: { ...t.udpValues } } : {}) });

  // ── Definition: nombres por faceta + rayo + esquema + definición (espejo de Properties) ──
  const saveTableDef = async () => {
    if (!data) return;
    const pre = tablePre(data.table);
    const logical = form.logicalName.trim();
    // Doc 68: la decisión (re-derivar vs conservar el custom + flag de override)
    // vive en tableNamePlan — un físico con override NO se re-deriva al renombrar
    // el lógico; vaciarlo re-enciende el auto.
    const plan = tableNamePlan({ logical, physical: form.physicalName.trim(), prev: data.table, sessionOverride: physTouched });
    let physical = plan.physical;
    if (plan.derive) {
      try { physical = (await gov.physicalize(logical, 'table')).physical; } catch { /* mantener el actual */ }
    }
    const next: CanonicalTable = {
      ...data.table, logicalName: logical, physicalName: physical, physicalNameOverridden: plan.overridden,
      schema: form.schema.trim() || undefined, description: form.description.trim() || undefined,
    };
    const structural = next.logicalName !== pre.logicalName || next.physicalName !== pre.physicalName || (next.schema ?? '') !== (pre.schema ?? '');
    if (!structural && (next.description ?? '') === (pre.description ?? '') && !!next.physicalNameOverridden === !!pre.physicalNameOverridden) return;
    setSaving(true);
    try {
      await gov.createTable(next);   // upsert por id = update (merge sobre el doc efectivo)
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterEdit(true); });
      setForm((f) => ({ ...f, logicalName: logical, physicalName: physical }));
      setPhysTouched(null);
      await afterEdit(structural);
      toast.success(`${nouns.One} updated`);
    } catch (e) { toast.error(errMsg(e, "Couldn't save")); }
    finally { setSaving(false); }
  };
  // Definición funcional: auto-guardado al salir del campo (doc 40). Los
  // nombres y el esquema siguen detrás de Save (un rename es transaccional):
  // `...data.table` usa los nombres del server — un nombre a medio editar en el
  // form NO viaja con este blur.
  const saveDescriptionOnBlur = async () => {
    if (!canEdit || !data) return;
    const next = form.description.trim() || undefined;
    if ((data.table.description ?? undefined) === next) return;
    const pre = tablePre(data.table);
    try {
      await gov.createTable({ ...data.table, description: next });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterEdit(false); });
      await afterEdit(false);
    } catch (e) { toast.error(errMsg(e, "Couldn't save")); }
  };
  /** Rayo (doc 88 §3): re-deriva el físico desde el lógico por el glosario y apaga el override. */
  const derivePhysical = async () => {
    try {
      const p = (await gov.physicalize(form.logicalName.trim(), 'table')).physical;
      setForm((f) => ({ ...f, physicalName: p }));
      setPhysTouched(false);  // doc 68: derivar = renunciar al override
    } catch { toast.error("Couldn't derive the physical name"); }
  };
  const saveTableUdp = async (next: Record<string, string>) => {
    if (!data) return;
    const pre = tablePre(data.table);
    try {
      await gov.createTable({ ...data.table, udpValues: next });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterEdit(false); });
      await afterEdit(false);
    } catch (e) { toast.error(errMsg(e, "Couldn't save UDP")); }
  };
  /** Doc 89 §3.2: borrado con el diálogo de impacto de Properties (conteos del
   *  dossier) y la cascada versionada del store — la pre-imagen del Undo viene
   *  del dossier porque sin canvas no hay diagrama. El store recarga el canvas
   *  y sincroniza el Explorer; el popup se cierra (la tabla ya no existe). */
  const askDeleteTable = async () => {
    if (!data || deleting) return;
    setDeleting(true);
    const t = data.table;
    try {
      const ok = await confirmDeleteTable({
        name: t.physicalName || t.logicalName, nouns, impact: tableDeleteImpact(target.id, data),
        action: async () => { await deleteTable(target.id, { pre: tablePre(t) }); },
      });
      if (ok) { toast.success(`${nouns.One} deleted`); onClose(); }
    } catch (e) { toast.error(errMsg(e, `Couldn't delete the ${nouns.one}`)); }
    finally { setDeleting(false); }
  };

  // ── Columna: mismo upsert changeset-aware que el sidebar (doc 89 §3.3) ──
  const viewDeps = { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView };
  const patchColumn = async (id: string, fields: Partial<CanonicalColumn>) => {
    const c = data?.columns.find((x) => x.id === id);
    if (!c) return;
    // PK nueva entra al final de la llave si hay orden explícito (doc 19 §12b).
    if (fields.isPrimaryKey === true && fields.pkPosition === undefined) {
      const pos = nextPkPosition(cols, id);
      if (pos != null) fields = { ...fields, pkPosition: pos };
    }
    const pre = { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) };
    const renamed = typeof fields.physicalName === 'string' && fields.physicalName !== c.physicalName;
    const structural = renamed || (typeof fields.logicalName === 'string' && fields.logicalName !== c.logicalName);
    try {
      await gov.updateColumn({ ...c, ...fields });   // upsert por id = update (merge)
      pushUndo(`Edit column ${pre.physicalName}`, async () => {
        await gov.updateColumn(pre);
        // Si el cambio renombró el FÍSICO, las vistas quedaron re-apuntadas al
        // nombre nuevo: deshacer las devuelve al viejo (best-effort).
        if (renamed) { try { await syncRenamedColumnInViews(viewDeps, c.tableId, fields.physicalName as string, pre.physicalName); } catch { /* best-effort */ } }
        await afterEdit(structural);
      });
      if (renamed) {
        // Un rename FÍSICO re-apunta las vistas que referencian el nombre viejo (mismo sync del sidebar).
        try {
          const n = await syncRenamedColumnInViews(viewDeps, c.tableId, c.physicalName, fields.physicalName as string);
          if (n) toast.success(`Rename also applied to ${n} view(s)`);
        } catch { /* la vista se corrige a mano si hiciera falta */ }
      }
      await afterEdit(structural);
    } catch (e) { toast.error(errMsg(e, "Couldn't save the column")); }
  };
  /** Doc 89 §3.3: impacto GLOBAL (spec 10 §8) + cascada versionada del store —
   *  la columna viaja desde el dossier (sin canvas no está en el diagrama). */
  const askDeleteColumn = async (c: CanonicalColumn) => {
    let impact: gov.RelationshipImpact = { relationships: [], total: 0 };
    try { impact = await gov.columnImpact(c.id); } catch { /* confirm genérico */ }
    const relIds = impact.relationships.map((r) => r.relId);
    try {
      const ok = await confirmDeleteColumn({
        name: c.physicalName, nouns, impact,
        action: () => deleteColumn(c.id, relIds, { col: c }),
      });
      if (ok) {
        toast.success(impact.total > 0 ? `${nouns.Member} and its relationships deleted` : `${nouns.Member} deleted`);
        setSelCol(null);
        await refresh();   // el store ya recargó el canvas y sincronizó el Explorer
      }
    } catch (e) { toast.error(errMsg(e, "Couldn't delete")); }
  };
  /** Doc 74: mueve la columna en el único orden de la tabla (`ordinal`). */
  const move = async (colId: string, delta: number) => {
    if (!data || reordering) return;
    const ids = cols.map((c) => c.id);
    const from = ids.indexOf(colId), to = from + delta;
    // Doc 81: el bloque PK queda fijo (su orden se cambia en el properties);
    // un no-PK no puede cruzar hacia el bloque PK (el display lo re-agruparía).
    if (cols[from]?.isPrimaryKey || cols[to]?.isPrimaryKey) return;
    const nextIds = moveId(ids, colId, delta);
    if (nextIds === ids) return;
    const plan = reorderPlan(data.columns, nextIds);
    if (!plan.length) return;
    setReordering(true);
    // Optimista: el inspector reordena ya; la persistencia corre detrás.
    setData((d) => d && ({ ...d, columns: d.columns.map((c) => { const s = plan.find((p) => p.c.id === c.id); return s ? { ...c, ordinal: s.idx } : c; }) }));
    try {
      await persistReorder(plan, (c, idx) => gov.updateColumn({ ...c, ordinal: idx }));
      pushUndo('Reorder columns',
        async () => { await persistReorder(plan, (c) => gov.updateColumn(c)); await afterEdit(false); });
      await afterEdit(false);
    } catch (e) { toast.error(errMsg(e, "Couldn't reorder")); await refresh().catch(() => {}); }
    finally { setReordering(false); }
  };
  /** Doc 89 §3.2: basurero de la pestaña Views (paridad con Properties › Views). */
  const askDeleteView = async (v: TableViewRow) => {
    const pre = viewPre(v);
    const viewOnActive = onActiveCanvas || !!useModelerStore.getState().diagram?.views.some((x) => x.id === v.id);
    try {
      const ok = await confirmDeleteView({
        name: v.name,
        action: () => deleteViewVersioned(pre, v.canvases.map((c) => c.id), viewOnActive),
      });
      if (ok) { toast.success('View deleted'); await afterEdit(true); }
    } catch (e) { toast.error(errMsg(e, "Couldn't delete")); }
  };

  const goCanvas = (u: TableUsageRow) => {
    onClose();
    const label = col ? `${table?.physicalName ?? ''} · ${col.physicalName}` : (table?.physicalName ?? '');
    openCanvasAndFocus(u.canvasId, u.projectId ?? undefined, target.id, selCol ?? undefined, label)
      .catch(() => toast.error("Couldn't open the canvas"));
  };
  const openPrimary = () => {
    if (!data) return;
    const c = primaryCanvas(data.usage, activeSaId);
    if (c) goCanvas(c); else setTab('usage');
  };
  const counts: Partial<Record<TTab, number>> = data
    ? { columns: data.columns.length, links: data.links.length, views: data.views.length, usage: data.usage.length }
    : {};
  const parents = data ? data.links.filter((l) => linkRole(l, target.id) === 'parent').length : 0;
  const children = data ? data.links.length - parents : 0;
  const canReorder = canEdit && !colQ.trim() && !reordering;

  return (
    <Dialog open title="Object Inspector" icon={Table2} width={960} onClose={onClose}
      subtitle={`${facet === 'logical' ? 'Entity' : 'Table'} metadata — the effective state of the open version, no canvas needed`}
      footer={<Footer usage={data?.usage ?? null} canEdit={canEdit} onOpen={openPrimary} onClose={onClose} />}>
      <div className="wk-insp">
        {error && <div className="wk-findres-empty rd-small" role="alert">{error}</div>}
        {!error && !data && <div className="wk-insp-loading"><span className="rd-spin" aria-hidden /> Loading…</div>}
        {data && table && (
          <>
            <div className="wk-insp-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={`wk-insp-title${facet === 'physical' ? ' rd-mono' : ''}`}>{facetName(table, facet) || '—'}</div>
                <div className="wk-insp-other">
                  {facet === 'logical' ? 'Physical' : 'Logical'}: <span className={facet === 'logical' ? 'rd-mono' : ''}>{facetName(table, otherFacet(facet)) || '—'}</span>
                </div>
                <div className="wk-insp-chips">
                  <span className="wk-insp-chip accent">{noun}</span>
                  <span className="wk-insp-chip rd-mono">schema {table.schema || '—'}</span>
                  {facetOnly(table) && <span className="wk-insp-chip">{facetOnly(table)} only</span>}
                  <span className="wk-insp-chip">{data.columns.length} {data.columns.length === 1 ? nouns.member : nouns.members}</span>
                  <span className="wk-insp-chip">{data.usage.length === 0 ? 'not on any canvas' : `${data.usage.length} canvas${data.usage.length === 1 ? '' : 'es'}`}</span>
                  {canEdit && <span className="wk-insp-chip">editable</span>}
                </div>
              </div>
              <FacetSwitch facet={facet} onChange={setFacet} />
            </div>
            <div className="wk-pp-tabs" role="tablist">
              {tTabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}{counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
                </button>
              ))}
            </div>
            <div className="wk-insp-body">
              {tab === 'definition' && canEdit && (
                <>
                  {/* Doc 89 §3.2 · doc 85 §3.7: cada faceta edita SUS campos; los de la otra quedan en solo-lectura con el hint. */}
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}>
                    <b>{facet === 'logical' ? 'Logical facet' : 'Physical facet'}</b> — fields of the other facet are read-only here. {INSPECTOR_SWITCH_HINT[facet]}
                  </p>
                  <div className="wk-insp-ro">{CANVAS_ONLY_HINT}</div>
                  <div className="wk-props-field"><label>Logical name</label>
                    <input className="rd-input" disabled={saving || ro('logicalName')} title={ro('logicalName') ? INSPECTOR_SWITCH_HINT[facet] : undefined} value={form.logicalName} onChange={(e) => setForm({ ...form, logicalName: e.target.value })} />
                  </div>
                  <div className="wk-props-field"><label>Physical name</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input className="rd-input rd-mono" disabled={saving || ro('physicalName')} title={ro('physicalName') ? INSPECTOR_SWITCH_HINT[facet] : undefined} value={form.physicalName} onChange={(e) => { setForm({ ...form, physicalName: e.target.value }); setPhysTouched(e.target.value.trim() !== ''); }} style={{ flex: 1, minWidth: 0 }} />
                      {!ro('physicalName') && (
                        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" title="Derive from logical (glossary)" disabled={saving || !form.logicalName.trim()} onClick={() => void derivePhysical()}>
                          <Icon name="bolt" size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="wk-props-field"><label>Schema</label>
                    <SchemaSelect kind="tables" value={form.schema} onChange={(v) => setForm({ ...form, schema: v })} disabled={saving || ro('schema')} />
                    {ro('schema') && <p className="wk-pp-cap">{INSPECTOR_SWITCH_HINT[facet]}</p>}
                  </div>
                  <div className="wk-props-field"><label>Functional definition</label>
                    <textarea className="wk-pp-textarea" placeholder="What this entity represents…" value={form.description} disabled={saving}
                      onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => void saveDescriptionOnBlur()} />
                  </div>
                  <dl className="wk-pp-meta">
                    <dt>Facets</dt><dd>{facetOnly(table) === 'logical' ? 'Logical only (entity without a physical table)' : facetOnly(table) === 'physical' ? 'Physical only (table without a logical entity)' : 'Logical and physical'}</dd>
                    <dt>Relationships</dt><dd>{data.links.length === 0 ? '—' : `${data.links.length} link${data.links.length === 1 ? '' : 's'} · ${parents} parent${parents === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'}`}</dd>
                    <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{table.id}</dd>
                  </dl>
                  <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%', marginTop: 4 }} disabled={saving} onClick={() => void saveTableDef()}>
                    {saving && <span className="rd-spin" aria-hidden />}{saving ? 'Saving…' : 'Save'}
                  </button>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5' }}>
                    <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--error, #C4314B)' }} disabled={deleting || saving} onClick={() => void askDeleteTable()}>
                      {deleting ? <span className="rd-spin" aria-hidden /> : <Trash2 size={12} />} Delete {nouns.one}…
                    </button>
                  </div>
                </>
              )}
              {tab === 'definition' && !canEdit && (
                <dl className="wk-pp-meta">
                  <dt>Logical name</dt><dd>{table.logicalName || '—'}</dd>
                  <dt>Physical name</dt><dd className="rd-mono">{table.physicalName || '—'}</dd>
                  <dt>Schema</dt><dd className="rd-mono">{table.schema || '—'}</dd>
                  <dt>Facets</dt><dd>{facetOnly(table) === 'logical' ? 'Logical only (entity without a physical table)' : facetOnly(table) === 'physical' ? 'Physical only (table without a logical entity)' : 'Logical and physical'}</dd>
                  <dt>Definition</dt><dd>{table.description || '—'}</dd>
                  <dt>{nouns.Members}</dt><dd>{data.columns.length}</dd>
                  <dt>Relationships</dt><dd>{data.links.length === 0 ? '—' : `${data.links.length} link${data.links.length === 1 ? '' : 's'} · ${parents} parent${parents === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'}`}</dd>
                  <dt>Views</dt><dd>{data.views.length || '—'}</dd>
                  <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{table.id}</dd>
                </dl>
              )}

              {tab === 'columns' && col && (
                <ColumnDetail col={col} cols={cols} table={table} facet={facet} std={std} canEdit={canEdit}
                  domains={domains} udpDefs={udpDefs} domainName={domainName(col.parentDomainId)}
                  onBack={() => setSelCol(null)} onPatch={patchColumn} onDelete={() => void askDeleteColumn(col)} />
              )}
              {tab === 'columns' && !col && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}>
                    Click a row for the full detail{canEdit ? ' (names, type, domain, keys, UDPs, delete)' : ' (both facets, UDPs, history)'}.
                    {canEdit ? ' Use ↑ ↓ to reorder the columns.' : ''}
                    {reordering && <span className="rd-spin" style={{ marginLeft: 6, color: 'var(--primary)' }} aria-hidden />}
                  </p>
                  {cols.length > 0 && (
                    <div className="wk-insp-find">
                      <Search size={12} aria-hidden />
                      <input className="rd-input" placeholder={`Find ${nouns.aMember} (contains…)`} value={colQ} onChange={(e) => setColQ(e.target.value)} aria-label={`Find ${nouns.aMember}`} />
                    </div>
                  )}
                  {canEdit && colQ.trim() && cols.length > 0 && <p className="wk-pp-cap">Reordering is disabled while filtering.</p>}
                  {visible.length === 0
                    ? muted(cols.length === 0 ? 'No columns.' : `No columns match “${colQ.trim()}”.`)
                    : (
                      <table className="wk-insp-grid">
                        <thead>
                          <tr>
                            <th>#</th>
                            {canReorder && <th />}
                            <th>Key</th>
                            <th>{facet === 'logical' ? 'Attribute' : 'Column'}</th>
                            <th>{facet === 'logical' ? 'Physical' : 'Logical'}</th>
                            <th>Type</th><th>Domain</th><th>Null</th><th>Definition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((c) => {
                            const only = facetOnly(c);
                            const i = cols.indexOf(c);
                            return (
                              <tr key={c.id} onClick={() => setSelCol(c.id)} title="Open the column detail">
                                <td className="n">{i + 1}</td>
                                {canReorder && (
                                  <td className="mv" onClick={(e) => e.stopPropagation()}>
                                    <button type="button" className="wk-insp-mv" title={c.isPrimaryKey ? 'Reorder keys in the table properties' : 'Move up'} disabled={i === 0 || c.isPrimaryKey || !!cols[i - 1]?.isPrimaryKey} onClick={() => void move(c.id, -1)}>↑</button>
                                    <button type="button" className="wk-insp-mv" title={c.isPrimaryKey ? 'Reorder keys in the table properties' : 'Move down'} disabled={i === cols.length - 1 || c.isPrimaryKey} onClick={() => void move(c.id, 1)}>↓</button>
                                  </td>
                                )}
                                <td className="k">{c.isPrimaryKey && <KeyRound size={11} className="pk" />}{c.isForeignKey && <LinkIcon size={11} className="fk" />}</td>
                                <td className={facet === 'physical' ? 'rd-mono' : ''}>{facetName(c, facet)}{only && <span className="wk-insp-only">{only} only</span>}</td>
                                <td className={`muted${facet === 'logical' ? ' rd-mono' : ''}`}>{facetName(c, otherFacet(facet))}</td>
                                <td className="rd-mono">{facetType(c, facet) || '—'}</td>
                                <td>{domainName(c.parentDomainId)}</td>
                                <td>{c.isNullable !== false ? 'Yes' : 'No'}</td>
                                <td className="def" title={c.description ?? undefined}>{c.description || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                </>
              )}

              {tab === 'links' && (
                <>
                  {data.links.length === 0 && muted(`This ${noun} has no relationships.`)}
                  {data.links.map((l) => {
                    const role = linkRole(l, target.id);
                    const otherId = role === 'parent' ? l.parentTableId : l.childTableId;
                    return (
                      <div className="wk-pp-link" key={l.id}>
                        <div className="wk-pp-link-head">
                          <span className={`wk-pp-role ${role}`}>{role.toUpperCase()}</span>
                          <span className="rd-mono">{l.parentTableName}</span>
                          <span style={{ color: 'var(--text-muted-3)' }}>→</span>
                          <span className="rd-mono">{l.childTableName}</span>
                          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }} title="Inspect the other table"
                            onClick={() => openInspector({ kind: 'table', id: otherId })}>
                            <Eye size={12} />
                          </button>
                        </div>
                        <div className="wk-pp-link-card">
                          <span className="rd-mono">on {ownColumns(l, target.id).join(', ')}</span>
                          <span className="wk-pp-card-lbl">{cardinalityLabel(l)}</span>
                        </div>
                        <div className="wk-pp-link-card">
                          <span className="rd-small" style={{ color: 'var(--muted)' }}>
                            visible in {l.canvases.length > 0 ? l.canvases.map((c) => c.name).join(' · ') : 'no shared canvas'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {tab === 'views' && (
                <>
                  {data.views.length === 0 && muted(`No views on this ${noun}.`)}
                  {data.views.map((v) => (
                    <div key={v.id} className="wk-insp-view-row">
                      <Eye size={13} style={{ color: 'var(--purple)', flex: 'none' }} />
                      <span className="rd-mono" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.schema ? `${v.schema}.` : ''}{v.name}
                      </span>
                      {v.customSql?.trim() ? <span className="wk-insp-chip">custom SQL</span> : null}
                      <span className="wk-srch-chips" style={{ marginLeft: 'auto', maxWidth: '45%' }}>
                        {v.canvases.length === 0 && <span className="wk-srch-none">not on any canvas</span>}
                        {v.canvases.slice(0, 4).map((c) => <span key={c.id} className="wk-srch-chip">{c.name}</span>)}
                        {v.canvases.length > 4 && <span className="wk-srch-none">+{v.canvases.length - 4} more</span>}
                      </span>
                      <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" title="Inspect this view" onClick={() => openInspector({ kind: 'view', id: v.id })}>
                        <Eye size={12} /> Inspect
                      </button>
                      {canEdit && (
                        <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" title="Delete from the model" style={{ color: 'var(--error, #C4314B)' }} onClick={() => void askDeleteView(v)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}

              {tab === 'udps' && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}><b>{FACET_CAPTION.table[facet]}</b> — governance tags of this facet{canEdit ? '' : ' (read-only)'}.</p>
                  {canEdit
                    ? <UdpAssign key={`${table.id}:${facet}`} level="table" view={facet} values={table.udpValues ?? {}} onChange={(next) => void saveTableUdp(next)} />
                    : std ? <UdpReadonly defs={std.udp} level="table" facet={facet} values={table.udpValues ?? {}} /> : muted('Loading…')}
                </>
              )}

              {tab === 'usage' && <UsageList usage={data.usage} activeSaId={activeSaId} noun={noun} onOpen={goCanvas} />}

              {tab === 'history' && <AuditHistory kind="table" entityId={target.id} />}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Columna / atributo (doc 89 §3.3): el Properties de columna completo ──────

const COL_TABS: { id: ColTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'datatype', label: 'Data Type' },
  { id: 'udps', label: 'UDPs' },
  { id: 'metadata', label: 'Metadata' },
];

function ColumnDetail({ col, cols, table, facet, std, canEdit, domains, udpDefs, domainName, onBack, onPatch, onDelete }: {
  col: CanonicalColumn; cols: CanonicalColumn[]; table: CanonicalTable; facet: Facet; std: Standards | null; canEdit: boolean;
  domains: ParentDomain[]; udpDefs: UdpDefinition[]; domainName: string; onBack: () => void;
  onPatch: (id: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  onDelete: () => void;
}) {
  const position = positionIn(cols, col.id);
  const only = facetOnly(col);
  const nouns = facetNouns(facet);
  const [tab, setTab] = useState<ColTab>('definition');
  return (
    <>
      <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onBack}><ArrowLeft size={12} /> All {nouns.members}</button>
      <div className="wk-insp-colhead">
        {col.isPrimaryKey && <KeyRound size={14} style={{ color: 'var(--k-pk)' }} />}
        {col.isForeignKey && <LinkIcon size={14} style={{ color: 'var(--k-fk)' }} />}
        <span className={facet === 'physical' ? 'rd-mono' : ''}>{facetName(col, facet)}</span>
        <span className="wk-insp-chip accent">{facetNoun('column', facet)}</span>
        {only && <span className="wk-insp-chip">{only} only</span>}
        <span className="wk-insp-chip">#{position.pos} of {position.of}</span>
        {canEdit && <span className="wk-insp-chip">editable</span>}
      </div>
      {canEdit ? (
        <>
          <div className="wk-pp-tabs" role="tablist">
            {COL_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {/* key=col.id: cambiar de columna remonta el editor — estado local,
              nameSync y debounces arrancan limpios (y el flush del desmontaje
              persiste lo pendiente de la columna anterior, doc 40). */}
          <div style={{ paddingTop: 12 }}>
            <ColumnPropsBody key={col.id} col={col} table={table} cols={cols} tab={tab} domains={domains} udpDefs={udpDefs}
              view={facet} canEdit onPatch={onPatch} onDelete={onDelete} switchHint={INSPECTOR_SWITCH_HINT} />
          </div>
        </>
      ) : (
        <>
          <dl className="wk-pp-meta">
            <dt>Logical name</dt><dd>{col.logicalName || '—'}</dd>
            <dt>Physical name</dt><dd className="rd-mono">{col.physicalName || '—'}</dd>
            <dt>{nouns.One}</dt><dd className="rd-mono">{table.schema ? `${table.schema}.` : ''}{table.physicalName}</dd>
            <dt>Logical type</dt><dd className="rd-mono">{col.logicalDataType || <span className="wk-insp-default">{col.dataType || '—'} (physical)</span>}</dd>
            <dt>Physical type</dt><dd className="rd-mono">{col.dataType || '—'}</dd>
            <dt>Parent Domain</dt><dd>{domainName}</dd>
            <dt>Keys</dt><dd>{[col.isPrimaryKey ? 'PK' : null, col.isForeignKey ? 'FK' : null].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Nullable</dt><dd>{col.isNullable !== false ? 'Yes' : 'No'}</dd>
            <dt>Partition</dt><dd>{col.isPartition ? 'Yes' : 'No'}</dd>
            <dt>Position</dt><dd>#{position.pos} <span className="wk-insp-default">of {position.of}</span></dd>
            <dt>Definition</dt><dd>{col.description || '—'}</dd>
            <dt>Physical comment</dt><dd>{col.physicalDescription || <span className="wk-insp-default">same as the definition</span>}</dd>
            <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{col.id}</dd>
          </dl>
          <div className="wk-props-sec">{FACET_CAPTION.column[facet]}</div>
          {std ? <UdpReadonly defs={std.udp} level="column" facet={facet} values={col.udpValues ?? {}} /> : muted('Loading…')}
          <div style={{ marginTop: 14 }}><AuditHistory kind="column" entityId={col.id} /></div>
        </>
      )}
    </>
  );
}

// ── Vista ───────────────────────────────────────────────────────────────────

type VTab = 'definition' | 'columns' | 'sql' | 'udps' | 'usage' | 'history';
const V_TABS: { id: VTab; label: string }[] = [
  { id: 'definition', label: 'Definition' },
  { id: 'columns', label: 'Columns' },
  { id: 'sql', label: 'SQL' },
  { id: 'udps', label: 'UDPs' },
  { id: 'usage', label: 'Where used' },
  { id: 'history', label: 'History' },
];
const VIEW_CANVAS_HINT = 'Sources, join, filter and the SQL script are edited in the View Editor (they need the canvas); name, schema, definition and UDPs can be changed here.';

function ViewInspector({ target, onClose }: { target: InspectTarget; onClose: () => void }) {
  const activeSaId = useModelerStore((s) => s.activeSaId);
  const openCanvasAndFocus = useModelerStore((s) => s.openCanvasAndFocus);
  const openInspector = useModelerStore((s) => s.openInspector);
  const reloadDiagram = useModelerStore((s) => s.reload);
  const markDirty = useModelerStore((s) => s.markDirty);
  const bumpExplorer = useModelerStore((s) => s.bumpExplorer);
  const onActiveCanvas = useModelerStore((s) => !!s.diagram?.views.some((v) => v.id === target.id));
  const canEdit = useCanEdit();
  const [data, setData] = useState<InspectViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<VTab>('definition');
  const [form, setForm] = useState({ name: '', schema: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Def «Tipo de Vista» (seed doc 61): gestionado — lo fija el modo Regular/Personalizada.
  const [viewTypeDef, setViewTypeDef] = useState<UdpDefinition | null>(null);
  const std = useStandards();

  useEffect(() => {
    let alive = true;
    inspectView(target.id)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setForm({ name: d.view.name, schema: d.view.schema ?? '', description: d.view.description ?? '' });
      })
      .catch((e: unknown) => { if (alive) setError(errMsg(e, "Couldn't load the view")); });
    return () => { alive = false; };
  }, [target.id]);
  useEffect(() => {
    if (!canEdit) return undefined;
    let alive = true;
    getUdpDefs(sessionProjectId())
      .then((d) => { if (alive) setViewTypeDef(d.find((x) => x.level === 'view' && x.name.trim().toLowerCase() === VIEW_TYPE_NAME) ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [canEdit]);

  const view = data?.view;
  const custom = !!(view?.customSql && view.customSql.trim());
  const srcName = (id?: string | null) => (id ? (data?.sources.find((s) => s.id === id)?.physicalName ?? id) : '—');

  // ── Escritura versionada (doc 89 §3.4): el mismo saveView del panel de vista ──
  const refresh = async () => { setData(await inspectView(target.id)); };
  const afterEdit = async (structural: boolean) => {
    markDirty();
    await refresh();
    const plan = inspectorRefreshPlan({ onActiveCanvas, structural });
    if (plan === 'reload') await reloadDiagram();
    else if (plan === 'bump') bumpExplorer();
  };
  const saveView = async (patch: Partial<ViewInput>, label: string, structural: boolean) => {
    if (!data) return;
    const pre = viewPre(data.view);
    await viewsSvc.updateView(pre.id, { ...data.view, ...patch } as ViewInput);   // doc completo (el overlay reemplaza)
    pushUndo(label, async () => { await viewsSvc.updateView(pre.id, pre as ViewInput); await afterEdit(structural); });
    await afterEdit(structural);
  };
  const saveDef = async () => {
    if (!data) return;
    const name = form.name.trim() || data.view.name;
    const schema = form.schema.trim() || undefined;
    const description = form.description.trim() || undefined;
    const structural = name !== data.view.name || (schema ?? '') !== (data.view.schema ?? '');
    if (!structural && (description ?? '') === (data.view.description ?? '')) return;
    setSaving(true);
    try {
      await saveView({ name, schema, description }, `Edit view ${data.view.name}`, structural);
      setForm((f) => ({ ...f, name }));
      toast.success('View updated');
    } catch (e) { toast.error(errMsg(e, "Couldn't save")); }
    finally { setSaving(false); }
  };
  const saveDescriptionOnBlur = async () => {
    if (!canEdit || !data) return;
    const next = form.description.trim() || undefined;
    if ((data.view.description ?? undefined) === next) return;
    try { await saveView({ description: next }, `Edit view ${data.view.name}`, false); } catch (e) { toast.error(errMsg(e, "Couldn't save")); }
  };
  const saveUdp = async (next: Record<string, string>) => {
    if (!data) return;
    // «Tipo de Vista» es gestionado (doc 61 §2.3): preserva el valor del modo pase lo que pase.
    const guarded = viewTypeDef ? (syncViewTypeUdp(next, viewTypeDef.id, custom) ?? next) : next;
    try { await saveView({ udpValues: guarded }, `Edit view ${data.view.name}`, false); } catch (e) { toast.error(errMsg(e, "Couldn't save UDP")); }
  };
  /** Doc 89 §3.4: borra la vista (cualquiera sea su origen: botón View del
   *  toolbar o Properties › Views — misma colección) y cierra el popup. */
  const askDelete = async () => {
    if (!data || deleting) return;
    setDeleting(true);
    const pre = viewPre(data.view);
    const canvasIds = data.usage.map((u) => u.canvasId);
    try {
      const ok = await confirmDeleteView({ name: pre.name, action: () => deleteViewVersioned(pre, canvasIds, onActiveCanvas) });
      if (ok) {
        toast.success('View deleted');
        markDirty();
        onClose();
        const plan = inspectorRefreshPlan({ onActiveCanvas, structural: true });
        if (plan === 'reload') await reloadDiagram(); else bumpExplorer();
      }
    } catch (e) { toast.error(errMsg(e, "Couldn't delete")); }
    finally { setDeleting(false); }
  };

  const goCanvas = (u: TableUsageRow) => {
    onClose();
    openCanvasAndFocus(u.canvasId, u.projectId ?? undefined, target.id, undefined, view?.name).catch(() => toast.error("Couldn't open the canvas"));
  };
  const openPrimary = () => {
    if (!data) return;
    const c = primaryCanvas(data.usage, activeSaId);
    if (c) goCanvas(c); else setTab('usage');
  };
  const nCols = view ? (custom ? (view.customColumns ?? []).length : (view.sources ?? []).length) : 0;
  const counts: Partial<Record<VTab, number>> = data ? { columns: nCols, usage: data.usage.length } : {};

  return (
    <Dialog open title="Object Inspector" icon={Eye} width={960} onClose={onClose}
      subtitle={`View metadata — the effective state of the open version, no canvas needed${canEdit ? '' : ' (views are edited in the View Editor)'}`}
      footer={<Footer usage={data?.usage ?? null} canEdit={canEdit} onOpen={openPrimary} onClose={onClose} />}>
      <div className="wk-insp">
        {error && <div className="wk-findres-empty rd-small" role="alert">{error}</div>}
        {!error && !data && <div className="wk-insp-loading"><span className="rd-spin" aria-hidden /> Loading…</div>}
        {data && view && (
          <>
            <div className="wk-insp-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wk-insp-title rd-mono">{view.name}</div>
                <div className="wk-insp-other">{view.description || 'No functional definition yet.'}</div>
                <div className="wk-insp-chips">
                  <span className="wk-insp-chip accent">view</span>
                  <span className="wk-insp-chip rd-mono">schema {view.schema || '—'}</span>
                  <span className="wk-insp-chip">{custom ? 'Custom SQL' : 'Regular (generated from sources)'}</span>
                  <span className="wk-insp-chip">{data.sources.length} source{data.sources.length === 1 ? '' : 's'}</span>
                  <span className="wk-insp-chip">{data.usage.length === 0 ? 'not on any canvas' : `${data.usage.length} canvas${data.usage.length === 1 ? '' : 'es'}`}</span>
                  {canEdit && <span className="wk-insp-chip">editable</span>}
                </div>
              </div>
            </div>
            <div className="wk-pp-tabs" role="tablist">
              {V_TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={`wk-pp-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}{counts[t.id] != null && <span className="wk-pp-tab-count">{counts[t.id]}</span>}
                </button>
              ))}
            </div>
            <div className="wk-insp-body">
              {tab === 'definition' && (
                <>
                  {canEdit ? (
                    <>
                      <div className="wk-insp-ro">{VIEW_CANVAS_HINT}</div>
                      <div className="wk-props-field"><label>Name</label>
                        <input className="rd-input rd-mono" disabled={saving} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                      </div>
                      <div className="wk-props-field"><label>Schema</label>
                        <SchemaSelect kind="views" value={form.schema} onChange={(v) => setForm({ ...form, schema: v })} disabled={saving} />
                      </div>
                      <div className="wk-props-field"><label>Functional definition</label>
                        <textarea className="wk-pp-textarea" disabled={saving} placeholder="What this view represents…" value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => void saveDescriptionOnBlur()} />
                      </div>
                      <dl className="wk-pp-meta">
                        <dt>Mode</dt><dd>{custom ? 'Personalizada (custom SQL governs the view)' : 'Regular (generated from sources, join and filter)'}</dd>
                        <dt>Join</dt><dd className="rd-mono">{view.joinOverride?.trim() || <span className="wk-insp-default">inferred from relationships</span>}</dd>
                        <dt>Filter</dt><dd className="rd-mono">{view.filter?.trim() || '—'}</dd>
                        <dt>Tags</dt><dd>{view.tags?.length ? view.tags.map((t) => `${t.key}${t.value ? `=${t.value}` : ''}`).join(' · ') : '—'}</dd>
                        <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{view.id}</dd>
                      </dl>
                      <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%', marginTop: 4 }} disabled={saving} onClick={() => void saveDef()}>
                        {saving && <span className="rd-spin" aria-hidden />}{saving ? 'Saving…' : 'Save'}
                      </button>
                      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5' }}>
                        <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--error, #C4314B)' }} disabled={deleting || saving} onClick={() => void askDelete()}>
                          {deleting ? <span className="rd-spin" aria-hidden /> : <Trash2 size={12} />} Delete view…
                        </button>
                      </div>
                    </>
                  ) : (
                    <dl className="wk-pp-meta">
                      <dt>Name</dt><dd className="rd-mono">{view.name}</dd>
                      <dt>Schema</dt><dd className="rd-mono">{view.schema || '—'}</dd>
                      <dt>Mode</dt><dd>{custom ? 'Personalizada (custom SQL governs the view)' : 'Regular (generated from sources, join and filter)'}</dd>
                      <dt>Definition</dt><dd>{view.description || '—'}</dd>
                      <dt>Join</dt><dd className="rd-mono">{view.joinOverride?.trim() || <span className="wk-insp-default">inferred from relationships</span>}</dd>
                      <dt>Filter</dt><dd className="rd-mono">{view.filter?.trim() || '—'}</dd>
                      <dt>Tags</dt><dd>{view.tags?.length ? view.tags.map((t) => `${t.key}${t.value ? `=${t.value}` : ''}`).join(' · ') : '—'}</dd>
                      <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{view.id}</dd>
                    </dl>
                  )}
                  <div className="wk-props-sec">Source tables</div>
                  {data.sources.length === 0 && muted('No sources.')}
                  {data.sources.map((s, i) => (
                    <div key={s.id} className="wk-insp-view-row">
                      <Table2 size={13} style={{ flex: 'none' }} />
                      <span className="rd-mono" style={{ fontWeight: 600 }}>t{i + 1} · {s.schema ? `${s.schema}.` : ''}{s.physicalName}</span>
                      <span className="rd-small" style={{ color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.logicalName}</span>
                      <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }} title="Inspect this table" onClick={() => openInspector({ kind: 'table', id: s.id })}>
                        <Eye size={12} /> Inspect
                      </button>
                    </div>
                  ))}
                </>
              )}

              {tab === 'columns' && (
                nCols === 0 ? muted('No output columns.') : (
                  <table className="wk-insp-grid">
                    <thead>
                      {custom
                        ? <tr><th>#</th><th>Output</th><th>Expression</th></tr>
                        : <tr><th>#</th><th>Output</th><th>Source</th><th>Type</th><th>Expression</th><th>Definition</th></tr>}
                    </thead>
                    <tbody>
                      {custom
                        ? (view.customColumns ?? []).map((c, i) => (
                          <tr key={`${c.name}:${i}`} style={{ cursor: 'default' }}>
                            <td className="n">{i + 1}</td>
                            <td className="rd-mono">{c.name}</td>
                            <td className="rd-mono def" title={c.expression ?? undefined}>{c.expression || '—'}</td>
                          </tr>
                        ))
                        : (view.sources ?? []).map((s, i) => (
                          <tr key={`${s.tableId ?? s.table ?? ''}:${s.column ?? ''}:${i}`} style={{ cursor: 'default' }}>
                            <td className="n">{i + 1}</td>
                            <td className="rd-mono">{s.outputAlias || s.column || '—'}</td>
                            <td className="rd-mono muted">{s.column ? `${srcName(s.tableId ?? s.table)}.${s.column}` : '— (expression)'}</td>
                            <td className="rd-mono">{s.castType?.trim() ? `${s.castType} (cast)` : <span className="wk-insp-default">inherited</span>}</td>
                            <td className="rd-mono def" title={s.expression ?? undefined}>{s.expression || '—'}</td>
                            <td className="def" title={s.description ?? undefined}>{s.description || <span className="wk-insp-default">inherited</span>}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )
              )}

              {tab === 'sql' && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}>{custom ? 'Custom SQL script — the body of the CREATE VIEW.' : 'Stored DDL preview (generated from sources; regenerate it from the View Editor).'}</p>
                  <pre className="wk-insp-sql">{view.customSql?.trim() || view.sql?.trim() || 'No SQL stored for this view yet.'}</pre>
                </>
              )}

              {tab === 'udps' && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}><b>View UDPs</b> — governance tags of the view{canEdit ? '' : ' (read-only here; open the model in edit mode to change them)'}.</p>
                  {canEdit
                    ? <UdpAssign key={view.id} level="view" values={view.udpValues ?? {}}
                      locked={viewTypeDef ? { [viewTypeDef.id]: 'Managed — the view mode is set from the Query SQL tab.' } : undefined}
                      onChange={(next) => void saveUdp(next)} />
                    : std ? <UdpReadonly defs={std.udp} level="view" facet="physical" values={view.udpValues ?? {}} /> : muted('Loading…')}
                </>
              )}

              {tab === 'usage' && <UsageList usage={data.usage} activeSaId={activeSaId} noun="view" onOpen={goCanvas} />}

              {tab === 'history' && <AuditHistory kind="view" entityId={target.id} />}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
