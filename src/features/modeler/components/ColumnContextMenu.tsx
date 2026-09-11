import { useEffect, useRef } from 'react';
import { facetNouns } from '@/lib/facets';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';

// Etiquetas de atajos agnósticas al SO (Windows/Linux = Ctrl, macOS = ⌘) —
// el handler real ya acepta ambos (`metaKey || ctrlKey`).
const IS_MAC = /Mac/i.test(typeof navigator === 'undefined' ? '' : navigator.platform);
export const PASTE_KEY_LABEL = IS_MAC ? '⌘V' : 'Ctrl+V';
export const UNDO_KEY_LABEL = IS_MAC ? '⌘Z' : 'Ctrl+Z';

export const copiedMessage = (n: number) =>
  `${n} column${n === 1 ? '' : 's'} copied — paste with ${PASTE_KEY_LABEL} on the target table`;

export const copiedTableMessage = (name: string) =>
  `Table ${name} copied — paste with ${PASTE_KEY_LABEL}`;

/**
 * Menú contextual del canvas (docs 48 + 50): espejo DESCUBRIBLE de Ctrl/Cmd+C/V.
 * Fila → Copy de columnas (+ Paste de columnas si hay clipboard y edición);
 * bloque → Copy table (+ Paste de columnas / Paste table según clipboard).
 * Vive fuera del viewport de React Flow (position: fixed sin ancestro con
 * transform), lo monta ModelerCanvas; TableNode/onNodeContextMenu lo abren vía store.
 */
export default function ColumnContextMenu({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const menu = useModelerStore((s) => s.colMenu);
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // doc 85: Entity/Attribute vs Table/Column
  const closeColMenu = useModelerStore((s) => s.closeColMenu);
  const selCount = useModelerStore((s) => s.colSel?.ids.length ?? 0);
  const clipCount = useModelerStore((s) => s.colClipboard?.cols.length ?? 0);
  const tblClipName = useModelerStore((s) => s.tblClipboard?.table.physicalName ?? null);
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
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
  const isBlock = menu.colId == null;
  const showCopyCols = !isBlock && selCount > 0;   // copiar es lectura: vale también en readonly
  const showPasteCols = clipCount > 0 && canEdit;
  // Doc 50: el menú del BLOQUE siempre ofrece copiar la tabla; pegarla exige
  // clipboard de tabla + edición (crea una tabla NUEVA, no necesita destino).
  const showCopyTable = isBlock;
  const showPasteTable = isBlock && tblClipName != null && canEdit;
  if (!showCopyCols && !showPasteCols && !showCopyTable && !showPasteTable) return null;

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
  const doCopyTable = () => {
    const st = useModelerStore.getState();
    const name = st.copyTable(menu.tableId);
    if (name) pushToast(copiedTableMessage(name));
    st.closeColMenu();
  };
  const doPasteTable = () => {
    const st = useModelerStore.getState();
    st.closeColMenu();
    void st.pasteTable()
      .then((name) => { if (name) pushToast(`Table pasted as ${name}`); })
      .catch((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't paste the table", 'err'));
  };

  // Clamp al viewport: el menú es chico (~200×~120), que no se corte en el borde.
  const x = Math.min(menu.x, window.innerWidth - 216);
  const y = Math.min(menu.y, window.innerHeight - 140);

  return (
    <div ref={ref} className="wk-ctxmenu" style={{ left: x, top: y }} role="menu">
      {showCopyCols && (
        <button type="button" role="menuitem" onClick={doCopy}>
          {selCount > 1 ? `Copy ${selCount} ${n.members}` : `Copy ${n.member}`}
        </button>
      )}
      {showCopyTable && (
        <button type="button" role="menuitem" onClick={doCopyTable}>
          Copy table
        </button>
      )}
      {showPasteCols && (
        <button type="button" role="menuitem" onClick={doPaste}>
          Paste {clipCount} column{clipCount === 1 ? '' : 's'}
        </button>
      )}
      {showPasteTable && (
        <button type="button" role="menuitem" onClick={doPasteTable}>
          Paste table ({tblClipName} as copy)
        </button>
      )}
    </div>
  );
}
