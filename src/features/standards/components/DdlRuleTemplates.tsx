/**
 * New rule — template picker (pantalla 16d). Nunca un editor vacío: 4
 * plantillas reales + "Blank rule". Al continuar, el editor se pre-carga con
 * la plantilla elegida (todo editable después).
 */
import { useEffect, useState } from 'react';
import { Eye, Plus, ShieldBan, Table2, Tag, X } from 'lucide-react';
import { toast } from 'sonner';

import { getDdlTemplates, type DdlTemplate } from '../ddlRules.service';
import type { DdlRule } from '../standards.service';

const ICONS: Record<string, React.ReactNode> = {
  'mask-by-udp': <ShieldBan size={17} color="#2E5BFF" />,
  'rejected-table': <Table2 size={17} color="#8B5CF6" />,
  'technical-view': <Eye size={17} color="#8B5CF6" />,
  'governance-tags': <Tag size={17} color="#2E5BFF" />,
  blank: <Plus size={16} color="#8A93A5" />,
};

export default function DdlRuleTemplates({ projectId, onClose, onPick }: {
  projectId: string;
  onClose: () => void;
  onPick: (draft: Partial<DdlRule>) => void;
}) {
  const [templates, setTemplates] = useState<DdlTemplate[]>([]);
  const [sel, setSel] = useState<string>('mask-by-udp');

  useEffect(() => {
    getDdlTemplates(projectId).then((t) => setTemplates(t.templates))
      .catch(() => toast.error("Couldn't load the rule templates"));
  }, [projectId]);

  const grid = templates.filter((t) => t.id !== 'blank');
  const blank = templates.find((t) => t.id === 'blank');
  const chosen = templates.find((t) => t.id === sel);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,28,45,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ width: 660, background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px rgba(16,27,48,0.4)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '22px 24px 16px', borderBottom: '1px solid #EEF1F6' }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: '#EAF0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Plus size={21} color="#2E5BFF" /></div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1A2B4A' }}>New export rule</h2>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#8A93A5', lineHeight: 1.5 }}>Start from a template — you don't have to begin with a blank rule.</p>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E6EAF0', background: '#fff', color: '#8A93A5', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}><X size={13} /></button>
        </div>

        <div style={{ padding: '18px 24px 8px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#9AA3B2', marginBottom: 11 }}>Choose a template</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            {grid.map((t) => (
              <button key={t.id} onClick={() => setSel(t.id)}
                style={{ border: sel === t.id ? '1.5px solid #2E5BFF' : '1px solid #E6EAF0', borderRadius: 12, padding: 14, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', boxShadow: sel === t.id ? '0 0 0 3px rgba(46,91,255,0.1)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, background: t.id.startsWith('mask') || t.id.startsWith('gov') ? '#EAF0FF' : '#F3EEFF', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{ICONS[t.id]}</span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: '#1A2B4A' }}>{t.title}</span>
                  <Radio on={sel === t.id} />
                </div>
                <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, color: '#56607A', background: '#F7F9FC', border: '1px solid #EEF1F6', borderRadius: 7, padding: '6px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.summary}</div>
              </button>
            ))}
          </div>
          {blank && (
            <button onClick={() => setSel('blank')}
              style={{ width: '100%', border: sel === 'blank' ? '1.5px solid #2E5BFF' : '1px dashed #C9D2E0', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', boxShadow: sel === 'blank' ? '0 0 0 3px rgba(46,91,255,0.1)' : 'none' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#F2F4F8', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{ICONS.blank}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A2B4A' }}>Blank rule</div>
                <div style={{ fontSize: 11.5, color: '#8A93A5' }}>{blank.summary}</div>
              </div>
              <Radio on={sel === 'blank'} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 24px 20px' }}>
          <span style={{ flex: 1, fontSize: 11.5, color: '#9AA3B2' }}>You can change any field after picking a template.</span>
          <button onClick={onClose} style={{ height: 40, display: 'inline-flex', alignItems: 'center', padding: '0 18px', border: '1px solid #DDE2EC', background: '#fff', color: '#56607A', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={() => chosen && onPick({ ...chosen.rule, id: undefined } as Partial<DdlRule>)} disabled={!chosen}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 40, padding: '0 20px', border: 'none', background: '#2E5BFF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 2px rgba(46,91,255,0.35)' }}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${on ? '#2E5BFF' : '#D4DAE6'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2E5BFF' }} />}
    </span>
  );
}
