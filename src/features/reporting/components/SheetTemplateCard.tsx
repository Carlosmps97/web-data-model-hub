/**
 * SheetTemplateCard — «Export with a template» (doc 95 D11): baja UNA hoja con el
 * formato fijo de una plantilla guardada del proyecto (p. ej. QA_MODELO), sobre
 * la MISMA selección y filtros que el export por niveles. Las plantillas son
 * dato: se crean y editan en «Manage templates…» sin redesplegar.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAuthStore } from '@/store/useAuthStore';
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import { listSheetTemplates } from '../sheetTemplates.service';
import { templateFileName, templateRows, type SheetTemplate } from '../lib/sheetTemplates';
import SheetTemplateEditor from './SheetTemplateEditor';

export default function SheetTemplateCard({ projectId, selectedCount, disabled, resolveTables, fetchColumns }: {
  projectId: string;
  selectedCount: number;
  disabled: boolean;
  resolveTables: () => Promise<ReportTableRow[]>;
  fetchColumns: (tableIds: string[]) => Promise<ReportColumnRow[]>;
}) {
  // Spec D11: cualquiera en sesión gestiona las suyas; un admin, además, las compartidas.
  const me = useAuthStore((s) => s.user?.username);
  const isAdmin = useAuthStore((s) => s.has('admin.manage'));
  const [templates, setTemplates] = useState<SheetTemplate[]>([]);
  const [selId, setSelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);

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
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateRows(selected, tables, columns),
        { header: selected.columns.map((c) => c.header) });
      XLSX.utils.book_append_sheet(wb, ws, selected.sheetName);
      XLSX.writeFile(wb, templateFileName(selected.name, new Date()));
      toast.success(`Exported with the ${selected.name} template.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not build the Excel file.');
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
      {templates.length === 0
        ? <div className="dmh-rep-card-desc">No templates in this project yet.</div>
        : (
          <select className="rd-input" value={selId} onChange={(e) => setSelId(e.target.value)} aria-label="Template"
            style={{ width: '100%', height: 34 }}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · sheet {t.sheetName}</option>)}
          </select>
        )}
      <div className="dmh-rep-card-foot">
        <Button variant="success" icon={Download} className="dmh-rep-export-btn" onClick={exportTemplate}
          disabled={busy || disabled || !selected || selectedCount === 0}>
          {busy ? 'Exporting…' : 'Download .xlsx'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setManaging(true)}>Manage templates…</Button>
      </div>
      {managing && (
        <SheetTemplateEditor projectId={projectId} templates={templates} me={me} isAdmin={isAdmin}
          onClose={() => setManaging(false)} onChanged={reload} />
      )}
    </div>
  );
}
