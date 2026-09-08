import { AlertTriangle } from 'lucide-react';
import type { DiffImpact } from '@/types/versioning';
import { criticalDeletionText } from '@/features/modeler/lib/projectDeletion';

/** Aviso crítico del revisor (doc 75 D5/D20): el request borra su proyecto. */
export default function CriticalDeletionBlock({ deletes }: { deletes: NonNullable<DiffImpact['deletesProject']> }) {
  const t = criticalDeletionText(deletes.name, deletes.counts);
  return (
    <div className="dmh-rv-critical" role="alert">
      <AlertTriangle size={18} strokeWidth={1.8} aria-hidden />
      <div><strong>{t.title}</strong> {t.body}</div>
    </div>
  );
}
