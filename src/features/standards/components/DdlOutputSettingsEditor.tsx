/**
 * Output settings (doc 93 D1) — CÓMO se escribe todo DDL exportado del
 * proyecto y cómo se nombran sus archivos. Mismo formulario que la pestaña
 * Output del modal Export DDL, que arranca desde estos valores. Guardar
 * registra una versión de Data Standards (rollback disponible).
 *
 * Doc 101: el proyecto elige su dialecto por default (con el que abre el modal)
 * y tiene una configuración por dialecto — Databricks y Oracle se editan en
 * pestañas; los nombres de archivo son de los dos.
 */
import { useState } from 'react';
import { FileCode2, X } from 'lucide-react';
import { toast } from 'sonner';

import { DdlOutputForm, mergeOutputSettings, type DdlDialect, type DdlOutputSettings } from '@/features/ddl';
import { saveDdlOutput } from '../ddlRules.service';
import type { DdlRulesetConfig } from '../standards.service';

const DIALECTS: [DdlDialect, string][] = [['databricks', 'Databricks'], ['oracle', 'Oracle']];

export default function DdlOutputSettingsEditor({ projectId, config, canEdit, onClose, onApplied }: {
  projectId: string;
  config: DdlRulesetConfig;
  canEdit: boolean;
  onClose: () => void;
  onApplied: () => Promise<void> | void;
}) {
  const [value, setValue] = useState<DdlOutputSettings>(() => mergeOutputSettings(config.output ?? null));
  // Qué configuración se está editando (arranca en la del dialecto por default).
  const [shown, setShown] = useState<DdlDialect>(() => value.dialect);
  const [saving, setSaving] = useState(false);

  const doSave = async () => {
    setSaving(true);
    try {
      await saveDdlOutput(projectId, value);
      toast.success('Output settings saved');
      await onApplied(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,28,45,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ width: 560, maxHeight: '88vh', background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '22px 24px 14px', borderBottom: '1px solid #EEF1F6' }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: '#EAF0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><FileCode2 size={20} color="#2E5BFF" /></div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>Output settings</h2>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 }}>
              How every exported DDL is written and how its files are named. The Export DDL dialog starts from these settings.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}><X size={13} /></button>
        </div>
        <div className="exd-opts" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 24px' }}>
          <span className="exd-section">Default dialect</span>
          <div className="rd-seg exd-caseseg" role="group" aria-label="Default dialect">
            {DIALECTS.map(([d, label]) => (
              <button key={d} type="button" className={value.dialect === d ? 'active' : ''} aria-pressed={value.dialect === d}
                disabled={!canEdit} onClick={() => { setValue({ ...value, dialect: d }); setShown(d); }}>{label}</button>
            ))}
          </div>
          <span className="exd-swrow-hint">The Export DDL dialog opens with this dialect; it can still be changed for each export.</span>
          <div className="wk-pp-tabs exd-tabs" role="tablist" aria-label="Settings of each dialect">
            {DIALECTS.map(([d, label]) => (
              <button key={d} type="button" role="tab" aria-selected={shown === d}
                className={`wk-pp-tab${shown === d ? ' active' : ''}`} onClick={() => setShown(d)}>
                {label} settings
                {value.dialect === d && <span className="wk-pp-tab-count">default</span>}
              </button>
            ))}
          </div>
          <DdlOutputForm value={value} onChange={setValue} disabled={!canEdit} dialect={shown} />
        </div>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 24px 18px', borderTop: '1px solid #EEF1F6' }}>
          <span style={{ flex: 1, fontSize: 11.5, color: '#9AA3B2' }}>Saving records a Data Standards version (rollback available).</span>
          <button onClick={onClose} style={{ height: 38, padding: '0 16px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          {canEdit && (
            <button onClick={doSave} disabled={saving}
              style={{ height: 38, padding: '0 18px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
