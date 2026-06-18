'use client';

import React from 'react';
import Icon, { type IconName } from '@/components/ui/Icon';
import { getEngine } from '@/features/engines';
import { GOV_SEV_COLOR } from '../lib/catalog';
import type { DatabaseEngine } from '@/types/model';

type Sev = 'medium' | 'info' | 'critical';

export interface OverviewTabProps {
  stats: { projects: number; models: number; tables: number; views: number; columns: number };
  byEngine: [string, number][];
  byDomain: [string, { n: number; color: string }][];
  gov: { nopk: number; nodomain: number; noview: number; pii: number };
  onFlagNav: (f: 'nopk' | 'nodomain' | 'noview') => void;
  onPIINav: () => void;
}

/** Overview dashboard: headline stats + tables-by-engine/domain + governance health. */
export default function OverviewTab({ stats, byEngine, byDomain, gov, onFlagNav, onPIINav }: OverviewTabProps) {
  return (
    <>
      <div className="dash-stats">
        {([['folder', stats.projects, 'Projects', 'Activos en el workspace'], ['layers', stats.models, 'Data Models', 'Niveles de modelado'], ['database', stats.tables, 'Tables', 'Catalogadas con éxito'], ['eye', stats.views, 'Views', 'Expuestas al negocio'], ['columns', stats.columns, 'Columns', 'Metadatos parseados']] as [IconName, number, string, string][]).map(([ic, v, l, cap]) => (
          <div className="dash-stat" key={l}>
            <div className="dash-stat-top">
              <span className="dash-stat-lbl">{l}</span>
              <Icon name={ic} size={16} className="dash-stat-ico" />
            </div>
            <div className="dash-stat-val">{v}</div>
            <div className="dash-stat-cap">{cap}</div>
          </div>
        ))}
      </div>
      <div className="mc-panels">
        <div className="rd-card mc-panel">
          <div className="mc-cardhead">
            <span className="mc-cardlbl"><Icon name="database" size={13} />Tablas por engine</span>
            <span className="mc-pill">{byEngine.length} {byEngine.length === 1 ? 'motor' : 'motores'}</span>
          </div>
          {byEngine.map(([e, n]) => {
            const def = getEngine(e as DatabaseEngine);
            const pct = Math.round((n / Math.max(stats.tables, 1)) * 100);
            return (
              <div className="mc-bar" key={e}>
                <span className="mc-bar-lbl"><span style={{ width: 8, height: 8, borderRadius: '50%', background: def?.color }} />{def?.shortLabel ?? e}</span>
                <div className="mc-bar-track"><div className="mc-bar-fill" style={{ width: `${pct}%`, background: def?.color }} /></div>
                <span className="mc-bar-num">{n} <span className="mc-bar-pct">{pct}%</span></span>
              </div>
            );
          })}
        </div>
        <div className="rd-card mc-panel">
          <div className="mc-cardhead">
            <span className="mc-cardlbl"><Icon name="folder" size={13} />Tablas por dominio</span>
            <span className="mc-pill">{byDomain.length} {byDomain.length === 1 ? 'dominio' : 'dominios'}</span>
          </div>
          {byDomain.map(([d, { n, color }]) => {
            const pct = Math.round((n / Math.max(stats.tables, 1)) * 100);
            return (
              <div className="mc-bar" key={d}>
                <span className="mc-bar-lbl"><span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />{d}</span>
                <div className="mc-bar-track"><div className="mc-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                <span className="mc-bar-num">{n} <span className="mc-bar-pct">{pct}%</span></span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="rd-card mc-panel">
        <div className="mc-cardhead">
          <span className="mc-cardlbl"><Icon name="shield" size={13} />Salud y gobierno del modelo</span>
        </div>
        <div className="mc-gov-grid">
          {([
            [gov.nopk, 'Tablas sin clave primaria', 'Afecta el rendimiento de queries.', 'medium', () => onFlagNav('nopk')],
            [gov.nodomain, 'Tablas sin dominio asignado', 'Dificulta el catalogado del modelo.', 'medium', () => onFlagNav('nodomain')],
            [gov.noview, 'Tablas sin ninguna vista', 'Bajo consumo interno actual.', 'info', () => onFlagNav('noview')],
            [gov.pii, 'Columnas sensibles (PII)', 'Requiere enmascaramiento.', 'critical', onPIINav],
          ] as [number, string, string, Sev, () => void][]).map(([n, title, cap, sev, on]) => (
            <button className="mc-gov" key={title} onClick={on}>
              <div className="mc-gov-top">
                <span className="mc-gov-v" style={{ color: n ? GOV_SEV_COLOR[sev] : 'var(--success)' }}>{n}</span>
                <span className={`mc-gov-sev sev-${sev}`}>{sev}</span>
              </div>
              <div className="mc-gov-t">{title}</div>
              <div className="mc-gov-cap">{cap}</div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
