import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { facetNouns, type FacetNouns } from '@/lib/facets';
import { useModelerStore } from '@/store/useModelerStore';
import { reportWriteError } from '../lib/sessionGuard';
import { useSessionStore } from '@/store/useSessionStore';
import { colorHex, colorLabel, effectiveRef, normalColor } from '@/lib/colors';
import ColorPicker from './ColorPicker';

// Etiquetas de atajos agnósticas al SO (Windows/Linux = Ctrl, macOS = ⌘) —
// el handler real ya acepta ambos (`metaKey || ctrlKey`).
const IS_MAC = /Mac/i.test(typeof navigator === 'undefined' ? '' : navigator.platform);
export const PASTE_KEY_LABEL = IS_MAC ? '⌘V' : 'Ctrl+V';
export const UNDO_KEY_LABEL = IS_MAC ? '⌘Z' : 'Ctrl+Z';
export const SEARCH_KEY_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

// Doc 105 (ronda 5, R15-H9): con los sustantivos de la faceta abierta (en
// Lógico decía «columns copied … on the target table» y «Table X copied»).
export const copiedMessage = (n: number, nouns: FacetNouns) =>
  `${n} ${n === 1 ? nouns.member : nouns.members} copied — paste with ${PASTE_KEY_LABEL} on the target ${nouns.one}`;

export const copiedTableMessage = (name: string, nouns: FacetNouns) =>
  `${nouns.One} ${name} copied — paste with ${PASTE_KEY_LABEL}`;

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
  // El nombre según la faceta (ronda 5, R15-H9: en Lógico mostraba el físico).
  const tblClipName = useModelerStore((s) => {
    const t = s.tblClipboard?.table;
    return t ? (s.viewMode === 'logical' ? t.logicalName || t.physicalName : t.physicalName) : null;
  });
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  const canEdit = useSessionStore((s) => s.activeChangesetId) != null && !readonly;
  const ref = useRef<HTMLDivElement>(null);
  // Doc 109: submenú «Color on this canvas» (flyout dentro del menú: un clic en
  // él no cuenta como clic afuera). Se cierra al cambiar de menú.
  const [colorOpen, setColorOpen] = useState(false);
  useEffect(() => { setColorOpen(false); }, [menu]);

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
  const isView = menu.kind === 'view';
  const isBlock = menu.colId == null;
  const showCopyCols = !isView && !isBlock && selCount > 0;   // copiar es lectura: vale también en readonly
  const showPasteCols = !isView && clipCount > 0 && canEdit;
  // Doc 50: el menú del BLOQUE siempre ofrece copiar la tabla; pegarla exige
  // clipboard de tabla + edición (crea una tabla NUEVA, no necesita destino).
  const showCopyTable = !isView && isBlock;
  const showPasteTable = !isView && isBlock && tblClipName != null && canEdit;
  // Doc 109: color de la caja EN ESTE canvas — del bloque (tabla o vista), en edición.
  const showColor = isBlock && canEdit;
  if (!showCopyCols && !showPasteCols && !showCopyTable && !showPasteTable && !showColor) return null;

  const doCopy = () => {
    const st = useModelerStore.getState();
    const count = st.copySelectedColumns();
    if (count > 0) pushToast(copiedMessage(count, n));
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
    if (name) pushToast(copiedTableMessage(name, n));
    st.closeColMenu();
  };
  const doPasteTable = () => {
    const st = useModelerStore.getState();
    st.closeColMenu();
    void st.pasteTable()
      // Ronda 4 (6b): con el sustantivo del modelo, como Ctrl+V en el canvas.
      .then((name) => { if (name) pushToast(`${n.One} pasted as ${name}`); })
      .catch(reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : `Couldn't paste the ${n.one}`, 'err')));   // doc 105 (ronda 3)
  };

  // Clamp al viewport: el menú es chico (~200×~120), que no se corte en el borde.
  const x = Math.min(menu.x, window.innerWidth - 216);
  const y = Math.min(menu.y, window.innerHeight - 140);

  // Doc 109: a qué cajas aplica el color — todas las seleccionadas si el clic
  // fue sobre una de ellas; si no, sólo la del clic.
  const colorTargets = (): string[] => {
    const nodes = useModelerStore.getState().flow?.getNodes() ?? [];
    const picked = nodes.filter((nd) => nd.selected && (nd.type === 'table' || nd.type === 'view')).map((nd) => nd.id);
    return picked.length > 1 && picked.includes(menu.tableId) ? picked : [menu.tableId];
  };
  const colorSection = () => {
    const st = useModelerStore.getState();
    const targets = colorTargets();
    const dia = st.diagram;
    const ownOf = (id: string) => (dia?.tables.find((t) => t.id === id)?.color
      ?? (dia?.views ?? []).find((v) => v.id === id)?.color ?? null);
    const overrides = targets.map((id) => st.canvasColors[id] ?? null);
    const allSame = overrides.every((o) => o === overrides[0]);
    const single = targets.length === 1;
    const own = single ? ownOf(targets[0]) : null;
    const nouns = facetNouns(st.viewMode);
    return (
      <div className="wk-ctxmenu-sub" style={{
        ...(x + 216 + 260 > window.innerWidth ? { right: '100%' } : { left: '100%' }),
        ...(y + 440 > window.innerHeight ? { bottom: -5 } : { top: -5 }),
      }}>
        <ColorPicker
          title={single ? 'Color on this canvas' : `Color on this canvas · ${targets.length} boxes`}
          themes={st.themes}
          value={allSame ? overrides[0] : '__mixed__'}
          noneValue="none"
          inherit={{
            label: single ? `Use the ${isView ? 'view' : nouns.one}'s color` : 'Use each one\'s own color',
            hex: single ? colorHex(normalColor(own) ? own : null, st.themeIdx) : null,
            current: allSame && overrides[0] === null,
          }}
          onPick={(ref) => {
            // el selector del sistema aplica después: no cerrar un menú más nuevo
            if (useModelerStore.getState().colMenu === menu) st.closeColMenu();
            void st.setBoxColors(targets, ref);
          }}
        />
        {single && own && (
          <div className="wk-ctxmenu-note">{`${isView ? 'View' : nouns.One} color: ${colorLabel(own, st.themeIdx)}`}</div>
        )}
      </div>
    );
  };
  const currentHex = (() => {
    const st = useModelerStore.getState();
    const own = (st.diagram?.tables.find((t) => t.id === menu.tableId)?.color
      ?? (st.diagram?.views ?? []).find((v) => v.id === menu.tableId)?.color ?? null);
    return colorHex(effectiveRef(menu.tableId, own, st.canvasColors), st.themeIdx);
  })();

  return (
    <div ref={ref} className="wk-ctxmenu" style={{ left: x, top: y }} role="menu">
      {showCopyCols && (
        <button type="button" role="menuitem" onClick={doCopy}>
          {selCount > 1 ? `Copy ${selCount} ${n.members}` : `Copy ${n.member}`}
        </button>
      )}
      {showCopyTable && (
        <button type="button" role="menuitem" onClick={doCopyTable}>
          {`Copy ${n.one}`}
        </button>
      )}
      {showPasteCols && (
        <button type="button" role="menuitem" onClick={doPaste}>
          {`Paste ${clipCount} ${clipCount === 1 ? n.member : n.members}`}
        </button>
      )}
      {showPasteTable && (
        <button type="button" role="menuitem" onClick={doPasteTable}>
          {`Paste ${n.one} (${tblClipName} as copy)`}
        </button>
      )}
      {showColor && (showCopyTable || showPasteTable) && <div className="wk-ctxmenu-sep" />}
      {showColor && (
        <div className="wk-ctxmenu-group" onMouseEnter={() => setColorOpen(true)} onMouseLeave={() => setColorOpen(false)}>
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={colorOpen}
            className={colorOpen ? 'on' : undefined} onClick={() => setColorOpen((v) => !v)}>
            <span className={`wk-cpick-dot wk-cpick-dot--sm${currentHex ? '' : ' wk-cpick-dot--none'}`}
              style={currentHex ? { background: currentHex } : undefined} aria-hidden />
            Color on this canvas
            <ChevronRight size={13} className="wk-ctxmenu-chev" aria-hidden />
          </button>
          {colorOpen && colorSection()}
        </div>
      )}
    </div>
  );
}
