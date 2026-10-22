/**
 * SheetTemplateCard — «Export with a template»: baja una hoja con el formato
 * fijo de una plantilla guardada del proyecto (p. ej. QA_MODELO), sobre la
 * misma selección y filtros que el export por niveles; los filtros de la
 * plantilla eligen, además, qué filas salen. Las plantillas son dato: se crean
 * y editan en «Manage templates…» sin redesplegar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAuthStore } from '@/store/useAuthStore';
import { NO_EXPORT_HINT } from '@/lib/permissionHints';
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import { listSheetTemplates } from '../sheetTemplates.service';
import { templateFileName, templateRows, type SheetTemplate } from '../lib/sheetTemplates';
import { readErrorText } from '../lib/reportVersions';
import SheetTemplateEditor, { filtersLabel } from './SheetTemplateEditor';

export default function SheetTemplateCard({
  projectId, selectedCount, disabled, resolveTables, fetchColumns, onBusyChange, versionToastId,
}: {
  projectId: string;
  selectedCount: number;
  disabled: boolean;
  resolveTables: () => Promise<ReportTableRow[]>;
  fetchColumns: (tableIds: string[]) => Promise<ReportColumnRow[]>;
  /** Avisa si hay un export en curso (y `false` al desmontarse): el Reporting
   *  deshabilita Project / Version mientras tanto. */
  onBusyChange?: (busy: boolean) => void;
  /** En modo versión, id del toast compartido con el aviso «showing
   *  Production» del Reporting (y el texto de un 403/404 lo explica). */
  versionToastId?: string;
}) {
  // Cualquiera en sesión gestiona las suyas; un admin, además, las compartidas.
  const me = useAuthStore((s) => s.user?.username);
  const isAdmin = useAuthStore((s) => s.has('admin.manage'));
  const canExport = useAuthStore((s) => s.has('export'));
  const [templates, setTemplates] = useState<SheetTemplate[]>([]);
  const [selId, setSelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);
  // Un export que falla después de desmontar la card (el Reporting volvió a
  // Production) no avisa sobre la pantalla nueva.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const reload = useCallback(async () => {
    const list = await listSheetTemplates(projectId);
    setTemplates(list);
    setSelId((cur) => (list.some((t) => t.id === cur) ? cur : list[0]?.id ?? ''));
  }, [projectId]);
  useEffect(() => { reload().catch(() => setTemplates([])); }, [reload]);

  const selected = templates.find((t) => t.id === selId) ?? null;

  const exportTemplate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const tables = await resolveTables();
      if (tables.length === 0) { toast.error('Select at least one row to export.'); return; }
      const columns = await fetchColumns(tables.map((t) => t.id));
      const rows = templateRows(selected, tables, columns);
      const filtered = (selected.filters?.length ?? 0) > 0;
      if (filtered && rows.length === 0 && columns.length > 0) {
        toast.info('No rows match the template filters — nothing was exported.');
        return;
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows, { header: selected.columns.map((c) => c.header) });
      XLSX.utils.book_append_sheet(wb, ws, selected.sheetName);
      XLSX.writeFile(wb, templateFileName(selected, new Date()));   // nombre de la plantilla
      toast.success(filtered
        ? `Exported ${rows.length} row${rows.length === 1 ? '' : 's'} with the ${selected.name} template.`
        : `Exported with the ${selected.name} template.`);
    } catch (err: unknown) {
      if (!alive.current) return;
      const text = readErrorText(err, 'Could not build the Excel file.', !!versionToastId);
      if (versionToastId) toast.error(text, { id: versionToastId });
      else toast.error(text);
    } finally { setBusy(false); }
  };

  return (
    <div className="dmh-rep-card">
      <div className="dmh-rep-card-head">
        <span className="dmh-rep-card-ico"><FileSpreadsheet size={17} strokeWidth={1.6} aria-hidden /></span>
        <span className="dmh-rep-card-title">Export with a template</span>
      </div>
      <div className="dmh-rep-card-desc">
        A saved fixed format: one sheet with its own name and columns. Uses the same selection and filters.
      </div>
      {/* Misma distribución que la card «Export to Excel». */}
      <div className="dmh-rep-card-body">
        {templates.length === 0
          ? <div className="dmh-rep-card-empty">No templates in this project yet.</div>
          : (
            <select className="rd-input" value={selId} onChange={(e) => setSelId(e.target.value)} aria-label="Template"
              style={{ width: '100%', height: 34 }}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · sheet {t.sheetName}</option>)}
            </select>
          )}
        {selected?.filters?.length ? (
          <div className="dmh-rep-export-note">{filtersLabel(selected.filters.length)} · only matching rows are exported</div>
        ) : null}
      </div>
      <div className="dmh-rep-card-foot">
        <Button variant="success" icon={Download} className="dmh-rep-export-btn" onClick={exportTemplate}
          disabled={!canExport || busy || disabled || !selected || selectedCount === 0}
          title={canExport ? undefined : NO_EXPORT_HINT}>
          {busy ? 'Exporting…' : 'Download .xlsx'}
        </Button>
        <div className="dmh-rep-export-note">
          Only the <strong>{selectedCount} selected</strong> row{selectedCount === 1 ? '' : 's'} will be exported.
        </div>
        <div className="dmh-rep-card-links">
          <Button variant="secondary" size="sm" onClick={() => setManaging(true)}>Manage templates…</Button>
        </div>
      </div>
      {managing && (
        <SheetTemplateEditor projectId={projectId} templates={templates} me={me} isAdmin={isAdmin}
          onClose={() => setManaging(false)} onChanged={reload} />
      )}
    </div>
  );
}
