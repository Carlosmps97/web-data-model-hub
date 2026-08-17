import { useEffect, useRef } from 'react';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';

export const PASTE_KEY_LABEL =
  /Mac/i.test(typeof navigator === 'undefined' ? '' : navigator.platform) ? '⌘V' : 'Ctrl+V';

export const copiedMessage = (n: number) =>
  `${n} column${n === 1 ? '' : 's'} copied — paste with ${PASTE_KEY_LABEL} on the target table`;

/**
 * Menú contextual del canvas (doc 48): espejo DESCUBRIBLE de Ctrl/Cmd+C/V.
 * Fila → Copy (+ Paste si hay clipboard y edición); bloque → Paste. Vive fuera
 * del viewport de React Flow (position: fixed sin ancestro con transform), lo
 * monta ModelerCanvas; TableNode/onNodeContextMenu lo abren vía store.
 */
export default function ColumnContextMenu({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const menu = useModelerStore((s) => s.colMenu);
  const closeColMenu = useModelerStore((s) => s.closeColMenu);
  const selCount = useModelerStore((s) => s.colSel?.ids.length ?? 0);
  const clipCount = useModelerStore((s) => s.colClipboard?.cols.length ?? 0);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useChangesetStore((s) => s.activeId) != null && !readonly;
  const ref = useRef<HTMLDivElement>(null);

  // Cierre por interacción global: click/pan fuera (mousedown), zoom/scroll
  // (wheel), Esc o blur de la ventana. Capture: gana aunque el target frene el
  // bubbling; los mousedown DENTRO del menú no cierran (el click debe llegar).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      closeColMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeColMenu(); };
    const onAway = () => closeColMenu();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', onAway, true);
    window.addEventListener('blur', onAway);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', onAway, true);
      window.removeEventListener('blur', onAway);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, closeColMenu]);

  if (!menu) return null;
  const showCopy = menu.colId != null && selCount > 0;   // copiar es lectura: vale también en readonly
  const showPaste = clipCount > 0 && canEdit;
  if (!showCopy && !showPaste) return null;

  const doCopy = () => {
    const st = useModelerStore.getState();
    const n = st.copySelectedColumns();
    if (n > 0) pushToast(copiedMessage(n));
    st.closeColMenu();
  };
  const doPaste = () => {
    const st = useModelerStore.getState();
    st.setSelectedTable(menu.tableId);   // el destino queda visible (anillo .sel)
    st.setPasteTarget(menu.tableId);
    st.closeColMenu();
  };

  // Clamp al viewport: el menú es chico (~200×72), que no se corte en el borde.
  const x = Math.min(menu.x, window.innerWidth - 216);
  const y = Math.min(menu.y, window.innerHeight - 92);

  return (
    <div ref={ref} className="wk-ctxmenu" style={{ left: x, top: y }} role="menu">
      {showCopy && (
        <button type="button" role="menuitem" onClick={doCopy}>
          {selCount > 1 ? `Copy ${selCount} columns` : 'Copy column'}
        </button>
      )}
      {showPaste && (
        <button type="button" role="menuitem" onClick={doPaste}>
          Paste {clipCount} column{clipCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
