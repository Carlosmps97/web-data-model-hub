import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { facetNouns } from '@/lib/facets';
import { colorHex, colorLabel } from '@/lib/colors';
import { useModelerStore } from '@/store/useModelerStore';
import ColorPicker from './ColorPicker';
import FloatingPanel from './FloatingPanel';
import {
  canvasBoxes, paintedHere, paintTargets, pendingChanges, withPending, type PendingColors,
} from '../lib/canvasColors';

/** Hasta cuántos nombres de cajas se listan antes de «+N more». */
const NAMES_SHOWN = 3;

const Dot = ({ hex, sm }: { hex: string | null; sm?: boolean }) => (
  <span className={`wk-cpick-dot${sm ? ' wk-cpick-dot--sm' : ''}${hex ? '' : ' wk-cpick-dot--none'}`}
    style={hex ? { background: hex } : undefined} aria-hidden />
);

/**
 * Doc 112 — «Colors on this canvas», en la ficha del canvas (Model properties).
 * El color de una caja en UN canvas es del canvas, no de la tabla (ése está en
 * Properties).
 *
 *  - Qué cajas pinta distinto este canvas, cada una con «Reset» (vuelve al
 *    color de su tabla en este canvas).
 *  - «Paint on this canvas» para las cajas elegidas: las seleccionadas en el
 *    canvas al abrir la ficha, o la del panel Properties si se abrió desde ahí.
 *
 * Todo queda PENDIENTE (`pending`, de la ficha) y se ve en el canvas como vista
 * previa: Save lo graba en la versión en edición, Cancel lo descarta. El
 * selector de color se abre encima (no agranda la ficha) y DENTRO de ella: se
 * llega con Tab y Escape cierra sólo el selector.
 */
export default function CanvasColorsSection({ canEdit, boxes: asked, pending, onStage, alive }: {
  canEdit: boolean;
  /** Cajas a pintar (desde Properties); sin esto, la selección del canvas. */
  boxes?: string[];
  /** Cambios pendientes de la ficha ({id: ColorRef | null}; null = color de su tabla). */
  pending: PendingColors;
  onStage: (ids: string[], ref: string | null) => void;
  /** Mientras la ficha siga abierta (para «More colors…»). */
  alive: () => boolean;
}) {
  const diagram = useModelerStore((s) => s.diagram);
  const viewMode = useModelerStore((s) => s.viewMode);
  const saved = useModelerStore((s) => s.canvasColors);
  const themes = useModelerStore((s) => s.themes);
  const idx = useModelerStore((s) => s.themeIdx);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<DOMRect | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const nouns = facetNouns(viewMode);

  const boxes = useMemo(() => canvasBoxes(diagram, viewMode), [diagram, viewMode]);
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const colors = useMemo(() => withPending(saved, pending), [saved, pending]);
  const unsaved = useMemo(() => pendingChanges(saved, pending), [saved, pending]);
  const unsavedCount = Object.keys(unsaved).length;
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
  const names = live.map((id) => byId.get(id)!.name);
  const noun = (kind: 'table' | 'view') => (kind === 'view' ? 'view' : nouns.one);

  // Al abrir el selector, el foco entra a él.
  useEffect(() => {
    if (open) document.querySelector<HTMLButtonElement>('.wk-mp-float button')?.focus();
  }, [open]);

  // Cerrar el selector devuelve el foco a su botón (sin esto caía al <body>).
  // Un color que llega después del selector del sistema, con el menú ya
  // cerrado, no mueve el foco (la persona puede estar escribiendo un UDP).
  const closePicker = () => {
    const was = openRef.current;
    setOpen(null);
    if (was) btn.current?.focus();
  };
  const paint = (ref: string | null) => { closePicker(); onStage(live, ref); };
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
            onClick={() => { onStage(rows.map((r) => r.id), null); focusAfterReset(0); }}>
            Reset all
          </button>
        )}
      </div>
      <p className="wk-pp-cap wk-mp-cap">
        {`Each ${nouns.one} shows its own color on every canvas. Here you paint a box differently on this canvas only.`}
        {canEdit ? ' Changes are saved with Save; Cancel discards them.' : ''}
      </p>

      {rows.length ? (
        <>
          <div className="wk-mp-sub">{`Painted differently here · ${rows.length} ${rows.length === 1 ? 'box' : 'boxes'}`}</div>
          <ul ref={list} className="wk-mp-list">
            {rows.map((r, i) => (
              <li key={r.id} className="wk-mp-row">
                <Dot hex={colorHex(r.ref, idx)} />
                <span className="wk-mp-txt">
                  <span className="wk-mp-name" title={r.name}>
                    {r.name}
                    {r.id in unsaved && <span className="wk-mp-unsaved">unsaved</span>}
                  </span>
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
                    onClick={() => { onStage([r.id], null); focusAfterReset(i); }}>
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
                aria-expanded={open != null}
                onClick={() => (open ? closePicker() : setOpen(btn.current?.getBoundingClientRect() ?? null))}>
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
      {canEdit && unsavedCount > 0 && (
        <p className="wk-mp-pending" role="status">
          {`${unsavedCount} unsaved color ${unsavedCount === 1 ? 'change' : 'changes'} — previewed on the canvas. Save to keep them, Cancel to discard.`}
        </p>
      )}

      {open && live.length > 0 && (
        // Encima de la ficha (no la agranda) y dentro de ella (Tab llega a él).
        // Escape lo cierra a él solo: el panel corta el evento antes que la ficha.
        <FloatingPanel anchor={open} owner={btn.current} onClose={closePicker} inPlace>
          <div className="wk-mp-float">
            <ColorPicker
              title={single ? `${single.name} · on this canvas` : `${live.length} boxes · on this canvas`}
              themes={themes}
              value={allSame ? here[0] : '__mixed__'}
              noneValue="none"
              inherit={{
                label: single ? `Use the ${noun(single.kind)}'s color` : "Use each one's own color",
                hex: single ? colorHex(single.own, idx) : null,
                current: allSame && here[0] === null,
              }}
              onPick={paint}
              alive={alive}
            />
          </div>
        </FloatingPanel>
      )}
    </section>
  );
}
