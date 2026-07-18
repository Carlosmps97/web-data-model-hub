import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Play, Save, Table2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createReport, emptySpec, exportCsv, getCatalog, listReports, runQuery, runSql,
  type FieldDef, type QueryResult, type ReportSpec, type SavedReport, type ViewKey,
} from '../query.service';
import FilterBuilder from './FilterBuilder';
import ResultsGrid from './ResultsGrid';
import SqlEditor from './SqlEditor';

type Mode = 'builder' | 'sql';

const VIEWS: ViewKey[] = ['columns', 'tables', 'relationships', 'views', 'models'];
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };

export default function ReportDesigner({ onClose }: { onClose?: () => void }) {
  const [from, setFrom] = useState<ViewKey>('columns');
  const [catalog, setCatalog] = useState<FieldDef[]>([]);
  const [spec, setSpec] = useState<ReportSpec>(emptySpec('columns'));
  const [mode, setMode] = useState<Mode>('builder');
  const [sqlText, setSqlText] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedReport[]>([]);

  useEffect(() => { getCatalog(from).then(setCatalog).catch(() => toast.error("Couldn't load the catalog")); }, [from]);
  useEffect(() => { listReports().then(setSaved).catch(() => {}); }, []);
  useEffect(() => { setSpec((s) => ({ ...emptySpec(from), select: [] })); setResult(null); }, [from]);

  const sortState = spec.orderBy[0] ? { field: spec.orderBy[0].field, dir: spec.orderBy[0].dir } : null;
  const groupable = useMemo(() => catalog.filter((f) => f.groupable), [catalog]);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = mode === 'sql' ? await runSql(sqlText) : await runQuery(spec);
      setResult(res);
      res.meta?.warnings?.forEach((w) => toast.warning(w));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The query failed'); }
    finally { setLoading(false); }
  }, [mode, spec, sqlText]);

  const loadMore = async () => {
    if (!result?.nextCursor || loading) return;
    setLoading(true);
    try {
      const res = mode === 'sql' ? await runSql(sqlText, result.nextCursor) : await runQuery(spec, result.nextCursor);
      setResult((prev) => (prev ? { ...res, rows: [...prev.rows, ...res.rows] } : res));
    } finally { setLoading(false); }
  };

  const onSort = (key: string) => {
    if (mode !== 'builder') return;
    const dir = sortState?.field === key && sortState.dir === 'asc' ? 'desc' : 'asc';
    setSpec((s) => ({ ...s, orderBy: [{ field: key, dir }] }));
  };
  useEffect(() => { if (mode === 'builder' && result) run(); /* re-run on sort */ }, [spec.orderBy]); // eslint-disable-line

  const toggleSelect = (key: string) => setSpec((s) => ({
    ...s, select: s.select.includes(key) ? s.select.filter((k) => k !== key) : [...s.select, key],
  }));
  const toggleGroup = (key: string) => setSpec((s) => {
    const groupBy = s.groupBy.includes(key) ? s.groupBy.filter((k) => k !== key) : [...s.groupBy, key];
    return { ...s, groupBy, aggregations: groupBy.length ? [{ fn: 'count', as: 'count' }] : [] };
  });

  const doExport = async () => {
    try { await exportCsv(spec); toast.success('Export CSV iniciado'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); }
  };
  const doSave = async () => {
    const name = window.prompt('Report name'); if (!name?.trim()) return;
    try { await createReport({ name: name.trim(), spec, shared: false }); setSaved(await listReports()); toast.success('Reporte guardado'); }
    catch { toast.error("Couldn't save"); }
  };
  const loadReport = (r: SavedReport) => { setFrom(r.spec.from); setTimeout(() => { setSpec(r.spec); setMode('builder'); }, 0); toast.success(`Cargado: ${r.name}`); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff' }}>
      {/* header */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #EAEDF2' }}>
        <Table2 size={18} color="#2E5BFF" />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1A2B4A' }}>Report Designer</span>
        <select value={from} onChange={(e) => setFrom(e.target.value as ViewKey)} style={{ height: 32, padding: '0 10px', border: '1px solid #DCE1EA', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#1A2B4A' }}>
          {VIEWS.map((v) => <option key={v} value={v}>{v}</option>)}
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
        <button onClick={run} disabled={loading} style={{ ...btn, border: 'none', background: '#2E5BFF', color: '#fff' }}><Play size={14} />Run</button>
        {onClose && <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9AA3B2' }}><X size={18} /></button>}
      </div>

      {/* controls + results */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 'none', maxHeight: '46%', overflowY: 'auto', padding: '14px 20px', borderBottom: '1px solid #EAEDF2' }}>
          {mode === 'sql' ? (
            <SqlEditor text={sqlText} onText={setSqlText} onValidated={(s) => { setSpec(s); setMode('builder'); }} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
              {/* field picker */}
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A93A5', textTransform: 'uppercase', marginBottom: 8 }}>Columns · group</div>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #EAEDF2', borderRadius: 9, padding: 8 }}>
                  {catalog.map((f) => (
                    <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', fontSize: 12.5, color: '#2B3346' }}>
                      <input type="checkbox" checked={spec.select.includes(f.key)} onChange={() => toggleSelect(f.key)} title="Mostrar columna" />
                      <span style={{ flex: 1 }}>{f.udp && <span style={{ color: '#7A4DD6' }}>◆ </span>}{f.label}</span>
                      {f.groupable && <button onClick={() => toggleGroup(f.key)} title="Agrupar por" style={{ border: 'none', background: spec.groupBy.includes(f.key) ? '#EAF0FF' : 'transparent', color: spec.groupBy.includes(f.key) ? '#2E5BFF' : '#B6BECD', borderRadius: 5, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', padding: '2px 5px' }}>GRP</button>}
                    </div>
                  ))}
                </div>
              </div>
              {/* filters */}
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#8A93A5', textTransform: 'uppercase', marginBottom: 8 }}>Filters</div>
                {catalog.length > 0 && <FilterBuilder group={spec.where ?? { op: 'and', conditions: [] }} catalog={catalog} from={from} onChange={(g) => setSpec((s) => ({ ...s, where: g }))} />}
              </div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: '10px 20px 16px' }}>
          <ResultsGrid result={result} loading={loading} onLoadMore={loadMore} onSort={onSort} sort={sortState} />
        </div>
      </div>
    </div>
  );
}
