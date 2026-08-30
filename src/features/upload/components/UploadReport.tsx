import { ChevronRight, CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import type { UploadCounts, UploadIssue, UploadReport, UploadTableRow } from '../upload.service';

const TILES: { key: keyof UploadReport['summary']; label: string }[] = [
  { key: 'tables', label: 'Tables' },
  { key: 'columns', label: 'Columns' },
  { key: 'canvases', label: 'Canvases' },
  { key: 'schemas', label: 'Schemas' },
  { key: 'projects', label: 'Projects' },
  { key: 'folders', label: 'Folders' },
];
const LEDGER_CAP = 200;

const ACTION_PILL: Record<UploadTableRow['action'], { cls: string; label: string }> = {
  create: { cls: 'dmh-pill dmh-pill--green', label: 'New' },
  update: { cls: 'dmh-pill dmh-pill--amber', label: 'Update' },
  unchanged: { cls: 'dmh-pill dmh-pill--neutral', label: 'Unchanged' },
  error: { cls: 'dmh-pill dmh-pill--red', label: 'Error' },
};

const zero: UploadCounts = { create: 0, update: 0, unchanged: 0 };

/** Referencia de celda del Excel — la firma visual del reporte. */
export function IssueLocator({ issue }: { issue: UploadIssue }) {
  const parts = [issue.sheet];
  if (issue.row != null) parts.push(`row ${issue.row}`);
  if (issue.column) parts.push(issue.column);
  return <code className="up-loc">{parts.join(' · ')}</code>;
}

export function SummaryTiles({ summary }: { summary: UploadReport['summary'] }) {
  return (
    <div className="up-card">
      <div className="up-card-head"><span className="up-card-title">What will change</span></div>
      <div className="up-tiles">
        {TILES.map(({ key, label }) => {
          const c = summary[key] ?? zero;
          return (
            <div className="up-tile" key={key}>
              <span className="up-tile-label">{label}</span>
              <span className="up-tile-n">{c.create}<small>new</small></span>
              <span className="up-tile-sub">
                <span><i className="up-dot up-dot--upd" aria-hidden />{c.update} to update</span>
                <span><i className="up-dot up-dot--same" aria-hidden />{c.unchanged} unchanged</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IssueList({ report }: { report: UploadReport }) {
  const issues = [...report.errors, ...report.warnings];
  const hidden = (report.errorCount - report.errors.length) + (report.warningCount - report.warnings.length);
  return (
    <div className="up-card">
      <div className="up-card-head">
        <span className="up-card-title">Validation</span>
        <span className={`dmh-pill ${report.errorCount ? 'dmh-pill--red' : 'dmh-pill--neutral'}`}>
          <CircleAlert aria-hidden />{report.errorCount} error{report.errorCount === 1 ? '' : 's'}
        </span>
        <span className={`dmh-pill ${report.warningCount ? 'dmh-pill--amber' : 'dmh-pill--neutral'}`}>
          <TriangleAlert aria-hidden />{report.warningCount} warning{report.warningCount === 1 ? '' : 's'}
        </span>
      </div>
      {issues.length === 0 ? (
        <div className="up-issues-empty"><CircleCheck size={15} strokeWidth={1.8} aria-hidden />No issues — the workbook is ready to upload.</div>
      ) : (
        <ul className="up-issues-list">
          {issues.map((i, n) => (
            <li className={`up-issue up-issue--${i.severity}`} key={`${i.sheet}-${i.row}-${i.code}-${n}`}>
              {i.severity === 'error'
                ? <CircleAlert size={14} strokeWidth={1.8} aria-label="Error" />
                : <TriangleAlert size={14} strokeWidth={1.8} aria-label="Warning" />}
              <IssueLocator issue={i} />
              <span className="up-issue-msg">{i.message}</span>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <div className="up-issues-more">Showing the first {issues.length} issues — {hidden} more not listed. Fix these and validate again.</div>}
    </div>
  );
}

function cols(c: UploadCounts) {
  return <span className="up-cols"><span title="new">+{c.create}</span><span title="to update">~{c.update}</span><span title="unchanged">={c.unchanged}</span></span>;
}

export function TablesLedger({ rows }: { rows: UploadTableRow[] }) {
  if (!rows.length) return null;
  const shown = rows.slice(0, LEDGER_CAP);
  return (
    <details className="up-ledger">
      <summary><ChevronRight size={14} strokeWidth={2} aria-hidden />Tables in this workbook ({rows.length})</summary>
      <div className="up-ledger-wrap">
        <table className="up-table">
          <thead>
            <tr><th>Row</th><th>Action</th><th>Table</th><th>Schema</th><th>Canvas</th><th>Columns +new ~update =same</th><th>Issues</th></tr>
          </thead>
          <tbody>
            {shown.map((r, n) => {
              const pill = ACTION_PILL[r.action] ?? ACTION_PILL.unchanged;
              return (
                <tr key={`${r.row ?? 'x'}-${r.physicalName}-${n}`}>
                  <td className="num">{r.row ?? '—'}</td>
                  <td><span className={pill.cls}>{pill.label}</span></td>
                  <td>{r.logicalName}<br /><span className="up-mono">{r.physicalName}</span></td>
                  <td>{r.schema ?? '—'}</td>
                  <td>{r.canvas ?? '—'}</td>
                  <td>{cols(r.columns)}</td>
                  <td className="num">{r.issues || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > shown.length && <div className="up-issues-more">and {rows.length - shown.length} more tables.</div>}
      </div>
    </details>
  );
}

export default function UploadReportView({ report }: { report: UploadReport }) {
  return (
    <>
      <div className="up-grid">
        <SummaryTiles summary={report.summary} />
        <IssueList report={report} />
      </div>
      <TablesLedger rows={report.tables} />
    </>
  );
}
