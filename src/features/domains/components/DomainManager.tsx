'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useModelStore } from '@/store/useModelStore';
import ConfirmDialog, { shouldSkipConfirm } from '@/components/ui/ConfirmDialog';
import type { DomainDefinition, SubdomainDefinition, Tag } from '@/types/model';
import { tagId } from '@/lib/tags';

// ─── Palette de colores predefinidos para dominios ─────────────────────────
const DOMAIN_COLORS = [
  '#0d9488', '#4f46e5', '#0369a1', '#7c3aed',
  '#b45309', '#16a34a', '#dc2626', '#0891b2',
  '#9333ea', '#db2777',
];

interface DomainManagerProps {
  onClose: () => void;
}

export default function DomainManager({ onClose }: DomainManagerProps) {
  const { domainCatalog, addDomain, updateDomain, removeDomain } = useModelStore();
  const [selectedId, setSelectedId] = useState<string | null>(
    domainCatalog[0]?.id ?? null
  );

  const selectedDomain = domainCatalog.find((d) => d.id === selectedId) ?? null;

  // ── Domain form state ──────────────────────────────────────────────────
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editColor, setEditColor] = useState(DOMAIN_COLORS[0]);
  const [editSchema, setEditSchema] = useState('');
  const [editTags, setEditTags] = useState<Tag[]>([]);
  const [tagKeyDraft, setTagKeyDraft] = useState('');
  const [tagValueDraft, setTagValueDraft] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const addEditTag = () => {
    const k = tagKeyDraft.trim();
    const v = tagValueDraft.trim();
    if (!k && !v) return;
    const next: Tag = { key: k, value: v };
    if (editTags.some((t) => t.key === next.key && t.value === next.value)) {
      setTagKeyDraft('');
      setTagValueDraft('');
      return;
    }
    setEditTags([...editTags, next]);
    setTagKeyDraft('');
    setTagValueDraft('');
  };

  const removeEditTagAt = (idx: number) => setEditTags(editTags.filter((_, i) => i !== idx));

  // ── Subdomain form state ───────────────────────────────────────────────
  const [subName, setSubName] = useState('');
  const [subCode, setSubCode] = useState('');
  const [subSchema, setSubSchema] = useState('');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);

  // ── Confirm-dialog state ───────────────────────────────────────────────
  const [pendingDomainDelete, setPendingDomainDelete] = useState<{ id: string; name: string } | null>(null);

  const startNewDomain = () => {
    setIsAdding(true);
    setSelectedId(null);
    setEditName('');
    setEditCode('');
    setEditDesc('');
    setEditColor(DOMAIN_COLORS[domainCatalog.length % DOMAIN_COLORS.length]);
    setEditSchema('');
    setEditTags([]);
    setTagKeyDraft('');
    setTagValueDraft('');
  };

  const selectDomain = (d: DomainDefinition) => {
    setIsAdding(false);
    setSelectedId(d.id);
    setEditName(d.name);
    setEditCode(d.code ?? '');
    setEditDesc(d.description ?? '');
    setEditColor(d.color ?? DOMAIN_COLORS[0]);
    setEditSchema(d.defaults?.schema ?? '');
    setEditTags(d.defaults?.tags ?? []);
    setTagKeyDraft('');
    setTagValueDraft('');
    setSubName('');
    setSubCode('');
    setSubSchema('');
    setEditingSubId(null);
  };

  const saveDomain = () => {
    if (!editName.trim()) return;
    const tags = editTags;
    if (isAdding) {
      const newDomain: DomainDefinition = {
        id: uuidv4(),
        name: editName.trim(),
        code: editCode.trim() || undefined,
        description: editDesc.trim() || undefined,
        color: editColor,
        subdomains: [],
        defaults: {
          schema: editSchema.trim() || undefined,
          tags: tags.length ? tags : undefined,
        },
      };
      addDomain(newDomain);
      setSelectedId(newDomain.id);
      setIsAdding(false);
    } else if (selectedDomain) {
      updateDomain(selectedDomain.id, {
        name: editName.trim(),
        code: editCode.trim() || undefined,
        description: editDesc.trim() || undefined,
        color: editColor,
        defaults: {
          schema: editSchema.trim() || undefined,
          tags: tags.length ? tags : undefined,
        },
      });
    }
  };

  const performDomainDelete = (id: string) => {
    removeDomain(id);
    setSelectedId(domainCatalog.find((d) => d.id !== id)?.id ?? null);
    setIsAdding(false);
  };

  const deleteDomain = (id: string) => {
    if (shouldSkipConfirm('domain-manager:delete-domain')) {
      performDomainDelete(id);
      return;
    }
    const d = domainCatalog.find((x) => x.id === id);
    setPendingDomainDelete({ id, name: d?.name ?? 'this domain' });
  };

  // ── Subdomain operations ───────────────────────────────────────────────
  const addSubdomain = () => {
    if (!subName.trim() || !selectedDomain) return;
    const tags = subSchema ? [] : [];
    const newSub: SubdomainDefinition = {
      id: uuidv4(),
      name: subName.trim(),
      code: subCode.trim() || undefined,
      defaults: { schema: subSchema.trim() || undefined },
    };
    updateDomain(selectedDomain.id, {
      subdomains: [...selectedDomain.subdomains, newSub],
    });
    setSubName('');
    setSubCode('');
    setSubSchema('');
  };

  const startEditSub = (sub: SubdomainDefinition) => {
    setEditingSubId(sub.id);
    setSubName(sub.name);
    setSubCode(sub.code ?? '');
    setSubSchema(sub.defaults?.schema ?? '');
  };

  const saveSubdomain = () => {
    if (!selectedDomain || !editingSubId || !subName.trim()) return;
    updateDomain(selectedDomain.id, {
      subdomains: selectedDomain.subdomains.map((s) =>
        s.id === editingSubId
          ? { ...s, name: subName.trim(), code: subCode.trim() || undefined, defaults: { schema: subSchema.trim() || undefined } }
          : s
      ),
    });
    setEditingSubId(null);
    setSubName('');
    setSubCode('');
    setSubSchema('');
  };

  const removeSubdomain = (subId: string) => {
    if (!selectedDomain) return;
    updateDomain(selectedDomain.id, {
      subdomains: selectedDomain.subdomains.filter((s) => s.id !== subId),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content modal-large dm-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: 'var(--text-lg)' }}>Gestionar Dominios</h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              Define dominios y subdominios reutilizables con defaults heredables por las tablas del modelo.
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="dm-body">
          {/* Left — domain list */}
          <div className="dm-sidebar">
            <div className="dm-sidebar-header">
              <span className="dm-sidebar-title">Dominios ({domainCatalog.length})</span>
              <button className="btn btn-primary btn-sm" onClick={startNewDomain} type="button">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Nuevo
              </button>
            </div>

            <div className="dm-domain-list">
              {domainCatalog.length === 0 && (
                <div className="dm-empty">Sin dominios. Crea el primero →</div>
              )}
              {domainCatalog.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`dm-domain-item ${selectedId === d.id && !isAdding ? 'active' : ''}`}
                  onClick={() => selectDomain(d)}
                >
                  <span className="dm-domain-dot" style={{ background: d.color ?? '#cbd5e1' }} />
                  <div className="dm-domain-info">
                    <span className="dm-domain-name">{d.name}</span>
                    {d.code && <span className="dm-domain-code">{d.code}</span>}
                  </div>
                  <span className="dm-sub-count">{d.subdomains.length}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right — domain/subdomain editor */}
          <div className="dm-editor">
            {!selectedDomain && !isAdding ? (
              <div className="dm-editor-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                <p>Seleccioná un dominio o creá uno nuevo</p>
              </div>
            ) : (
              <>
                {/* Domain form */}
                <div className="dm-section">
                  <div className="dm-section-title">
                    {isAdding ? 'Nuevo dominio' : 'Editar dominio'}
                  </div>

                  <div className="form-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="input-label">Nombre <span className="tf-required">*</span></label>
                      <input className="input" placeholder="e.g. Campañas CRM" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <div className="form-group" style={{ flex: '0 0 110px' }}>
                      <label className="input-label">Código</label>
                      <input className="input" placeholder="CRM" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="input-label">Descripción</label>
                    <input className="input" placeholder="Descripción del dominio" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                  </div>

                  {/* Color picker */}
                  <div className="form-group">
                    <label className="input-label">Color</label>
                    <div className="dm-color-grid">
                      {DOMAIN_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`dm-color-swatch ${editColor === c ? 'selected' : ''}`}
                          style={{ background: c }}
                          onClick={() => setEditColor(c)}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="dm-section-title" style={{ marginTop: 'var(--space-3)' }}>Defaults heredables</div>
                  <div className="form-group">
                    <label className="input-label">Schema por defecto</label>
                    <input className="input" placeholder="e.g. bcp_ddv_crm" value={editSchema} onChange={(e) => setEditSchema(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Tags (clave-valor)</label>
                    <small className="tf-help" style={{ display: 'block', marginBottom: 6 }}>
                      Se heredan por cada tabla asignada a este dominio.
                    </small>
                    {editTags.length > 0 && (
                      <div className="tag-kv-list">
                        {editTags.map((t, idx) => (
                          <span key={`${tagId(t)}-${idx}`} className="tag-chip tag-chip--kv">
                            {t.key && <span className="tag-chip-key">{t.key}</span>}
                            {t.key && t.value && <span className="tag-chip-sep">:</span>}
                            {t.value && <span className="tag-chip-value">{t.value}</span>}
                            <button
                              type="button"
                              className="tag-chip-remove"
                              onClick={() => removeEditTagAt(idx)}
                              aria-label="Remove tag"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="tag-kv-row">
                      <input
                        className="input tag-kv-input tag-kv-input--key"
                        type="text"
                        placeholder="key (e.g. owner)"
                        value={tagKeyDraft}
                        onChange={(e) => setTagKeyDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEditTag(); } }}
                      />
                      <span className="tag-kv-sep">=</span>
                      <input
                        className="input tag-kv-input tag-kv-input--value"
                        type="text"
                        placeholder="value (e.g. crm)"
                        value={tagValueDraft}
                        onChange={(e) => setTagValueDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEditTag(); } }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={addEditTag}
                        disabled={!tagKeyDraft.trim() && !tagValueDraft.trim()}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                    {!isAdding && selectedDomain && (
                      <button className="btn btn-danger btn-sm" type="button" onClick={() => deleteDomain(selectedDomain.id)}>
                        Eliminar dominio
                      </button>
                    )}
                    <button className="btn btn-primary btn-sm" type="button" onClick={saveDomain} disabled={!editName.trim()}>
                      {isAdding ? 'Crear dominio' : 'Guardar cambios'}
                    </button>
                  </div>
                </div>

                {/* Subdomains — only shown when editing an existing domain */}
                {!isAdding && selectedDomain && (
                  <div className="dm-section dm-section--sub">
                    <div className="dm-section-title">
                      Subdominios ({selectedDomain.subdomains.length})
                    </div>

                    {selectedDomain.subdomains.map((sub) => (
                      <div key={sub.id} className="dm-sub-row">
                        {editingSubId === sub.id ? (
                          <>
                            <input className="input" style={{ flex: 1 }} value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="Nombre" />
                            <input className="input" style={{ width: 80 }} value={subCode} onChange={(e) => setSubCode(e.target.value)} placeholder="Código" />
                            <input className="input" style={{ width: 130 }} value={subSchema} onChange={(e) => setSubSchema(e.target.value)} placeholder="Schema" />
                            <button className="btn btn-primary btn-sm" type="button" onClick={saveSubdomain}>OK</button>
                            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditingSubId(null)}>✕</button>
                          </>
                        ) : (
                          <>
                            <span className="dm-sub-name">{sub.name}</span>
                            {sub.code && <span className="badge badge-neutral">{sub.code}</span>}
                            {sub.defaults?.schema && <code className="dm-sub-schema">{sub.defaults.schema}</code>}
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                              <button className="btn btn-ghost btn-icon btn-sm" type="button" onClick={() => startEditSub(sub)} title="Editar">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                              <button className="btn btn-ghost btn-icon btn-sm" type="button" onClick={() => removeSubdomain(sub.id)} title="Eliminar">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                                </svg>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}

                    {/* New subdomain row */}
                    {editingSubId === null && (
                      <div className="dm-sub-row dm-sub-new">
                        <input className="input" style={{ flex: 1 }} value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="Nombre del subdominio" />
                        <input className="input" style={{ width: 80 }} value={subCode} onChange={(e) => setSubCode(e.target.value)} placeholder="Código" />
                        <input className="input" style={{ width: 130 }} value={subSchema} onChange={(e) => setSubSchema(e.target.value)} placeholder="Schema (override)" />
                        <button className="btn btn-secondary btn-sm" type="button" onClick={addSubdomain} disabled={!subName.trim()}>
                          Agregar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={pendingDomainDelete !== null}
        title="Eliminar dominio"
        message={
          pendingDomainDelete ? (
            <>
              ¿Eliminar el dominio <strong>{pendingDomainDelete.name}</strong>? Las tablas
              que lo referencien quedarán sin dominio asignado.
            </>
          ) : null
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        dontAskKey="domain-manager:delete-domain"
        onConfirm={() => {
          if (!pendingDomainDelete) return;
          performDomainDelete(pendingDomainDelete.id);
          setPendingDomainDelete(null);
        }}
        onCancel={() => setPendingDomainDelete(null)}
      />
    </div>
  );
}
