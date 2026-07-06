import { useState } from 'react';
import { Toaster, toast } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import CatalogPanel from './CatalogPanel';
import ChangesetBar from './ChangesetBar';
import ApprovalInbox from './ApprovalInbox';
import { useChangesetStore } from '@/store/useChangesetStore';

const pushToast = (m: string, k?: 'err') => (k === 'err' ? toast.error(m) : toast.success(m));
type Tab = 'catalog' | 'approvals';

// Las pestañas Parent Domains y UDP se retiraron (2026-07-04): los estándares se
// gestionan en el módulo **Data Standards** (versionado propio), no acá — desde
// el changeset del canvas daban 422 (ya no son colecciones versionadas).
export default function GovernanceScreen() {
  const [tab, setTab] = useState<Tab>('catalog');
  const activeId = useChangesetStore((s) => s.activeId);
  const canEdit = activeId != null;
  return (
    <AppLayout>
      <div className="dmh-main">
        <Header crumbs={[{ label: 'Governance' }]} />
        <div className="dmh-page">
          <ChangesetBar pushToast={pushToast} />
          <div className="rd-seg" style={{ marginBottom: 12 }}>
            <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Tablas canónicas</button>
            <button className={tab === 'approvals' ? 'active' : ''} onClick={() => setTab('approvals')}>Aprobaciones</button>
          </div>
          {tab === 'catalog' && <CatalogPanel key={`c-${activeId}`} pushToast={pushToast} canEdit={canEdit} />}
          {tab === 'approvals' && <ApprovalInbox pushToast={pushToast} />}
        </div>
      </div>
      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </AppLayout>
  );
}
