import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Play, Save, Table2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createReport, emptySpec, exportCsv, getCatalog, listReports, runQuery, runSql, validateSql,
  type FieldDef, type OrderBy, type QueryResult, type ReportSpec, type SavedReport, type ViewKey,
} from '../query.service';
import { specForExport } from '../lib/exportSpec';
import { regroup, toBuilderSpec, withoutUnsortableOrder } from '../lib/reportBuilder';
import FilterBuilder from './FilterBuilder';
import ResultsGrid from './ResultsGrid';
import SqlEditor from './SqlEditor';

type Mode = 'builder' | 'sql';

const VIEWS: ViewKey[] = ['columns', 'tables', 'relationships', 'views', 'view_columns', 'models'];
// Etiqueta legible del selector (la key `view_columns` se muestra "view columns").
const VIEW_LABELS: Record<ViewKey, string> = {
  columns: 'columns', tables: 'tables', relationships: 'relationships',
  views: 'views', view_columns: 'view columns', models: 'models',
};
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

/** Doc 75 D13: el diseñador consulta UN proyecto (`projectId`); `projectPicker`
 *  es el selector compartido con la pantalla de Reporting. */
export default function ReportDesigner({ projectId, projectPicker, onClose }: {
  projectId: string; projectPicker?: React.ReactNode; onClose?: () => void;
}) {
  const [from, setFrom] = useState<ViewKey>('columns');
  const [catalog, setCatalog] = useState<FieldDef[]>([]);
  const [spec, setSpec] = useState<ReportSpec>(emptySpec(projectId, 'columns'));
  const [mode, setMode] = useState<Mode>('builder');
  const [sqlText, setSqlText] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  // Doc 105: cada consulta nueva (Run, ordenar, otra vista, abrir un spec) deja
  // viejas las que siguen en vuelo — su respuesta o su página ya no se muestran.
  const seq = useRef(0);
  // La consulta que produjo el resultado en pantalla: «Load more» sigue ESA (el
  // cursor no la identifica — con el formulario editado desde el Run pegaba la
  // página de otra consulta). `paging`: el scroll la pide varias veces antes del re-render.
  const shown = useRef<{ sql: boolean; spec: ReportSpec; text: string } | null>(null);
  const paging = useRef(false);
  // Doc 105 (ronda 6): un Run en vuelo (no una página): mientras tanto no se
  // ordena — el orden invalidaba la consulta nueva y dejaba la vieja ordenada.
  const running = useRef(false);
  // Lo que la grilla necesita de la consulta en pantalla: `runId` la vuelve
  // arriba en cada consulta nueva (antes quedaba en el scroll de la anterior y,
  // al fondo, pedía sola la página 2; «Load more» no la mueve); `sql`/`sort`:
  // sólo un resultado del Builder se ordena, y la flecha es la de ESE resultado.
  const [shownView, setShownView] = useState<{ runId: number; sql: boolean; sort: OrderBy | null }>({ runId: 0, sql: false, sort: null });

  useEffect(() => {
    let live = true;   // doc 105: el catálogo de la vista anterior, si llega tarde, no pisa al de la elegida
    setCatalog([]);    // …ni queda en pantalla mientras llega el nuevo (o si falla)
    getCatalog(projectId, from)
      .then((c) => { if (live) setCatalog(c); })
      .catch(() => { if (live) toast.error("Couldn't load the catalog"); });
    return () => { live = false; };
  }, [projectId, from]);
  useEffect(() => { listReports(projectId).then(setSaved).catch(() => {}); }, [projectId]);

  /** Doc 105: elegir otra vista reinicia el spec; abrir uno (SQL validado o
   *  reporte guardado) fija su vista Y su spec juntos — antes un efecto lo
   *  reiniciaba al cambiar la vista (de ahí un setTimeout al cargar un reporte)
   *  y «Validate → builder» ni la cambiaba: con `FROM tables` el Builder seguía
   *  con el catálogo de `columns`. El Builder abre sin el tope del LIMIT. */
  const clearResult = () => {
    seq.current += 1; shown.current = null; paging.current = false;
    setResult(null); setLoading(false); setShownView({ runId: seq.current, sql: false, sort: null });
  };
  const pickFrom = (v: ViewKey) => { setFrom(v); setSpec(emptySpec(projectId, v)); clearResult(); };
  const openInBuilder = (s: ReportSpec) => {
    setFrom(s.from); setSpec(toBuilderSpec(s, projectId)); clearResult(); setMode('builder');
  };

  /** El spec sin el orden por campos no ordenables (aviso + formulario al día). */
  const sortable = useCallback((s: ReportSpec): ReportSpec => {
    const { spec: cleaned, removed } = withoutUnsortableOrder(s, catalog);
    if (!removed.length) return s;
    toast.info(`Sorting by ${removed.join(', ')} was removed: that field can't be sorted.`);
    setSpec(cleaned);
    return cleaned;
  }, [catalog]);

  /** `override`: correr ese spec del Builder (ordenar la consulta en pantalla). */
  const run = useCallback(async (override?: ReportSpec) => {
    const my = ++seq.current;
    let query = override ? { sql: false, spec: override, text: '' } : { sql: mode === 'sql', spec, text: sqlText };
    // Doc 105 (ronda 6): un orden por un campo sin índice (un reporte guardado
    // antes de que la grilla sólo ofreciera los ordenables) daba 422 en cada
    // Run, sin salida — el Builder no muestra el orden. Se quita, con aviso.
    if (!query.sql) query = { ...query, spec: sortable(query.spec) };
    paging.current = false;
    running.current = true;
    setLoading(true);
    try {
      const res = query.sql ? await runSql(projectId, query.text) : await runQuery(query.spec);
      if (my !== seq.current) return;
      shown.current = query;
      setResult(res);
      setShownView({ runId: my, sql: query.sql, sort: query.sql ? null : query.spec.orderBy[0] ?? null });
      res.meta?.warnings?.forEach((w) => toast.warning(w));
    } catch (e) { if (my === seq.current) toast.error(e instanceof Error ? e.message : 'The query failed'); }
    finally { if (my === seq.current) { running.current = false; setLoading(false); } }
  }, [mode, spec, sqlText, projectId, sortable]);

  const loadMore = async () => {
    const query = shown.current;
    const cursor = result?.nextCursor;
    if (!query || !cursor || loading || paging.current) return;
    const my = seq.current;
    paging.current = true;
    setLoading(true);
    try {
      const res = query.sql ? await runSql(projectId, query.text, cursor) : await runQuery(query.spec, cursor);
      if (my !== seq.current) return;
      setResult((prev) => (prev ? { ...res, rows: [...prev.rows, ...res.rows] } : res));
    } catch (e) {
      if (my === seq.current) toast.error(e instanceof Error ? e.message : "Couldn't load more rows");
    } finally {
      if (my === seq.current) { paging.current = false; setLoading(false); }
    }
  };

  // Doc 105 (ronda 5): el backend sólo ordena por campos con índice (el resto: 422).
  const canSort = (key: string) => catalog.some((f) => f.key === key && f.sortable);
  // Doc 105 (ronda 5): ordenar es sobre la consulta EN PANTALLA (antes corría el
  // formulario, editado o no desde el Run; con un resultado SQL corría el
  // Builder con un campo `sql_c1` y fallaba cada Run siguiente). El formulario
  // toma el orden elegido para el próximo Run.
  const onSort = (key: string) => {
    const q = shown.current;
    if (!q || q.sql || running.current) return;
    const cur = q.spec.orderBy[0];
    const orderBy: OrderBy[] = [{ field: key, dir: cur?.field === key && cur.dir === 'asc' ? 'desc' : 'asc' }];
    setSpec((s) => ({ ...s, orderBy }));
    void run({ ...q.spec, orderBy });
  };

  const toggleSelect = (key: string) => setSpec((s) => ({
    ...s, select: s.select.includes(key) ? s.select.filter((k) => k !== key) : [...s.select, key],
  }));
  // Doc 105: agrupar quita el orden por fila que el agrupado ignoraría (antes
  // no había forma de quitarlo y cada Run avisaba «Sort by … was ignored»).
  const toggleGroup = (key: string) => setSpec((s) => regroup(s, key));

  // Doc 95 D12: en modo SQL se exporta la SQL (validada), no el spec del Builder.
  const doExport = async () => {
    try {
      // Ronda 7: sin un orden no ordenable (un reporte guardado viejo daba 422 al exportar).
      await exportCsv(await specForExport(mode, mode === 'sql' ? spec : sortable(spec), sqlText, (text) => validateSql(projectId, text)));
      toast.success('CSV export started');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); }
  };
  const doSave = async () => {
    const name = window.prompt('Report name'); if (!name?.trim()) return;
    try { await createReport({ projectId, name: name.trim(), spec: sortable(spec), shared: false }); setSaved(await listReports(projectId)); toast.success('Report saved'); }
    catch { toast.error("Couldn't save"); }
  };
  const loadReport = (r: SavedReport) => { openInBuilder(r.spec); toast.success(`Loaded: ${r.name}`); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff' }}>
      {/* header */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #EAEDF2' }}>
        <Table2 size={18} color="#2E5BFF" />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1A2B4A' }}>Report Designer</span>
        {projectPicker}
        <select value={from} onChange={(e) => pickFrom(e.target.value as ViewKey)} style={{ height: 32, padding: '0 10px', border: '1px solid #DCE1EA', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#1A2B4A' }}>
          {VIEWS.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
        </select>
        <div style={{ display: 'inline-flex', border: '1px solid #DCE1EA', borderRadius: 8, overflow: 'hidden' }}>
          {(['builder', 'sql'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{ height: 32, padding: '0 13px', border: 'none', background: mode === m ? '#2E5BFF' : '#fff', color: mode === m ? '#fff' : '#48526A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{m === 'builder' ? 'Builder' : 'SQL'}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {saved.length > 0 && (
          <select onChange={(e) => { const r = saved.find((x) => x.id === e.target.value); if (r) loadReport(r); }} value="" style={{ height: 32, padding: '0 10px', border: '1px solid #DCE1EA', borderRadius: 8, fontSize: 12.5, color: '#48526A' }}>
            <option value="">Saved reports…</option>
            {saved.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <button onClick={doSave} style={{ ...btn, border: '1px solid #DCE1EA', background: '#fff', color: '#48526A' }}><Save size={14} />Save</button>
        <button onClick={doExport} style={{ ...btn, border: '1px solid #DCE1EA', background: '#fff', color: '#48526A' }}><Download size={14} />CSV</button>
        <button onClick={() => void run()} disabled={loading} style={{ ...btn, border: 'none', background: '#2E5BFF', color: '#fff' }}><Play size={14} />Run</button>
        {onClose && <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9AA3B2' }}><X size={18} /></button>}
      </div>

      {/* controls + results */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 'none', maxHeight: '46%', overflowY: 'auto', padding: '14px 20px', borderBottom: '1px solid #EAEDF2' }}>
          {mode === 'sql' ? (
            <SqlEditor projectId={projectId} text={sqlText} onText={setSqlText} onValidated={openInBuilder} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
              {/* field picker */}
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A93A5', textTransform: 'uppercase', marginBottom: 8 }}>Columns · group</div>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #EAEDF2', borderRadius: 9, padding: 8 }}>
                  {catalog.map((f) => (
                    <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', fontSize: 12.5, color: '#2B3346' }}>
                      <input type="checkbox" checked={spec.select.includes(f.key)} onChange={() => toggleSelect(f.key)} title="Show column" />
                      <span style={{ flex: 1 }}>{f.udp && <span style={{ color: '#7A4DD6' }}>◆ </span>}{f.label}</span>
                      {f.groupable && <button onClick={() => toggleGroup(f.key)} title="Group by" style={{ border: 'none', background: spec.groupBy.includes(f.key) ? '#EAF0FF' : 'transparent', color: spec.groupBy.includes(f.key) ? '#2E5BFF' : '#B6BECD', borderRadius: 5, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', padding: '2px 5px' }}>GRP</button>}
                    </div>
                  ))}
                </div>
              </div>
              {/* filters */}
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A93A5', textTransform: 'uppercase', marginBottom: 8 }}>Filters</div>
                {catalog.length > 0 && <FilterBuilder projectId={projectId} group={spec.where ?? { op: 'and', conditions: [] }} catalog={catalog} from={from} onChange={(g) => setSpec((s) => ({ ...s, where: g }))} />}
              </div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: '10px 20px 16px' }}>
          <ResultsGrid resetKey={shownView.runId} result={result} loading={loading} onLoadMore={loadMore}
            onSort={shownView.sql ? undefined : onSort} sortDisabled={loading && !paging.current}
            canSort={canSort} sort={shownView.sql ? null : shownView.sort} />
        </div>
      </div>
    </div>
  );
}
