'use client';

import React, { useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { Table, Relationship, ModelLevel, Domain, View } from '@/types/model';
import { findLayer, findDomain } from '@/lib/hierarchy';

function ViewCard({ v, onEdit, onDelete }: { v: View; onEdit: (v: View) => void; onDelete: (v: View) => void }) {
  const exprs = (v.select ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const conds = (v.where ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const protectedCount = exprs.filter((l) => /sha256|md5|hash|regexp_replace|crypt|mask/i.test(l)).length;
  return (
    <div className="iv-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="rd-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
        <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ width: 26, height: 26 }} onClick={() => onEdit(v)}><Icon name="edit" size={13} /></button>
        <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ width: 26, height: 26 }} onClick={() => onDelete(v)}><Icon name="trash" size={12} style={{ color: 'var(--error)' }} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
        <span className="rd-badge rd-badge-neutral"><Icon name="users" size={10} />{v.role || '—'}</span>
        <span className="rd-badge rd-badge-neutral"><Icon name="columns" size={10} />{exprs.length}</span>
        {protectedCount > 0 && <span className="rd-badge rd-badge-warning"><Icon name="key" size={10} />{protectedCount} protegidas</span>}
        {conds.length > 0 && <span className="rd-badge rd-badge-flow"><Icon name="filter" size={10} /><span>{conds.length} filtro{conds.length > 1 ? 's' : ''}</span></span>}
      </div>
      {conds.length > 0 && <div className="rd-mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 7, padding: '5px 8px', background: 'var(--surface-2)', borderRadius: 6, whiteSpace: 'pre-wrap' }}>WHERE {conds.join('\n  AND ')}</div>}
    </div>
  );
}

interface InspectorProps {
  table: Table;
  tables: Table[];
  relationships: Relationship[];
  layers: ModelLevel[];
  domains: Domain[];
  engineShort?: string;
  onClose: () => void;
  onEditTable: (t: Table) => void;
  onNewView: (t: Table) => void;
  onEditView: (t: Table, v: View) => void;
  onDeleteView: (t: Table, v: View) => void;
  onExportDDL: () => void;
}

export default function Inspector({
  table, tables, relationships, layers, domains, engineShort,
  onClose, onEditTable, onNewView, onEditView, onDeleteView, onExportDDL,
}: InspectorProps) {
  const [tab, setTab] = useState<'columns' | 'views' | 'links'>('columns');

  const D = findDomain(domains, table.domain);
  const L = findLayer(layers, table.layer);
  const views = table.views ?? [];
  const biz = views.filter((v) => v.type === 'business');
  const tech = views.filter((v) => v.type === 'technical');
  const rels = relationships.filter((r) => r.source.table === table.id || r.target.table === table.id);

  return (
    <div className="ed-inspector">
      <div className="ins-head">
        <span className="ins-ico" style={{ background: (table.color ?? '#4f46e5') + '1a', color: table.color }}><Icon name="table" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{table.schema}.{table.name}</div>
          <div className="rd-small">{engineShort ?? ''}</div>
        </div>
        <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={onClose}><Icon name="x" size={15} /></button>
      </div>

      <div style={{ padding: '0 14px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {L && <span className="rd-badge" style={{ background: (L.color ?? '#4f46e5') + '1a', color: L.color }} title={L.full}>{L.name}</span>}
        {D && <span className="rd-badge" style={{ background: (D.color ?? '#4f46e5') + '1a', color: D.color }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: D.color }} />{D.name}</span>}
        {table.subdomain && <span className="rd-badge rd-badge-neutral">{table.subdomain}</span>}
      </div>
      {D && (D.owner || D.steward) && (
        <div className="rd-small" style={{ padding: '0 14px 10px', display: 'flex', gap: 12 }}>
          {D.owner && <span><b style={{ color: 'var(--ink-2)' }}>Owner:</b> {D.owner}</span>}
          {D.steward && <span><b style={{ color: 'var(--ink-2)' }}>Steward:</b> {D.steward}</span>}
        </div>
      )}
      {table.functionalDefinition && <div className="rd-small" style={{ padding: '0 14px 12px' }}>{table.functionalDefinition}</div>}

      <div className="rd-tabs" style={{ padding: '0 8px' }}>
        <button className={tab === 'columns' ? 'active' : ''} onClick={() => setTab('columns')}>Columns <span className="ins-count">{table.columns.length}</span></button>
        <button className={tab === 'views' ? 'active' : ''} onClick={() => setTab('views')}>Views <span className="ins-count">{views.length}</span></button>
        <button className={tab === 'links' ? 'active' : ''} onClick={() => setTab('links')}>Links <span className="ins-count">{rels.length}</span></button>
      </div>

      <div className="ins-body">
        {tab === 'columns' && (
          <div>
            {table.columns.map((c) => {
              const k = c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : c.isSurrogateKey ? 'SK' : c.isPartitionKey ? 'PT' : '';
              return (
                <div className="ins-col" key={c.id}>
                  {k ? <span className={`rd-key ${k.toLowerCase()}`}>{k}</span> : <span className="rd-key none"><span className="d" /></span>}
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 12.5 }}>{c.name}</span>
                  {c.isNullable !== false && <span className="rd-row" style={{ padding: 0 }}><span className="nul" /></span>}
                  <span className="rd-mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{c.dataType}</span>
                </div>
              );
            })}
            <button className="rd-btn rd-btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={() => onEditTable(table)}><Icon name="edit" size={14} />Editar columnas</button>
          </div>
        )}

        {tab === 'views' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '9px 11px', background: 'var(--flow-soft)', borderRadius: 'var(--r-sm)' }}>
              <Icon name="info" size={14} style={{ color: 'var(--flow-700)', flexShrink: 0 }} />
              <span className="rd-small" style={{ color: 'var(--flow-700)' }}>Las vistas son proyecciones por rol — no forman parte del diagrama ER. Se exportan con el DDL.</span>
            </div>
            <button className="rd-btn rd-btn-primary" style={{ width: '100%', marginBottom: 14 }} onClick={() => onNewView(table)}><Icon name="plus" size={14} sw={2.6} />Nueva vista</button>

            {views.length === 0 && <div className="dmh-empty" style={{ padding: '24px 10px' }}><div className="ico"><Icon name="eye" size={36} /></div>Sin vistas. Crea una por rol para controlar el acceso a columnas.</div>}

            {biz.length > 0 && <div className="ins-grouplbl"><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)' }} />Business · {biz.length}</div>}
            {biz.map((v) => <ViewCard key={v.id} v={v} onEdit={(vv) => onEditView(table, vv)} onDelete={(vv) => onDeleteView(table, vv)} />)}

            {tech.length > 0 && <div className="ins-grouplbl" style={{ marginTop: biz.length ? 12 : 0 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--flow)' }} />Technical · {tech.length}</div>}
            {tech.map((v) => <ViewCard key={v.id} v={v} onEdit={(vv) => onEditView(table, vv)} onDelete={(vv) => onDeleteView(table, vv)} />)}

            {views.length > 0 && <button className="rd-btn rd-btn-ghost" style={{ width: '100%', marginTop: 14 }} onClick={onExportDDL}><Icon name="download" size={14} />Exportar DDL con vistas</button>}
          </div>
        )}

        {tab === 'links' && (
          <div>
            {rels.length === 0 && <div className="dmh-empty" style={{ padding: '24px 10px' }}><div className="ico"><Icon name="merge" size={36} /></div>Sin relaciones. Usa el modo Conectar en el canvas.</div>}
            {rels.map((r) => {
              const out = r.source.table === table.id;
              const other = out ? r.target : r.source;
              const otherT = tables.find((t) => t.id === other.table);
              const myCol = (out ? r.source.column : r.target.column).split('.').pop();
              const otherCol = other.column.split('.').pop();
              return (
                <div className="ins-link" key={r.id}>
                  <span className={`rd-key ${out ? 'fk' : 'pk'}`} style={{ minWidth: 20 }}>{out ? 'FK' : 'PK'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{myCol}</div>
                    <div className="rd-small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="chevR" size={11} />{otherT ? otherT.name : other.table}.{otherCol}</div>
                  </div>
                  <span className="rd-badge rd-badge-flow">{r.cardinality}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
