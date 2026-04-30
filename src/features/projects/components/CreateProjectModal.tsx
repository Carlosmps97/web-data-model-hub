'use client';

import React, { useState } from 'react';

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    onSubmit({ name: name.trim(), description: description.trim() });
    setName('');
    setDescription('');
    setError('');
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setError('');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal-content animate-scaleIn" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New Project</h3>
          <button className="btn btn-ghost btn-icon" onClick={handleClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="input-label" htmlFor="project-name">Project Name</label>
              <input
                id="project-name"
                className="input"
                type="text"
                placeholder="Enter project name..."
                value={name}
                onChange={(e) => { setName(e.target.value); setError(''); }}
                autoFocus
              />
              {error && (
                <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
                  {error}
                </p>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="input-label" htmlFor="project-desc">Description (optional)</label>
              <textarea
                id="project-desc"
                className="input"
                placeholder="Describe the purpose of this project..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateProjectModal;
