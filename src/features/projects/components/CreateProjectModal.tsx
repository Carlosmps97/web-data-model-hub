'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string }) => void;
}

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const reset = () => { setName(''); setDescription(''); setError(''); };
  const handleClose = () => { reset(); onClose(); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('El nombre del proyecto es obligatorio'); return; }
    onSubmit({ name: name.trim(), description: description.trim() });
    reset();
  };

  return (
    <Modal
      title="Nuevo proyecto"
      subtitle="Un contenedor de modelos (niveles), dominios y tablas"
      icon="grid"
      onClose={handleClose}
      footer={
        <>
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm" onClick={handleClose}>Cancelar</button>
          <button type="submit" form="create-project-form" className="rd-btn rd-btn-primary rd-btn-sm">
            <Icon name="plus" size={14} sw={2.6} />Crear proyecto
          </button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label className="rd-label" htmlFor="project-name">Nombre</label>
          <input
            id="project-name"
            className="rd-input"
            type="text"
            placeholder="Ej. Lakehouse"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            autoFocus
          />
          {error && <p className="rd-small" style={{ color: 'var(--error)', marginTop: 6 }}>{error}</p>}
        </div>
        <div>
          <label className="rd-label" htmlFor="project-desc">Descripción (opcional)</label>
          <textarea
            id="project-desc"
            className="rd-input"
            placeholder="¿Para qué sirve este proyecto?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
      </form>
    </Modal>
  );
};

export default CreateProjectModal;
