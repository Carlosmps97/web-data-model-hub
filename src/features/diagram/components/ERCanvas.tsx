'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Icon from '@/components/ui/Icon';
import type { Table, Relationship, ModelLevel, Domain, Cardinality } from '@/types/model';
import { NODE_W, HEADER, ROW, ROWS_PAD, nodeHeight, type Positions, type ArrangeKind } from '../layout/layouts';
import { layerGap, findLayer, findDomain, domainName } from '@/lib/hierarchy';

export interface ERModel {
  tables: Table[];
  relationships: Relationship[];
  positions: Positions;
  layers: ModelLevel[];
  domains: Domain[];
}

interface ERCanvasProps {
  model: ERModel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onCreateRel: (rel: Relationship) => void;
  onArrange: (kind: ArrangeKind) => void;
  onGear: (id: string, action: 'edit' | 'color' | 'delete', payload?: string) => void;
  pushToast: (msg: string, type?: 'err') => void;
}

const colIndex = (t: Table, colId: string) => t.columns.findIndex((c) => c.id === colId);

function anchor(model: ERModel, tableId: string, colId: string, side: 'left' | 'right') {
  const t = model.tables.find((x) => x.id === tableId);
  if (!t) return null;
  const i = colIndex(t, colId);
  if (i < 0) return null;
  const p = model.positions[tableId];
  if (!p) return null;
  return { x: side === 'right' ? p.x + NODE_W : p.x, y: p.y + HEADER + ROWS_PAD + i * ROW + ROW / 2 };
}

function CrowFoot({ x, y, side, one }: { x: number; y: number; side: 'left' | 'right'; one: boolean }) {
  const d = side === 'right' ? 1 : -1;
  const o = 7 * d;
  if (one) return <line x1={x + o} y1={y - 7} x2={x + o} y2={y + 7} stroke="var(--flow)" strokeWidth="2.4" strokeLinecap="round" />;
  return (
    <g stroke="var(--flow)" strokeWidth="2.4" strokeLinecap="round" fill="none">
      <path d={`M${x + o},${y - 7} L${x},${y} L${x + o},${y + 7}`} />
      <line x1={x} y1={y} x2={x + o} y2={y} />
    </g>
  );
}

const HEADER_COLORS = ['#4f46e5', '#0d9488', '#7c3aed', '#0e7490', '#b45309', '#475569'];

export default function ERCanvas({ model, selectedId, onSelect, onMove, onCreateRel, onArrange, onGear, pushToast }: ERCanvasProps) {
  const [tf, setTf] = useState({ x: 40, y: 20, scale: 0.82 });
  const [hover, setHover] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'connect'>('select');
  const [connectSrc, setConnectSrc] = useState<{ table: string; column: string; name: string } | null>(null);
  const [card, setCard] = useState<Cardinality>('1:N');
  const [gearId, setGearId] = useState<string | null>(null);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panning = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);
  const pos = model.positions;

  const fit = useCallback(() => {
    const w = wrapRef.current;
    if (!w) return;
    const rect = w.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    model.tables.forEach((t) => {
      const p = pos[t.id];
      if (!p) return;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + nodeHeight(t));
    });
    if (!isFinite(minX)) return;
    const pad = 80;
    const cw = maxX - minX + pad * 2, ch = maxY - minY + pad * 2;
    const scale = Math.min(rect.width / cw, rect.height / ch, 1.1);
    setTf({ scale, x: (rect.width - cw * scale) / 2 - (minX - pad) * scale, y: (rect.height - ch * scale) / 2 - (minY - pad) * scale });
  }, [model.tables, pos]);

  // Fit once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fit(); }, []);

  // Wheel zoom.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setTf((t) => {
        const factor = Math.exp(-e.deltaY * 0.0014);
        const ns = Math.min(2.2, Math.max(0.25, t.scale * factor));
        const k = ns / t.scale;
        return { scale: ns, x: px - (px - t.x) * k, y: py - (py - t.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (tool === 'connect') return;
    e.stopPropagation();
    onSelect(id);
    setGearId(null);
    const start = { mx: e.clientX, my: e.clientY, px: pos[id].x, py: pos[id].y };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.mx) / tf.scale, dy = (ev.clientY - start.my) / tf.scale;
      onMove(id, { x: Math.round(start.px + dx), y: Math.round(start.py + dy) });
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const startPan = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.er-node') || target.closest('.ed-dock') || target.closest('.ed-connect') || target.closest('.er-gear-menu')) return;
    onSelect(null);
    setGearId(null);
    panning.current = { mx: e.clientX, my: e.clientY, x: tf.x, y: tf.y };
    const move = (ev: PointerEvent) => setTf((t) => ({ ...t, x: panning.current!.x + (ev.clientX - panning.current!.mx), y: panning.current!.y + (ev.clientY - panning.current!.my) }));
    const up = () => { panning.current = null; document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const onRowClick = (tableId: string, c: Table['columns'][number]) => {
    if (tool !== 'connect') return;
    if (!connectSrc) { setConnectSrc({ table: tableId, column: c.id, name: c.name }); return; }
    if (connectSrc.table === tableId) { pushToast('Elige una columna en otra tabla', 'err'); return; }
    onCreateRel({ id: uuidv4(), source: { table: connectSrc.table, column: connectSrc.column }, target: { table: tableId, column: c.id }, cardinality: card });
    setConnectSrc(null);
  };

  const focusId = hover ?? selectedId;
  const activeRels = new Set<string>();
  const activeCols = new Set<string>();
  if (focusId) {
    model.relationships.forEach((r) => {
      if (r.source.table === focusId || r.target.table === focusId) {
        activeRels.add(r.id);
        activeCols.add(r.source.column);
        activeCols.add(r.target.column);
      }
    });
  }

  const LN = (id?: string) => findLayer(model.layers, id)?.name ?? id ?? '';

  const edges = model.relationships.map((r) => {
    const sp = pos[r.source.table], tp = pos[r.target.table];
    if (!sp || !tp) return null;
    const scx = sp.x + NODE_W / 2, tcx = tp.x + NODE_W / 2;
    const sideS: 'left' | 'right' = scx <= tcx ? 'right' : 'left';
    const sideT: 'left' | 'right' = scx <= tcx ? 'left' : 'right';
    const a = anchor(model, r.source.table, r.source.column, sideS);
    const b = anchor(model, r.target.table, r.target.column, sideT);
    if (!a || !b) return null;
    const c1 = a.x + (sideS === 'right' ? 56 : -56), c2 = b.x + (sideT === 'right' ? 56 : -56);
    const st = model.tables.find((x) => x.id === r.source.table);
    const tt = model.tables.find((x) => x.id === r.target.table);
    const gap = st && tt ? layerGap(model.layers, st.layer, tt.layer) : 0;
    return {
      r, a, b, sideS, sideT, gap, sLayer: st?.layer, tLayer: tt?.layer,
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      d: `M${a.x},${a.y} C${c1},${a.y} ${c2},${b.y} ${b.x},${b.y}`,
      active: activeRels.has(r.id),
    };
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  return (
    <div className="ed-canvas" ref={wrapRef} onPointerDown={startPan} style={{ cursor: panning.current ? 'grabbing' : 'default' }}>
      <div className="er-world" style={{ transform: `translate(${tf.x}px,${tf.y}px) scale(${tf.scale})` }}>
        <svg className="er-edges" width="4000" height="3000">
          {edges.map(({ r, d, active, a, b, sideS, sideT, gap, sLayer, tLayer, mx, my }) => {
            const skip = gap > 1;
            const baseStroke = skip ? '#d97706' : active ? 'var(--flow)' : gap > 0 ? '#9aa6c2' : '#b9c2cf';
            const dash = skip ? '7 5' : gap > 0 ? '2 5' : 'none';
            return (
              <g key={r.id} style={{ opacity: focusId && !active ? 0.28 : 1 }}>
                <path d={d} className="rd-wire-base" style={{ stroke: baseStroke, strokeWidth: skip ? 2.6 : 2, strokeDasharray: dash }} />
                {active && <path d={d} className="rd-wire-flow" />}
                <CrowFoot x={a.x} y={a.y} side={sideS} one={false} />
                <CrowFoot x={b.x} y={b.y} side={sideT} one />
                {(skip || (gap > 0 && active)) && (
                  <g transform={`translate(${mx},${my})`}>
                    <rect x={-26} y={-9} width={52} height={18} rx={5} fill={skip ? '#fbf0e2' : '#ffffff'} stroke={skip ? '#d97706' : '#d3d8e0'} strokeWidth={1} />
                    {skip && <text x={-19} y={3.5} fontSize="11" fontWeight="800" fill="#d97706">!</text>}
                    <text x={skip ? 3 : 0} y={3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={skip ? '#b45309' : '#6b7280'} style={{ fontFamily: 'var(--mono)' }}>{LN(sLayer)}→{LN(tLayer)}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {model.tables.map((t) => {
          const p = pos[t.id];
          if (!p) return null;
          const sel = selectedId === t.id;
          const L = findLayer(model.layers, t.layer);
          const D = findDomain(model.domains, t.domain);
          return (
            <div className="er-node" key={t.id} style={{ left: p.x, top: p.y, zIndex: sel || hover === t.id ? 5 : 2 }}
              onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover((h) => (h === t.id ? null : h))}>
              <div className={`rd-node${sel ? ' selected' : ''}`}>
                <div className="rd-node-head" style={{ background: t.color, height: HEADER }} onPointerDown={(e) => startDrag(e, t.id)}>
                  <span className="ico"><Icon name="table" size={12} /></span>
                  <span className="rd-node-title"><span className="schema">{t.schema}.</span>{t.name}</span>
                  {t.layer && <span className="rd-node-layer" title={L?.full}>{L?.name ?? t.layer}</span>}
                  {t.columns.some((c) => c.isPartitionKey) && <span className="rd-node-count" title="Particionada"><Icon name="grid" size={10} /></span>}
                  {t.views && t.views.length > 0 && <span className="rd-node-count" title={`${t.views.length} vistas`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="eye" size={10} />{t.views.length}</span>}
                  <span className="rd-node-count">{t.columns.length}</span>
                  <button className="rd-node-gear" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setGearId((g) => (g === t.id ? null : t.id)); }}><Icon name="gear" size={13} /></button>
                </div>
                <div className="rd-node-rows" style={{ padding: ROWS_PAD }}>
                  {t.columns.map((c) => {
                    const k = c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : c.isSurrogateKey ? 'SK' : c.isPartitionKey ? 'PT' : '';
                    const act = activeCols.has(c.id);
                    const isSrc = connectSrc?.table === t.id && connectSrc?.column === c.id;
                    return (
                      <div key={c.id} style={{ height: ROW, display: 'flex', alignItems: 'center' }}
                        className={`rd-row er-row${act ? ' active' : ''}${tool === 'connect' ? ' connectable' : ''}${isSrc ? ' connect-source' : ''}`}
                        onMouseEnter={() => setHoverCol(c.id)} onMouseLeave={() => setHoverCol((x) => (x === c.id ? null : x))}
                        onClick={(e) => { e.stopPropagation(); onRowClick(t.id, c); }} onPointerDown={(e) => e.stopPropagation()}>
                        {k ? <span className={`rd-key ${k.toLowerCase()}`}>{k}</span> : <span className="rd-key none"><span className="d" /></span>}
                        <span className="name">{c.name}</span>
                        {c.isNullable !== false && <span className="nul" />}
                        <span className="type">{c.dataType}</span>
                        {hoverCol === c.id && tool !== 'connect' && (c.functionalDefinition || c.foreignKeyRef) && (
                          <div className="er-node-tip"><div className="rd-tip">
                            <strong>{c.name}</strong>
                            {c.functionalDefinition && <span className="dim">{c.functionalDefinition}</span>}
                            {c.foreignKeyRef && <span className="dim" style={{ display: 'block', marginTop: 3 }}>FK → {c.foreignKeyRef.table}.{c.foreignKeyRef.column}</span>}
                          </div></div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {t.functionalDefinition && (
                  <div className="rd-node-foot">
                    {t.domain && <span className="rd-badge" style={{ padding: '1px 7px', fontSize: 9.5, background: (D?.color ?? '#4f46e5') + '1a', color: D?.color ?? 'var(--primary-700)' }}>{domainName(model.domains, t.domain)}</span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.functionalDefinition}</span>
                  </div>
                )}
              </div>

              {gearId === t.id && (
                <div className="er-gear-menu rd-menu" onPointerDown={(e) => e.stopPropagation()}>
                  <button className="rd-menu-item" onClick={() => { setGearId(null); onGear(t.id, 'edit'); }}><Icon name="edit" size={15} />Editar tabla</button>
                  <div className="rd-menu-label">Color de cabecera</div>
                  <div className="er-color-row">
                    {HEADER_COLORS.map((cl) => (
                      <span key={cl} className={`er-color-dot${t.color === cl ? ' sel' : ''}`} style={{ background: cl }} onClick={() => onGear(t.id, 'color', cl)} />
                    ))}
                  </div>
                  <div className="rd-menu-sep" />
                  <button className="rd-menu-item danger" onClick={() => { setGearId(null); onGear(t.id, 'delete'); }}><Icon name="trash" size={14} />Eliminar tabla</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tool === 'connect' && (
        <div className="ed-connect rd-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ width: 26, height: 26, borderRadius: 'var(--r-sm)', background: 'var(--flow-soft)', color: 'var(--flow-700)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="merge" size={15} /></span>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Modo conectar</span>
            <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setTool('select'); setConnectSrc(null); }}><Icon name="x" size={14} /></button>
          </div>
          <div className="rd-small" style={{ marginBottom: 12 }}>
            {connectSrc
              ? <span><b style={{ color: 'var(--ink)' }}>{connectSrc.name}</b> seleccionada — haz clic en la columna destino.</span>
              : 'Haz clic en una columna origen, luego en una columna destino de otra tabla.'}
          </div>
          <div className="rd-label" style={{ marginBottom: 7 }}>Cardinalidad</div>
          <div className="rd-seg" style={{ width: '100%' }}>
            {(['1:1', '1:N', 'N:N'] as Cardinality[]).map((c) => <button key={c} className={card === c ? 'active' : ''} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setCard(c)}>{c}</button>)}
          </div>
        </div>
      )}

      <div className="ed-dock rd-dock">
        <button className={`rd-dock-btn${tool === 'select' ? ' active' : ''}`} title="Seleccionar" onClick={() => { setTool('select'); setConnectSrc(null); }}><Icon name="cursor" size={17} /></button>
        <button className={`rd-dock-btn${tool === 'connect' ? ' active' : ''}`} title="Conectar" onClick={() => setTool('connect')}><Icon name="link" size={17} /></button>
        <span className="rd-dock-sep" />
        <div style={{ position: 'relative' }}>
          <button className={`rd-dock-btn${arrangeOpen ? ' active' : ''}`} title="Auto-organizar" onClick={() => setArrangeOpen((o) => !o)}><Icon name="arrange" size={17} /></button>
          {arrangeOpen && (
            <div className="ed-arrange-pop rd-card" onPointerDown={(e) => e.stopPropagation()}>
              {([['byLayer', 'layers', 'Por modelo', 'Bandas por nivel (orden)'], ['snowflake', 'sparkles', 'Snowflake', 'Radial alrededor de la tabla central'], ['compact', 'grid', 'Compacto', 'Grilla ordenada, mínimo espacio']] as [ArrangeKind, 'layers' | 'sparkles' | 'grid', string, string][]).map(([key, ic, lb, ds]) => (
                <button key={key} className="ed-arrange-opt" onClick={() => { onArrange(key); setArrangeOpen(false); setTimeout(fit, 30); }}>
                  <span className="ico"><Icon name={ic} size={18} /></span>
                  <span><div style={{ fontSize: 13, fontWeight: 700 }}>{lb}</div><div className="rd-small">{ds}</div></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="rd-dock-btn" title="Ajustar a pantalla" onClick={fit}><Icon name="fit" size={17} /></button>
        <span className="rd-dock-sep" />
        <button className="rd-dock-btn" title="Alejar" onClick={() => setTf((t) => ({ ...t, scale: Math.max(0.25, t.scale - 0.12) }))}><Icon name="zoomOut" size={17} /></button>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', minWidth: 42, justifyContent: 'center' }}>{Math.round(tf.scale * 100)}%</div>
        <button className="rd-dock-btn" title="Acercar" onClick={() => setTf((t) => ({ ...t, scale: Math.min(2.2, t.scale + 0.12) }))}><Icon name="zoomIn" size={17} /></button>
      </div>

      <Minimap model={model} selectedId={selectedId} />
    </div>
  );
}

function Minimap({ model, selectedId }: { model: ERModel; selectedId: string | null }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  model.tables.forEach((t) => {
    const p = model.positions[t.id];
    if (!p) return;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + nodeHeight(t));
  });
  if (!isFinite(minX)) return <div className="ed-minimap" />;
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const s = Math.min(150 / w, 90 / h);
  return (
    <div className="ed-minimap">
      {model.tables.map((t) => {
        const p = model.positions[t.id];
        if (!p) return null;
        return <div key={t.id} className={`mm-node${selectedId === t.id ? ' sel' : ''}`} style={{ left: 9 + (p.x - minX) * s, top: 9 + (p.y - minY) * s, width: Math.max(8, NODE_W * s), height: Math.max(6, nodeHeight(t) * s) }} />;
      })}
    </div>
  );
}
