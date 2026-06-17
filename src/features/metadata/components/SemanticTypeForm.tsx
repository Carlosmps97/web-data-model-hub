'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Icon from '@/components/ui/Icon';
import { COLUMN_DATA_TYPES, type SemanticType, type SemanticTag } from '@/types/model';

interface Props {
  semanticType: SemanticType | null;
  onClose: () => void;
  onSave: (data: Omit<SemanticType, 'id'>, id?: string) => void;
}

/** Create / edit a Semantic Type — name, inherited data type, and the
 *  controlled-vocabulary tags it carries. */
export default function SemanticTypeForm({ semanticType, onClose, onSave }: Props) {
  const isNew = !semanticType;
  const [name, setName] = useState(semanticType?.name ?? '');
  const [dataType, setDataType] = useState(semanticType?.dataType ?? 'varchar');
  const [description, setDescription] = useState(semanticType?.description ?? '');
  const [tags, setTags] = useState<SemanticTag[]>(semanticType?.tags ?? []);

  const addTag = () => setTags((t) => [...t, { key: '', allowedValues: [] }]);
  const setTag = (i: number, p: Partial<SemanticTag>) => setTags((t) => t.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const delTag = (i: number) => setTags((t) => t.filter((_, j) => j !== i));

  const submit = () => {
    if (!name.trim()) return;
    const cleanTags = tags
      .map((t) => ({ key: t.key.trim(), allowedValues: t.allowedValues.map((v) => v.trim()).filter(Boolean) }))
      .filter((t) => t.key);
    onSave({ name: name.trim(), dataType: dataType.trim() || 'varchar', description: description.trim() || undefined, tags: cleanTags }, semanticType?.id);
  };

  return (
    <Modal
      title={isNew ? 'Nuevo Semantic Type' : 'Editar Semantic Type'}
      subtitle="Clasificación semántica reutilizable — arrastra su tipo y etiquetas a cada columna"
      icon="sparkles"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="rd-btn rd-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="rd-btn rd-btn-primary" disabled={!name.trim()} onClick={submit}><Icon name="check" size={14} sw={2.6} />{isNew ? 'Crear' : 'Guardar'}</button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}><span className="rd-label">Nombre</span><input className="rd-input" value={name} placeholder="Ej. Monto" onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div style={{ width: 180 }}>
          <span className="rd-label">Tipo de dato</span>
          <div className="dmh-select">
            <select className="rd-input" value={dataType} onChange={(e) => setDataType(e.target.value)}>
              {COLUMN_DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Icon name="chevD" size={13} className="chev" />
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}><span className="rd-label">Descripción</span><input className="rd-input" value={description} placeholder="opcional" onChange={(e) => setDescription(e.target.value)} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <span className="rd-label" style={{ margin: 0 }}>Etiquetas con valores controlados · {tags.length}</span>
        <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={addTag}><Icon name="plus" size={13} sw={2.6} />Añadir etiqueta</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tags.length === 0 && <div className="rd-small" style={{ padding: '10px 0', textAlign: 'center' }}>Sin etiquetas. Ej. “Cross Attribute” con valores YES / NO.</div>}
        {tags.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="rd-input" style={{ width: 220 }} value={t.key} placeholder="clave (ej. Data Classification)" onChange={(e) => setTag(i, { key: e.target.value })} />
            <input className="rd-input" style={{ flex: 1 }} value={t.allowedValues.join(', ')} placeholder="valores válidos por coma (ej. DAC, NO DAC)" onChange={(e) => setTag(i, { allowedValues: e.target.value.split(',').map((v) => v.trimStart()) })} />
            <button className="rd-btn rd-btn-icon rd-btn-ghost rd-btn-sm" onClick={() => delTag(i)}><Icon name="trash" size={13} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
