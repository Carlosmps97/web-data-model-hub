'use client';

import React, { useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { Table, ModelLevel, Domain, Relationship } from '@/types/model';
import type { Scope } from '@/lib/hierarchy';
import { findLayer } from '@/lib/hierarchy';
import { tableFromSources } from '@/features/diagram';

interface CreateFromSqlModalProps {
  tables: Table[];
  scope: Scope;
  isInScope: (t: Table) => boolean;
  layers: ModelLevel[];
  domains: Domain[];
  onClose: () => void;
  onCreate: (built: { table: Table; rels: Relationship[] }) => void;
  pushToast: (msg: string, type?: 'err') => void;
}

export default function CreateFromSqlModal({ tables, scope, isInScope, layers, domains, onClose, onCreate, pushToast }: CreateFromSqlModalProps) {
  const [sources, setSources] = useState<string[]>([]);
  const [picks, setPicks] = useState<Set<string>>(() => new Set());
  const [srcQuery, setSrcQuery] = useState('');
  const [colQuery, setColQuery] = useState('');
  const [srcScope, setSrcScope] = useState<'scope' | 'all'>('scope');
  const [name, setName] = useState('');
  const [layer, setLayer] = useState(scope.layers.length === 1 ? scope.layers[0] : layers[0]?.id ?? '');
  const [schema, setSchema] = useState(scope.layers.length === 1 ? scope.layers[0] : layers[0]?.id ?? '');
  const [domain, setDomain] = useState(scope.domains.length === 1 ? scope.domains[0] : domains[0]?.id ?? '');
  const [link, setLink] = useState(true);

  const srcTables = sources.map((id) => tables.find((t) => t.id === id)).filter((t): t is Table => !!t);

  const toggleSource = (id: string) => {
    if (sources.includes(id)) {
      const t = tables.find((x) => x.id === id);
      if (t) setPicks((p) => { const n = new Set(p); t.columns.forEach((c) => n.delete(c.id)); return n; });
      setSources((s) => s.filter((x) => x !== id));
      return;
    }
    if (sources.length >= 2) { pushToast('Elige máximo 2 tablas fuente', 'err'); return; }
    setSources((s) => [...s, id]);
  };
  const togglePick = (cid: string) => setPicks((p) => { const n = new Set(p); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });
  const allOn = (t: Table) => t.columns.every((c) => picks.has(c.id));
  const selectAll = (t: Table) => setPicks((p) => { const n = new Set(p); const on = t.columns.every((c) => n.has(c.id)); t.columns.forEach((c) => (on ? n.delete(c.id) : n.add(c.id))); return n; });

  const create = () => {
    const built = tableFromSources(srcTables, picks, {
      name: name.trim(), schema, layer, domain, subdomain: '',
      color: domains.find((dm) => dm.id === domain)?.color, link,
    });
    if (tables.some((x) => x.id === built.table.id)) { pushToast('Ya existe una tabla con ese nombre', 'err'); return; }
    onCreate(built);
  };

  return (
    <div className="dmh-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dmh-modal lg">
        <div className="m-head">
          <span className="ico"><Icon name="database" size={16} /></span>
          <div className="m-title"><div className="t">Nueva tabla desde existentes</div><div className="s">Hereda columnas de hasta 2 tablas padre — sin redeclararlas</div></div>
          <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>
        <div className="m-body" style={{ display: 'flex', gap: 0, padding: 0, minHeight: 360 }}>
          <div style={{ width: 232, flexShrink: 0, borderRight: '1px solid var(--border-soft)', padding: 14, overflowY: 'auto' }}>
            <div className="rd-label" style={{ marginBottom: 9 }}>Tablas fuente · {sources.length}/2</div>
            <div className="rd-seg" style={{ width: '100%', marginBottom: 9, padding: 2 }}>
              <button className={srcScope === 'scope' ? 'active' : ''} style={{ flex: 1, justifyContent: 'center', padding: '5px 8px', fontSize: 11 }} onClick={() => setSrcScope('scope')}>En scope</button>
              <button className={srcScope === 'all' ? 'active' : ''} style={{ flex: 1, justifyContent: 'center', padding: '5px 8px', fontSize: 11 }} onClick={() => setSrcScope('all')}>Todas</button>
            </div>
            <div className="rd-search" style={{ marginBottom: 9 }}><Icon name="search" size={14} /><input className="rd-input" style={{ padding: '7px 10px 7px 32px', fontSize: 12 }} placeholder="Buscar tablas…" value={srcQuery} onChange={(e) => setSrcQuery(e.target.value)} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {tables.filter((t) => (srcScope === 'all' || isInScope(t)) && (!srcQuery || t.name.toLowerCase().includes(srcQuery.toLowerCase()))).map((t) => {
                const on = sources.includes(t.id);
                const dis = !on && sources.length >= 2;
                return (
                  <button key={t.id} className="fs-src" data-on={on} disabled={dis} style={{ opacity: dis ? 0.4 : 1 }} onClick={() => toggleSource(t.id)}>
                    <span className="fs-check">{on && <Icon name="check" size={12} sw={3} />}</span>
                    <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>{t.name}</span>
                    {t.layer && <span className="ed-layer-pill" style={{ fontSize: 8.5 }}>{findLayer(layers, t.layer)?.name ?? t.layer}</span>}
                    <span className="rd-small">{t.columns.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', overflowY: 'auto' }}>
            {srcTables.length === 0 ? (
              <div className="dmh-empty" style={{ padding: '70px 10px' }}><div className="ico"><Icon name="columns" size={40} /></div>Elige una tabla fuente para escoger qué columnas heredar.</div>
            ) : (
              <>
                <div className="rd-search" style={{ marginBottom: 12 }}><Icon name="search" size={14} /><input className="rd-input" style={{ padding: '7px 10px 7px 32px', fontSize: 12 }} placeholder="Buscar columnas en las fuentes…" value={colQuery} onChange={(e) => setColQuery(e.target.value)} /></div>
                {srcTables.map((t) => {
                  const shown = t.columns.filter((c) => !colQuery || c.name.toLowerCase().includes(colQuery.toLowerCase()));
                  if (!shown.length) return null;
                  return (
                    <div key={t.id} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                        <span className="rd-badge rd-badge-primary"><Icon name="table" size={11} />{t.schema}.{t.name}</span>
                        <button className="rd-btn rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto', padding: '4px 8px' }} onClick={() => selectAll(t)}>{allOn(t) ? 'Quitar todo' : 'Seleccionar todo'}</button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {shown.map((c) => {
                          const k = c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : c.isSurrogateKey ? 'SK' : c.isPartitionKey ? 'PT' : '';
                          const on = picks.has(c.id);
                          return (
                            <button key={c.id} type="button" className="fs-col" data-on={on} onClick={() => togglePick(c.id)}>
                              <span className="fs-check">{on && <Icon name="check" size={12} sw={3} />}</span>
                              {k ? <span className={`rd-key ${k.toLowerCase()}`}>{k}</span> : <span className="rd-key none"><span className="d" /></span>}
                              <span style={{ flex: 1, fontWeight: 600, fontSize: 12.5, textAlign: 'left' }}>{c.name}</span>
                              <span className="rd-mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{c.dataType}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-soft)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}><span className="rd-label">Nombre</span><input className="rd-input" value={name} placeholder="ej. f_saldo_cliente" onChange={(e) => setName(e.target.value)} /></div>
          <div style={{ width: 96 }}><span className="rd-label">Schema</span><input className="rd-input" value={schema} onChange={(e) => setSchema(e.target.value)} /></div>
          <div style={{ width: 120 }}><span className="rd-label">Modelo</span>
            <div className="dmh-select"><select className="rd-input" value={layer} onChange={(e) => setLayer(e.target.value)}>{layers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><Icon name="chevD" size={13} className="chev" /></div>
          </div>
          <div style={{ width: 120 }}><span className="rd-label">Dominio</span>
            <div className="dmh-select"><select className="rd-input" value={domain} onChange={(e) => setDomain(e.target.value)}>{domains.map((dm) => <option key={dm.id} value={dm.id}>{dm.name}</option>)}</select><Icon name="chevD" size={13} className="chev" /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingBottom: 9 }}>
            <span className={`rd-toggle${link ? ' on' : ''}`} style={{ transform: 'scale(.85)' }} onClick={(e) => { e.preventDefault(); setLink((v) => !v); }} />
            <span className="rd-small" style={{ maxWidth: 110 }}>Mantener relación a las tablas padre</span>
          </label>
        </div>
        <div className="m-foot">
          <span className="rd-small left">{picks.size} columnas seleccionadas</span>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" disabled={!name.trim() || picks.size === 0} onClick={create}><Icon name="check" size={14} sw={2.6} />Crear tabla</button>
        </div>
      </div>
    </div>
  );
}
