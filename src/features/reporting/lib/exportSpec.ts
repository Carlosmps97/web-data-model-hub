/**
 * exportSpec — qué consulta exporta el botón CSV del Report Designer (doc 95
 * D12): en modo SQL, la SQL (validada por el servidor a QuerySpec), no el spec
 * que quedó del Builder.
 */
import type { ReportSpec, SqlValidation } from '../query.service';

export async function specForExport(
  mode: 'builder' | 'sql', spec: ReportSpec, sqlText: string,
  validate: (text: string) => Promise<SqlValidation>,
): Promise<ReportSpec> {
  if (mode !== 'sql') return spec;
  if (!sqlText.trim()) throw new Error('Write a query before exporting.');
  const v = await validate(sqlText);
  if (!v.spec) {
    const e = v.errors[0];
    throw new Error(e ? `Line ${e.line}: ${e.message}` : 'The query is not valid.');
  }
  return { ...v.spec, projectId: spec.projectId };
}
