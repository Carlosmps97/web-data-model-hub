import { useMemo, useState } from 'react';
import { Eye, Plus } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Icon from '@/components/ui/Icon';
import TagEditor from '@/components/ui/TagEditor';
import type { Tag } from '@/types/model';
import * as viewsSvc from '@/services/views.service';
import type { View, ViewSource } from '@/services/views.service';

/** Una fila editable de la sección Sources (la `expression` es free-text). */
interface SourceRow {
  table: string;
  outputAlias: string;
  expression: string;
}

const emptyRow = (): SourceRow => ({ table: '', outputAlias: '', expression: '' });

/**
 * Compone una previsualización `CREATE VIEW … AS SELECT … FROM … WHERE …` a
 * partir del estado del editor. Es puramente cosmético (no es el SQL canónico
 * del backend): proyecta los `outputAlias`/`expression` de cada source, lista
 * las tablas en el FROM y agrega el filtro como WHERE. Recalculado en vivo.
 */
function buildPreview(schema: string, name: string, filter: string, sources: SourceRow[]): string {
  const qualified = [schema.trim(), name.trim()].filter(Boolean).join('.') || 'view';
  const rows = sources.filter((s) => s.table.trim() || s.outputAlias.trim() || s.expression.trim());

  // SELECT: una proyección por source (expresión o tabla.* con alias opcional).
  const select = rows.length
    ? rows
        .map((s) => {
          const expr = s.expression.trim() || (s.table.trim() ? `${s.table.trim()}.*` : '*');
          const alias = s.outputAlias.trim();
          return alias ? `  ${expr} AS ${alias}` : `  ${expr}`;
        })
        .join(',\n')
    : '  *';

  // FROM: tablas distintas en orden de aparición.
  const tables = Array.from(new Set(rows.map((s) => s.table.trim()).filter(Boolean)));
  const from = tables.length ? tables.join(', ') : '<source>';

  const where = filter.trim() ? `\nWHERE ${filter.trim()}` : '';
  return `CREATE VIEW ${qualified} AS\nSELECT\n${select}\nFROM ${from}${where};`;
}

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5, display: 'block' };
const field: React.CSSProperties = { marginBottom: 14 };

/**
 * ViewEditor (Pantalla 07b-2 · New view). Crea o edita una vista de una tabla.
 * Modal sobre el lienzo desenfocado (toolbar visible). Los campos View name /
 * Schema vienen precargados con el nombre/esquema de la tabla + sufijo `_v`,
 * editables. La previsualización (caja mono oscura) se recalcula en vivo.
 */
export default function ViewEditor({
  tableId,
  defaultName,
  defaultSchema,
  view,
  onClose,
  onSaved,
  pushToast,
}: {
  tableId: string;
  /** Nombre base de la tabla (se le añade `_v` para precargar). */
  defaultName: string;
  /** Schema de la tabla (precarga el campo Schema). */
  defaultSchema: string;
  /** Vista a editar; si es `undefined` se crea una nueva. */
  view?: View;
  onClose: () => void;
  onSaved: () => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const editing = !!view;

  const [name, setName] = useState(view?.name ?? `${defaultName}_v`);
  const [schema, setSchema] = useState(view?.schema ?? defaultSchema);
  const [tags, setTags] = useState<Tag[]>(view?.tags ?? []);
  const [filter, setFilter] = useState(view?.filter ?? '');
  const [sources, setSources] = useState<SourceRow[]>(
    view?.sources?.length
      ? view.sources.map((s) => ({ table: s.table ?? '', outputAlias: s.outputAlias ?? '', expression: s.expression ?? '' }))
      : [emptyRow()],
  );
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => buildPreview(schema, name, filter, sources), [schema, name, filter, sources]);

  const patchSource = (i: number, patch: Partial<SourceRow>) =>
    setSources((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addSource = () => setSources((rows) => [...rows, emptyRow()]);
  const removeSource = (i: number) => setSources((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  const save = async () => {
    const nm = name.trim();
    if (!nm) return;
    setBusy(true);
    try {
      const cleanSources: ViewSource[] = sources
        .filter((s) => s.table.trim() || s.outputAlias.trim() || s.expression.trim())
        .map((s) => ({
          table: s.table.trim(),
          outputAlias: s.outputAlias.trim() || undefined,
          expression: s.expression.trim() || undefined,
        }));
      const body: viewsSvc.ViewInput = {
        tableId,
        name: nm,
        schema: schema.trim() || undefined,
        tags: tags.length ? tags : undefined,
        filter: filter.trim() || undefined,
        sources: cleanSources.length ? cleanSources : undefined,
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
      title={editing ? 'Edit view' : 'New view'}
      subtitle={editing ? name : `Define a SQL view over ${defaultName}`}
      icon={Eye}
      backdrop="canvas"
      canvasTop={116}
      width={620}
      onClose={onClose}
      footer={
        <>
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy || !name.trim()} onClick={save}>
            {editing ? 'Save changes' : 'Save view'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, ...field }}>
        <div>
          <label style={lbl}>View name</label>
          <input className="rd-input rd-mono" autoFocus value={name} placeholder="CLIENTE_v"
            onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={lbl}>Schema</label>
          <input className="rd-input rd-mono" value={schema} placeholder="schema_name"
            onChange={(e) => setSchema(e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>

      <div style={field}>
        <label style={lbl}>Tags</label>
        <TagEditor compact value={tags} onChange={setTags} keyPlaceholder="clave" valuePlaceholder="valor" />
      </div>

      <div style={field}>
        <label style={lbl}>Filter</label>
        <textarea className="wk-pp-textarea" value={filter} placeholder="e.g. estado = 'ACTIVO' AND saldo > 0"
          onChange={(e) => setFilter(e.target.value)} style={{ minHeight: 52, fontFamily: 'var(--mono)' }} />
      </div>

      <div style={field}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ ...lbl, marginBottom: 0 }}>Sources</label>
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" onClick={addSource}>
            <Plus size={13} /> add source
          </button>
        </div>
        <div className="wk-ve-srclist">
          <div className="wk-ve-srchead">
            <span>Source</span><span>Output name</span><span>Expression</span><span />
          </div>
          {sources.map((s, i) => (
            <div className="wk-ve-srcrow" key={i}>
              <input className="rd-input rd-mono" value={s.table} placeholder="table"
                onChange={(e) => patchSource(i, { table: e.target.value })} />
              <input className="rd-input rd-mono" value={s.outputAlias} placeholder="alias"
                onChange={(e) => patchSource(i, { outputAlias: e.target.value })} />
              <input className="rd-input rd-mono" value={s.expression} placeholder="expr / column"
                onChange={(e) => patchSource(i, { expression: e.target.value })} />
              <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" title="Quitar source"
                disabled={sources.length <= 1} onClick={() => removeSource(i)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label style={lbl}>Preview</label>
        <pre className="wk-ve-preview">{preview}</pre>
      </div>
    </Dialog>
  );
}
