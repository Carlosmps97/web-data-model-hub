import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <span
      style={{ display: 'inline-flex' }}
      onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ x: r.left + r.width / 2, y: r.bottom + 6 }); setShow(true); }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && createPortal(
        <div style={{
          position: 'fixed', left: pos.x, top: pos.y, transform: 'translateX(-50%)',
          background: 'var(--ink)', color: 'var(--inverse)', fontSize: 11, fontWeight: 600,
          padding: '4px 8px', borderRadius: 6, whiteSpace: 'nowrap', pointerEvents: 'none',
          zIndex: 1000, boxShadow: 'var(--shadow-md)',
        }}>{label}</div>, document.body)}
    </span>
  );
}
