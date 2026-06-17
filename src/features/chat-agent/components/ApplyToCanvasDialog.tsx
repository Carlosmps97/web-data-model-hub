'use client';

// ─────────────────────────────────────────────────────────────────────────
//  Diálogo de "Aplicar al canvas": el agente devuelve tablas agnósticas a la
//  jerarquía, así que acá el usuario elige dónde ubicarlas (Model level +
//  Domain + Subdomain) antes de mezclarlas al proyecto. Se pre-llena con el
//  scope actual del editor.
// ─────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import type { Domain, ModelLevel } from '@/types/model';
import type { Scope } from '@/lib/hierarchy';
import type { ModelingResponse } from '../lib/types';
import type { TablePlacement } from '../lib/mapping';

export interface ApplyToCanvasDialogProps {
  result: ModelingResponse;
  layers: ModelLevel[];
  domains: Domain[];
  scope: Scope;
  onClose: () => void;
  onApply: (placement: TablePlacement) => void;
}

export default function ApplyToCanvasDialog({
  result,
  layers,
  domains,
  scope,
  onClose,
  onApply,
}: ApplyToCanvasDialogProps) {
  // Prefill from the current scope (mirrors the Excel import meta logic):
  // a single-layer / single-domain scope → that one; else first layer / none.
  const [layer, setLayer] = useState<string>(
    scope.layers.length === 1 ? scope.layers[0] : (layers[0]?.id ?? ''),
  );
  const [domain, setDomain] = useState<string>(
    scope.domains.length === 1 ? scope.domains[0] : '',
  );
  const [subdomain, setSubdomain] = useState<string>('');

  const selectedDomain = useMemo(() => domains.find((d) => d.id === domain), [domains, domain]);
  const subOptions = selectedDomain?.subdomains ?? [];
  const tableCount = result.tables.length;

  const onDomainChange = (id: string) => {
    setDomain(id);
    // Reset subdomain when it no longer belongs to the chosen domain.
    const subs = domains.find((d) => d.id === id)?.subdomains ?? [];
    setSubdomain((prev) => (subs.includes(prev) ? prev : ''));
  };

  const handleApply = () => {
    onApply({
      layer: layer || undefined,
      domain: domain || undefined,
      subdomain: subdomain || undefined,
      color: selectedDomain?.color,
    });
  };

  return (
    <Modal
      title="Aplicar al canvas"
      subtitle={`${tableCount} ${tableCount === 1 ? 'tabla' : 'tablas'} del agente — elegí dónde ubicarlas`}
      icon="merge"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="rd-btn rd-btn-primary" onClick={handleApply}>
            <Icon name="merge" size={14} />Aplicar ({tableCount})
          </button>
        </>
      }
    >
      <div className="chat-apply-grid">
        <div className="rd-field">
          <label className="rd-label">Model level</label>
          <div className="dmh-select">
            <select className="rd-input" value={layer} onChange={(e) => setLayer(e.target.value)}>
              <option value="">— Sin nivel —</option>
              {layers.map((l) => <option key={l.id} value={l.id}>{l.name}{l.full ? ` · ${l.full}` : ''}</option>)}
            </select>
            <span className="chev"><Icon name="chevD" size={14} /></span>
          </div>
        </div>

        <div className="rd-field">
          <label className="rd-label">Domain</label>
          <div className="dmh-select">
            <select className="rd-input" value={domain} onChange={(e) => onDomainChange(e.target.value)}>
              <option value="">— Sin dominio —</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span className="chev"><Icon name="chevD" size={14} /></span>
          </div>
        </div>

        <div className="rd-field">
          <label className="rd-label">Subdomain</label>
          <div className="dmh-select">
            <select
              className="rd-input"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              disabled={!selectedDomain || subOptions.length === 0}
            >
              <option value="">{subOptions.length === 0 ? '— (el dominio no tiene subdominios) —' : '— Sin subdominio —'}</option>
              {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="chev"><Icon name="chevD" size={14} /></span>
          </div>
        </div>
      </div>

      <p className="chat-apply-note">
        <Icon name="info" size={13} />
        Las tablas se <strong>mezclan</strong> al proyecto: las que coincidan por nombre se actualizan;
        las nuevas se agregan en el nivel y dominio elegidos. Las relaciones (FK) se dibujan automáticamente.
      </p>
    </Modal>
  );
}
