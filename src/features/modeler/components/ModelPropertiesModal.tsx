import { useState } from 'react';
import { Tags } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import UdpAssign from './UdpAssign';
import type { SubjectArea } from '@/features/modeler/services/modeler.service';
import { setSubjectAreaUdp } from '@/features/modeler/services/structure.service';
import { useModelerStore } from '@/store/useModelerStore';

/**
 * "Model properties" (F5): asigna los UDP level='canvas' al Modelo de Datos
 * (subject area). Va por la capa de ESTRUCTURA changeset-aware (doc 16): en
 * sesión de edición se registra al changeset; sin changeset, PUT directo
 * (mismo régimen que layout/drawings). Al guardar refleja el mapa
 * en el diagrama en memoria (sin refetch).
 */
export default function ModelPropertiesModal({ subjectArea, canEdit, onClose, pushToast }: {
  subjectArea: SubjectArea;
  canEdit: boolean;
  onClose: () => void;
  pushToast: (m: string, k?: 'err') => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(subjectArea.udpValues ?? {});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const sa = await setSubjectAreaUdp(subjectArea.id, values);
      const st = useModelerStore.getState();
      if (st.diagram && st.diagram.subjectArea.id === sa.id) {
        useModelerStore.setState({
          diagram: { ...st.diagram, subjectArea: { ...st.diagram.subjectArea, udpValues: sa.udpValues ?? {} } },
        });
      }
      pushToast('Model properties saved');
      onClose();
    } catch (e) {
      pushToast(e instanceof Error && e.message ? e.message : "Couldn't save", 'err');
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open
      title="Model properties"
      subtitle={subjectArea.name}
      icon={Tags}
      backdrop="canvas"
      canvasTop={136}
      width={480}
      onClose={onClose}
      footer={(
        <>
          <button className="rd-btn rd-btn-ghost rd-btn-sm" onClick={onClose}>Cancel</button>
          <button className="rd-btn rd-btn-primary rd-btn-sm" disabled={!canEdit || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <UdpAssign level="canvas" values={values} disabled={!canEdit} onChange={setValues} />
    </Dialog>
  );
}
