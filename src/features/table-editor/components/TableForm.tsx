'use client';

import React, { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import TagEditor from '@/components/ui/TagEditor';
import { useMetadataStore } from '@/store/useMetadataStore';
import type { Table, ModelLevel, Domain, Tag } from '@/types/model';

interface TableFormProps {
  table: Table | null;
  layers: ModelLevel[];
  domains: Domain[];
  /** All project tables — used to resolve an FK column's referenced table name. */
  tables?: Table[];
  onClose: () => void;
  onSave: (table: Table, isNew: boolean) => void;
}

export default function TableForm({ table, layers, domains, tables = [], onClose, onSave }: TableFormProps) {
  const isNew = !table;
  const [d, setD] = useState<Table>(() =>
    table
      ? structuredClone(table)
      : {
          id: uuidv4(), name: '', logicalName: '', schema: layers[0]?.id ?? '',
          layer: layers[0]?.id, domain: undefined, subdomain: '', color: '#4f46e5',
          functionalDefinition: '', columns: [], views: [],
        },
  );
  // Which column's detail panel is open (governance metadata lives there).
  const [expandedColId, setExpandedColId] = useState<string | null>(null);
  // Drag-to-reorder state: id being dragged + the row it currently hovers.
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Transversal catalog (Semantic Types + UDPs) — loaded once, cached.
  const { semanticTypes, udps, load: loadCatalog } = useMetadataStore();
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  const colUdps = udps.filter((u) => u.appliesTo.includes('column'));
  const tableUdps = udps.filter((u) => u.appliesTo.includes('table'));

  const patch = (p: Partial<Table>) => setD((s) => ({ ...s, ...p }));
  const setCol = (i: number, p: Partial<Table['columns'][number]>) =>
    setD((s) => ({ ...s, columns: s.columns.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  const toggleKey = (i: number, key: 'pk' | 'fk' | 'sk') => {
    const c = d.columns[i];
    // PK and FK are independent — a column can be both at once.
    if (key === 'pk') setCol(i, { isPrimaryKey: !c.isPrimaryKey });
    else if (key === 'fk') {
      // Toggling FK by hand pins it (fkManual) so a relationship delete won't
      // clear it; turning it off also drops the manual pin + the reference.
      const on = !c.isForeignKey;
      setCol(i, on ? { isForeignKey: true, fkManual: true } : { isForeignKey: false, fkManual: false, foreignKeyRef: undefined });
    }
    else setCol(i, { isSurrogateKey: !c.isSurrogateKey });
  };
  const addCol = () => {
    const id = uuidv4();
    setD((s) => ({ ...s, columns: [...s.columns, { id, name: '', dataType: 'varchar', isNullable: true }] }));
    setExpandedColId(id);
  };
  const delCol = (i: number) => setD((s) => ({ ...s, columns: s.columns.filter((_, j) => j !== i) }));

  // ── Drag-reorder (physical column order — Feature 5) ─────────────────────
  // The array order is the canonical order used by the canvas, the list view
  // and the DDL generator. Views inherit it via their seeded SELECT.
  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setD((s) => {
      const cols = [...s.columns];
      const from = cols.findIndex((c) => c.id === fromId);
      const to = cols.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0) return s;
      const [moved] = cols.splice(from, 1);
      cols.splice(to, 0, moved);
      return { ...s, columns: cols };
    });
  };

  // ── Semantic Type / UDP assignment (Feature 3) ───────────────────────────
  // Assigning a Semantic Type inherits its data type onto the column — but the
  // data type stays editable in the row input (not locked), per the spec.
  const onSelectSemanticType = (i: number, stId: string) => {
    const st = semanticTypes.find((s) => s.id === stId);
    if (!st) { setCol(i, { semanticTypeId: undefined, semanticValues: undefined }); return; }
    setCol(i, { semanticTypeId: st.id, dataType: st.dataType });
  };
  const setSemanticValue = (i: number, key: string, value: string) => {
    const sv: Record<string, string> = { ...(d.columns[i].semanticValues ?? {}) };
    if (value) sv[key] = value; else delete sv[key];
    setCol(i, { semanticValues: Object.keys(sv).length ? sv : undefined });
  };
  const setColUdp = (i: number, udpId: string, value: string) => {
    const uv: Record<string, string> = { ...(d.columns[i].udpValues ?? {}) };
    if (value) uv[udpId] = value; else delete uv[udpId];
    setCol(i, { udpValues: Object.keys(uv).length ? uv : undefined });
  };
  const setTableUdp = (udpId: string, value: string) => {
    const uv: Record<string, string> = { ...(d.udpValues ?? {}) };
    if (value) uv[udpId] = value; else delete uv[udpId];
    patch({ udpValues: Object.keys(uv).length ? uv : undefined });
  };

  const domain = d.domain ? domains.find((x) => x.id === d.domain) : undefined;
  const submit = () => { if (!d.name.trim()) return; onSave({ ...d, name: d.name.trim() }, isNew); };

  return (
    <Modal
      title={isNew ? 'Nueva tabla' : 'Editar tabla'}
      subtitle="Define columnas, claves, tipos y metadata"
      icon="table"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="rd-small left">El toggle a la derecha de cada fila es Nullable · expande una columna para su metadata</span>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" disabled={!d.name.trim()} onClick={submit}><Icon name="check" size={14} sw={2.6} />{isNew ? 'Crear tabla' : 'Guardar tabla'}</button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}><span className="rd-label">Nombre de tabla</span><input className="rd-input" value={d.name} placeholder="ej. h_saldocontable" onChange={(e) => patch({ name: e.target.value })} /></div>
        <div style={{ width: 120 }}><span className="rd-label">Schema</span><input className="rd-input" value={d.schema ?? ''} onChange={(e) => patch({ schema: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 160 }}>
          <span className="rd-label">Modelo (capa)</span>
          <div className="dmh-select">
            <select className="rd-input" value={d.layer ?? ''} onChange={(e) => patch({ layer: e.target.value || undefined })}>
              <option value="">— Ninguno</option>
              {layers.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.full}</option>)}
            </select>
            <Icon name="chevD" size={13} className="chev" />
          </div>
        </div>
        <div style={{ width: 160 }}>
          <span className="rd-label">Dominio</span>
          <div className="dmh-select">
            <select className="rd-input" value={d.domain ?? ''} onChange={(e) => { const dm = domains.find((x) => x.id === e.target.value); patch({ domain: e.target.value || undefined, color: dm?.color ?? d.color }); }}>
              <option value="">— Ninguno</option>
              {domains.map((dm) => <option key={dm.id} value={dm.id}>{dm.name}</option>)}
            </select>
            <Icon name="chevD" size={13} className="chev" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <span className="rd-label">Subdominio</span>
          {domain && domain.subdomains.length ? (
            <div className="dmh-select">
              <select className="rd-input" value={d.subdomain ?? ''} onChange={(e) => patch({ subdomain: e.target.value })}>
                <option value="">—</option>
                {domain.subdomains.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <Icon name="chevD" size={13} className="chev" />
            </div>
          ) : (
            <input className="rd-input" value={d.subdomain ?? ''} placeholder="opcional" onChange={(e) => patch({ subdomain: e.target.value })} />
          )}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}><span className="rd-label">Definición</span><input className="rd-input" value={d.functionalDefinition ?? ''} placeholder="Qué representa esta tabla" onChange={(e) => patch({ functionalDefinition: e.target.value })} /></div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <span className="rd-label" style={{ margin: 0 }}>Columnas · {d.columns.length}</span>
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={addCol}><Icon name="plus" size={13} sw={2.6} />Añadir columna</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {d.columns.length === 0 && <div className="rd-small" style={{ padding: '14px 0', textAlign: 'center' }}>Sin columnas — añade una para empezar.</div>}
        {d.columns.map((c, i) => {
          const open = expandedColId === c.id;
          return (
            <div
              className={`ce-rowwrap${dragOverId === c.id ? ' dragover' : ''}${open ? ' open' : ''}`}
              key={c.id}
              onDragOver={(e) => { if (dragId.current) { e.preventDefault(); setDragOverId(c.id); } }}
              onDragLeave={() => setDragOverId((x) => (x === c.id ? null : x))}
              onDrop={(e) => { e.preventDefault(); if (dragId.current) reorder(dragId.current, c.id); dragId.current = null; setDragOverId(null); }}
            >
              <div className="ce-row">
                <span
                  className="ce-grip"
                  draggable
                  title="Arrastra para reordenar"
                  onDragStart={(e) => { dragId.current = c.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }}
                  onDragEnd={() => { dragId.current = null; setDragOverId(null); }}
                ><Icon name="dots" size={14} /></span>
                <button type="button" className={`ce-expand${open ? ' open' : ''}`} title={open ? 'Cerrar metadata' : 'Abrir metadata'} onClick={() => setExpandedColId(open ? null : c.id)}><Icon name="chevR" size={13} /></button>
                <input className="rd-input" style={{ flex: 1, padding: '6px 9px' }} value={c.name} placeholder="columna" onChange={(e) => setCol(i, { name: e.target.value })} />
                <input className="rd-input rd-mono" style={{ width: 120, padding: '6px 9px', fontSize: 11.5 }} value={c.dataType} onChange={(e) => setCol(i, { dataType: e.target.value })} />
                <div className="ce-keys">
                  {(['PK', 'FK', 'SK'] as const).map((kk) => {
                    const on = kk === 'PK' ? c.isPrimaryKey : kk === 'FK' ? c.isForeignKey : c.isSurrogateKey;
                    return <span key={kk} className={`rd-key ${kk.toLowerCase()}${on ? ' on' : ''}`} onClick={() => toggleKey(i, kk.toLowerCase() as 'pk' | 'fk' | 'sk')}>{kk}</span>;
                  })}
                  {c.isPartitionKey && <span className="rd-key pt on" title="Columna de partición">PT</span>}
                </div>
                <span className={`rd-toggle${c.isNullable !== false ? ' on' : ''}`} title="Nullable" style={{ transform: 'scale(.82)', flexShrink: 0 }} onClick={() => setCol(i, { isNullable: c.isNullable === false })} />
                <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ flexShrink: 0 }} onClick={() => delCol(i)}><Icon name="trash" size={13} /></button>
              </div>

              {open && (
                <div className="ce-detail">
                  <div className="ce-detail-field">
                    <span className="rd-label">Definición funcional</span>
                    <textarea className="rd-input" rows={2} value={c.functionalDefinition ?? ''} placeholder="Qué representa esta columna en lenguaje de negocio" onChange={(e) => setCol(i, { functionalDefinition: e.target.value })} />
                  </div>
                  <div className="ce-detail-field">
                    <span className="rd-label">Nombre lógico</span>
                    <input className="rd-input" value={c.logicalName ?? ''} placeholder="opcional" onChange={(e) => setCol(i, { logicalName: e.target.value })} />
                  </div>
                  {c.isForeignKey && c.foreignKeyRef && (
                    <div className="ce-detail-fk">
                      <Icon name="link" size={12} />
                      <span>Esta columna <b>referencia (FK)</b> a <b>{(tables.find((t) => t.id === c.foreignKeyRef!.table)?.name ?? (c.foreignKeyRef!.table === d.id ? d.name : c.foreignKeyRef!.table))}.{c.foreignKeyRef!.column}</b></span>
                    </div>
                  )}
                  <div className="ce-detail-block">
                    <span className="rd-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="tag" size={11} />Tags (clave-valor)</span>
                    <TagEditor value={c.tags} onChange={(tags: Tag[]) => setCol(i, { tags })} compact />
                  </div>
                  <div className="ce-detail-block">
                    <span className="rd-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="sparkles" size={11} />Semantic Type / UDP</span>
                    <div className="dmh-select">
                      <select className="rd-input" value={c.semanticTypeId ?? ''} onChange={(e) => onSelectSemanticType(i, e.target.value)}>
                        <option value="">— Sin Semantic Type</option>
                        {semanticTypes.map((st) => <option key={st.id} value={st.id}>{st.name} · {st.dataType}</option>)}
                      </select>
                      <Icon name="chevD" size={13} className="chev" />
                    </div>
                    {(() => {
                      const st = semanticTypes.find((s) => s.id === c.semanticTypeId);
                      if (!st || st.tags.length === 0) return null;
                      return (
                        <div className="ce-sem-tags">
                          {st.tags.map((t) => (
                            <div className="ce-sem-tag" key={t.key}>
                              <span className="ce-sem-tag-k">{t.key}</span>
                              <div className="dmh-select" style={{ flex: 1 }}>
                                <select className="rd-input" value={c.semanticValues?.[t.key] ?? ''} onChange={(e) => setSemanticValue(i, t.key, e.target.value)}>
                                  <option value="">—</option>
                                  {t.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <Icon name="chevD" size={13} className="chev" />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {colUdps.length > 0 && (
                      <div className="ce-sem-tags">
                        {colUdps.map((u) => (
                          <div className="ce-sem-tag" key={u.id}>
                            <span className="ce-sem-tag-k" title={u.description}>{u.name}</span>
                            {u.valueType === 'enum' ? (
                              <div className="dmh-select" style={{ flex: 1 }}>
                                <select className="rd-input" value={c.udpValues?.[u.id] ?? ''} onChange={(e) => setColUdp(i, u.id, e.target.value)}>
                                  <option value="">—</option>
                                  {(u.allowedValues ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <Icon name="chevD" size={13} className="chev" />
                              </div>
                            ) : (
                              <input className="rd-input" style={{ flex: 1 }} value={c.udpValues?.[u.id] ?? ''} placeholder="valor" onChange={(e) => setColUdp(i, u.id, e.target.value)} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ce-detail-toggle">
                    <span className={`rd-toggle${c.isPartitionKey ? ' on' : ''}`} onClick={() => setCol(i, { isPartitionKey: !c.isPartitionKey })} />
                    <div><div style={{ fontWeight: 700, fontSize: 12.5 }}>Columna de partición</div><div className="rd-small">Se incluye en la cláusula de particionado del DDL según el motor.</div></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 18 }}>
        <span className="rd-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="tag" size={12} />Etiquetas de la tabla</span>
        <TagEditor value={d.tags} onChange={(tags: Tag[]) => patch({ tags })} />
      </div>

      {tableUdps.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span className="rd-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="bolt" size={12} />UDPs de la tabla</span>
          <div className="ce-sem-tags">
            {tableUdps.map((u) => (
              <div className="ce-sem-tag" key={u.id}>
                <span className="ce-sem-tag-k" title={u.description}>{u.name}</span>
                {u.valueType === 'enum' ? (
                  <div className="dmh-select" style={{ flex: 1 }}>
                    <select className="rd-input" value={d.udpValues?.[u.id] ?? ''} onChange={(e) => setTableUdp(u.id, e.target.value)}>
                      <option value="">—</option>
                      {(u.allowedValues ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <Icon name="chevD" size={13} className="chev" />
                  </div>
                ) : (
                  <input className="rd-input" style={{ flex: 1 }} value={d.udpValues?.[u.id] ?? ''} placeholder="valor" onChange={(e) => setTableUdp(u.id, e.target.value)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
