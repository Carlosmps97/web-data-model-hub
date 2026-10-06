import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { facetNouns } from '@/lib/facets';
import { colorHex, colorLabel } from '@/lib/colors';
import { useModelerStore } from '@/store/useModelerStore';
import ColorPicker from './ColorPicker';
import { canvasBoxes, paintedHere, paintTargets } from '../lib/canvasColors';
import { flushSystemPicker } from '../lib/systemColorPicker';

/** Hasta cuántos nombres de cajas se listan antes de «+N more». */
const NAMES_SHOWN = 3;

const Dot = ({ hex, sm }: { hex: string | null; sm?: boolean }) => (
  <span className={`wk-cpick-dot${sm ? ' wk-cpick-dot--sm' : ''}${hex ? '' : ' wk-cpick-dot--none'}`}
    style={hex ? { background: hex } : undefined} aria-hidden />
);

/**
 * Doc 112 — «Colors on this canvas», en la ficha del canvas (Model properties).
 * Reemplaza el «Color on this canvas» del clic derecho: el color de una caja
 * en UN canvas es del canvas, no de la tabla (ése está en Properties).
 *
 *  - Qué cajas pinta distinto este canvas, cada una con «Reset» (vuelve al
 *    color de su tabla en este canvas).
 *  - «Paint on this canvas» para las cajas elegidas: las seleccionadas en el
 *    canvas al abrir la ficha, o la del panel Properties si se abrió desde ahí.
 *
 * Se aplica al instante (con Undo), como antes desde el clic derecho; los UDPs
 * de la ficha siguen yendo con Save. El selector de color se abre DENTRO de la
 * ficha (no en un panel flotante): así se llega con Tab y Escape cierra sólo el
 * selector.
 */
export default function CanvasColorsSection({ canEdit, boxes: asked }: {
  canEdit: boolean;
  /** Cajas a pintar (desde Properties); sin esto, la selección del canvas. */
  boxes?: string[];
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const viewMode = useModelerStore((s) => s.viewMode);
  const colors = useModelerStore((s) => s.canvasColors);
  const themes = useModelerStore((s) => s.themes);
  const idx = useModelerStore((s) => s.themeIdx);
  const setBoxColors = useModelerStore((s) => s.setBoxColors);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const nouns = facetNouns(viewMode);
  // «More colors…» aplica mientras siga abierta ESTA ficha (el selector del
  // sistema puede seguir abierto después): cerrada, o abierta otra, ya no pinta.
  // Al cerrarse, lo ya elegido que esperaba la pausa se aplica (no se pierde).
  const [sheetOpen] = useState(() => {
    const sheet = useModelerStore.getState().modelProps;
    return () => useModelerStore.getState().modelProps === sheet;
  });
  useEffect(() => () => flushSystemPicker(sheetOpen), [sheetOpen]);
  const openRef = useRef(open);
  openRef.current = open;

  const boxes = useMemo(() => canvasBoxes(diagram, viewMode), [diagram, viewMode]);
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const rows = paintedHere(boxes, colors);
  // A quién se pinta: se decide AL ABRIR la ficha (con ella abierta el canvas
  // no se puede tocar); las que dejaron de verse (otra faceta) no cuentan.
  const [targets] = useState<string[]>(() => {
    const st = useModelerStore.getState();
    const visible = new Set(canvasBoxes(st.diagram, st.viewMode).map((b) => b.id));
    if (asked) return asked.filter((id) => visible.has(id));
    return paintTargets(st.flow?.getNodes() ?? [], [st.selectedTableId, st.selectedViewId], visible);
  });
  const live = targets.filter((id) => byId.has(id));
  const here = live.map((id) => colors[id] ?? null);
  const allSame = here.every((c) => c === here[0]);
  const single = live.length === 1 ? byId.get(live[0]) : undefined;
  const ownNoun = single?.kind === 'view' ? 'view' : nouns.one;
  const names = live.map((id) => byId.get(id)!.name);
  const noun = (kind: 'table' | 'view') => (kind === 'view' ? 'view' : nouns.one);

  // Al abrir el selector, el foco entra a él (y se ve entero).
  useEffect(() => {
    if (!open) return;
    picker.current?.scrollIntoView?.({ block: 'nearest' });
    picker.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);

  // Cerrar el selector devuelve el foco a su botón (sin esto caía al <body>).
  // Un color que llega después del selector del sistema, con el menú ya
  // cerrado, no mueve el foco (la persona puede estar escribiendo un UDP).
  const closePicker = () => {
    const was = openRef.current;
    setOpen(false);
    if (was) btn.current?.focus();
  };
  const paint = (ref: string | null) => { closePicker(); void setBoxColors(live, ref); };
  // Tras «Reset» la fila desaparece: el foco pasa a la que queda en su lugar, o
  // a «Paint on this canvas».
  const focusAfterReset = (index: number) => requestAnimationFrame(() => {
    const left = list.current?.querySelectorAll<HTMLButtonElement>('.wk-mp-reset');
    (left?.length ? left[Math.min(index, left.length - 1)] : btn.current)?.focus();
  });

  return (
    <section className="wk-mp-sec" aria-label="Colors on this canvas">
      <div className="wk-mp-head">
        <h4 className="wk-mp-title">Colors on this canvas</h4>
        {canEdit && rows.length > 1 && (
          <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm"
            aria-label={`Reset all ${rows.length} boxes to their own color`}
            onClick={() => { void setBoxColors(rows.map((r) => r.id), null); focusAfterReset(0); }}>
            Reset all
          </button>
        )}
      </div>
      <p className="wk-pp-cap wk-mp-cap">
        {`Each ${nouns.one} shows its own color on every canvas. Here you paint a box differently on this canvas only.`}
        {canEdit ? ' Changes apply right away — revert them with Undo in the toolbar.' : ''}
      </p>

      {rows.length ? (
        <>
          <div className="wk-mp-sub">{`Painted differently here · ${rows.length} ${rows.length === 1 ? 'box' : 'boxes'}`}</div>
          <ul ref={list} className="wk-mp-list">
            {rows.map((r, i) => (
              <li key={r.id} className="wk-mp-row">
                <Dot hex={colorHex(r.ref, idx)} />
                <span className="wk-mp-txt">
                  <span className="wk-mp-name" title={r.name}>{r.name}</span>
                  <span className="wk-mp-meta">
                    Here: <b>{colorLabel(r.ref, idx)}</b>
                    {` · ${r.kind === 'view' ? 'View' : nouns.One} color: `}
                    <Dot hex={colorHex(r.own, idx)} sm /> {colorLabel(r.own, idx)}
                  </span>
                </span>
                {canEdit && (
                  <button type="button" className="rd-btn rd-btn-secondary rd-btn-sm wk-mp-reset"
                    aria-label={`Reset ${r.name} to its ${noun(r.kind)}'s color`}
                    title={`Back to the ${noun(r.kind)}'s color on this canvas (${colorLabel(r.own, idx)})`}
                    onClick={() => { void setBoxColors([r.id], null); focusAfterReset(i); }}>
                    Reset
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="wk-mp-empty">{`No box is painted differently here — every box shows its ${nouns.one}'s color.`}</p>
      )}

      {canEdit && (
        <div className="wk-mp-paint">
          {live.length ? (
            <>
              <span className="wk-mp-sel" title={names.join(', ')}>
                <b>{live.length === 1 ? 'Selected box' : `${live.length} selected boxes`}</b>
                {`: ${names.slice(0, NAMES_SHOWN).join(', ')}${names.length > NAMES_SHOWN ? ` +${names.length - NAMES_SHOWN} more` : ''}`}
              </span>
              <button ref={btn} type="button" className="rd-btn rd-btn-secondary rd-btn-sm" aria-haspopup="menu"
                aria-expanded={open} onClick={() => (open ? closePicker() : setOpen(true))}>
                Paint on this canvas <ChevronDown size={13} aria-hidden />
              </button>
            </>
          ) : (
            <span className="wk-mp-sel wk-mp-sel--none">
              To paint boxes here, select them on the canvas (click, or Shift + drag around them) and open Model properties again.
            </span>
          )}
        </div>
      )}

      {open && live.length > 0 && (
        // Escape cierra sólo el selector (React corta el evento antes del
        // listener de la ficha, que la cerraría entera).
        <div ref={picker} className="wk-mp-picker"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closePicker(); } }}>
          <ColorPicker
            title={single ? `${single.name} · on this canvas` : `${live.length} boxes · on this canvas`}
            themes={themes}
            value={allSame ? here[0] : '__mixed__'}
            noneValue="none"
            inherit={{
              label: single ? `Use the ${ownNoun}'s color` : "Use each one's own color",
              hex: single ? colorHex(single.own, idx) : null,
              current: allSame && here[0] === null,
            }}
            onPick={paint}
            alive={sheetOpen}
          />
        </div>
      )}
    </section>
  );
}
