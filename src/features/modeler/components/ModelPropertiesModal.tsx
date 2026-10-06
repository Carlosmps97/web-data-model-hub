import { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import UdpAssign from './UdpAssign';
import CanvasColorsSection from './CanvasColorsSection';
import type { SubjectArea } from '@/features/modeler/services/modeler.service';
import { patchSubjectAreaUdp } from '@/features/modeler/services/structure.service';
import { useModelerStore } from '@/store/useModelerStore';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { udpChanges } from '../lib/udpDraft';
import { pendingChanges, stage, type PendingColors } from '../lib/canvasColors';
import { discardSystemPicker, flushSystemPicker } from '../lib/systemColorPicker';

/**
 * "Model properties" — la ficha del canvas (F5 + doc 112). TODO se graba con
 * Save, en la versión en edición (changeset), y Cancel/X/Escape lo descartan:
 *  - UDPs: los UDP level='canvas' del Modelo de Datos (subject area). Se graba
 *    SÓLO lo que cambió desde que se abrió la ficha, sobre los valores vigentes
 *    (una ficha reabierta mientras otro Save viajaba no lo pisa); al guardar
 *    refleja el mapa en el diagrama en memoria (sin refetch).
 *  - Colors on this canvas: qué cajas pinta distinto este canvas y pintar las
 *    elegidas. Quedan pendientes y el canvas las muestra como vista previa
 *    (`colorPreview`); al Save van en UN request con UN Undo.
 * En el visor se abre de sólo lectura.
 */
export default function ModelPropertiesModal({ subjectArea, canEdit, boxes, onClose, pushToast }: {
  subjectArea: SubjectArea;
  canEdit: boolean;
  /** Doc 112: cajas a pintar en este canvas (desde Properties). */
  boxes?: string[];
  onClose: () => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  // Cómo se abrió: lo que se graba es la diferencia contra esto.
  const [initial] = useState<Record<string, string>>(() => ({ ...(subjectArea.udpValues ?? {}) }));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const applyCanvasColors = useModelerStore((s) => s.applyCanvasColors);
  const setColorPreview = useModelerStore((s) => s.setColorPreview);
  // Colores pendientes: el Save lee el ref (incluye lo que «More colors…» trae
  // en el mismo instante, al vaciar su pausa).
  const [pending, setPending] = useState<PendingColors>({});
  const pendingRef = useRef(pending);
  const onStage = (ids: string[], ref: string | null) => {
    pendingRef.current = stage(pendingRef.current, ids, ref);
    setPending(pendingRef.current);
  };
  // «More colors…» aplica mientras siga abierta ESTA ficha.
  const [sheetOpen] = useState(() => {
    const sheet = useModelerStore.getState().modelProps;
    return () => useModelerStore.getState().modelProps === sheet;
  });
  // El canvas muestra lo pendiente; al cerrarse la ficha (Save, Cancel, X,
  // Escape, otra sesión) la vista previa se va y lo no guardado se descarta.
  useEffect(() => { setColorPreview(pending); }, [pending, setColorPreview]);
  useEffect(() => () => { setColorPreview(null); discardSystemPicker(sheetOpen); }, [setColorPreview, sheetOpen]);

  const save = async () => {
    flushSystemPicker(sheetOpen);   // lo elegido en el selector del sistema que esperaba su pausa
    const udp = udpChanges(initial, values);
    const colors = pendingChanges(useModelerStore.getState().canvasColors, pendingRef.current);
    if (!Object.keys(udp).length && !Object.keys(colors).length) { onClose(); return; }
    setBusy(true);
    // Doc 105 (ronda 3): el fallo espera la revalidación y calla si la sesión cambió (`reportWriteError`).
    const pin = pinSession();
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'));
    try {
      if (Object.keys(udp).length) {
        const sa = await patchSubjectAreaUdp(subjectArea.id, udp);
        if (!pin.holds()) return;   // el diagrama en pantalla ya es de otra sesión
        const st = useModelerStore.getState();
        if (st.diagram && st.diagram.subjectArea.id === sa.id) {
          useModelerStore.setState({
            diagram: { ...st.diagram, subjectArea: { ...st.diagram.subjectArea, udpValues: sa.udpValues ?? {} } },
          });
        }
      }
      if (Object.keys(colors).length) {
        if (!pin.holds()) return;
        // Si no se pudo grabar ya avisó: la ficha queda abierta con lo pendiente.
        if (!(await applyCanvasColors(colors, 'Change colors on this canvas'))) return;
        pendingRef.current = {};
        setPending({});
      }
      pushToast('Model properties saved');
      onClose();
    } catch (e) {
      await onError(e);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open
      title="Model properties"
      subtitle={subjectArea.name}
      icon={Settings2}
      backdrop="canvas"
      canvasTop={136}
      width={540}
      onClose={onClose}
      footer={(
        <>
          {/* Doc 112: «Cancel» descarta todo lo no guardado (UDPs y colores);
              en el visor no hay nada que descartar: «Close». */}
          <button className="rd-btn rd-btn-secondary rd-btn-sm" disabled={busy} onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && (
            <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
        </>
      )}
    >
      <section className="wk-mp-sec" aria-label="UDPs">
        <div className="wk-mp-head"><h4 className="wk-mp-title">UDPs</h4></div>
        <UdpAssign level="canvas" values={values} disabled={!canEdit} onChange={setValues} />
      </section>
      <CanvasColorsSection canEdit={canEdit} boxes={boxes} pending={pending} onStage={onStage} alive={sheetOpen} />
    </Dialog>
  );
}
