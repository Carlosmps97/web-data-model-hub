/**
 * ChangesDetailModal (doc 64 §7 — v2; nace en doc 31) — popup "Change details"
 * de la revisión. Doc 84: el cuerpo (filtros + árbol + diff de campos) vive en
 * `DiffExplorer`, compartido con el Compare de versiones; acá quedan el overlay,
 * la cabecera y la fuente de datos (`POST /diff/details`, bajo demanda) más la
 * atribución «quién y cuándo» de cada cambio (B3). READ-ONLY: no toca nada del
 * flujo de aprobación.
 */
import { useCallback, useEffect } from 'react';
import { FileDiff, X } from 'lucide-react';
import { getDiffDetails } from '@/services/versioning.service';
import type { ChangesetDiff, DiffEntityDetail } from '@/types/versioning';
import DiffExplorer, { fmtWhen } from './DiffExplorer';
import type { DetailRef } from './diffDetailCache';

export { FieldRows } from './DiffExplorer';

export default function ChangesDetailModal({ csId, title, versionLabel, diff, ownerName, onClose }: {
  csId: string;
  title: string | null;
  versionLabel: string | null;
  diff: ChangesetDiff;
  /** Doc 84 B3: autor de TODOS los cambios del request (un changeset = un owner). */
  ownerName?: string | null;
  onClose: () => void;
}) {
  // Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadDetails = useCallback((items: DetailRef[]) => getDiffDetails(csId, items), [csId]);
  const attribution = useCallback((_sel: unknown, d: DiffEntityDetail | null) => (
    d?.at ? (
      <div className="dmh-rvd-attr">
        Changed {fmtWhen(d.at)}{ownerName ? ` by ${ownerName}` : ''}
      </div>
    ) : null
  ), [ownerName]);

  return (
    <div className="dmh-rvd-overlay" onClick={onClose} role="presentation">
      <div
        className="dmh-rvd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Change details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dmh-rvd-head">
          <div className="dmh-rvd-head-ico">
            <FileDiff size={17} strokeWidth={1.5} aria-hidden />
          </div>
          <div className="dmh-rvd-head-text">
            <div className="dmh-rvd-head-title">Change details</div>
            <div className="dmh-rvd-head-sub">
              {versionLabel ?? '—'} · {title ?? 'Untitled request'}{ownerName ? ` · by ${ownerName}` : ''}
            </div>
          </div>
          <button type="button" className="dmh-rvd-close" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto' }}>
            <X size={14} strokeWidth={1.6} aria-hidden />
          </button>
        </div>
        <DiffExplorer diff={diff} loadDetails={loadDetails} attribution={attribution} />
      </div>
    </div>
  );
}
