import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { facetName, facetNouns, type FacetNouns } from '@/lib/facets';
import { placeAtPoint } from '@/lib/floating';
import { useFloating } from '@/components/ui/useFloating';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import { canvasMenuItems, type CanvasClipboard, type CanvasMenuAction } from '../lib/canvasMenu';
import { orderColumns } from '../lib/columnOrder';
import { askDeleteColumns, askDeleteTable, askRemoveFromCanvas } from './deleteFlows';

// Etiquetas de atajos agnósticas al SO (Windows/Linux = Ctrl, macOS = ⌘) —
// el handler real ya acepta ambos (`metaKey || ctrlKey`).
const IS_MAC = /Mac/i.test(typeof navigator === 'undefined' ? '' : navigator.platform);
export const COPY_KEY_LABEL = IS_MAC ? '⌘C' : 'Ctrl+C';
export const PASTE_KEY_LABEL = IS_MAC ? '⌘V' : 'Ctrl+V';
export const UNDO_KEY_LABEL = IS_MAC ? '⌘Z' : 'Ctrl+Z';
export const REDO_KEY_LABEL = IS_MAC ? '⇧⌘Z' : 'Ctrl+Y';
export const SEARCH_KEY_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

// Mensajes con los sustantivos de la faceta abierta (en Logical, entidad y
// atributos; en Physical, tabla y columnas).
export const copiedMessage = (n: number, nouns: FacetNouns) =>
  `${n} ${n === 1 ? nouns.member : nouns.members} copied — paste with ${PASTE_KEY_LABEL} on the target ${nouns.one}`;

export const copiedTableMessage = (name: string, nouns: FacetNouns) =>
  `${nouns.One} ${name} copied — paste with ${PASTE_KEY_LABEL}`;

type ColMenu = NonNullable<ReturnType<typeof useModelerStore.getState>['colMenu']>;

/**
 * Menú contextual del canvas (`lib/canvasMenu.ts` decide los ítems): en una
 * fila, Copy · Paste · Delete sobre las columnas seleccionadas; en el bloque,
 * Copy table · Paste · Remove from this canvas · Delete table…. Lo que no
 * aplica se ve deshabilitado con su motivo. Copy/Paste son el espejo de
 * Ctrl/Cmd+C/V; los borrados usan los flujos de `deleteFlows` (los mismos del
 * panel Properties). Vive fuera del viewport de React Flow (position: fixed sin
 * ancestro con transform), lo monta ModelerCanvas; TableNode/onNodeContextMenu
 * lo abren vía store.
 */
export default function ColumnContextMenu({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const menu = useModelerStore((s) => s.colMenu);
  const viewMode = useModelerStore((s) => s.viewMode);
  const n = facetNouns(viewMode);   // sustantivos Entity/Attribute o Table/Column
  const closeColMenu = useModelerStore((s) => s.closeColMenu);
  const selCount = useModelerStore((s) => s.colSel?.ids.length ?? 0);
  const clipCount = useModelerStore((s) => s.colClipboard?.cols.length ?? 0);
  // El nombre según la faceta: en Logical, el lógico (o el físico si no tiene).
  const tblClipName = useModelerStore((s) => {
    const t = s.tblClipboard?.table;
    return t ? (s.viewMode === 'logical' ? t.logicalName || t.physicalName : t.physicalName) : null;
  });
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  const ref = useRef<HTMLDivElement>(null);
  // Un borrado lee su impacto antes del diálogo: mientras tanto el menú queda
  // abierto, con el spinner en ese ítem y el resto deshabilitado.
  const [pending, setPending] = useState<{ menu: ColMenu; action: CanvasMenuAction } | null>(null);

  // Cierre por interacción global: click/pan fuera (mousedown), zoom/scroll
  // (wheel), Esc o blur de la ventana. Capture: gana aunque el target frene el
  // bubbling; los mousedown dentro del menú no cierran (el click debe llegar).
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

  // Las vistas no tienen menú: su color en el canvas se gestiona en Model properties.
  if (!menu || menu.kind === 'view') return null;
  const clipboard: CanvasClipboard = tblClipName != null ? { kind: 'table', name: tblClipName }
    : clipCount > 0 ? { kind: 'columns', count: clipCount } : { kind: 'none' };
  const items = canvasMenuItems({
    target: menu.colId == null ? 'table' : 'row', selCount, clipboard, canEdit, nouns: n,
    keys: { copy: COPY_KEY_LABEL, paste: PASTE_KEY_LABEL },
  });
  const busy = pending?.menu === menu ? pending.action : null;
  // El flujo sigue si el menú que lo pidió sigue abierto; se cierra justo antes
  // del diálogo.
  const hooks = {
    stillWanted: () => useModelerStore.getState().colMenu === menu,
    beforeDialog: () => useModelerStore.getState().closeColMenu(),
  };
  // Al terminar, el spinner se suelta solo si sigue siendo el de este menú: un
  // borrado que termina tarde no le quita el suyo al de un menú abierto después.
  const release = () => setPending((p) => (p?.menu === menu ? null : p));

  const deleteSelected = async () => {
    const st = useModelerStore.getState();
    const sel = st.colSel;
    const table = st.diagram?.tables.find((t) => t.id === menu.tableId);
    if (!sel || sel.tableId !== menu.tableId || !table) return;
    const wanted = new Set(sel.ids);
    // En el orden único de la tabla (PK primero), como se ven en el bloque.
    const cols = orderColumns((st.diagram?.columns ?? []).filter((c) => c.tableId === table.id && wanted.has(c.id)));
    if (!cols.length) return;
    setPending({ menu, action: 'delete-columns' });
    try {
      await askDeleteColumns({
        tableId: table.id, tableName: facetName(table, st.viewMode), cols, viewMode: st.viewMode,
        pushToast, deleteColumns: st.deleteColumns, ...hooks,
      });
    } finally { release(); }
  };
  const deleteTable = async () => {
    const st = useModelerStore.getState();
    const table = st.diagram?.tables.find((t) => t.id === menu.tableId);
    if (!table) return;
    setPending({ menu, action: 'delete-table' });
    try { await askDeleteTable({ table, nouns: n, pushToast, deleteTable: st.deleteTable, ...hooks }); }
    finally { release(); }
  };

  const run = (action: CanvasMenuAction) => {
    const st = useModelerStore.getState();
    switch (action) {
      case 'copy-columns': {
        const count = st.copySelectedColumns();
        if (count > 0) pushToast(copiedMessage(count, n));
        st.closeColMenu();
        return;
      }
      case 'copy-table': {
        const name = st.copyTable(menu.tableId);
        if (name) pushToast(copiedTableMessage(name, n));
        st.closeColMenu();
        return;
      }
      case 'paste':
        // Lo mismo que Ctrl/Cmd+V: una tabla copiada abre el popup que muestra
        // qué viaja (crea una tabla nueva, no necesita destino); columnas
        // copiadas, su confirmación sobre ESTA tabla.
        if (st.tblClipboard) {
          st.closeColMenu();
          st.setTablePasteOpen(true);
          return;
        }
        st.setSelectedTable(menu.tableId);   // el destino queda visible (anillo .sel)
        st.setPasteTarget(menu.tableId);
        st.closeColMenu();
        return;
      case 'delete-columns':
        void deleteSelected();
        return;
      case 'remove-table': {
        const table = st.diagram?.tables.find((t) => t.id === menu.tableId);
        st.closeColMenu();
        if (table) void askRemoveFromCanvas({ table, nouns: n, pushToast, remove: st.removeTableFromArea });
        return;
      }
      case 'delete-table':
        void deleteTable();
        return;
    }
  };

  return (
    <MenuBox boxRef={ref} x={menu.x} y={menu.y}>
      {items.map((it) => (
        <Fragment key={it.action}>
          {it.separatorBefore && <div className="wk-ctxmenu-sep" role="separator" />}
          <button type="button" role="menuitem" className={it.danger ? 'danger' : undefined}
            disabled={!it.enabled || busy !== null} title={it.hint} onClick={() => run(it.action)}>
            {busy === it.action && <span className="rd-spin" aria-hidden />}
            {it.label}
            {it.shortcut && <span className="wk-ctxmenu-key" aria-hidden>{it.shortcut}</span>}
          </button>
        </Fragment>
      ))}
    </MenuBox>
  );
}

/** El menú en el cursor con la regla única de flotantes: a la izquierda o
 *  arriba del cursor si no entra, según su tamaño medido (un tope fijo
 *  estimado cortaría los nombres largos y el último ítem). */
function MenuBox({ boxRef, x, y, children }: { boxRef: RefObject<HTMLDivElement | null>; x: number; y: number; children: ReactNode }) {
  const place = useFloating(boxRef, (box, bounds) => placeAtPoint({ x, y }, box, bounds), [x, y]);
  return <div ref={boxRef} className="wk-ctxmenu" style={place} role="menu">{children}</div>;
}
