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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  const [search, setSearch] = useState('');
  const [schemaSel, setSchemaSel] = useState<Set<string>>(new Set());
  const [projectSel, setProjectSel] = useState<Set<string>>(new Set());
  const [areaSel, setAreaSel] = useState<Set<string>>(new Set());

  const [levels, setLevels] = useState<Set<LevelKey>>(new Set<LevelKey>(['tables', 'columns']));
  const [exporting, setExporting] = useState(false);

  // Lazy load: only the first 50 tables up-front; the full set loads the moment
  // a filter is applied (so faceting/filtering stays accurate over everything).
  const [fullLoad, setFullLoad] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listReportTables(fullLoad ? {} : { limit: 50 })
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
  }, [fullLoad]);

  // Per-facet predicates. Building a facet's options excludes its OWN selection,
  // so the filters narrow each other (cumulative / faceted).
  const passSearch = useCallback(
    (t: ReportTableRow) => {
      const q = search.trim().toLowerCase();
      return !q || t.physicalName.toLowerCase().includes(q) || t.logicalName.toLowerCase().includes(q);
    },
    [search],
  );
  const passSchema = useCallback(
    (t: ReportTableRow) => schemaSel.size === 0 || schemaSel.has(t.schema),
    [schemaSel],
  );
  const passProject = useCallback(
    (t: ReportTableRow) => projectSel.size === 0 || t.projects.some((p) => projectSel.has(p)),
    [projectSel],
  );
  const passArea = useCallback(
    (t: ReportTableRow) => areaSel.size === 0 || t.subjectAreas.some((a) => areaSel.has(a)),
    [areaSel],
  );

  // Faceted option lists: each reflects rows passing the OTHER filters; selected
  // values are always kept visible so they can be toggled off.
  const schemaOptions = useMemo(() => {
    const s = new Set(
      tables.filter((t) => passSearch(t) && passProject(t) && passArea(t)).map((t) => t.schema).filter(Boolean),
    );
    schemaSel.forEach((v) => s.add(v));
    return [...s].sort();
  }, [tables, passSearch, passProject, passArea, schemaSel]);
  const projectOptions = useMemo(() => {
    const s = new Set(
      tables.filter((t) => passSearch(t) && passSchema(t) && passArea(t)).flatMap((t) => t.projects).filter(Boolean),
    );
    projectSel.forEach((v) => s.add(v));
    return [...s].sort();
  }, [tables, passSearch, passSchema, passArea, projectSel]);
  const areaOptions = useMemo(() => {
    const s = new Set(
      tables.filter((t) => passSearch(t) && passSchema(t) && passProject(t)).flatMap((t) => t.subjectAreas).filter(Boolean),
    );
    areaSel.forEach((v) => s.add(v));
    return [...s].sort();
  }, [tables, passSearch, passSchema, passProject, areaSel]);

  // Rows passing ALL filters.
  const filtered = useMemo(
    () => tables.filter((t) => passSearch(t) && passSchema(t) && passProject(t) && passArea(t)),
    [tables, passSearch, passSchema, passProject, passArea],
  );

  // ── row selection (drives the Excel export) ──────────────────────────────────
  // Explicit set; starts EMPTY (nothing selected). Only ids among the visible
  // (filtered) rows count toward the export.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filteredIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const selectedIds = useMemo(
    () => new Set(filteredIds.filter((id) => selected.has(id))),
    [selected, filteredIds],
  );
  const selectedRows = useMemo(
    () => filtered.filter((t) => selectedIds.has(t.id)),
    [filtered, selectedIds],
  );
  const selectedCount = selectedIds.size;
  const allRowsSelected = filtered.length > 0 && selectedCount === filtered.length;

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllRows = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allRowsSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });

  // Right-rail summaries derive from the (filtered) rows.
  const bySubjectArea = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((t) => t.subjectAreas.forEach((a) => m.set(a, (m.get(a) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filtered]);
  const maxArea = bySubjectArea[0]?.[1] ?? 1;
  const mostRelated = useMemo(
    () =>
      [...filtered]
        .sort(
          (a, b) =>
            b.relationshipCount - a.relationshipCount || b.projects.length - a.projects.length,
        )
        .slice(0, 5),
    [filtered],
  );

  // La búsqueda cuenta como filtro recién con 2+ caracteres: el PRIMER
  // keystroke no debe disparar la descarga del set completo (15k tablas).
  const anyFilter =
    search.trim().length >= 2 || schemaSel.size > 0 || projectSel.size > 0 || areaSel.size > 0;

  // The first time any filter is applied, load the full table set — con
  // debounce para que tipear rápido no encole la carga a mitad de palabra.
  useEffect(() => {
    if (!anyFilter || fullLoad) return;
    const t = setTimeout(() => setFullLoad(true), 300);
    return () => clearTimeout(t);
  }, [anyFilter, fullLoad]);

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
    if (selectedRows.length === 0) {
      toast.error('Select at least one row to export.');
      return;
    }
    setExporting(true);
    try {
      const rows = selectedRows;
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
        // Export ACOTADO server-side a las tablas seleccionadas (hasta 300 ids
        // por la URL); por encima de eso, descarga completa como antes.
        const ids = rows.map((t) => t.id);
        const allCols: ReportColumnRow[] = await listReportColumns(
          undefined,
          ids.length > 0 && ids.length <= 300 ? ids : undefined,
        );
        const visibleIds = new Set(ids);
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
                options={projectOptions}
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
              <span className="dmh-rep-selcount">
                <strong>{selectedCount} selected</strong> · {filtered.length} table
                {filtered.length === 1 ? '' : 's'}
                {!fullLoad && <em className="dmh-rep-selcount-hint"> · first 50 — filter to load all</em>}
              </span>
            </div>

            <div className="dmh-rep-tablewrap">
              <div className="dmh-rep-tablescroll">
                <table className="dmh-rep-table">
                  <thead>
                    <tr>
                      <th className="dmh-rep-check">
                        <button
                          type="button"
                          className={`dmh-rep-cbox${allRowsSelected ? ' is-on' : ''}`}
                          onClick={toggleAllRows}
                          aria-label="Select all rows"
                          disabled={filtered.length === 0}
                        >
                          {allRowsSelected && <Check strokeWidth={3} aria-hidden />}
                        </button>
                      </th>
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
                          <td colSpan={8} className="dmh-rep-skel-row" />
                        </tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8}>
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
                        <tr key={t.id} className={selectedIds.has(t.id) ? 'is-selected' : ''}>
                          <td className="dmh-rep-check">
                            <button
                              type="button"
                              className={`dmh-rep-cbox${selectedIds.has(t.id) ? ' is-on' : ''}`}
                              onClick={() => toggleRow(t.id)}
                              aria-label={`Select ${t.physicalName}`}
                            >
                              {selectedIds.has(t.id) && <Check strokeWidth={3} aria-hidden />}
                            </button>
                          </td>
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
                  disabled={exporting || levels.size === 0 || selectedCount === 0 || loading}
                >
                  {exporting ? 'Exporting…' : 'Download .xlsx'}
                </Button>
                <div className="dmh-rep-export-note">
                  Only the <strong>{selectedCount} selected</strong> row
                  {selectedCount === 1 ? '' : 's'} will be exported.
                </div>
              </div>
            </div>

            <div className="dmh-rep-card dmh-rep-sumcard">
              <div className="dmh-rep-sumcard-title">Tables by subject area</div>
              {loading ? (
                <div className="dmh-rep-sumcard-empty">Loading…</div>
              ) : bySubjectArea.length === 0 ? (
                <div className="dmh-rep-sumcard-empty">No subject areas in view.</div>
              ) : (
                <div className="dmh-rep-bars">
                  {bySubjectArea.map(([area, n]) => (
                    <div key={area} className="dmh-rep-bar-row">
                      <div className="dmh-rep-bar-head">
                        <span className="dmh-rep-bar-name">{area}</span>
                        <span className="dmh-rep-bar-val">{n}</span>
                      </div>
                      <div className="dmh-rep-bar-track">
                        <div
                          className="dmh-rep-bar-fill"
                          style={{ width: `${Math.round((n / maxArea) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dmh-rep-card dmh-rep-sumcard">
              <div className="dmh-rep-sumcard-title">Most related / in most projects</div>
              {loading ? (
                <div className="dmh-rep-sumcard-empty">Loading…</div>
              ) : mostRelated.length === 0 ? (
                <div className="dmh-rep-sumcard-empty">No tables in view.</div>
              ) : (
                <div className="dmh-rep-related">
                  {mostRelated.map((t) => (
                    <div key={t.id} className="dmh-rep-related-row">
                      <span className="dmh-rep-related-name">{t.physicalName}</span>
                      <span className="dmh-rep-related-rel">{t.relationshipCount} rel.</span>
                      <span className="dmh-rep-related-proj">· {t.projects.length} proj.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
