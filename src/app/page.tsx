'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import Icon, { type IconName } from '@/components/ui/Icon';
import MetadataAdmin from '@/features/metadata/components/MetadataAdmin';
import { projectsService, canvasService } from '@/services';
import { getEngine } from '@/features/engines/engines';
import { normalizeTags, formatTag, tagId } from '@/lib/tags';
import type { Project, Table, DatabaseEngine, Tag } from '@/types/model';

const pushToast = (msg: string, kind?: 'err') => (kind === 'err' ? toast.error(msg) : toast.success(msg));

// ── Catalog row (one per table, flattened across all projects) ───────────────
interface ColRow { name: string; dataType: string; key: '' | 'PK' | 'FK' | 'SK' | 'PT'; def: string; tags: Tag[] }
interface ViewRow { name: string; type: string; role: string }
interface CatalogRow {
  projectId: string; project: string;
  layerId: string; model: string; layerColor: string;
  engine?: DatabaseEngine;
  schema: string; table: string;
  domainId: string; domainName: string; domainColor: string;
  owner: string;
  columns: ColRow[]; views: ViewRow[]; fkCount: number; tags: Tag[];
}

const PII = /email|phone|ssn|dni|passport|card|tax|address|documento|tel[eé]fono|correo|nombre/i;

// Governance severity → number color (badge styling lives in globals.css `.sev-*`).
const GOV_SEV_COLOR: Record<'medium' | 'info' | 'critical', string> = {
  medium: 'var(--warning)', info: 'var(--ink-2)', critical: 'var(--error)',
};

function keyOf(c: { isPrimaryKey?: boolean; isForeignKey?: boolean; isSurrogateKey?: boolean; isPartitionKey?: boolean }): ColRow['key'] {
  if (c.isPrimaryKey) return 'PK';
  if (c.isForeignKey) return 'FK';
  if (c.isSurrogateKey) return 'SK';
  if (c.isPartitionKey) return 'PT';
  return '';
}

function buildCatalog(project: Project, tables: Table[]): CatalogRow[] {
  const layerById = new Map(project.layers.map((l) => [l.id, l]));
  const domainById = new Map(project.domains.map((d) => [d.id, d]));
  return tables.map((t) => {
    const layer = t.layer ? layerById.get(t.layer) : undefined;
    const domain = t.domain ? domainById.get(t.domain) : undefined;
    return {
      projectId: project.id, project: project.name,
      layerId: t.layer ?? '', model: layer?.name ?? '—', layerColor: layer?.color ?? '#99a1ae',
      engine: (layer?.engine ?? project.engines[0]) as DatabaseEngine | undefined,
      schema: t.schema ?? '', table: t.name,
      domainId: t.domain ?? '', domainName: domain?.name ?? '', domainColor: domain?.color ?? '#99a1ae',
      owner: domain?.owner ?? '',
      columns: (t.columns ?? []).map((c) => ({ name: c.name, dataType: c.dataType, key: keyOf(c), def: c.functionalDefinition ?? '', tags: normalizeTags(c.tags) ?? [] })),
      views: (t.views ?? []).map((v) => ({ name: v.name, type: v.type, role: v.role ?? '—' })),
      fkCount: (t.columns ?? []).filter((c) => c.isForeignKey).length,
      tags: normalizeTags(t.tags) ?? [],
    };
  });
}

// ── Sort helper ──────────────────────────────────────────────────────────────
type SortDir = 'asc' | 'desc';
function useSort(initial: string) {
  const [sortKey, setSortKey] = useState(initial);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const onSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };
  function sortBy<T>(arr: T[], get: (row: T, k: string) => string | number): T[] {
    return [...arr].sort((a, b) => {
      const x = get(a, sortKey); const y = get(b, sortKey);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return c * (sortDir === 'asc' ? 1 : -1);
    });
  }
  return { sortKey, sortDir, onSort, sortBy };
}

function Th({ label, k, sortKey, sortDir, onSort, align, w }: {
  label: string; k: string; sortKey: string; sortDir: SortDir; onSort: (k: string) => void; align?: 'right'; w?: number;
}) {
  const active = sortKey === k;
  return (
    <th className={`mc-th${active ? ' active' : ''}`} style={{ textAlign: align ?? 'left', width: w }} onClick={() => onSort(k)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
        {label}{active && <Icon name="chevD" size={11} style={{ transform: sortDir === 'asc' ? 'none' : 'rotate(180deg)' }} />}
      </span>
    </th>
  );
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="dmh-select">
      <select className="rd-input" style={{ padding: '7px 28px 7px 11px', fontSize: 12.5, width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
      </select>
      <Icon name="chevD" size={13} className="chev" />
    </div>
  );
}

type Tab = 'overview' | 'tables' | 'views' | 'columns' | 'metadata';
type Selection = { kind: 'table'; row: CatalogRow } | { kind: 'view'; row: CatalogRow; view: ViewRow } | null;

export default function ModelCenterPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [q, setQ] = useState('');
  const [engine, setEngine] = useState('all');
  const [domain, setDomain] = useState('all');
  const [layerF, setLayerF] = useState('all');
  const [flag, setFlag] = useState<'none' | 'nopk' | 'nodomain' | 'noview'>('none');
  const [sel, setSel] = useState<Selection>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const projects = await projectsService.listProjects();
        const canvases = await Promise.all(
          projects.map((p) => canvasService.getCanvas(p.id).catch(() => ({ tables: [], relationships: [] }))),
        );
        setCatalog(projects.flatMap((p, i) => buildCatalog(p, canvases[i].tables ?? [])));
      } catch (e) {
        console.error('Failed to build catalog', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => ({
    projects: new Set(catalog.map((t) => t.projectId)).size,
    models: new Set(catalog.map((t) => t.projectId + '·' + t.layerId)).size,
    tables: catalog.length,
    views: catalog.reduce((a, t) => a + t.views.length, 0),
    columns: catalog.reduce((a, t) => a + t.columns.length, 0),
  }), [catalog]);

  const byEngine = useMemo(() => {
    const m = new Map<string, number>();
    catalog.forEach((t) => { if (t.engine) m.set(t.engine, (m.get(t.engine) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalog]);
  const byDomain = useMemo(() => {
    const m = new Map<string, { n: number; color: string }>();
    catalog.forEach((t) => {
      const key = t.domainName || 'Sin dominio';
      const cur = m.get(key) ?? { n: 0, color: t.domainColor };
      m.set(key, { n: cur.n + 1, color: t.domainColor });
    });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [catalog]);
  const gov = useMemo(() => ({
    nopk: catalog.filter((t) => !t.columns.some((c) => c.key === 'PK')).length,
    nodomain: catalog.filter((t) => !t.domainId).length,
    noview: catalog.filter((t) => t.views.length === 0).length,
    pii: catalog.reduce((a, t) => a + t.columns.filter((c) => PII.test(c.name)).length, 0),
  }), [catalog]);

  const ql = q.toLowerCase().trim();
  const matchEng = (t: CatalogRow) => engine === 'all' || t.engine === engine;
  const matchDom = (t: CatalogRow) => domain === 'all' || t.domainName === domain;
  const matchLayer = (t: CatalogRow) => layerF === 'all' || t.model === layerF;
  const matchFlag = (t: CatalogRow) =>
    flag === 'none' ||
    (flag === 'nopk' && !t.columns.some((c) => c.key === 'PK')) ||
    (flag === 'nodomain' && !t.domainId) ||
    (flag === 'noview' && t.views.length === 0);

  const tableRows = useMemo(() => catalog.filter((t) =>
    matchEng(t) && matchDom(t) && matchLayer(t) && matchFlag(t) &&
    (!ql || t.table.toLowerCase().includes(ql) || t.schema.toLowerCase().includes(ql) || t.project.toLowerCase().includes(ql))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [catalog, ql, engine, domain, layerF, flag]);
  const viewRows = useMemo(() => {
    const r: { v: ViewRow; t: CatalogRow }[] = [];
    catalog.forEach((t) => t.views.forEach((v) => {
      if (matchEng(t) && (!ql || v.name.toLowerCase().includes(ql) || v.role.toLowerCase().includes(ql) || t.table.toLowerCase().includes(ql))) r.push({ v, t });
    }));
    return r;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, ql, engine]);
  const colRows = useMemo(() => {
    const r: { c: ColRow; t: CatalogRow }[] = [];
    catalog.forEach((t) => t.columns.forEach((c) => {
      if (matchEng(t) && (!ql || c.name.toLowerCase().includes(ql) || t.table.toLowerCase().includes(ql))) r.push({ c, t });
    }));
    return r;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, ql, engine]);

  const tSort = useSort('table'); const vSort = useSort('name'); const cSort = useSort('name');
  const tRows = tSort.sortBy(tableRows, (t, k) => (({ table: `${t.schema}.${t.table}`, project: t.project, layer: t.model, engine: t.engine ?? '', domain: t.domainName, owner: t.owner, columns: t.columns.length, views: t.views.length, fks: t.fkCount } as Record<string, string | number>)[k] ?? ''));
  const vRows = vSort.sortBy(viewRows, (r, k) => (({ name: r.v.name, table: r.t.table, project: r.t.project, type: r.v.type, role: r.v.role } as Record<string, string>)[k] ?? ''));
  const cRows = cSort.sortBy(colRows, (r, k) => (({ name: r.c.name, dataType: r.c.dataType, key: r.c.key, def: r.c.def, table: r.t.table, project: r.t.project } as Record<string, string>)[k] ?? ''));

  const goTables = (f: typeof flag) => { setFlag(f); setQ(''); setTab('tables'); };
  const engOpts: [string, string][] = [['all', 'Todos los engines'], ...byEngine.map(([e]) => [e, getEngine(e as DatabaseEngine)?.shortLabel ?? e] as [string, string])];
  const domOpts: [string, string][] = [['all', 'Todos los dominios'], ...[...new Set(catalog.map((t) => t.domainName).filter(Boolean))].map((d) => [d, d] as [string, string])];
  const layerOpts: [string, string][] = [['all', 'Todos los modelos'], ...[...new Set(catalog.map((t) => t.model).filter((m) => m !== '—'))].map((l) => [l, l] as [string, string])];

  const rowCount = tab === 'tables' ? tRows.length : tab === 'views' ? vRows.length : cRows.length;

  return (
    <AppLayout>
      <div className="dmh-main">
        <Header crumbs={[{ label: 'Model Center' }]} />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div className="dmh-page" style={{ flex: 1 }}>
            <div className="mc-top">
              <div className="mc-top-titles">
                <div className="rd-h1">Model Center</div>
                <div className="rd-small">Un catálogo único de todos los proyectos — busca tablas, vistas y columnas, y vigila la salud del modelo</div>
              </div>
              <div className="rd-seg">
                {(['overview', 'tables', 'views', 'columns', 'metadata'] as Tab[]).map((k) => (
                  <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                    {{ overview: 'Overview', tables: 'Tables', views: 'Views', columns: 'Columns', metadata: 'Metadata' }[k]}
                  </button>
                ))}
              </div>
            </div>
            {tab === 'metadata' ? (
              <MetadataAdmin pushToast={pushToast} />
            ) : loading ? (
              <div className="rd-small">Cargando catálogo…</div>
            ) : tab === 'overview' ? (
              <>
                <div className="dash-stats">
                  {([['folder', stats.projects, 'Projects', 'Activos en el workspace'], ['layers', stats.models, 'Data Models', 'Niveles de modelado'], ['database', stats.tables, 'Tables', 'Catalogadas con éxito'], ['eye', stats.views, 'Views', 'Expuestas al negocio'], ['columns', stats.columns, 'Columns', 'Metadatos parseados']] as [IconName, number, string, string][]).map(([ic, v, l, cap]) => (
                    <div className="dash-stat" key={l}>
                      <div className="dash-stat-top">
                        <span className="dash-stat-lbl">{l}</span>
                        <Icon name={ic} size={16} className="dash-stat-ico" />
                      </div>
                      <div className="dash-stat-val">{v}</div>
                      <div className="dash-stat-cap">{cap}</div>
                    </div>
                  ))}
                </div>
                <div className="mc-panels">
                  <div className="rd-card mc-panel">
                    <div className="mc-cardhead">
                      <span className="mc-cardlbl"><Icon name="database" size={13} />Tablas por engine</span>
                      <span className="mc-pill">{byEngine.length} {byEngine.length === 1 ? 'motor' : 'motores'}</span>
                    </div>
                    {byEngine.map(([e, n]) => {
                      const def = getEngine(e as DatabaseEngine);
                      const pct = Math.round((n / Math.max(stats.tables, 1)) * 100);
                      return (
                        <div className="mc-bar" key={e}>
                          <span className="mc-bar-lbl"><span style={{ width: 8, height: 8, borderRadius: '50%', background: def?.color }} />{def?.shortLabel ?? e}</span>
                          <div className="mc-bar-track"><div className="mc-bar-fill" style={{ width: `${pct}%`, background: def?.color }} /></div>
                          <span className="mc-bar-num">{n} <span className="mc-bar-pct">{pct}%</span></span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="rd-card mc-panel">
                    <div className="mc-cardhead">
                      <span className="mc-cardlbl"><Icon name="folder" size={13} />Tablas por dominio</span>
                      <span className="mc-pill">{byDomain.length} {byDomain.length === 1 ? 'dominio' : 'dominios'}</span>
                    </div>
                    {byDomain.map(([d, { n, color }]) => {
                      const pct = Math.round((n / Math.max(stats.tables, 1)) * 100);
                      return (
                        <div className="mc-bar" key={d}>
                          <span className="mc-bar-lbl"><span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />{d}</span>
                          <div className="mc-bar-track"><div className="mc-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                          <span className="mc-bar-num">{n} <span className="mc-bar-pct">{pct}%</span></span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rd-card mc-panel">
                  <div className="mc-cardhead">
                    <span className="mc-cardlbl"><Icon name="shield" size={13} />Salud y gobierno del modelo</span>
                  </div>
                  <div className="mc-gov-grid">
                    {([
                      [gov.nopk, 'Tablas sin clave primaria', 'Afecta el rendimiento de queries.', 'medium', () => goTables('nopk')],
                      [gov.nodomain, 'Tablas sin dominio asignado', 'Dificulta el catalogado del modelo.', 'medium', () => goTables('nodomain')],
                      [gov.noview, 'Tablas sin ninguna vista', 'Bajo consumo interno actual.', 'info', () => goTables('noview')],
                      [gov.pii, 'Columnas sensibles (PII)', 'Requiere enmascaramiento.', 'critical', () => { setTab('columns'); setQ('email'); }],
                    ] as [number, string, string, 'medium' | 'info' | 'critical', () => void][]).map(([n, title, cap, sev, on]) => (
                      <button className="mc-gov" key={title} onClick={on}>
                        <div className="mc-gov-top">
                          <span className="mc-gov-v" style={{ color: n ? GOV_SEV_COLOR[sev] : 'var(--success)' }}>{n}</span>
                          <span className={`mc-gov-sev sev-${sev}`}>{sev}</span>
                        </div>
                        <div className="mc-gov-t">{title}</div>
                        <div className="mc-gov-cap">{cap}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <div className="rd-search" style={{ flex: 1, minWidth: 240 }}>
                    <Icon name="search" size={15} />
                    <input className="rd-input" placeholder={`Buscar ${tab}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                  </div>
                  <FilterSelect value={engine} onChange={setEngine} options={engOpts} />
                  {tab === 'tables' && <FilterSelect value={layerF} onChange={setLayerF} options={layerOpts} />}
                  {tab === 'tables' && <FilterSelect value={domain} onChange={setDomain} options={domOpts} />}
                  {tab === 'tables' && flag !== 'none' && <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={() => setFlag('none')}><Icon name="x" size={13} />Quitar filtro</button>}
                  <span className="rd-small" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{rowCount} filas</span>
                </div>

                {tab === 'tables' && (
                  <div className="mc-gridwrap">
                    <table className="mc-grid">
                      <thead><tr>
                        <Th label="Tabla" k="table" {...tSort} />
                        <Th label="Proyecto · Modelo" k="project" {...tSort} />
                        <Th label="Modelo" k="layer" {...tSort} w={86} />
                        <Th label="Engine" k="engine" {...tSort} w={116} />
                        <Th label="Dominio" k="domain" {...tSort} w={130} />
                        <Th label="Owner" k="owner" {...tSort} w={110} />
                        <Th label="Cols" k="columns" {...tSort} align="right" w={56} />
                        <Th label="Vistas" k="views" {...tSort} align="right" w={64} />
                        <Th label="FKs" k="fks" {...tSort} align="right" w={50} />
                      </tr></thead>
                      <tbody>
                        {tRows.map((t, i) => (
                          <tr key={i} className={sel?.kind === 'table' && sel.row === t ? 'active' : ''} onClick={() => setSel({ kind: 'table', row: t })}>
                            <td><span className="mc-name"><span className="mc-tico"><Icon name="table" size={12} /></span>{t.schema}.{t.table}{t.tags.length > 0 && <span className="mc-tagdot" title={t.tags.map(formatTag).join(' · ')}><Icon name="tag" size={9} />{t.tags.length}</span>}</span></td>
                            <td className="mc-dim">{t.project} · {t.model}</td>
                            <td>{t.layerId ? <span className="rd-badge" style={{ background: t.layerColor + '1a', color: t.layerColor }}>{t.model}</span> : <span className="mc-dim">—</span>}</td>
                            <td><span className="rd-engine" style={{ padding: '2px 8px 2px 6px' }}><span className="dot" style={{ background: getEngine(t.engine)?.color }} />{getEngine(t.engine)?.shortLabel ?? '—'}</span></td>
                            <td>{t.domainId ? <span className="rd-badge" style={{ background: t.domainColor + '1a', color: t.domainColor }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: t.domainColor }} />{t.domainName}</span> : <span className="mc-dim">—</span>}</td>
                            <td className="mc-dim">{t.owner || '—'}</td>
                            <td className="mc-num">{t.columns.length}</td>
                            <td className="mc-num">{t.views.length || '—'}</td>
                            <td className="mc-num">{t.fkCount || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {tRows.length === 0 && <div className="dmh-empty" style={{ padding: 40 }}>Ninguna tabla coincide con los filtros.</div>}
                  </div>
                )}

                {tab === 'views' && (
                  <div className="mc-gridwrap">
                    <table className="mc-grid">
                      <thead><tr>
                        <Th label="Vista" k="name" {...vSort} />
                        <Th label="Sobre la tabla" k="table" {...vSort} />
                        <Th label="Proyecto" k="project" {...vSort} w={150} />
                        <Th label="Tipo" k="type" {...vSort} w={110} />
                        <Th label="Rol" k="role" {...vSort} w={150} />
                      </tr></thead>
                      <tbody>
                        {vRows.map((r, i) => (
                          <tr key={i} className={sel?.kind === 'view' && sel.view === r.v ? 'active' : ''} onClick={() => setSel({ kind: 'view', row: r.t, view: r.v })}>
                            <td><span className="mc-name"><span className="mc-tico" style={{ background: 'var(--flow-soft)', color: 'var(--flow-700)' }}><Icon name="eye" size={12} /></span><span className="rd-mono" style={{ fontSize: 12.5 }}>{r.v.name}</span></span></td>
                            <td className="mc-dim">{r.t.schema}.{r.t.table}</td>
                            <td className="mc-dim">{r.t.project}</td>
                            <td><span className={`rd-badge ${r.v.type === 'business' ? 'rd-badge-primary' : 'rd-badge-flow'}`}>{r.v.type}</span></td>
                            <td className="mc-dim">{r.v.role}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {vRows.length === 0 && <div className="dmh-empty" style={{ padding: 40 }}>Ninguna vista coincide con la búsqueda.</div>}
                  </div>
                )}

                {tab === 'columns' && (
                  <div className="mc-gridwrap">
                    <table className="mc-grid">
                      <thead><tr>
                        <Th label="Columna" k="name" {...cSort} />
                        <Th label="Tipo" k="dataType" {...cSort} w={130} />
                        <Th label="Clave" k="key" {...cSort} w={64} />
                        <Th label="Definición · tags" k="def" {...cSort} />
                        <Th label="Tabla" k="table" {...cSort} w={170} />
                        <Th label="Proyecto" k="project" {...cSort} w={140} />
                      </tr></thead>
                      <tbody>
                        {cRows.slice(0, 400).map((r, i) => (
                          <tr key={i} onClick={() => setSel({ kind: 'table', row: r.t })}>
                            <td><span className="mc-name" style={{ fontWeight: 600 }}>{PII.test(r.c.name) && <span title="Sensible (PII)" style={{ color: 'var(--error)', display: 'inline-flex' }}><Icon name="key" size={12} /></span>}{r.c.name}</span></td>
                            <td><span className="rd-mono mc-dim" style={{ fontSize: 11.5 }}>{r.c.dataType}</span></td>
                            <td>{r.c.key ? <span className={`rd-key ${r.c.key.toLowerCase()}`}>{r.c.key}</span> : <span className="mc-dim">—</span>}</td>
                            <td>
                              <span className="mc-coldef" title={r.c.def || undefined}>{r.c.def || <span className="mc-dim">—</span>}</span>
                              {r.c.tags.length > 0 && <span className="mc-tagdot" title={r.c.tags.map(formatTag).join(' · ')}><Icon name="tag" size={9} />{r.c.tags.length}</span>}
                            </td>
                            <td className="mc-dim">{r.t.schema}.{r.t.table}</td>
                            <td className="mc-dim">{r.t.project}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {cRows.length === 0 && <div className="dmh-empty" style={{ padding: 40 }}>Ninguna columna coincide con la búsqueda.</div>}
                  </div>
                )}
              </>
            )}
          </div>

          {sel && (
            <div className="ed-inspector">
              <div className="ins-head">
                <span className="ins-ico" style={{ background: sel.kind === 'view' ? 'var(--flow-soft)' : 'var(--primary-soft)', color: sel.kind === 'view' ? 'var(--flow-700)' : 'var(--primary-700)' }}>
                  <Icon name={sel.kind === 'view' ? 'eye' : 'table'} size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel.kind === 'view' ? sel.view.name : `${sel.row.schema}.${sel.row.table}`}</div>
                  <div className="rd-small">{sel.row.project} · {sel.row.model}</div>
                </div>
                <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setSel(null)}><Icon name="x" size={15} /></button>
              </div>
              <div style={{ padding: '0 14px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className="rd-engine" style={{ padding: '2px 8px 2px 6px' }}><span className="dot" style={{ background: getEngine(sel.row.engine)?.color }} />{getEngine(sel.row.engine)?.shortLabel ?? '—'}</span>
                {sel.row.domainId && <span className="rd-badge" style={{ background: sel.row.domainColor + '1a', color: sel.row.domainColor }}>{sel.row.domainName}</span>}
                {sel.kind === 'view' && <span className={`rd-badge ${sel.view.type === 'business' ? 'rd-badge-primary' : 'rd-badge-flow'}`}>{sel.view.type} · {sel.view.role}</span>}
              </div>
              <div className="ins-body">
                {sel.kind === 'table' ? (
                  <>
                    <div className="ins-grouplbl" style={{ marginBottom: 8 }}><Icon name="columns" size={12} />Columnas · {sel.row.columns.length}</div>
                    {sel.row.columns.map((c, i) => (
                      <div className="ins-col" key={i} style={{ alignItems: (c.def || c.tags.length) ? 'flex-start' : undefined }}>
                        {c.key ? <span className={`rd-key ${c.key.toLowerCase()}`}>{c.key}</span> : <span className="rd-key none"><span className="d" /></span>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: 12.5 }}>{c.name}</span>
                          {c.def && <div className="rd-small" style={{ lineHeight: 1.4, marginTop: 2 }}>{c.def}</div>}
                          {c.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{c.tags.map((t) => <span key={tagId(t)} className="rd-badge rd-badge-neutral" style={{ fontSize: 9.5 }}>{formatTag(t)}</span>)}</div>}
                        </div>
                        <span className="rd-mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{c.dataType}</span>
                      </div>
                    ))}
                    {sel.row.views.length > 0 && (
                      <>
                        <div className="ins-grouplbl" style={{ margin: '16px 0 8px' }}><Icon name="eye" size={12} />Vistas · {sel.row.views.length}</div>
                        {sel.row.views.map((v, i) => (
                          <div key={i} className="iv-card" style={{ cursor: 'pointer' }} onClick={() => setSel({ kind: 'view', row: sel.row, view: v })}>
                            <span className="rd-mono" style={{ fontSize: 12, fontWeight: 600 }}>{v.name}</span>
                            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}><span className={`rd-badge ${v.type === 'business' ? 'rd-badge-primary' : 'rd-badge-flow'}`}>{v.type}</span><span className="rd-badge rd-badge-neutral"><Icon name="users" size={10} />{v.role}</span></div>
                          </div>
                        ))}
                      </>
                    )}
                    {sel.row.tags.length > 0 && (
                      <>
                        <div className="ins-grouplbl" style={{ margin: '16px 0 8px' }}><Icon name="tag" size={12} />Etiquetas · {sel.row.tags.length}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{sel.row.tags.map((t) => <span key={tagId(t)} className="rd-badge rd-badge-neutral"><Icon name="tag" size={9} />{formatTag(t)}</span>)}</div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="rd-small" style={{ lineHeight: 1.6 }}>Vista {sel.view.type} para el rol <b style={{ color: 'var(--ink)' }}>{sel.view.role}</b>, proyectada desde <b style={{ color: 'var(--ink)' }}>{sel.row.schema}.{sel.row.table}</b>. Abre el proyecto para editar su SQL.</div>
                )}
                <button className="rd-btn rd-btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={() => router.push(`/projects/${sel.row.projectId}`)}><Icon name="share" size={14} />Abrir proyecto</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </AppLayout>
  );
}
