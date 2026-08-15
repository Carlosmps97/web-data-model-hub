import { useEffect, useMemo, useRef, useState } from 'react';
import { Combine, Search, X } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { useModelerStore } from '@/store/useModelerStore';
import * as gov from '@/features/governance/services/governance.service';
import type { CanonicalColumn, CanonicalTable } from '@/features/governance/services/governance.service';
import SearchSelect from './SearchSelect';
import { tableSchemasCached } from '../services/schemaPartition';
import { buildCandidates, filterColumns } from '../lib/ctasPick';

/** Página server-side de fuentes (mismo tamaño que el Import existing). */
const PAGE = 50;
/** Tope de filas de columnas RENDERIZADAS — el filtro y Select all operan
 *  sobre el total (una fuente DDV real trae miles de columnas; miles de
 *  checkboxes en el DOM repiten el problema del canvas pre-LOD). */
const COL_CAP = 300;

/**
 * CTAS — Create Table As Select (Pantalla 06, rediseño doc 43). Dos secciones:
 *  1) elegir tablas fuente de TODO el modelo (ya no sólo el canvas) con el
 *     patrón del Import existing: búsqueda SERVER-SIDE paginada (draft-aware)
 *     + filtro por esquema, chips de seleccionadas (sobreviven al cambio de
 *     página), y columnas a heredar con buscador y tabla dueña visible;
 *  2) definir la nueva tabla — Schema con combobox buscable (doc 41) acotado a
 *     esquemas de TABLAS + preview SQL en vivo.
 * Este popup consulta SOLO `canonical_tables` (pedido del owner): la colección
 * `views` ni se toca — ni para las fuentes ni para los esquemas, que salen del
 * pool de tablas cacheado por sesión (`tableSchemasCached`).
 * Crea vía `createTableFromSources` (un solo lote al changeset, doc 39).
 */
export default function CtasModal({ onClose, pushToast }: { onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const createTableFromSources = useModelerStore((s) => s.createTableFromSources);
  const schemasCatalog = useModelerStore((s) => s.schemas);
  const loadSchemas = useModelerStore((s) => s.loadSchemas);

  // Página vigente de la búsqueda de fuentes (null = primera carga).
  const [page, setPage] = useState<CanonicalTable[] | null>(null);
  // Esquemas con tablas (null = cargando; con error → fallback al catálogo).
  const [tableSchemas, setTableSchemas] = useState<string[] | null>(null);
  const [schemasErr, setSchemasErr] = useState(false);

  // `sources` conserva el ORDEN DE SELECCIÓN (Set = orden de inserción): fija
  // la precedencia del dedup de candidatas y el orden del FROM del preview.
  // `selById` cachea el doc de cada seleccionada: la fila puede salir de la
  // página al seguir buscando y chips/FROM/tabla-dueña deben sobrevivir.
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [selById, setSelById] = useState<Map<string, CanonicalTable>>(new Map());
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [colsByTable, setColsByTable] = useState<Map<string, CanonicalColumn[]>>(new Map());
  const [loadingCols, setLoadingCols] = useState<Set<string>>(new Set());
  const [tq, setTq] = useState('');
  const [tSchema, setTSchema] = useState('');
  const [cq, setCq] = useState('');

  const [name, setName] = useState('');
  const [schema, setSchema] = useState('');
  const [physName, setPhysName] = useState('');
  const [busy, setBusy] = useState(false);

  // Guard de desmonte para los callbacks de HANDLERS (listColumns). El cuerpo
  // REPONE true: con StrictMode (montaje doble en dev) el cleanup del primer
  // montaje dejaba el ref en false para siempre y el modal descartaba todas
  // las respuestas ("Loading tables…" eterno). Los efectos usan su propio
  // `let live` por corrida (patrón Import existing), inmune a ese doble ciclo.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Búsqueda SERVER-SIDE con debounce (patrón Import existing): página inicial
  // alfabética al abrir; tipear o cambiar el esquema RE-CONSULTA (draft-aware
  // vía /effective con q/limit/schema). `live` descarta respuestas viejas.
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => {
      gov.searchTables(tq.trim(), PAGE, tSchema || undefined)
        .then((r) => { if (live) setPage(r); })
        .catch(() => { if (live) { setPage([]); pushToast('Could not load the tables', 'err'); } });
    }, tq ? 300 : 0);
    return () => { live = false; clearTimeout(h); };
  }, [tq, tSchema, pushToast]);

  // Esquemas con tablas en SEGUNDO PLANO (cacheados por sesión y versión en
  // schemaPartition, compartidos con New table). Mientras cargan, los combobox
  // muestran solo su opción vacía — NUNCA el catálogo completo, que mezclaría
  // los esquemas solo-de-vistas (`_vu`); el catálogo queda como fallback
  // únicamente si la bajada FALLA (mejor con ruido que en blanco).
  useEffect(() => {
    let live = true;
    tableSchemasCached()
      .then((ts) => { if (live) setTableSchemas(ts); })
      .catch(() => { if (live) setSchemasErr(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (useModelerStore.getState().schemas.length === 0) void loadSchemas().catch(() => {});
  }, [loadSchemas]);

  // Defensa client-side del filtro de esquema (como el Import existing):
  // descarta resultados del esquema previo mientras resuelve la re-consulta.
  const visible = useMemo(
    () => (tSchema ? (page ?? []).filter((t) => t.schema === tSchema) : (page ?? [])),
    [page, tSchema],
  );
  const srcTables = useMemo(
    () => [...sources].map((id) => selById.get(id)).filter((t): t is CanonicalTable => !!t),
    [sources, selById],
  );

  const candidates = useMemo(() => buildCandidates([...sources], colsByTable), [sources, colsByTable]);
  const visibleCands = useMemo(() => filterColumns(candidates, cq), [candidates, cq]);
  // Lo que se CREA sale de lo marcado sobre el TOTAL de candidatas: el
  // buscador sólo acota la vista, jamás lo que se hereda.
  const pickedCols = useMemo(() => candidates.filter((c) => picks.has(c.id)), [candidates, picks]);

  const toggleSrc = (t: CanonicalTable) => {
    const wasSelected = sources.has(t.id);
    setSources((s) => { const n = new Set(s); if (wasSelected) n.delete(t.id); else n.add(t.id); return n; });
    if (wasSelected) return;
    setSelById((m) => new Map(m).set(t.id, t));
    if (colsByTable.has(t.id) || loadingCols.has(t.id)) return;
    // Primera selección de esta fuente: sus columnas se bajan una única vez
    // (server-side por tableId, draft-aware) y quedan cacheadas para el modal.
    setLoadingCols((s) => new Set(s).add(t.id));
    gov.listColumns(t.id)
      .then((cols) => { if (alive.current) setColsByTable((m) => new Map(m).set(t.id, cols)); })
      .catch(() => {
        if (!alive.current) return;
        pushToast('Could not load the columns of that table', 'err');
        setSources((s) => { const n = new Set(s); n.delete(t.id); return n; });
      })
      .finally(() => { if (alive.current) setLoadingCols((s) => { const n = new Set(s); n.delete(t.id); return n; }); });
  };
  const togglePick = (id: string) => setPicks((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Select all / Clear: actúan sobre las candidatas VISIBLES — con el buscador
  // activo, sobre el subconjunto filtrado (p.ej. marcar todas las "FEC_…");
  // picks de fuentes deseleccionadas quedan inertes (pickedCols filtra).
  const pickAll = () => setPicks((p) => { const n = new Set(p); for (const c of visibleCands) n.add(c.id); return n; });
  const pickNone = () => setPicks((p) => { const n = new Set(p); for (const c of visibleCands) n.delete(c.id); return n; });

  // Preview físico del nombre (scope table), debounced.
  useEffect(() => {
    const t = name.trim();
    if (!t) { setPhysName(''); return; }
    const h = setTimeout(() => { gov.physicalize(t, 'table').then((r) => setPhysName(r.physical)).catch(() => {}); }, 300);
    return () => clearTimeout(h);
  }, [name]);

  // Un solo pool de opciones para AMBOS combobox (filtro de fuentes y esquema
  // de la tabla nueva): esquemas con tablas; catálogo completo solo si falló.
  const schemaOpts = useMemo(() => {
    const base = tableSchemas ?? (schemasErr ? schemasCatalog.map((s) => s.name) : []);
    return base.map((s) => ({ value: s, label: s }));
  }, [tableSchemas, schemasErr, schemasCatalog]);

  const sql = useMemo(() => {
    const tbl = `${schema.trim() || 'schema'}.${physName || 'new_table'}`;
    const cols = pickedCols.length ? pickedCols.map((c) => `  ${c.physicalName}`).join(',\n') : '  *';
    const from = srcTables.map((t) => (t.schema ? `${t.schema}.${t.physicalName}` : t.physicalName)).join(', ') || '<source tables>';
    return `CREATE TABLE ${tbl} AS\nSELECT\n${cols}\nFROM ${from};`;
  }, [schema, physName, pickedCols, srcTables]);

  const create = async () => {
    if (!name.trim()) { pushToast('Table name is required', 'err'); return; }
    if (pickedCols.length === 0) { pushToast('Pick at least one column', 'err'); return; }
    setBusy(true);
    try {
      await createTableFromSources({ logicalName: name.trim(), schema: schema.trim() || undefined, columns: pickedCols });
      pushToast('Table created from sources'); onClose();
    } catch { pushToast('Could not create the table', 'err'); } finally { setBusy(false); }
  };

  // Esc en los buscadores: limpia la query SIN cerrar el Dialog (escucha
  // keydown en window); con la query ya vacía sí deja pasar el cierre.
  const escClears = (val: string, set: (v: string) => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && val) { e.stopPropagation(); set(''); }
  };

  const step: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--ink, #1A2B4A)', marginBottom: 6 };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted, #56607A)', marginBottom: 5, display: 'block' };
  const link: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--primary, #2F6BFF)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
  const listBox: React.CSSProperties = { overflow: 'auto', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 9, padding: 4 };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 7px', cursor: 'pointer', borderRadius: 6 };
  const sub: React.CSSProperties = { display: 'block', fontSize: 10, color: 'var(--text-muted-2, #8A93A5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const searchBox: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', background: 'var(--fill-3, #F4F6F9)', borderRadius: 8 };
  const searchInput: React.CSSProperties = { flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', padding: '8px 0', fontSize: 12.5, fontFamily: 'inherit' };
  const clearBtn: React.CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted, #8A93A5)', display: 'inline-flex', padding: 2 };
  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 4px 2px 8px', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 999, background: 'var(--fill-4, #F7F9FC)', maxWidth: '100%' };

  return (
    <Dialog
      open
      title="New table · CTAS"
      subtitle="Create a new table from columns of existing tables"
      icon={Combine}
      backdrop="canvas"
      canvasTop={136}
      width={980}
      onClose={onClose}
      footer={(
        <>
          <div className="dmh-dialog-foot-left rd-small" style={{ color: 'var(--text-muted, #8A93A5)' }}>Added to the canvas as an unpublished change.</div>
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={create}>Create table</button>
        </>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        {/* 1 · Choose source tables and columns */}
        <div>
          <div style={step}>1 · Choose source tables and columns</div>
          <div className="rd-small" style={{ marginBottom: 10, color: 'var(--text-muted, #8A93A5)' }}>
            Pick source tables from the whole model — not just this canvas — and check the columns to inherit.
          </div>
          <label style={lbl}>Source tables</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={searchBox}>
              <Search size={14} color="var(--text-muted, #8A93A5)" />
              <input placeholder="Search tables in the database…" value={tq} onChange={(e) => setTq(e.target.value)}
                onKeyDown={escClears(tq, setTq)} style={searchInput} />
              {tq && (
                <button type="button" style={clearBtn} onClick={() => setTq('')} aria-label="Clear table search"><X size={12} /></button>
              )}
            </div>
            <div style={{ width: 168, flexShrink: 0 }}>
              <SearchSelect mono options={schemaOpts} valueLabel={tSchema} placeholder="All schemas" emptyLabel="All schemas" onPick={setTSchema} />
            </div>
          </div>
          {/* Chips de seleccionadas: la selección sigue visible (y quitable)
              aunque la búsqueda cambie de página y esas filas ya no estén. */}
          {srcTables.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8, maxHeight: 56, overflowY: 'auto' }}>
              {srcTables.map((t) => (
                <span key={t.id} style={chip}>
                  <span className="rd-mono" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.schema && <span style={{ opacity: 0.62 }}>{t.schema}.</span>}
                    {t.physicalName}
                  </span>
                  <button type="button" style={clearBtn} onClick={() => toggleSrc(t)} aria-label={`Remove ${t.physicalName}`}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div style={{ ...listBox, height: 188, marginBottom: 12 }}>
            {page === null && <div className="rd-small" style={{ padding: 6 }}>Loading tables…</div>}
            {page !== null && visible.map((t) => (
              <label key={t.id} style={row}>
                <input type="checkbox" style={{ marginTop: 2 }} checked={sources.has(t.id)} onChange={() => toggleSrc(t)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  {/* esquema.tabla completo (dos tablas pueden llamarse igual
                      en esquemas distintos); sin ellipsis → nunca se trunca */}
                  <span className="rd-mono" style={{ display: 'block', fontSize: 12, wordBreak: 'break-all' }}>
                    {t.schema && <span style={{ opacity: 0.62 }}>{t.schema}.</span>}
                    {t.physicalName}
                  </span>
                  <span style={sub}>{t.logicalName}</span>
                </span>
              </label>
            ))}
            {page !== null && page.length >= PAGE && visible.length > 0 && (
              <div className="rd-small" style={{ padding: 6, color: 'var(--text-muted, #8A93A5)' }}>
                Showing the first {PAGE} matches — refine your search to narrow the list.
              </div>
            )}
            {page !== null && visible.length === 0 && (
              <div className="rd-small" style={{ padding: 6 }}>
                {tSchema
                  ? `No tables in schema "${tSchema}"${tq.trim() ? ' match your search' : ''}.`
                  : 'No tables match your search.'}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <label style={lbl}>Columns to inherit</label>
            {candidates.length > 0 && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                <button type="button" style={link} onClick={pickAll}>Select all</button>
                <span style={{ color: '#D6DCE6' }}>·</span>
                <button type="button" style={{ ...link, color: 'var(--text-muted, #8A93A5)' }} onClick={pickNone}>Clear</button>
              </span>
            )}
          </div>
          <div style={{ ...searchBox, marginBottom: 8 }}>
            <Search size={14} color="var(--text-muted, #8A93A5)" />
            <input placeholder="Search by column name…" value={cq} onChange={(e) => setCq(e.target.value)}
              onKeyDown={escClears(cq, setCq)} style={searchInput} />
            {cq && (
              <button type="button" style={clearBtn} onClick={() => setCq('')} aria-label="Clear column search"><X size={12} /></button>
            )}
          </div>
          <div style={{ ...listBox, height: 236 }}>
            {sources.size === 0 && <div className="rd-small" style={{ padding: 6 }}>Pick source tables first.</div>}
            {loadingCols.size > 0 && <div className="rd-small" style={{ padding: 6 }}>Loading columns…</div>}
            {visibleCands.slice(0, COL_CAP).map((c) => {
              const owner = selById.get(c.tableId);
              return (
                <label key={c.id} style={row}>
                  <input type="checkbox" style={{ marginTop: 2 }} checked={picks.has(c.id)} onChange={() => togglePick(c.id)} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="rd-mono" style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.physicalName}</span>
                      <span className="rd-mono" style={{ color: 'var(--text-muted-2, #8A93A5)', fontSize: 10, flexShrink: 0 }}>{c.dataType}</span>
                    </span>
                    {/* a qué tabla pertenece la columna (pedido doc 43) */}
                    <span style={sub}>{owner ? (owner.schema ? `${owner.schema}.${owner.physicalName}` : owner.physicalName) : '—'}</span>
                  </span>
                </label>
              );
            })}
            {sources.size > 0 && loadingCols.size === 0 && candidates.length > 0 && visibleCands.length === 0 && (
              <div className="rd-small" style={{ padding: 6 }}>No columns match your search.</div>
            )}
            {visibleCands.length > COL_CAP && (
              <div className="rd-small" style={{ padding: 6, color: 'var(--text-muted, #8A93A5)' }}>
                Showing the first {COL_CAP} of {visibleCands.length} columns — refine your search.
              </div>
            )}
          </div>
          {cq.trim() !== '' && candidates.length > 0 && (
            <div className="rd-small" style={{ marginTop: 6, color: 'var(--text-muted, #8A93A5)' }}>
              {visibleCands.length} of {candidates.length} columns match — Select all / Clear act on the matches.
            </div>
          )}
        </div>

        {/* 2 · Define the new table */}
        <div>
          <div style={step}>2 · Define the new table</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={lbl}>Schema</label>
              {/* Combobox buscable (doc 41) acotado a esquemas de TABLAS: los
                  usados sólo por vistas no aplican a una tabla nueva (doc 43). */}
              <SearchSelect mono options={schemaOpts} valueLabel={schema} placeholder="(no schema)" emptyLabel="(no schema)" onPick={setSchema} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label style={lbl}>Table Name</label>
              <input className="rd-input" autoFocus placeholder="e.g. resumen cliente" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>
          <label style={{ ...lbl, marginTop: 14 }}>Generated SQL</label>
          <pre style={{
            margin: 0, padding: 12, borderRadius: 10, background: '#0F1B30', color: '#CBD6EA',
            fontFamily: 'var(--font-geist-mono, monospace)', fontSize: 12, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 150,
          }}>{sql}</pre>
          <div className="rd-small" style={{ marginTop: 8, color: 'var(--text-muted, #8A93A5)' }}>
            {pickedCols.length} column{pickedCols.length === 1 ? '' : 's'} from {srcTables.length} source table{srcTables.length === 1 ? '' : 's'}.
          </div>
        </div>
      </div>
    </Dialog>
  );
}
