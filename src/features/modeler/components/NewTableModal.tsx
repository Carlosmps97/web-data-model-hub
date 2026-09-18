import { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeLogicalName } from '@/lib/logicalName';
import { Table2, Search, Plus, Check } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import * as gov from '@/services/governance.service';
import type { CanonicalTable } from '@/services/governance.service';
import { useModelerStore } from '@/store/useModelerStore';
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
 * New table (Pantalla 05 / 05b). Un solo modal con dos modos:
 *  - **Blank**: Logical Name + Physical Name (auto-derivado del UDP per-table,
 *    editable) + Schema (free-text, NO dropdown). Sin "Add a primary key".
 *  - **Import existing**: busca el pool universal con filtro por schema y agrega
 *    tablas al canvas (universal → propaga a todos los módulos que la referencian).
 * Usa el `Dialog` con backdrop "canvas" (blur solo del lienzo).
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
  // Doc 64 §6: metadata del alta — definición funcional + UDPs en el MISMO
  // popup (antes había que crear y luego ir a Properties). Ref espejo de los
  // UDP: el blur del input (commit de UdpAssign) dispara en el MISMO gesto que
  // el click en "Create table" — el submit lee el ref (sincrónico) para no
  // perder ese último valor contra el batching del estado (patrón doc 40).
  const [description, setDescription] = useState('');
  // Doc 69: los UDPs del alta siguen la faceta activa del canvas (Entity/Table).
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // doc 85: Entity/Attribute vs Table/Column
  // Doc 86 D3: New entity (Logical) tipea el LÓGICO y muestra el físico
  // derivado; New table (Physical) tipea el FÍSICO (regla de case del scope
  // table) + Schema. `logical` guarda lo tipeado en ambos casos.
  const tableCase = useModelerStore((s) => s.naming?.table.case);
  const casedPhysical = viewMode === 'physical' ? applyNamingCase(logical.trim(), tableCase) : '';
  const [udpValues, setUdpValues] = useState<Record<string, string>>({});
  const udpRef = useRef<Record<string, string>>({});
  const setUdp = (next: Record<string, string>) => { udpRef.current = next; setUdpValues(next); };

  // Auto-physicalize (scope 'table') con debounce, salvo override manual.
  // `alive` descarta la respuesta si el efecto ya se limpió (el usuario siguió
  // tipeando o tomó el override): sin esto una respuesta VIEJA que llegara
  // tarde pisaba el físico vigente con el derivado de un lógico anterior.
  useEffect(() => {
    if (viewMode === 'physical') return;   // doc 86: el preview derivado es del modo Logical
    const t = logical.trim();
    if (!t) { setPhysical(''); return; }
    let alive = true;
    const h = setTimeout(() => {
      gov.physicalize(t, 'table').then((r) => { if (alive) setPhysical(r.physical); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [logical, viewMode]);

  const submitBlank = async () => {
    const ln = logical.trim();
    if (!ln) return;
    setBusy(true);
    setError(null);
    try {
      // Doc 86 §2.3: payload por faceta (createInputs, puro y testeado). En
      // Logical el físico lo deriva el store por glosario (scope table).
      await onCreate(tableCreateInput(viewMode, { name: ln, schema, description, udpValues: udpRef.current }, tableCase));
      onClose();
    } catch (e) {
      // 409 de duplicado (spec 10 §9) u otro error: mensaje INLINE con el
      // detail real del backend — el modal NO se cierra.
      setError(apiErrorMessage(e, "Couldn't create the table"));
    } finally { setBusy(false); }
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
  // Doc 70: la tabla entra SOLA; sus vistas se suman a este canvas a pedido.
  const [withViews, setWithViews] = useState(false);

  // Búsqueda SERVER-SIDE con debounce: a 15k tablas el modal no baja el
  // catálogo completo — el backend matchea por nombre + esquema y devuelve la
  // página. `alive` descarta respuestas fuera de orden (el usuario siguió
  // tipeando). 300ms: cada búsqueda es un scan por regex server-side (costo
  // proporcional a la colección) — no disparar por tecla. `schemaFilter` está en
  // las deps: cambiar el esquema RE-CONSULTA (antes filtraba client-side sobre la
  // página de 50 y las tablas del esquema fuera de esa página no aparecían).
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

  // Filtro por esquema (doc 43): opciones = esquemas que contienen TABLAS
  // (cacheados por sesión y versión en schemaPartition, compartidos con el
  // CTAS) — así el combobox no mezcla los esquemas solo-de-vistas (`_vu`).
  // Mientras cargan se muestra solo "All schemas"; el catálogo completo queda
  // como fallback únicamente si la bajada FALLA. El acotado por esquema lo
  // hace el BACKEND (server-side, junto a `q`); el filtro client-side de acá
  // es sólo defensa — descarta cualquier resultado de un esquema previo que
  // quedara en pantalla mientras resuelve la nueva consulta.
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
    try { await addExistingTables([id], { withViews }); setAdded((s) => new Set(s).add(id)); }
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
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || !logical.trim()} onClick={submitBlank}>Create {n.one}</button>
        </>
      ) : (
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Done</button>
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
                onChange={(e) => setLogical(sanitizeLogicalName(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') submitBlank(); }}
                style={{ width: '100%' }} />
              {/* Doc 86 D3: el físico se deriva por glosario (scope table); se edita luego en Physical. */}
              <span className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)', marginTop: 4, display: 'block' }}>
                Physical: <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{physical || '—'}</span> — derived from the glossary; schema and physical name are set in the Physical model.
              </span>
            </div>
          ) : (
            <>
              <div style={field}>
                <label style={lbl}>Physical name</label>
                <input className="rd-input rd-mono" autoFocus placeholder="e.g. HD_CLIENTE" value={logical}
                  onChange={(e) => setLogical(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitBlank(); }}
                  style={{ width: '100%' }} />
                {casedPhysical && casedPhysical !== logical.trim() && (
                  <span className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)', marginTop: 4, display: 'block' }}>
                    Saved as <span className="rd-mono" style={{ color: 'var(--flow-700)' }}>{casedPhysical}</span> (naming rule of the table scope).
                  </span>
                )}
              </div>
              <div style={field}>
                <label style={lbl}>Schema</label>
                {/* Combobox de esquemas con buscador (docs 18/52) — solo esquemas
                    de TABLAS; se crean desde Structure · Esquemas. */}
                <SchemaSelect kind="tables" value={schema} onChange={setSchema} style={{ width: '100%' }} />
              </div>
            </>
          )}
          {/* Doc 64 §6: definición funcional + UDPs en el alta (como el popup
              de New column, doc 40). */}
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
              {/* Combobox buscable (doc 41), mismo estilo que el del CTAS. */}
              <SearchSelect mono options={schemaOpts} valueLabel={schemaFilter} placeholder="All schemas" emptyLabel="All schemas" onPick={setSchemaFilter} />
            </div>
          </div>
          {/* Doc 70: una tabla vive en muchos canvases y cada canvas modela sus
              vistas — importar NO arrastra vistas salvo pedido explícito. */}
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
                    {/* Doc 86: el nombre de la faceta activa primero. */}
                    <div className={viewMode === 'physical' ? 'rd-mono' : ''} style={{ fontWeight: 600, fontSize: 13 }}>{viewMode === 'physical' ? t.physicalName : (t.logicalName || t.physicalName)}</div>
                    <div className={`rd-small${viewMode === 'logical' ? ' rd-mono' : ''}`} style={{ color: 'var(--text-muted, #8A93A5)' }}>{viewMode === 'physical' ? t.logicalName : t.physicalName} · used in {usageOf(t.id)} modules</div>
                  </div>
                  <button className="rd-btn rd-btn-ghost rd-btn-sm" disabled={already || adding === t.id} onClick={() => addOne(t.id)}>
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
