import Modal from '@/components/ui/Modal';
import { useChangesetStore } from '@/store/useChangesetStore';
import ParentDomainsPopup from '@/features/governance/components/ParentDomainsPopup';
import UdpPopup from '@/features/governance/components/UdpPopup';
import CatalogPanel from '@/features/governance/components/CatalogPanel';
import ApprovalInbox from '@/features/governance/components/ApprovalInbox';

export type GovKind = 'udp' | 'domains' | 'catalog' | 'approvals';
const META: Record<GovKind, { title: string; icon: 'bolt' | 'key' | 'grid' | 'sparkles' }> = {
  udp: { title: 'UDP · Naming standards', icon: 'bolt' },
  domains: { title: 'Parent Domains', icon: 'key' },
  catalog: { title: 'Catálogo canónico', icon: 'grid' },
  approvals: { title: 'Aprobaciones', icon: 'sparkles' },
};

export default function GovPopup({ kind, onClose, pushToast }: { kind: GovKind; onClose: () => void; pushToast: (m: string, k?: 'err') => void }) {
  const canEdit = useChangesetStore((s) => s.activeId) != null;
  return (
    <Modal title={META[kind].title} icon={META[kind].icon} size="lg" onClose={onClose}>
      {kind === 'domains' && <ParentDomainsPopup pushToast={pushToast} />}
      {kind === 'udp' && <UdpPopup pushToast={pushToast} />}
      {kind === 'catalog' && <CatalogPanel pushToast={pushToast} canEdit={canEdit} />}
      {kind === 'approvals' && <ApprovalInbox pushToast={pushToast} />}
    </Modal>
  );
}
