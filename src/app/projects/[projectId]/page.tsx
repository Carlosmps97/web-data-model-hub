'use client';

import React, { useEffect, useMemo, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import Icon from '@/components/ui/Icon';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LevelModal from '@/features/levels/components/LevelModal';
import DomainModal from '@/features/domains/components/DomainModal';
import { useProjectStore } from '@/store/useProjectStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { ModelLevel, Domain } from '@/types/model';

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default function ProjectHubPage({ params }: PageProps) {
  const { projectId } = use(params);
  const router = useRouter();

  const {
    currentProject, tables, loading, loadProject,
    addLayer, updateLayer, removeLayer,
    addDomain, updateDomain, removeDomain,
    persistProjectMeta,
  } = useProjectStore();
  const canEdit = useAuthStore((s) => s.canEditProject(projectId));

  const [levelModal, setLevelModal] = useState<{ level: ModelLevel | null } | null>(null);
  const [domainModal, setDomainModal] = useState<{ domain: Domain | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'layer' | 'domain'; id: string; name: string } | null>(null);

  useEffect(() => { loadProject(projectId); }, [projectId, loadProject]);

  const layers = currentProject?.layers ?? [];
  const domains = currentProject?.domains ?? [];

  const counts = useMemo(() => {
    const tablesInLayer = (id: string) => tables.filter((t) => t.layer === id).length;
    const domainsInLayer = (id: string) => new Set(tables.filter((t) => t.layer === id && t.domain).map((t) => t.domain)).size;
    const tablesInDomain = (id: string) => tables.filter((t) => t.domain === id).length;
    return { tablesInLayer, domainsInLayer, tablesInDomain };
  }, [tables]);

  const openEditor = (q = '') => router.push(`/projects/${projectId}/editor${q}`);

  const saveLevel = async (level: ModelLevel, isNew: boolean) => {
    if (isNew) addLayer({ ...level, order: layers.length });
    else updateLayer(level.id, level);
    setLevelModal(null);
    await persistProjectMeta();
  };
  const saveDomain = async (domain: Domain, isNew: boolean) => {
    if (isNew) addDomain(domain);
    else updateDomain(domain.id, domain);
    setDomainModal(null);
    await persistProjectMeta();
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'layer') removeLayer(pendingDelete.id);
    else removeDomain(pendingDelete.id);
    setPendingDelete(null);
    await persistProjectMeta();
  };

  if (!currentProject && loading) {
    return (
      <AppLayout>
        <div className="dmh-main">
          <Header crumbs={[{ label: 'Projects', href: '/projects' }, { label: '…' }]} />
          <div className="dmh-page"><div className="rd-small">Cargando…</div></div>
        </div>
      </AppLayout>
    );
  }
  if (!currentProject) {
    return (
      <AppLayout>
        <div className="dmh-main">
          <Header crumbs={[{ label: 'Projects', href: '/projects' }, { label: 'No encontrado' }]} />
          <div className="dmh-page"><div className="dmh-empty">Proyecto no encontrado.</div></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="dmh-main">
        <Header
          crumbs={[{ label: 'Projects', href: '/projects' }, { label: currentProject.name }]}
          actions={
            <button type="button" className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => openEditor()}>
              <Icon name="columns" size={14} />Abrir canvas
            </button>
          }
        />
        <div className="dmh-page">
          <div className="dmh-page-head">
            <div>
              <div className="rd-h1" style={{ marginBottom: 4 }}>{currentProject.name}</div>
              <div className="rd-small">{currentProject.description || 'Sin descripción'}</div>
            </div>
          </div>

          {/* Modelos (niveles) */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div className="mc-cardlbl" style={{ margin: 0 }}><Icon name="layers" size={13} />Modelos (niveles) · {layers.length}</div>
            {canEdit && (
              <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setLevelModal({ level: null })}>
                <Icon name="plus" size={14} sw={2.6} />Nuevo modelo
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 14, marginBottom: 26 }}>
            {layers.length === 0 && <div className="rd-small">Aún no hay modelos. Crea el primero para empezar.</div>}
            {layers.map((l) => (
              <div className="dmh-pcard" key={l.id} onClick={() => openEditor(`?layer=${encodeURIComponent(l.id)}`)}>
                {canEdit && (
                  <div className="dmh-pcard-del" style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setLevelModal({ level: l })}><Icon name="edit" size={13} /></button>
                    <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setPendingDelete({ kind: 'layer', id: l.id, name: l.name })}><Icon name="trash" size={13} style={{ color: 'var(--error)' }} /></button>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span className="lv-card-ico" style={{ background: (l.color ?? '#4f46e5') + '1a', color: l.color }}><Icon name="database" size={16} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{l.name}</div>
                    <div className="rd-small">{l.full}</div>
                  </div>
                </div>
                <div className="rd-small" style={{ marginBottom: 12, minHeight: 18 }}>{l.desc}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="rd-badge rd-badge-neutral"><Icon name="table" size={11} />{counts.tablesInLayer(l.id)} tablas</span>
                  <span className="rd-badge rd-badge-primary">{counts.domainsInLayer(l.id)} dominios</span>
                </div>
              </div>
            ))}
          </div>

          {/* Dominios */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div className="mc-cardlbl" style={{ margin: 0 }}><Icon name="folder" size={13} />Dominios (productos de datos) · {domains.length}</div>
            {canEdit && (
              <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setDomainModal({ domain: null })}>
                <Icon name="plus" size={14} sw={2.6} />Nuevo dominio
              </button>
            )}
          </div>
          <div className="mc-gridwrap">
            <table className="mc-grid">
              <thead>
                <tr>
                  <th className="mc-th">Dominio</th>
                  <th className="mc-th">Owner</th>
                  <th className="mc-th">Steward</th>
                  <th className="mc-th">Sensibilidad</th>
                  <th className="mc-th">Capas</th>
                  <th className="mc-th" style={{ textAlign: 'right', width: 64 }}>Tablas</th>
                  <th className="mc-th" style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {domains.length === 0 && (
                  <tr><td colSpan={7}><div className="rd-small" style={{ padding: '14px' }}>Aún no hay dominios.</div></td></tr>
                )}
                {domains.map((d) => (
                  <tr key={d.id} onClick={() => openEditor(`?domain=${encodeURIComponent(d.id)}`)}>
                    <td>
                      <span className="mc-name"><span style={{ width: 12, height: 12, borderRadius: 3, background: d.color }} />{d.name}</span>
                      <div className="rd-small" style={{ marginTop: 2, maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.description}</div>
                    </td>
                    <td className="mc-dim">{d.owner || '—'}</td>
                    <td className="mc-dim">{d.steward || '—'}</td>
                    <td><span className={`rd-badge ${d.sensitivity === 'PII' || d.sensitivity === 'Restricted' ? 'rd-badge-warning' : 'rd-badge-neutral'}`}>{d.sensitivity ?? 'Internal'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(d.layers ?? []).map((lid) => {
                          const L = layers.find((x) => x.id === lid);
                          return <span key={lid} className="ed-layer-pill" style={{ color: L?.color ?? '#888', borderColor: L?.color ?? '#888' }}>{L?.name ?? lid}</span>;
                        })}
                      </div>
                    </td>
                    <td className="mc-num">{counts.tablesInDomain(d.id)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setDomainModal({ domain: d })}><Icon name="edit" size={13} /></button>
                          <button type="button" className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => setPendingDelete({ kind: 'domain', id: d.id, name: d.name })}><Icon name="trash" size={13} style={{ color: 'var(--error)' }} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {levelModal && <LevelModal level={levelModal.level} onClose={() => setLevelModal(null)} onSave={saveLevel} />}
      {domainModal && <DomainModal domain={domainModal.domain} layers={layers} onClose={() => setDomainModal(null)} onSave={saveDomain} />}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'layer' ? 'Eliminar modelo' : 'Eliminar dominio'}
        message={pendingDelete ? <>¿Eliminar <strong>{pendingDelete.name}</strong>? Las tablas que lo usaban quedarán sin asignar.</> : null}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </AppLayout>
  );
}
