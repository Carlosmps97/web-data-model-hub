import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import UdpAssign from './UdpAssign';
import CanvasColorsSection from './CanvasColorsSection';
import type { SubjectArea } from '@/features/modeler/services/modeler.service';
import { patchSubjectAreaUdp } from '@/features/modeler/services/structure.service';
import { useModelerStore } from '@/store/useModelerStore';
import { pinSession, reportWriteError } from '../lib/sessionGuard';
import { udpChanges } from '../lib/udpDraft';

/**
 * "Model properties" — la ficha del canvas (F5 + doc 112):
 *  - UDPs: asigna los UDP level='canvas' al Modelo de Datos (subject area). Va
 *    por la capa de ESTRUCTURA changeset-aware (doc 16) y se graba con Save:
 *    SÓLO lo que cambió desde que se abrió la ficha, sobre los valores vigentes
 *    (doc 112: una ficha reabierta mientras otro Save viajaba no lo pisa); al
 *    guardar refleja el mapa en el diagrama en memoria (sin refetch).
 *  - Colors on this canvas (doc 112): qué cajas pinta distinto este canvas y
 *    pintar las elegidas. Se aplica al instante, con Undo (`CanvasColorsSection`).
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

  const save = async () => {
    // Doc 112: sin cambios en los UDPs, Save sólo cierra (los colores ya se aplicaron).
    const changes = udpChanges(initial, values);
    if (!Object.keys(changes).length) { onClose(); return; }
    setBusy(true);
    // Doc 105 (ronda 3): el fallo espera la revalidación y calla si la sesión cambió (`reportWriteError`).
    const pin = pinSession();
    const onError = reportWriteError((e) => pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err'));
    try {
      const sa = await patchSubjectAreaUdp(subjectArea.id, changes);
      if (!pin.holds()) return;   // el diagrama en pantalla ya es de otra sesión
      const st = useModelerStore.getState();
      if (st.diagram && st.diagram.subjectArea.id === sa.id) {
        useModelerStore.setState({
          diagram: { ...st.diagram, subjectArea: { ...st.diagram.subjectArea, udpValues: sa.udpValues ?? {} } },
        });
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
          {/* Doc 112: en edición dice «Cancel» (descarta los UDPs sin guardar —
              un campo de texto recién se confirma al salir de él, así que no se
              puede saber antes si hay algo escrito); los colores ya se aplicaron
              y no se revierten. En el visor no hay nada que descartar: «Close». */}
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
      <CanvasColorsSection canEdit={canEdit} boxes={boxes} />
    </Dialog>
  );
}
