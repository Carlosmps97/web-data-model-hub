import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Eye, Search } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import TagEditor from '@/components/ui/TagEditor';
import type { Tag } from '@/types/model';
import * as viewsSvc from '@/services/views.service';
import type { View, ViewSource } from '@/services/views.service';

/** Columna de la tabla base ofrecida en la grilla. */
export interface ViewEditorColumn { id: string; physicalName: string; dataType: string; }

/** Config editable por columna: si se incluye, su nombre de salida y su expresión. */
interface ColCfg { included: boolean; output: string; expression: string; }

const PURPLE = '#8B5CF6', PURPLE_DK = '#6D3FC4', BLUE = '#2E5BFF', NAVY = '#1A2B4A', MUTED = '#9AA3B2';
const MONO = "var(--mono, 'Geist Mono', monospace)";
const lbl: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 };
const idField: React.CSSProperties = { width: '100%', height: 42, padding: '0 13px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 10, fontFamily: MONO, fontSize: 13.5, color: NAVY, outline: 'none', boxSizing: 'border-box' };
const cellInput: React.CSSProperties = { width: '100%', height: 32, padding: '0 10px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 7, fontFamily: MONO, fontSize: 11.5, color: NAVY, outline: 'none', boxSizing: 'border-box' };
const link: React.CSSProperties = { border: 'none', background: 'transparent', color: BLUE, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const GRID = '20px 26px 1fr 1fr 1.4fr';

/** Preview `CREATE VIEW … SELECT … FROM … WHERE …` — una columna por fila, en el
 *  orden definido. Sin columnas incluidas ⇒ mensaje (NO SELECT *). */
function buildPreview(schema: string, name: string, filter: string, fromTable: string, order: string[], cols: Map<string, ViewEditorColumn>, cfg: Record<string, ColCfg>): string {
  const qualified = [schema.trim(), name.trim()].filter(Boolean).join('.') || 'view';
  const included = order.filter((k) => cfg[k]?.included && cols.has(k));
  if (!included.length) return '-- Seleccioná al menos una columna para la vista.';
  const select = included.map((k) => {
    const cc = cfg[k];
    const expr = cc.expression.trim() || k;
    const alias = cc.output.trim();
    return alias && alias !== expr ? `  ${expr} AS ${alias}` : `  ${expr}`;
  }).join(',\n');
  const where = filter.trim() ? `\nWHERE ${filter.trim()}` : '';
  return `CREATE VIEW ${qualified} AS\nSELECT\n${select}\nFROM ${fromTable}${where};`;
}

/**
 * ViewEditor (Pantalla 07b-2). Define una vista sobre la tabla base COLUMNA POR
 * COLUMNA: incluir/excluir (checkbox + Select all / Clear), renombrar la salida,
 * expresión SQL libre, buscar columnas y reordenarlas (up/down). La vista LISTA
 * sus columnas explícitas — no usa SELECT *. No se puede guardar sin columnas.
 */
export default function ViewEditor({
  tableId, defaultName, defaultSchema, columns, view, onClose, onSaved, pushToast,
}: {
  tableId: string;
  defaultName: string;
  defaultSchema: string;
  columns: ViewEditorColumn[];
  view?: View;
  onClose: () => void;
  onSaved: () => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const editing = !!view;
  const colMap = useMemo(() => new Map(columns.map((c) => [c.physicalName, c])), [columns]);

  const [name, setName] = useState(view?.name ?? `v_${defaultName}`);
  const [schema, setSchema] = useState(view?.schema ?? defaultSchema);
  const [tags, setTags] = useState<Tag[]>(view?.tags ?? []);
  const [filter, setFilter] = useState(view?.filter ?? '');
  const [search, setSearch] = useState('');

  // Orden de columnas: si se edita y hay sources, respeta su orden + agrega las
  // restantes; si no, orden natural (ordinal). Config por columna en paralelo.
  // Solo cuentan las proyecciones por COLUMNA (se ignora el formato legacy
  // table-only, que se trata como "sin proyección" ⇒ todas las columnas).
  const [order, setOrder] = useState<string[]>(() => {
    const colSrcs = (view?.sources ?? []).filter((s) => s.column && colMap.has(s.column));
    const srcKeys = colSrcs.map((s) => s.column!);
    const rest = columns.map((c) => c.physicalName).filter((k) => !srcKeys.includes(k));
    return srcKeys.length ? [...srcKeys, ...rest] : columns.map((c) => c.physicalName);
  });
  const [cfg, setCfg] = useState<Record<string, ColCfg>>(() => {
    const colSrcs = (view?.sources ?? []).filter((s) => s.column);
    const byCol = new Map(colSrcs.map((s) => [s.column!, s]));
    const hasProjection = colSrcs.length > 0;
    const out: Record<string, ColCfg> = {};
    for (const c of columns) {
      const s = byCol.get(c.physicalName);
      out[c.physicalName] = hasProjection
        ? { included: !!s, output: s?.outputAlias ?? c.physicalName, expression: s?.expression ?? '' }
        : { included: true, output: c.physicalName, expression: '' };
    }
    return out;
  });
  const [busy, setBusy] = useState(false);

  const fromTable = [defaultSchema.trim(), defaultName.trim()].filter(Boolean).join('.') || defaultName;
  const preview = useMemo(() => buildPreview(schema, name, filter, fromTable, order, colMap, cfg), [schema, name, filter, fromTable, order, colMap, cfg]);
  const includedCount = columns.filter((c) => cfg[c.physicalName]?.included).length;
  const canSave = !!name.trim() && includedCount > 0 && !busy;

  const patch = (col: string, p: Partial<ColCfg>) => setCfg((m) => ({ ...m, [col]: { ...m[col], ...p } }));
  const setAll = (included: boolean) => setCfg((m) => {
    const n = { ...m };
    for (const c of columns) n[c.physicalName] = { ...n[c.physicalName], included };
    return n;
  });
  const move = (key: string, dir: -1 | 1) => setOrder((o) => {
    const i = o.indexOf(key); const j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return o;
    const next = [...o]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const searching = !!search.trim();
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return order.filter((k) => colMap.has(k) && (!q || k.toLowerCase().includes(q)));
  }, [order, colMap, search]);

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      // Sources = columnas incluidas EN ORDEN (explícitas, sin colapsar a SELECT *).
      const clean: ViewSource[] = order
        .filter((k) => cfg[k]?.included && colMap.has(k))
        .map((k) => {
          const cc = cfg[k];
          return {
            column: k,
            outputAlias: cc.output.trim() && cc.output.trim() !== k ? cc.output.trim() : undefined,
            expression: cc.expression.trim() || undefined,
          };
        });
      const body: viewsSvc.ViewInput = {
        tableId, name: name.trim(),
        schema: schema.trim() || undefined,
        tags: tags.length ? tags : undefined,
        filter: filter.trim() || undefined,
        sources: clean,
        sql: preview,
      };
      if (editing && view) await viewsSvc.updateView(view.id, body);
      else await viewsSvc.createView(body);
      pushToast(editing ? 'Vista actualizada' : 'Vista creada');
      onSaved();
      onClose();
    } catch {
      pushToast('No se pudo guardar la vista', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={editing ? `Edit view · on ${defaultName}` : `New view · on ${defaultName}`}
      subtitle="Definí una vista sobre la tabla base — renombrá, filtrá, transformá y etiquetá"
      icon={Eye}
      backdrop="canvas"
      canvasTop={136}
      width={1120}
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 11.5, color: '#56607A' }}>
            Una vista nunca copia datos — siempre refleja la tabla base <strong style={{ color: NAVY }}>{defaultName}</strong>.
          </span>
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-sm" disabled={!canSave} onClick={save}
            title={includedCount === 0 ? 'Seleccioná al menos una columna' : undefined}
            style={{ background: canSave ? PURPLE : '#CBD2DE', color: '#fff', border: 'none' }}>
            {editing ? 'Save changes' : 'Create view'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 0, height: 540, margin: '-4px -4px 0', minHeight: 0 }}>
        {/* ── LEFT · identity ── */}
        <div style={{ width: 400, flex: 'none', borderRight: '1px solid #EAEDF2', background: '#FAFBFC', display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: '10px 0 0 10px' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #EAEDF2', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: '#F3EEFF', color: PURPLE, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: NAVY }}>View identity</h2>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={lbl}>View name</label>
              <input style={idField} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={`v_${defaultName}`} />
            </div>
            <div>
              <label style={lbl}>Schema</label>
              <input style={idField} value={schema} onChange={(e) => setSchema(e.target.value)} placeholder={defaultSchema || 'schema_name'} />
            </div>
            <div>
              <label style={lbl}>Labels / tags</label>
              <TagEditor compact value={tags} onChange={setTags} keyPlaceholder="clave" valuePlaceholder="valor" />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 120 }}>
              <label style={lbl}>Filter · free SQL (WHERE)</label>
              <textarea value={filter} onChange={(e) => setFilter(e.target.value)}
                placeholder="estado = 'ACTIVA' AND saldo > 0"
                style={{ flex: 1, minHeight: 110, padding: '11px 13px', background: '#fff', border: '1px solid #DDE2EC', borderRadius: 10, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, color: NAVY, resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
              <div style={{ marginTop: 7, fontSize: 11, color: MUTED }}>Cualquier expresión booleana SQL — sin la palabra WHERE.</div>
            </div>
          </div>
        </div>

        {/* ── RIGHT · columns + preview ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid #EEF1F5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: '#F3EEFF', color: PURPLE, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: NAVY }}>Columns — include, rename &amp; express</h2>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: includedCount === 0 ? '#C0392B' : MUTED, fontWeight: includedCount === 0 ? 700 : 400 }}>{includedCount}/{columns.length} incluidas</span>
            </div>
            {/* toolbar: search + select all/clear */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: MUTED }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar columna…"
                  style={{ width: '100%', height: 32, padding: '0 10px 0 30px', border: '1px solid #DDE2EC', borderRadius: 8, fontSize: 12.5, color: NAVY, outline: 'none', background: '#fff', boxSizing: 'border-box' }} />
              </div>
              <span style={{ flex: 1 }} />
              <button type="button" style={link} onClick={() => setAll(true)}>Select all</button>
              <span style={{ color: '#D6DCE6' }}>·</span>
              <button type="button" style={{ ...link, color: MUTED }} onClick={() => setAll(false)}>Clear</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', minHeight: 0 }}>
            {/* grilla de columnas */}
            <div style={{ border: '1px solid #EAEDF2', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, padding: '9px 13px', background: '#F7F9FC', borderBottom: '1px solid #EAEDF2', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: MUTED }}>
                <span /><span /><span>Source column</span><span>Output name</span><span>Expression · free SQL</span>
              </div>
              {columns.length === 0 && <div style={{ padding: '14px 13px', fontSize: 12.5, color: MUTED }}>La tabla no tiene columnas.</div>}
              {columns.length > 0 && visible.length === 0 && <div style={{ padding: '14px 13px', fontSize: 12.5, color: MUTED }}>Ninguna columna coincide con la búsqueda.</div>}
              {visible.map((k, vi) => {
                const c = colMap.get(k)!;
                const cc = cfg[k] ?? { included: true, output: k, expression: '' };
                const pos = order.indexOf(k);
                return (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 10, padding: '8px 13px', borderBottom: vi === visible.length - 1 ? 'none' : '1px solid #F2F4F8' }}>
                    <button type="button" onClick={() => patch(k, { included: !cc.included })} aria-pressed={cc.included} title={cc.included ? 'Incluida' : 'Excluida'}
                      style={{ width: 18, height: 18, borderRadius: 5, border: cc.included ? 'none' : '1.5px solid #CBD2DE', background: cc.included ? BLUE : '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                      {cc.included && <Check size={11} strokeWidth={2.6} color="#fff" />}
                    </button>
                    {/* reorder up/down (deshabilitado mientras se busca) */}
                    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
                      <button type="button" onClick={() => move(k, -1)} disabled={searching || pos <= 0} title="Subir"
                        style={{ height: 13, border: 'none', background: 'transparent', cursor: searching || pos <= 0 ? 'default' : 'pointer', color: searching || pos <= 0 ? '#D6DCE6' : '#8A93A5', padding: 0, lineHeight: 0 }}><ChevronUp size={13} /></button>
                      <button type="button" onClick={() => move(k, 1)} disabled={searching || pos >= order.length - 1} title="Bajar"
                        style={{ height: 13, border: 'none', background: 'transparent', cursor: searching || pos >= order.length - 1 ? 'default' : 'pointer', color: searching || pos >= order.length - 1 ? '#D6DCE6' : '#8A93A5', padding: 0, lineHeight: 0 }}><ChevronDown size={13} /></button>
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: cc.included ? NAVY : '#A9B1BE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.physicalName}<span style={{ fontWeight: 400, color: MUTED, fontSize: 11 }}>  {c.dataType}</span>
                    </span>
                    <input style={{ ...cellInput, opacity: cc.included ? 1 : 0.5 }} value={cc.output} disabled={!cc.included}
                      onChange={(e) => patch(k, { output: e.target.value })} placeholder={c.physicalName} />
                    <input style={{ ...cellInput, opacity: cc.included ? 1 : 0.5, borderColor: cc.expression.trim() ? '#E1D4FB' : '#DDE2EC', color: cc.expression.trim() ? PURPLE_DK : NAVY }}
                      value={cc.expression} disabled={!cc.included}
                      onChange={(e) => patch(k, { expression: e.target.value })} placeholder="expression… e.g. UPPER(col)" />
                  </div>
                );
              })}
            </div>
            {searching && <div style={{ marginTop: 7, fontSize: 11, color: MUTED }}>Limpiá la búsqueda para reordenar las columnas.</div>}

            {/* preview DDL — una columna por fila */}
            <div style={{ marginTop: 14, border: '1px solid #E1D4FB', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#F8F5FF', borderBottom: '1px solid #EEE7FB', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: PURPLE }}>
                Resulting DDL · preview
              </div>
              <pre style={{ margin: 0, padding: '13px 15px', fontFamily: MONO, fontSize: 12, lineHeight: 1.7, color: includedCount === 0 ? '#C0392B' : '#3A4658', background: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview}</pre>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
