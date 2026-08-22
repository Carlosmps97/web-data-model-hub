import { useEffect, useMemo, useState } from 'react';
import { Table2, Search, Plus, Check } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import * as gov from '@/features/governance/services/governance.service';
import type { CanonicalTable } from '@/features/governance/services/governance.service';
import { useModelerStore } from '@/store/useModelerStore';
import { apiErrorMessage } from '@/services/http';
import SchemaSelect from './SchemaSelect';
import SearchSelect from './SearchSelect';
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
  onCreate: (input: { logicalName: string; physicalName?: string; schema?: string }) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('blank');

  // ── Blank ──────────────────────────────────────────────────────────────
  const [logical, setLogical] = useState('');
  const [physical, setPhysical] = useState('');
  const [physEdited, setPhysEdited] = useState(false);
  const [schema, setSchema] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-physicalize (scope 'table') con debounce, salvo override manual.
  // `alive` descarta la respuesta si el efecto ya se limpió (el usuario siguió
  // tipeando o tomó el override): sin esto una respuesta VIEJA que llegara
  // tarde pisaba el físico vigente con el derivado de un lógico anterior.
  useEffect(() => {
    if (physEdited) return;
    const t = logical.trim();
    if (!t) { setPhysical(''); return; }
    let alive = true;
    const h = setTimeout(() => {
      gov.physicalize(t, 'table').then((r) => { if (alive) setPhysical(r.physical); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [logical, physEdited]);

  const submitBlank = async () => {
    const ln = logical.trim();
    if (!ln) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ logicalName: ln, physicalName: physical.trim() || undefined, schema: schema.trim() || undefined });
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
    try { await addExistingTables([id]); setAdded((s) => new Set(s).add(id)); }
    finally { setAdding(null); }
  };

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted, #56607A)', marginBottom: 5, display: 'block' };
  const field: React.CSSProperties = { marginBottom: 14 };

  return (
    <Dialog
      open
      title="New table"
      subtitle="Create a blank entity or import an existing one"
      icon={Table2}
      backdrop="canvas"
      canvasTop={136}
      width={mode === 'import' ? 660 : 520}
      onClose={onClose}
      footer={mode === 'blank' ? (
        <>
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || !logical.trim()} onClick={submitBlank}>Create table</button>
        </>
      ) : (
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Done</button>
      )}
    >
      <div className="rd-seg" style={{ marginBottom: 16 }}>
        <button className={mode === 'blank' ? 'active' : ''} onClick={() => setMode('blank')}>Blank table</button>
        <button className={mode === 'import' ? 'active' : ''} onClick={() => setMode('import')}>Import existing</button>
      </div>

      {mode === 'blank' ? (
        <div>
          <div style={field}>
            <label style={lbl}>Logical Name</label>
            <input className="rd-input" autoFocus placeholder="e.g. cuenta cliente" value={logical}
              onChange={(e) => setLogical(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitBlank(); }}
              style={{ width: '100%' }} />
          </div>
          <div style={field}>
            <label style={lbl}>Physical Name</label>
            <input className="rd-input rd-mono" placeholder="schema-derived" value={physical}
              onChange={(e) => { setPhysical(e.target.value); setPhysEdited(true); }} style={{ width: '100%' }} />
            <span className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)', marginTop: 4, display: 'block' }}>
              Auto-generated from UDP (per-table). You can override it.
            </span>
          </div>
          <div style={field}>
            <label style={lbl}>Schema</label>
            {/* Combobox de esquemas con buscador (docs 18/52) — solo esquemas
                de TABLAS; se crean desde Structure · Esquemas. */}
            <SchemaSelect kind="tables" value={schema} onChange={setSchema} style={{ width: '100%' }} />
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
              <input placeholder="Search tables in the database…" value={q} onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, border: 0, background: 'transparent', outline: 'none', padding: '10px 0', fontSize: 13 }} />
            </div>
            <div style={{ width: 168, flexShrink: 0 }}>
              {/* Combobox buscable (doc 41), mismo estilo que el del CTAS. */}
              <SearchSelect mono options={schemaOpts} valueLabel={schemaFilter} placeholder="All schemas" emptyLabel="All schemas" onPick={setSchemaFilter} />
            </div>
          </div>
          <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visible.map((t) => {
              const already = inCanvas.has(t.id) || added.has(t.id);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border-soft, #EAEDF2)', borderRadius: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="rd-mono" style={{ fontWeight: 600, fontSize: 13 }}>{t.physicalName}</div>
                    <div className="rd-small" style={{ color: 'var(--text-muted, #8A93A5)' }}>{t.logicalName} · used in {usageOf(t.id)} modules</div>
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
                  ? `No tables in schema "${schemaFilter}"${q.trim() ? ' match your search' : ''}.`
                  : 'No tables match your search.'}
              </div>
            )}
          </div>
          <div className="rd-small" style={{ marginTop: 12, color: 'var(--text-muted, #56607A)' }}>
            Imported tables are <strong>universal</strong> — editing structure propagates to every module that references them.
          </div>
        </div>
      )}
    </Dialog>
  );
}
