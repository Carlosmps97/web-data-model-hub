/**
 * Modal: shell reutilizable (backdrop + card centrada + header/footer) para los
 * modales del módulo Admin. El backdrop no cierra al hacer clic: se cierra solo
 * con la X o las acciones del footer.
 */
import type { ReactNode } from 'react';
import { C, iconBtnStyle, labelStyle } from './helpers';
import { CloseIcon } from './icons';

interface ModalShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export default function ModalShell({ title, subtitle, onClose, children, footer, width = 460 }: ModalShellProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,28,45,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-label={title}
        style={{
          width: '100%',
          maxWidth: width,
          background: C.white,
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(20,28,45,0.28)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.navy }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: C.text3, marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={iconBtnStyle}><CloseIcon size={16} /></button>
        </div>
        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: `1px solid ${C.border}` }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

/** Campo etiquetado (label + control) para los formularios de los modales. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11.5, color: C.text3, marginTop: 4 }}>{hint}</span>}
    </label>
  );
}
