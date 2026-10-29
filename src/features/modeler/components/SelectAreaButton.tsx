import { useEffect } from 'react';
import { ControlButton, useStore } from '@xyflow/react';
import { BoxSelect } from 'lucide-react';
import { facetNouns } from '@/lib/facets';
import { useModelerStore } from '@/store/useModelerStore';

/**
 * «Select area» en los controles del canvas (doc 134 §3.1): enciende y apaga el
 * modo en que arrastrar sobre el fondo dibuja el cuadro de selección. Con el
 * candado de los controles puesto no se puede seleccionar: queda deshabilitado
 * y el store lo sabe (`canvasLocked`), así Shift + arrastrar tampoco dibuja.
 */
export default function SelectAreaButton() {
  const on = useModelerStore((s) => s.boxSelect);
  const setBoxSelect = useModelerStore((s) => s.setBoxSelect);
  const setCanvasLocked = useModelerStore((s) => s.setCanvasLocked);
  const nouns = facetNouns(useModelerStore((s) => s.viewMode));
  const interactive = useStore((s) => s.nodesDraggable && s.nodesConnectable && s.elementsSelectable);
  useEffect(() => { setCanvasLocked(!interactive); }, [interactive, setCanvasLocked]);
  return (
    <ControlButton className={`wk-box-btn${on && interactive ? ' on' : ''}`} aria-pressed={on && interactive} disabled={!interactive}
      title={interactive ? `Select area — drag to select ${nouns.many} (Space+drag to pan)` : 'Unlock the canvas to select an area'}
      aria-label="Select area" onClick={() => setBoxSelect(!on)}>
      <BoxSelect size={14} aria-hidden />
    </ControlButton>
  );
}
