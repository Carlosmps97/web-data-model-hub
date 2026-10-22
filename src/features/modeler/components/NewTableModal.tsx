import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeLogicalName } from '@/lib/logicalName';
import { Table2, Search, Plus, Check } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import * as gov from '@/services/governance.service';
import type { CanonicalTable } from '@/services/governance.service';
import { toast } from 'sonner';
import { failureText, useModelerStore } from '@/store/useModelerStore';
import { reportWriteError } from '../lib/sessionGuard';
import { apiErrorMessage } from '@/services/http';
import SchemaSelect from './SchemaSelect';
import SearchSelect from './SearchSelect';
import UdpAssign from './UdpAssign';
import { FACET_CAPTION, facetNouns } from '@/lib/facets';
import { tableCreateInput } from '../lib/createInputs';
import { applyNamingCase } from '../lib/physicalCase';
import { tableSchemasCached } from '../services/schemaPartition';

type Mode = 'blank' | 'import';

/**
 * New table. Un solo modal con dos modos:
 *  - **Blank**: nombre según la faceta activa (lógico con el físico derivado como
 *    vista previa, o físico con su esquema), definición funcional y UDPs. Sin
 *    "Add a primary key".
 *  - **Import existing**: busca el pool universal con filtro por schema y agrega
 *    tablas al canvas (universal → propaga a todos los módulos que la referencian).
 * Usa el `Dialog` con backdrop "canvas" (oscurece solo el lienzo).
 */
export default function NewTableModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical'; description?: string; udpValues?: Record<string, string> }) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('blank');

  // ── Blank ──────────────────────────────────────────────────────────────
  const [logical, setLogical] = useState('');
  const [physical, setPhysical] = useState('');
  const [schema, setSchema] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Metadata del alta: definición funcional + UDPs en el mismo popup. Ref espejo
  // de los UDP: el blur del input (commit de UdpAssign) dispara en el mismo gesto
  // que el clic en "Create table"; el submit lee el ref (sincrónico) para no
  // perder ese último valor frente al batching del estado.
  const [description, setDescription] = useState('');
  // Los UDPs del alta siguen la faceta activa del canvas (Entity/Table).
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // Entity/Attribute o Table/Column
  // New entity (Logical) recibe el nombre lógico y muestra el físico derivado;
  // New table (Physical) recibe el físico (regla de case del scope table) y el
  // esquema. `logical` guarda lo escrito en ambos casos.
  const tableCase = useModelerStore((s) => s.naming?.table.case);
  const casedPhysical = viewMode === 'physical' ? applyNamingCase(logical.trim(), tableCase) : '';
  const [udpValues, setUdpValues] = useState<Record<string, string>>({});
  const udpRef = useRef<Record<string, string>>({});
  const setUdp = (next: Record<string, string>) => { udpRef.current = next; setUdpValues(next); };

  // Auto-physicalize (scope 'table') con debounce. `alive` descarta la respuesta
  // si el efecto ya se limpió (el usuario siguió escribiendo): así una respuesta
  // tardía no pisa el físico vigente con el derivado de un lógico anterior.
  useEffect(() => {
    if (viewMode === 'physical') return;   // la vista previa derivada es del modo Logical
    const t = logical.trim();
    if (!t) { setPhysical(''); return; }
    let alive = true;
    const h = setTimeout(() => {
      gov.physicalize(t, 'table').then((r) => { if (alive) setPhysical(r.physical); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [logical, viewMode]);

  // Un alta a la vez: `busy` sigue en false dentro del mismo render, así que sin
  // este ref un doble Enter (o uno sostenido) crearía varias tablas.
  const inFlight = useRef(false);
  const submitBlank = async () => {
    const ln = logical.trim();
    if (!ln || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // Payload por faceta (createInputs, puro y testeado). En Logical el
      // físico lo deriva el store por glosario (scope table).
      await onCreate(tableCreateInput(viewMode, { name: ln, schema, description, udpValues: udpRef.current }, tableCase));
      onClose();
    } catch (e) {
      // 409 de duplicado u otro error: mensaje en línea con el detail real del
      // backend; el modal no se cierra.
      setError(apiErrorMessage(e, "Couldn't create the table"));
    } finally { inFlight.current = false; setBusy(false); }
  };

  // ── Import existing ────────────────────────────────────────────────────
  const subjectAreas = useModelerStore((s) => s.subjectAreas);
  const diagram = useModelerStore((s) => s.diagram);
  const addExistingTables = useModelerStore((s) => s.addExistingTables);
  const inCanvas = useMemo(() => new Set(diagram?.subjectArea.tableIds ?? []), [diagram]);
  const [tables, setTables] = useState<CanonicalTable[]>([]);
  const [q, setQ] = useState('');
  const [schemaFilter, setSchemaFilter] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  // La tabla entra sola; sus vistas se suman a este canvas a pedido.
  const [withViews, setWithViews] = useState(false);

  // Búsqueda server-side con debounce: con miles de tablas el modal no baja el
  // catálogo completo; el backend busca por nombre + esquema y devuelve la
  // página. `alive` descarta respuestas fuera de orden (el usuario siguió
  // escribiendo). 300 ms: cada búsqueda es un scan por regex server-side (costo
  // proporcional a la colección), por eso no se dispara por tecla. `schemaFilter`
  // está en las deps: cambiar el esquema vuelve a consultar, porque un filtro en
  // el cliente sobre la página de 50 dejaría fuera las tablas del esquema que no
  // entraron en esa página.
  const PAGE = 50;
  useEffect(() => {
    if (mode !== 'import') return;
    let alive = true;
    const h = setTimeout(() => {
      gov.searchTables(q.trim(), PAGE, schemaFilter || undefined)
        .then((r) => { if (alive) setTables(r); })
        .catch(() => {});
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [mode, q, schemaFilter]);

  // Filtro por esquema: opciones = esquemas que contienen tablas (cacheados por
  // sesión y versión en schemaPartition, compartidos con el CTAS); así el
  // combobox no mezcla los esquemas solo de vistas (`_vu`). Mientras cargan se
  // muestra solo "All schemas"; el catálogo completo queda como fallback
  // únicamente si la descarga falla. El acotado por esquema lo hace el backend
  // (junto a `q`); el filtro en el cliente es solo defensa: descarta cualquier
  // resultado de un esquema previo que quedara en pantalla mientras se resuelve
  // la nueva consulta.
  const schemaPool = useModelerStore((s) => s.schemas);
  const [tableSchemas, setTableSchemas] = useState<string[] | null>(null);
  const [schemasErr, setSchemasErr] = useState(false);
  useEffect(() => {
    if (mode !== 'import') return;
    let live = true;
    tableSchemasCached()
      .then((ts) => { if (live) setTableSchemas(ts); })
      .catch(() => { if (live) setSchemasErr(true); });
    return () => { live = false; };
  }, [mode]);
  const schemaOpts = useMemo(() => {
    const base = tableSchemas ?? (schemasErr ? schemaPool.map((s) => s.name) : []);
    return base.map((s) => ({ value: s, label: s }));
  }, [tableSchemas, schemasErr, schemaPool]);
  const usageOf = (id: string) => (subjectAreas ?? []).filter((sa) => (sa.tableIds ?? []).includes(id)).length;
  const visible = useMemo(
    () => (schemaFilter ? tables.filter((t) => t.schema === schemaFilter) : tables),
    [tables, schemaFilter],
  );

  const addOne = async (id: string) => {
    setAdding(id);
    // El fallo espera la revalidación y calla si la sesión cambia (`reportWriteError`).
    const onError = reportWriteError((e) => toast.error(failureText(`Couldn't add the ${n.one} to this canvas`, e)));   // entity/table según la faceta
    // Se pasa la tabla para estimar su bloque al ubicarla en el centro de lo que se ve.
    try { await addExistingTables([id], { withViews, tables: tables.filter((t) => t.id === id) }); setAdded((s) => new Set(s).add(id)); }
    catch (e) { await onError(e); }
    finally { setAdding(null); }
  };

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted, #56607A)', marginBottom: 5, display: 'block' };
  const field: React.CSSProperties = { marginBottom: 14 };

  return (
    <Dialog
      open
      title={`New ${n.one}`}
      subtitle={`Create a blank ${n.one} or import an existing one`}
      icon={Table2}
      backdrop="canvas"
      canvasTop={136}
      width={mode === 'import' ? 660 : 520}
      onClose={onClose}
      footer={mode === 'blank' ? (
        <>
          <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || !logical.trim()} onClick={submitBlank}>Create {n.one}</button>
        </>
      ) : (
        <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onClose}>Done</button>
      )}
    >
      <div className="rd-seg" style={{ marginBottom: 16 }}>
        <button className={mode === 'blank' ? 'active' : ''} onClick={() => setMode('blank')}>Blank {n.one}</button>
        <button className={mode === 'import' ? 'active' : ''} onClick={() => setMode('import')}>Import existing</button>
      </div>

      {mode === 'blank' ? (
        <div>
          {viewMode === 'logical' ? (
            <div style={field}>
              <label style={lbl}>Logical name</label>
              <input className="rd-input" autoFocus placeholder="e.g. cuenta cliente" value={logical}
                onChange={(e) => setLogical(sanitizeLogicalName(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitBlank(); } }}
                style={{ width: '100%' }} />
              {/* El físico se deriva por glosario (scope table); se edita luego en Physical. */}
              <span className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)', marginTop: 4, display: 'block' }}>
                Physical: <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{physical || '—'}</span> — derived from the glossary; schema and physical name are set in the Physical model.
              </span>
            </div>
          ) : (
            <>
              <div style={field}>
                <label style={lbl}>Physical name</label>
                <input className="rd-input rd-mono" autoFocus placeholder="e.g. HD_CLIENTE" value={logical}
                  onChange={(e) => setLogical(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitBlank(); } }}
                  style={{ width: '100%' }} />
                {casedPhysical && casedPhysical !== logical.trim() && (
                  <span className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)', marginTop: 4, display: 'block' }}>
                    Saved as <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{casedPhysical}</span> (naming rule of the table scope).
                  </span>
                )}
              </div>
              <div style={field}>
                <label style={lbl}>Schema</label>
                {/* Combobox de esquemas con buscador, solo esquemas de tablas;
                    «+ Create schema…» los crea desde el combo. */}
                <SchemaSelect kind="tables" value={schema} onChange={setSchema} style={{ width: '100%' }} />
              </div>
            </>
          )}
          {/* Definición funcional + UDPs en el alta (como el popup de New column). */}
          <div style={field}>
            <label style={lbl}>Functional definition</label>
            <textarea className="wk-pp-textarea" placeholder={`What this ${n.one} represents (business definition)…`}
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ ...field, paddingTop: 12, borderTop: '1px solid #EEF1F6' }}>
            <label style={lbl}>{FACET_CAPTION.table[viewMode]}</label>
            <UdpAssign level="table" view={viewMode} values={udpValues} onChange={setUdp} />
          </div>
          {error && (
            <div className="rd-small" role="alert" style={{ color: 'var(--error, #C4314B)', marginTop: 2 }}>
              {error}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px', background: 'var(--fill-3, #F4F6F9)', borderRadius: 9 }}>
              <Search size={15} color="var(--text-muted, #8A93A5)" />
              <input placeholder={`Search ${n.many} in the database…`} value={q} onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, border: 0, background: 'transparent', outline: 'none', padding: '10px 0', fontSize: 13 }} />
            </div>
            <div style={{ width: 168, flexShrink: 0 }}>
              {/* Combobox buscable, mismo estilo que el del CTAS. */}
              <SearchSelect mono options={schemaOpts} valueLabel={schemaFilter} placeholder="All schemas" emptyLabel="All schemas" onPick={setSchemaFilter} />
            </div>
          </div>
          {/* Una tabla vive en muchos canvases y cada canvas modela sus
              vistas: importar no arrastra vistas salvo pedido explícito. */}
          <label className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: 'var(--text-muted, #56607A)', cursor: 'pointer' }}>
            <input type="checkbox" checked={withViews} onChange={(e) => setWithViews(e.target.checked)} />
            Also add the table's views to this canvas
          </label>
          <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visible.map((t) => {
              const already = inCanvas.has(t.id) || added.has(t.id);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* El nombre de la faceta activa primero. */}
                    <div className={viewMode === 'physical' ? 'rd-mono' : ''} style={{ fontWeight: 600, fontSize: 13 }}>{viewMode === 'physical' ? t.physicalName : (t.logicalName || t.physicalName)}</div>
                    <div className={`rd-small${viewMode === 'logical' ? ' rd-mono' : ''}`} style={{ color: 'var(--text-muted, #8A93A5)' }}>{viewMode === 'physical' ? t.logicalName : t.physicalName} · used in {usageOf(t.id)} modules</div>
                  </div>
                  <button className="rd-btn rd-btn-secondary rd-btn-sm" disabled={already || adding === t.id} onClick={() => addOne(t.id)}>
                    {already ? <><Check size={14} /> Added</> : <><Plus size={14} /> Add</>}
                  </button>
                </div>
              );
            })}
            {tables.length >= PAGE && visible.length > 0 && (
              <div className="rd-small" style={{ padding: 10, color: 'var(--text-muted, #8A93A5)' }}>
                Showing the first {PAGE} matches — refine your search to narrow the list.
              </div>
            )}
            {visible.length === 0 && (
              <div className="rd-small" style={{ padding: 10, color: 'var(--text-muted, #8A93A5)' }}>
                {schemaFilter
                  ? `No ${n.many} in schema "${schemaFilter}"${q.trim() ? ' match your search' : ''}.`
                  : `No ${n.many} match your search.`}
              </div>
            )}
          </div>
          <div className="rd-small" style={{ marginTop: 12, color: 'var(--text-muted, #56607A)' }}>
            Imported tables are <strong>universal</strong> — editing structure propagates to every module that references them.
            Views belong to each canvas: use the option above to bring the table's views along, or add them later from Properties → Views.
          </div>
        </div>
      )}
    </Dialog>
  );
}
