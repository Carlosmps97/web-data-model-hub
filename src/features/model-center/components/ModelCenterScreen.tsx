'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import { MetadataAdmin } from '@/features/metadata';
import { getEngine } from '@/features/engines';
import type { DatabaseEngine } from '@/types/model';
import { useCatalog } from '../hooks/useCatalog';
import { useSort } from '../hooks/useSort';
import { PII } from '../lib/catalog';
import type { CatalogRow, ColRow, ViewRow, Tab, Selection } from '../lib/catalog';
import OverviewTab from './OverviewTab';
import FilterBar from './FilterBar';
import TablesGrid from './TablesGrid';
import ViewsGrid from './ViewsGrid';
import ColumnsGrid from './ColumnsGrid';
import CatalogInspector from './CatalogInspector';

const pushToast = (msg: string, kind?: 'err') => (kind === 'err' ? toast.error(msg) : toast.success(msg));

/**
 * Model Center — a single cross-project catalog of every table, view and
 * column, plus model-health governance. Orchestrates the data (useCatalog),
 * filtering/sorting, and the tab grids / overview / inspector.
 */
export default function ModelCenterScreen() {
  const router = useRouter();
  const { catalog, loading } = useCatalog();
  const [tab, setTab] = useState<Tab>('overview');
  const [q, setQ] = useState('');
  const [engine, setEngine] = useState('all');
  const [domain, setDomain] = useState('all');
  const [layerF, setLayerF] = useState('all');
  const [flag, setFlag] = useState<'none' | 'nopk' | 'nodomain' | 'noview'>('none');
  const [sel, setSel] = useState<Selection>(null);

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
              <OverviewTab stats={stats} byEngine={byEngine} byDomain={byDomain} gov={gov} onFlagNav={goTables} onPIINav={() => { setTab('columns'); setQ('email'); }} />
            ) : (
              <>
                <FilterBar
                  tab={tab} q={q} setQ={setQ}
                  engine={engine} setEngine={setEngine} engOpts={engOpts}
                  layerF={layerF} setLayerF={setLayerF} layerOpts={layerOpts}
                  domain={domain} setDomain={setDomain} domOpts={domOpts}
                  flag={flag} setFlag={setFlag} rowCount={rowCount}
                />
                {tab === 'tables' && <TablesGrid rows={tRows} sort={tSort} sel={sel} onSelect={setSel} />}
                {tab === 'views' && <ViewsGrid rows={vRows} sort={vSort} sel={sel} onSelect={setSel} />}
                {tab === 'columns' && <ColumnsGrid rows={cRows} sort={cSort} onSelect={setSel} />}
              </>
            )}
          </div>

          {sel && (
            <CatalogInspector
              sel={sel}
              onSelect={setSel}
              onClose={() => setSel(null)}
              onOpenProject={(projectId) => router.push(`/projects/${projectId}`)}
            />
          )}
        </div>
      </div>
      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </AppLayout>
  );
}
