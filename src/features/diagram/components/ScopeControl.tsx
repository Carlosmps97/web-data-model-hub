'use client';

import React, { useState } from 'react';
import Icon from '@/components/ui/Icon';
import type { ModelLevel, Domain } from '@/types/model';
import { type Scope, scopeLabel } from '@/lib/hierarchy';

interface ScopeControlProps {
  layers: ModelLevel[];
  domains: Domain[];
  scope: Scope;
  setScope: (s: Scope) => void;
}

/** Editor Scope control — the safety boundary for what's visible & editable. */
export default function ScopeControl({ layers, domains, scope, setScope }: ScopeControlProps) {
  const [open, setOpen] = useState(false);
  const allLayerIds = layers.map((l) => l.id);
  const allDomIds = domains.map((d) => d.id);
  const label = scopeLabel({ layers, domains }, scope);
  const toggleIn = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  return (
    <div style={{ position: 'relative', marginLeft: 8 }}>
      <button className="ed-scope-btn" onClick={() => setOpen((o) => !o)}>
        <Icon name="filter" size={14} />
        <span style={{ fontWeight: 700 }}>Scope:</span>
        <span style={{ color: 'var(--primary-700)', fontWeight: 700 }}>{label}</span>
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setOpen(false)} />
          <div className="ed-scope-pop rd-card">
            <div className="rd-label" style={{ marginBottom: 7, padding: '0 10px' }}>Alcance de edición</div>
            <div className="rd-small" style={{ padding: '0 10px 8px', lineHeight: 1.5 }}>Limita qué tablas ves y editas — edita en el nivel más pequeño necesario.</div>
            <div className="ed-scope-presets">
              <button onClick={() => setScope({ layers: [...allLayerIds], domains: [...allDomIds] })}>Todo el modelo</button>
              {layers.map((l) => <button key={l.id} onClick={() => setScope({ layers: [l.id], domains: [...allDomIds] })}>{l.name} completa</button>)}
              {domains.map((d) => <button key={d.id} onClick={() => setScope({ layers: [...allLayerIds], domains: [d.id] })}>{d.name} (vertical)</button>)}
            </div>
            <div className="rd-menu-sep" />
            <div className="ed-scope-cols">
              <div>
                <div className="rd-label" style={{ marginBottom: 7 }}>Modelos</div>
                {layers.map((l) => {
                  const on = scope.layers.includes(l.id);
                  return (
                    <label key={l.id} className="ed-scope-chk" onClick={(e) => { e.preventDefault(); const next = toggleIn(scope.layers, l.id); if (next.length) setScope({ ...scope, layers: next }); }}>
                      <span className="fs-check" data-on={on}>{on && <Icon name="check" size={11} sw={3} />}</span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color }} />{l.name}
                    </label>
                  );
                })}
              </div>
              <div>
                <div className="rd-label" style={{ marginBottom: 7 }}>Dominios</div>
                {domains.map((d) => {
                  const on = scope.domains.includes(d.id);
                  return (
                    <label key={d.id} className="ed-scope-chk" onClick={(e) => { e.preventDefault(); const next = toggleIn(scope.domains, d.id); if (next.length) setScope({ ...scope, domains: next }); }}>
                      <span className="fs-check" data-on={on}>{on && <Icon name="check" size={11} sw={3} />}</span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color }} />{d.name}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
