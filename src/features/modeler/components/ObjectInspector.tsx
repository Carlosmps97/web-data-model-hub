import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { sanitizeLogicalName } from '@/lib/logicalName';
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
import { generatedViewDdl } from '../lib/viewDdl';
import { matchesColumn } from '../lib/columnSearch';
import { moveId, orderColumns, persistReorder, reorderPlan } from '../lib/columnOrder';
import { facetEditable, type TableField } from '../lib/facetEditable';
import { inspectorRefreshPlan } from '../lib/inspectorRefresh';
import { keyLayoutBulk } from '../lib/keyLayout';
import { tableNamePlan } from '../lib/nameSync';
import { bestEffort, pinned, pinnedViewDeps } from '../lib/pinnedWrites';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { syncRenamedColumnInViews } from '../lib/viewSync';
import {
  cardinalityLabel, facetName, facetOnly, facetType, linkRole, otherFacet, ownColumns,
  positionIn, primaryCanvas, tableDeleteImpact, usagePath,
} from '../lib/inspectorModel';
import AuditHistory from './AuditHistory';
import { ColumnPropsBody, type ColTab } from './ColumnPropertiesPanel';
import { confirmDeleteColumn, confirmDeleteTable, confirmDeleteView } from './deleteConfirm';
import { busyMessage, holdTable, readEmptiedViews } from './deleteFlows';
import SchemaSelect from './SchemaSelect';
import UdpAssign from './UdpAssign';
import RelationshipPhraseLine from './RelationshipPhraseLine';
import UdpReadonly from './UdpReadonly';

/**
 * Object Inspector: popup con la metadata completa de una tabla/entidad (con sus
 * columnas/atributos) o de una vista, sin necesidad de canvas: el estado efectivo
 * de la versión abierta llega en una sola request (`/api/catalog/inspect/…`).
 * Tiene su propio switch Logical/Physical (arranca en la faceta del canvas
 * activo, o física sin canvas) y no cambia el modo del canvas. Lo que en el
 * sidebar depende del canvas («this canvas», posición) se presenta aquí como
 * «Where used» + «Open in canvas».
 *
 * En sesión de edición sobre un draft propio edita como los Properties del canvas
 * (nombres por faceta con rayo del glosario, esquema, definición,
 * tipos/dominios/llaves/UDPs de la columna vía `ColumnPropsBody`, definición y
 * UDPs de la vista) y borra tablas, columnas y vistas por el mismo camino
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

/** Dominios + defs UDP del proyecto: los insumos de `ColumnPropsBody`
 *  (los mismos que carga el sidebar de columna). */
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

/** La regla de case del físico escrito necesita `naming`, que solo se carga al
 *  abrir un canvas; sin canvas el inspector lo pide. */
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

/** Pre-imagen por valor de una vista para el Undo: el payload es el doc
 *  completo; `canvases` (fila del inspector de tabla) no es parte del doc. */
function viewPre(v: View): View {
  const copy: View & { canvases?: unknown } = {
    ...v,
    sources: v.sources?.map((s) => ({ ...s })),
    sourceTableIds: v.sourceTableIds ? [...v.sourceTableIds] : undefined,
    udpValues: v.udpValues ? { ...v.udpValues } : undefined,
  };
  delete copy.canvases;
  return copy;
}

/** Borra la vista en el changeset (el backend poda sus membresías) con su Undo.
 *  Es la misma acción del store que usan los paneles del canvas: el Undo repone
 *  el doc y la vuelve a listar, en su posición, en cada canvas que la listaba. */
const deleteViewVersioned = (pre: View, canvasIds: string[]): Promise<void> =>
  useModelerStore.getState().deleteView(pre, { canvasIds });

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
      <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onClose}>Close</button>
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
            <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={() => onOpen(u)}>
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
  // Arranca en la faceta del canvas activo (o física sin canvas); no toca el canvas.
  const [facet, setFacet] = useState<Facet>(activeSaId ? canvasFacet : 'physical');
  const [data, setData] = useState<InspectTableResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TTab>(target.colId ? 'columns' : 'definition');
  const [selCol, setSelCol] = useState<string | null>(target.colId ?? null);
  const [colQ, setColQ] = useState('');
  // Form de Definition como el Properties (`physTouched` = intención sobre el
  // físico en esta edición; null = manda el flag persistido).
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
        // Se siembra solo al cargar: un refresco tras guardar no pisa lo que se está escribiendo.
        setForm({ logicalName: d.table.logicalName, physicalName: d.table.physicalName, schema: d.table.schema ?? '', description: d.table.description ?? '' });
        setPhysTouched(null);
      })
      .catch((e: unknown) => { if (alive) setError(errMsg(e, "Couldn't load the table")); });
    return () => { alive = false; };
  }, [target.id]);

  const table = data?.table;
  // Mismo orden que el canvas y el Properties: bloque PK primero + resto por ordinal.
  const cols = useMemo(() => (data ? orderColumns(data.columns) : []), [data]);
  const visible = useMemo(() => cols.filter((c) => matchesColumn(c, colQ)), [cols, colQ]);
  const col = selCol ? (data?.columns.find((c) => c.id === selCol) ?? null) : null;
  const domainName = (id?: string | null) => (id ? (std ? (std.domains.find((d) => d.id === id)?.name ?? id) : '…') : '—');
  const noun = facetNoun('table', facet);
  const nouns = facetNouns(facet);
  // Views solo en físico; Columns se rotula Attributes en lógico.
  const tTabs = T_TABS.filter((t) => t.id !== 'views' || facet === 'physical')
    .map((t) => (t.id === 'columns' ? { ...t, label: nouns.Members } : t));
  useEffect(() => { if (tab === 'views' && facet !== 'physical') setTab('definition'); }, [tab, facet]);
  // Campo de la otra faceta ⇒ solo lectura (input disabled + hint del popup).
  const ro = (field: TableField) => !facetEditable('table', field, facet);

  // ── Refresco: el dossier siempre; el canvas si lo contiene, si no, el
  // Explorer solo ante cambios estructurales, nunca ambos. ──
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
  // Cada escritura del inspector pertenece a la sesión donde empezó (`pinSession`:
  // su inversa se apila solo ahí y corta si la sesión cambia) y su fallo espera la
  // revalidación y calla si la sesión cambia (`reportWriteError`).
  const saveTableDef = async () => {
    if (!data) return;
    const pin = pinSession();
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't save")));
    const pre = tablePre(data.table);
    const logical = form.logicalName.trim();
    // La decisión (re-derivar vs conservar el custom + flag de override) vive en
    // tableNamePlan: un físico con override no se re-deriva al renombrar el
    // lógico; vaciarlo re-enciende el auto.
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
      pin.check();   // el físico pudo derivarse con un await
      await gov.createTable(next);   // upsert por id = update (merge sobre el doc efectivo)
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterEdit(true); }, pin);
      setForm((f) => ({ ...f, logicalName: logical, physicalName: physical }));
      setPhysTouched(null);
      await afterEdit(structural);
      toast.success(`${nouns.One} updated`);
    } catch (e) { await onError(e); }
    finally { setSaving(false); }
  };
  // Definición funcional: auto-guardado al salir del campo. Los nombres y el
  // esquema siguen detrás de Save (un rename es transaccional): `...data.table`
  // usa los nombres del server, así que un nombre a medio editar en el form no
  // viaja con este blur.
  const saveDescriptionOnBlur = async () => {
    if (!canEdit || !data) return;
    const next = form.description.trim() || undefined;
    if ((data.table.description ?? undefined) === next) return;
    const pre = tablePre(data.table);
    const pin = pinSession();
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't save")));
    try {
      await gov.createTable({ ...data.table, description: next });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterEdit(false); }, pin);
      await afterEdit(false);
    } catch (e) { await onError(e); }
  };
  /** Rayo: re-deriva el físico desde el lógico por el glosario y apaga el override. */
  const derivePhysical = async () => {
    try {
      const p = (await gov.physicalize(form.logicalName.trim(), 'table')).physical;
      setForm((f) => ({ ...f, physicalName: p }));
      setPhysTouched(false);  // derivar = renunciar al override
    } catch { toast.error("Couldn't derive the physical name"); }
  };
  const saveTableUdp = async (next: Record<string, string>) => {
    if (!data) return;
    const pre = tablePre(data.table);
    const pin = pinSession();
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't save UDP")));
    try {
      await gov.createTable({ ...data.table, udpValues: next });
      pushUndo(`Edit table ${pre.physicalName}`, async () => { await gov.createTable(pre); await afterEdit(false); }, pin);
      await afterEdit(false);
    } catch (e) { await onError(e); }
  };
  /** Borrado con el diálogo de impacto de Properties (conteos del dossier) y la
   *  cascada versionada del store; la pre-imagen del Undo viene del dossier
   *  porque sin canvas no hay diagrama. El store recarga el canvas y sincroniza
   *  el Explorer; el popup se cierra, pues la tabla deja de existir. */
  const askDeleteTable = async () => {
    if (!data || deleting) return;
    // Un borrado por tabla a la vez: el menú del canvas puede estar borrando
    // esta tabla o sus columnas.
    const hold = holdTable(target.id);
    if (!hold) { toast.message(busyMessage(nouns)); return; }
    setDeleting(true);
    const t = data.table;
    const onError = reportWriteError((e) => toast.error(errMsg(e, `Couldn't delete the ${nouns.one}`)));
    try {
      const ok = await confirmDeleteTable({
        name: t.physicalName || t.logicalName, nouns, impact: tableDeleteImpact(target.id, data),
        action: async () => { await deleteTable(target.id, { pre: tablePre(t) }); },
      });
      if (ok) { toast.success(`${nouns.One} deleted`); onClose(); }
    } catch (e) { await onError(e); }
    finally { setDeleting(false); hold.release(); }
  };

  // ── Columna: mismo upsert changeset-aware que el sidebar ──
  const patchColumn = async (id: string, fields: Partial<CanonicalColumn>) => {
    const c = data?.columns.find((x) => x.id === id);
    if (!c) return;
    const pin = pinSession();
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't save the column")));
    // Entrar o salir de la llave la reubica en la frontera del bloque de PK:
    // ella y las que se corren viajan en un solo lote, con un solo Undo.
    if (fields.isPrimaryKey !== undefined && !!fields.isPrimaryKey !== !!c.isPrimaryKey) {
      try {
        const { changes, pres } = keyLayoutBulk(data!.columns, { [id]: fields });
        await gov.recordChangesBulk(changes);
        pushUndo(`Edit column ${c.physicalName}`, async () => {
          await gov.recordChangesBulk(pres.map((p) => gov.bulk.createColumn(p)));
          await afterEdit(true);
        }, pin);
        await afterEdit(true);
      } catch (e) { await onError(e); }
      return;
    }
    const pre = { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) };
    const renamed = typeof fields.physicalName === 'string' && fields.physicalName !== c.physicalName;
    const structural = renamed || (typeof fields.logicalName === 'string' && fields.logicalName !== c.logicalName);
    try {
      await gov.updateColumn({ ...c, ...fields });   // upsert por id = update (merge)
      pushUndo(`Edit column ${pre.physicalName}`, async (undo) => {
        await gov.updateColumn(pre);
        // Si el cambio renombró el físico, las vistas apuntan al nombre nuevo:
        // deshacer las devuelve al anterior (best-effort; solo mientras siga la
        // sesión del Undo).
        if (renamed) await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(undo), c.tableId, fields.physicalName as string, pre.physicalName));
        await afterEdit(structural);
      }, pin);
      if (renamed) {
        // Un rename físico re-apunta las vistas que referencian el nombre anterior
        // (mismo sync del sidebar); la vista se ajusta a mano si hiciera falta.
        await bestEffort(async () => {
          const n = await syncRenamedColumnInViews(pinnedViewDeps(pin), c.tableId, c.physicalName, fields.physicalName as string);
          if (n) toast.success(`Rename also applied to ${n} view(s)`);
        });
      }
      await afterEdit(structural);
    } catch (e) { await onError(e); }
  };
  /** Impacto global + cascada versionada del store; la columna viaja desde el
   *  dossier (sin canvas no está en el diagrama). */
  const askDeleteColumn = async (c: CanonicalColumn) => {
    // Un borrado por tabla a la vez: el menú del canvas puede estar borrando
    // columnas de esta misma tabla.
    const hold = holdTable(c.tableId);
    if (!hold) { toast.message(busyMessage(nouns)); return; }
    try {
      // El borrado pertenece a la sesión donde se pidió: el pin y los avisos se
      // toman antes de leer el impacto (creados después, el aviso mostraría
      // «read-only» encima de la revalidación); si mientras lee se abre otra
      // versión, el confirm no se abre en ella, y la acción verifica el pin al clic.
      const pin = pinSession();
      // Sin el impacto (relaciones donde es extremo) no se ofrece el borrado: con
      // `relIds` vacío quedarían relaciones con pares hacia una columna borrada.
      const onImpactError = reportWriteError(() => toast.error(`Couldn't check the relationships of this ${nouns.member}: nothing was deleted. Try again.`));
      const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't delete")));
      // Las vistas que quedarían sin columnas se leen junto con el impacto.
      const emptied = readEmptiedViews(c.tableId, [c]);
      let impact: gov.RelationshipImpact;
      try { impact = await gov.columnImpact(c.id); } catch (e) { await onImpactError(e); return; }
      const emptiedViews = await emptied;
      if (!pin.holds()) return;
      const relIds = impact.relationships.map((r) => r.relId);
      try {
        const ok = await confirmDeleteColumn({
          name: c.physicalName, nouns, impact, emptiedViews,
          action: () => { pin.check(); return deleteColumn(c.id, relIds, { col: c }); },
        });
        if (ok) {
          toast.success(impact.total > 0 ? `${nouns.Member} and its relationships deleted` : `${nouns.Member} deleted`);
          setSelCol(null);
          hold.release();    // el borrado terminó: refrescar el popup no retiene la tabla
          await refresh();   // el store ya recargó el canvas y sincronizó el Explorer
        }
      } catch (e) { await onError(e); }
    } finally { hold.release(); }
  };
  /** Mueve la columna en el único orden de la tabla (`ordinal`). */
  const move = async (colId: string, delta: number) => {
    if (!data || reordering) return;
    const ids = cols.map((c) => c.id);
    const from = ids.indexOf(colId), to = from + delta;
    // Se reordena dentro de cada bloque (las PK entre ellas, como cualquier
    // columna); ninguna cruza la frontera del bloque de PK.
    if (!cols[from] || !cols[to] || !!cols[from].isPrimaryKey !== !!cols[to].isPrimaryKey) return;
    const nextIds = moveId(ids, colId, delta);
    if (nextIds === ids) return;
    const plan = reorderPlan(data.columns, nextIds);
    if (!plan.length) return;
    setReordering(true);
    const pin = pinSession();   // tandas de escrituras de una misma sesión
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't reorder")));
    // Optimista: el inspector reordena ya; la persistencia corre detrás.
    setData((d) => d && ({ ...d, columns: d.columns.map((c) => { const s = plan.find((p) => p.c.id === c.id); return s ? { ...c, ordinal: s.idx } : c; }) }));
    try {
      await persistReorder(plan, (c, idx) => pinned(pin, gov.updateColumn)({ ...c, ordinal: idx }));
      pushUndo('Reorder columns',
        async (undo) => { await persistReorder(plan, (c) => pinned(undo, gov.updateColumn)(c)); await afterEdit(false); }, pin);
      await afterEdit(false);
    } catch (e) { await onError(e); await refresh().catch(() => {}); }
    finally { setReordering(false); }
  };
  /** Basurero de la pestaña Views (paridad con Properties › Views). */
  const askDeleteView = async (v: TableViewRow) => {
    const pre = viewPre(v);
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't delete")));
    try {
      const ok = await confirmDeleteView({
        name: v.name,
        action: () => deleteViewVersioned(pre, v.canvases.map((c) => c.id)),
      });
      if (ok) { toast.success('View deleted'); await afterEdit(true); }
    } catch (e) { await onError(e); }
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
                  {/* Cada faceta edita sus campos; los de la otra quedan en solo lectura con el hint. */}
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}>
                    <b>{facet === 'logical' ? 'Logical facet' : 'Physical facet'}</b> — fields of the other facet are read-only here. {INSPECTOR_SWITCH_HINT[facet]}
                  </p>
                  <div className="wk-insp-ro">{CANVAS_ONLY_HINT}</div>
                  <div className="wk-props-field"><label>Logical name</label>
                    <input className="rd-input" disabled={saving || ro('logicalName')} title={ro('logicalName') ? INSPECTOR_SWITCH_HINT[facet] : undefined} value={form.logicalName} onChange={(e) => setForm({ ...form, logicalName: sanitizeLogicalName(e.target.value) })} />
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
                    <button className="rd-btn rd-btn-danger rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} disabled={deleting || saving} onClick={() => void askDeleteTable()}>
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
                                    <button type="button" className="wk-insp-mv" title="Move up" disabled={i === 0 || !!cols[i - 1]?.isPrimaryKey !== !!c.isPrimaryKey} onClick={() => void move(c.id, -1)}>↑</button>
                                    <button type="button" className="wk-insp-mv" title="Move down" disabled={i === cols.length - 1 || !!cols[i + 1]?.isPrimaryKey !== !!c.isPrimaryKey} onClick={() => void move(c.id, 1)}>↓</button>
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
                        <RelationshipPhraseLine rel={l} />
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
                      {v.customSql?.trim() ? <span className="wk-insp-chip">User-Defined SQL (info)</span> : null}
                      <span className="wk-srch-chips" style={{ marginLeft: 'auto', maxWidth: '45%' }}>
                        {v.canvases.length === 0 && <span className="wk-srch-none">not on any canvas</span>}
                        {v.canvases.slice(0, 4).map((c) => <span key={c.id} className="wk-srch-chip">{c.name}</span>)}
                        {v.canvases.length > 4 && <span className="wk-srch-none">+{v.canvases.length - 4} more</span>}
                      </span>
                      <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" title="Inspect this view" onClick={() => openInspector({ kind: 'view', id: v.id })}>
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

// ── Columna / atributo: el Properties de columna completo ─────────────────────

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
          {/* key=col.id: cambiar de columna remonta el editor; estado local,
              nameSync y debounces arrancan limpios (y el flush del desmontaje
              persiste lo pendiente de la columna anterior). */}
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
  const view = data?.view;
  // La User-Defined SQL es solo informativa (el DDL sale de las columnas).
  const hasSql = !!(view?.customSql && view.customSql.trim());
  const srcName = (id?: string | null) => (id ? (data?.sources.find((s) => s.id === id)?.physicalName ?? id) : '—');

  // ── Escritura versionada: el mismo saveView del panel de vista ──
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
    const pin = pinSession();   // su inversa se apila solo en su sesión
    const pre = viewPre(data.view);
    await viewsSvc.updateView(pre.id, { ...data.view, ...patch } as ViewInput);   // doc completo (el overlay lo sustituye entero)
    pushUndo(label, async () => { await viewsSvc.updateView(pre.id, pre as ViewInput); await afterEdit(structural); }, pin);
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
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't save")));
    try {
      await saveView({ name, schema, description }, `Edit view ${data.view.name}`, structural);
      setForm((f) => ({ ...f, name }));
      toast.success('View updated');
    } catch (e) { await onError(e); }
    finally { setSaving(false); }
  };
  const saveDescriptionOnBlur = async () => {
    if (!canEdit || !data) return;
    const next = form.description.trim() || undefined;
    if ((data.view.description ?? undefined) === next) return;
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't save")));
    try { await saveView({ description: next }, `Edit view ${data.view.name}`, false); } catch (e) { await onError(e); }
  };
  const saveUdp = async (next: Record<string, string>) => {
    if (!data) return;
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't save UDP")));
    try { await saveView({ udpValues: next }, `Edit view ${data.view.name}`, false); } catch (e) { await onError(e); }
  };
  /** Borra la vista (cualquiera sea su origen: botón View del toolbar o
   *  Properties › Views, misma colección) y cierra el popup. */
  const askDelete = async () => {
    if (!data || deleting) return;
    setDeleting(true);
    const pre = viewPre(data.view);
    const canvasIds = data.usage.map((u) => u.canvasId);
    // Con la versión recién transferida el borrado termina con el error
    // original; la revalidación se encarga del aviso, así que aquí se calla.
    const onError = reportWriteError((e) => toast.error(errMsg(e, "Couldn't delete")));
    try {
      const ok = await confirmDeleteView({ name: pre.name, action: () => deleteViewVersioned(pre, canvasIds) });
      if (ok) {
        toast.success('View deleted');
        markDirty();
        onClose();
        const plan = inspectorRefreshPlan({ onActiveCanvas, structural: true });
        if (plan === 'reload') await reloadDiagram(); else bumpExplorer();
      }
    } catch (e) { await onError(e); }
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
  // En ambos modos las columnas son `sources`.
  const nCols = view ? (view.sources ?? []).length : 0;
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
                  {hasSql && <span className="wk-insp-chip">User-Defined SQL (info)</span>}
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
                        <dt>User-Defined SQL</dt><dd>{hasSql ? 'Informational — not exported' : '—'}</dd>
                        <dt>ID</dt><dd className="rd-mono" style={{ fontSize: 10.5 }}>{view.id}</dd>
                      </dl>
                      <button className="rd-btn rd-btn-primary rd-btn-sm" style={{ width: '100%', marginTop: 4 }} disabled={saving} onClick={() => void saveDef()}>
                        {saving && <span className="rd-spin" aria-hidden />}{saving ? 'Saving…' : 'Save'}
                      </button>
                      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EEF1F5' }}>
                        <button className="rd-btn rd-btn-danger rd-btn-sm" style={{ width: '100%', justifyContent: 'center' }} disabled={deleting || saving} onClick={() => void askDelete()}>
                          {deleting ? <span className="rd-spin" aria-hidden /> : <Trash2 size={12} />} Delete view…
                        </button>
                      </div>
                    </>
                  ) : (
                    <dl className="wk-pp-meta">
                      <dt>Name</dt><dd className="rd-mono">{view.name}</dd>
                      <dt>Schema</dt><dd className="rd-mono">{view.schema || '—'}</dd>
                      <dt>User-Defined SQL</dt><dd>{hasSql ? 'Informational — not exported' : '—'}</dd>
                      <dt>Definition</dt><dd>{view.description || '—'}</dd>
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
                      <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} title="Inspect this table" onClick={() => openInspector({ kind: 'table', id: s.id })}>
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
                      <tr><th>#</th><th>Output</th><th>Source</th><th>Type</th><th>Expression</th><th>Definition</th></tr>
                    </thead>
                    <tbody>
                      {(view.sources ?? []).map((s, i) => (
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
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}>Generated DDL — from the columns, exactly what the DDL export writes.</p>
                  <pre className="wk-insp-sql">{generatedViewDdl(view, data.sources)}</pre>
                  {hasSql && (
                    <>
                      <p className="wk-pp-cap">User-Defined SQL — informational, stored with the view and not exported.</p>
                      <pre className="wk-insp-sql">{view.customSql?.trim()}</pre>
                    </>
                  )}
                </>
              )}

              {tab === 'udps' && (
                <>
                  <p className="wk-pp-cap" style={{ marginTop: 0 }}><b>View UDPs</b> — governance tags of the view{canEdit ? '' : ' (read-only here; open the model in edit mode to change them)'}.</p>
                  {canEdit
                    ? <UdpAssign key={view.id} level="view" values={view.udpValues ?? {}}
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
