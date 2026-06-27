/**
 * ReportingScreen (pr — Screen 11) — tabular reporting of metadata.
 *
 * Layout (per design #pr + R6c spec):
 *   · header: REPORTING eyebrow + "Reporting" h1 + blurb
 *   · filter bar: table-name search + multi-select comboboxes
 *     (Schema · Project · Subject area) that filter the grid live, plus Clear
 *   · metadata table: Table · Schema · Subject area · #Columns · #Relations ·
 *     Projects · Functional definition — zebra rows, hover, sticky header
 *   · right rail: "Export to Excel" checklist of detail levels → xlsx workbook
 *     (one sheet per checked level), then small KPI indicators
 *
 * Data: reporting.service (tables + columns) + projects.service (project filter
 * options). Search + chips filter the loaded rows client-side; Schema/Project
 * filters also re-query the backend so server-side narrowing stays authoritative.
 * Loading → skeleton/placeholders; errors → sonner toast.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import {
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Filter,
  Layers,
  Search,
  TableProperties,
} from 'lucide-react';

import { Button } from '@/components/ui';
import { listProjects } from '@/services/projects.service';
import {
  listReportColumns,
  listReportTables,
  type ReportColumnRow,
  type ReportTableRow,
} from '@/services/reporting.service';

// ── export levels ─────────────────────────────────────────────────────────────

type LevelKey = 'tables' | 'columns' | 'relationships' | 'definitions';

interface LevelSpec {
  key: LevelKey;
  name: string;
  hint: string;
  sheet: string;
}

const EXPORT_LEVELS: LevelSpec[] = [
  { key: 'tables', name: 'Tables overview', hint: 'One row per table: schema, counts, subject areas, projects.', sheet: 'Tables' },
  { key: 'columns', name: 'Columns detail', hint: 'Every field: type, PK/FK, nullable, partition, parent domain.', sheet: 'Columns' },
  { key: 'relationships', name: 'Relationships', hint: 'Relationship totals per table.', sheet: 'Relationships' },
  { key: 'definitions', name: 'Definitions', hint: 'Functional definition text per table.', sheet: 'Definitions' },
];

// ── multi-select filter popover ───────────────────────────────────────────────

interface MultiFilterProps {
  label: string;
  icon: typeof Filter;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}

function MultiFilter({ label, icon: Icon, options, selected, onToggle }: MultiFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = selected.size;
  return (
    <div className="dmh-rep-filter" ref={ref}>
      <button
        type="button"
        className={`dmh-rep-filter-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon className="ico" strokeWidth={1.6} aria-hidden />
        <span>{label}</span>
        {count > 0 && <span className="dmh-rep-filter-count">{count}</span>}
        <ChevronDown className="chev" strokeWidth={1.7} aria-hidden />
      </button>
      {open && (
        <div className="dmh-rep-menu" role="listbox">
          {options.length === 0 ? (
            <div className="dmh-rep-menu-empty">No options</div>
          ) : (
            options.map((opt) => {
              const on = selected.has(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`dmh-rep-opt${on ? ' is-on' : ''}`}
                  onClick={() => onToggle(opt)}
                >
                  <span className="dmh-rep-opt-box">{on && <Check strokeWidth={3} aria-hidden />}</span>
                  <span className="dmh-rep-opt-label">{opt}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

export default function ReportingScreen() {
  const [tables, setTables] = useState<ReportTableRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>([]);

  const [search, setSearch] = useState('');
  const [schemaSel, setSchemaSel] = useState<Set<string>>(new Set());
  const [projectSel, setProjectSel] = useState<Set<string>>(new Set());
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());

  const [levels, setLevels] = useState<Set<LevelKey>>(new Set<LevelKey>(['tables', 'columns']));
  const [exporting, setExporting] = useState(false);

  // Project filter options load once.
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((projs) => {
        if (!cancelled) setProjectOptions(projs.map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {
        /* the table still works without project options; stay quiet */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tables re-query when the Schema / Project filters change (server-side narrowing).
  // Schema/Project are single-value on the wire, so we only push a query param when
  // exactly one is picked; otherwise we fetch the full set and filter client-side.
  const schemaParam = schemaSel.size === 1 ? [...schemaSel][0] : undefined;
  const projectParam = useMemo(() => {
    if (projectSel.size !== 1) return undefined;
    const name = [...projectSel][0];
    return projectOptions.find((p) => p.name === name)?.id;
  }, [projectSel, projectOptions]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listReportTables({ schema: schemaParam, projectId: projectParam })
      .then((rows) => {
        if (!cancelled) setTables(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : 'Could not load the reporting tables.');
        setTables([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schemaParam, projectParam]);

  // Filter option lists derive from the loaded rows (schema, projects, subject areas).
  const schemaOptions = useMemo(
    () => [...new Set(tables.map((t) => t.schema).filter(Boolean))].sort(),
    [tables],
  );
  const areaOptions = useMemo(
    () => [...new Set(tables.flatMap((t) => t.subjectAreas).filter(Boolean))].sort(),
    [tables],
  );

  // Live client-side filtering on top of whatever the server returned.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter((t) => {
      if (q && !t.physicalName.toLowerCase().includes(q) && !t.logicalName.toLowerCase().includes(q)) {
        return false;
      }
      if (schemaSel.size > 0 && !schemaSel.has(t.schema)) return false;
      if (projectSel.size > 0 && !t.projects.some((p) => projectSel.has(p))) return false;
      if (areaSel.size > 0 && !t.subjectAreas.some((a) => areaSel.has(a))) return false;
      return true;
    });
  }, [tables, search, schemaSel, projectSel, areaSel]);

  // KPI indicators derive from the (filtered) rows.
  const kpis = useMemo(() => {
    const projects = new Set<string>();
    let columns = 0;
    let relationships = 0;
    filtered.forEach((t) => {
      columns += t.columnCount;
      relationships += t.relationshipCount;
      t.projects.forEach((p) => projects.add(p));
    });
    return { tables: filtered.length, columns, relationships, projects: projects.size };
  }, [filtered]);

  const anyFilter =
    search.trim() !== '' || schemaSel.size > 0 || projectSel.size > 0 || areaSel.size > 0;

  const clearFilters = () => {
    setSearch('');
    setSchemaSel(new Set());
    setProjectSel(new Set());
    setAreaSel(new Set());
  };

  const toggleSet = <T,>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const toggleLevel = (key: LevelKey) => toggleSet<LevelKey>(setLevels, key);

  // ── Excel export: one sheet per checked level ────────────────────────────────
  const handleExport = async () => {
    if (levels.size === 0) {
      toast.error('Pick at least one detail level to export.');
      return;
    }
    setExporting(true);
    try {
      const rows = filtered;
      const wb = XLSX.utils.book_new();

      if (levels.has('tables')) {
        const data = rows.map((t) => ({
          Table: t.physicalName,
          'Logical name': t.logicalName,
          Schema: t.schema,
          'Subject areas': t.subjectAreas.join(', '),
          '#Columns': t.columnCount,
          '#Relations': t.relationshipCount,
          Projects: t.projects.join(', '),
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Tables');
      }

      if (levels.has('columns')) {
        // Pull every column once, then keep only those for the tables in view.
        const allCols: ReportColumnRow[] = await listReportColumns();
        const visibleIds = new Set(rows.map((t) => t.id));
        const nameById = new Map(rows.map((t) => [t.id, t.physicalName] as const));
        const data = allCols
          .filter((c) => visibleIds.size === 0 || visibleIds.has(c.tableId))
          .sort((a, b) => a.tableId.localeCompare(b.tableId) || a.ordinal - b.ordinal)
          .map((c) => ({
            Table: nameById.get(c.tableId) ?? c.tableId,
            Column: c.physicalName,
            'Logical name': c.logicalName,
            'Data type': c.dataType,
            'Parent domain': c.parentDomain ?? '',
            PK: c.isPrimaryKey ? 'Y' : '',
            FK: c.isForeignKey ? 'Y' : '',
            Nullable: c.isNullable ? 'Y' : 'N',
            Partition: c.isPartition ? 'Y' : '',
            Definition: c.description,
          }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Columns');
      }

      if (levels.has('relationships')) {
        const data = rows
          .filter((t) => t.relationshipCount > 0)
          .map((t) => ({
            Table: t.physicalName,
            Schema: t.schema,
            '#Relations': t.relationshipCount,
          }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Relationships');
      }

      if (levels.has('definitions')) {
        const data = rows.map((t) => ({
          Table: t.physicalName,
          'Logical name': t.logicalName,
          'Functional definition': t.description,
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Definitions');
      }

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `data-model-hub-report-${stamp}.xlsx`);
      toast.success('Report exported to Excel.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not build the Excel file.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dmh-rep">
      <div className="dmh-rep-inner">
        {/* ── header ───────────────────────────────────────────────── */}
        <div className="dmh-rep-head">
          <div className="dmh-rep-eyebrow">Reporting</div>
          <h1 className="dmh-rep-h1">Reporting</h1>
          <p className="dmh-rep-sub">
            Tabular view of your model metadata — tables, columns, relationships and projects.
            Filter the grid, then export the detail levels you need to Excel.
          </p>
        </div>

        <div className="dmh-rep-cols">
          {/* ── left: filters + table ──────────────────────────────── */}
          <div className="dmh-rep-main">
            <div className="dmh-rep-bar">
              <div className="dmh-rep-search">
                <Search strokeWidth={1.7} aria-hidden />
                <input
                  type="text"
                  placeholder="Search tables by name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search tables by name"
                />
              </div>
              <MultiFilter
                label="Schema"
                icon={TableProperties}
                options={schemaOptions}
                selected={schemaSel}
                onToggle={(v) => toggleSet<string>(setSchemaSel, v)}
              />
              <MultiFilter
                label="Project"
                icon={Filter}
                options={projectOptions.map((p) => p.name)}
                selected={projectSel}
                onToggle={(v) => toggleSet<string>(setProjectSel, v)}
              />
              <MultiFilter
                label="Subject area"
                icon={Layers}
                options={areaOptions}
                selected={areaSel}
                onToggle={(v) => toggleSet<string>(setAreaSel, v)}
              />
              {anyFilter && (
                <button type="button" className="dmh-rep-clear" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>

            <div className="dmh-rep-tablewrap">
              <div className="dmh-rep-tablescroll">
                <table className="dmh-rep-table">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Schema</th>
                      <th>Subject area</th>
                      <th className="num">#Columns</th>
                      <th className="num">#Relations</th>
                      <th>Projects</th>
                      <th>Functional definition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="dmh-rep-skel">
                          <td colSpan={7} className="dmh-rep-skel-row" />
                        </tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="dmh-rep-state">
                            <div className="dmh-rep-state-ico">
                              <TableProperties size={26} strokeWidth={1.3} aria-hidden />
                            </div>
                            <div className="dmh-rep-state-t">
                              {anyFilter ? 'No tables match your filters' : 'No tables to report yet'}
                            </div>
                            <div className="dmh-rep-state-m">
                              {anyFilter
                                ? 'Try clearing the search or a filter.'
                                : 'Once your model has tables, they will show up here.'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filtered.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <div className="dmh-rep-tname">
                              <span className="dmh-rep-tname-phys">{t.physicalName}</span>
                              {t.logicalName && t.logicalName !== t.physicalName && (
                                <span className="dmh-rep-tname-log">{t.logicalName}</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="dmh-rep-schema">{t.schema || '—'}</span>
                          </td>
                          <td>
                            {t.subjectAreas.length === 0 ? (
                              <span className="dmh-rep-chip-none">—</span>
                            ) : (
                              <div className="dmh-rep-chips">
                                {t.subjectAreas.map((a) => (
                                  <span key={a} className="dmh-rep-chip dmh-rep-chip--sa">
                                    {a}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="num">{t.columnCount}</td>
                          <td className="num">{t.relationshipCount}</td>
                          <td>
                            {t.projects.length === 0 ? (
                              <span className="dmh-rep-chip-none">—</span>
                            ) : (
                              <div className="dmh-rep-chips">
                                {t.projects.map((p) => (
                                  <span key={p} className="dmh-rep-chip dmh-rep-chip--proj">
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className={`dmh-rep-def${t.description ? '' : ' is-empty'}`}>
                              {t.description || 'No definition'}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── right: export rail + KPIs ──────────────────────────── */}
          <div className="dmh-rep-rail">
            <div className="dmh-rep-card">
              <div className="dmh-rep-card-head">
                <span className="dmh-rep-card-ico">
                  <FileSpreadsheet size={17} strokeWidth={1.6} aria-hidden />
                </span>
                <span className="dmh-rep-card-title">Export to Excel</span>
              </div>
              <div className="dmh-rep-card-desc">
                Choose the detail levels to include — each becomes a sheet in the workbook.
                Exports respect the filters above.
              </div>
              <div className="dmh-rep-levels">
                {EXPORT_LEVELS.map((lvl) => {
                  const on = levels.has(lvl.key);
                  return (
                    <button
                      key={lvl.key}
                      type="button"
                      className={`dmh-rep-level${on ? ' is-on' : ''}`}
                      onClick={() => toggleLevel(lvl.key)}
                      aria-pressed={on}
                    >
                      <span className="dmh-rep-level-box">{on && <Check strokeWidth={3} aria-hidden />}</span>
                      <span className="dmh-rep-level-text">
                        <span className="dmh-rep-level-name">{lvl.name}</span>
                        <span className="dmh-rep-level-hint">{lvl.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="dmh-rep-card-foot">
                <Button
                  variant="success"
                  icon={Download}
                  className="dmh-rep-export-btn"
                  onClick={handleExport}
                  disabled={exporting || levels.size === 0 || loading}
                >
                  {exporting ? 'Exporting…' : 'Export .xlsx'}
                </Button>
                <div className="dmh-rep-export-note">
                  {levels.size} level{levels.size === 1 ? '' : 's'} · {filtered.length} table
                  {filtered.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="dmh-rep-kpis">
              {[
                { label: 'Tables', value: kpis.tables },
                { label: 'Columns', value: kpis.columns },
                { label: 'Relations', value: kpis.relationships },
                { label: 'Projects', value: kpis.projects },
              ].map((kpi) => (
                <div key={kpi.label} className="dmh-rep-kpi">
                  <div className="dmh-rep-kpi-label">{kpi.label}</div>
                  {loading ? (
                    <div className="dmh-rep-kpi-value is-loading" aria-hidden />
                  ) : (
                    <div className="dmh-rep-kpi-value">{kpi.value}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
