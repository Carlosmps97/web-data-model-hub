import { useState } from 'react';
import { Toaster, toast } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';
import Header from '@/components/layout/Header';
import DomainsPanel from './DomainsPanel';
import DictionaryPanel from './DictionaryPanel';
import CatalogPanel from './CatalogPanel';
import ChangesetBar from './ChangesetBar';
import ApprovalInbox from './ApprovalInbox';
import { useChangesetStore } from '@/store/useChangesetStore';

const pushToast = (m: string, k?: 'err') => (k === 'err' ? toast.error(m) : toast.success(m));
type Tab = 'domains' | 'dictionary' | 'catalog' | 'approvals';

export default function GovernanceScreen() {
  const [tab, setTab] = useState<Tab>('domains');
  const activeId = useChangesetStore((s) => s.activeId);
  const canEdit = activeId != null;
  return (
    <AppLayout>
      <div className="dmh-main">
        <Header crumbs={[{ label: 'Governance' }]} />
        <div className="dmh-page">
          <ChangesetBar pushToast={pushToast} />
          <div className="rd-seg" style={{ marginBottom: 12 }}>
            <button className={tab === 'domains' ? 'active' : ''} onClick={() => setTab('domains')}>Parent Domains</button>
            <button className={tab === 'dictionary' ? 'active' : ''} onClick={() => setTab('dictionary')}>UDP</button>
            <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Tablas canónicas</button>
            <button className={tab === 'approvals' ? 'active' : ''} onClick={() => setTab('approvals')}>Aprobaciones</button>
          </div>
          {tab === 'domains' && <DomainsPanel key={`d-${activeId}`} pushToast={pushToast} canEdit={canEdit} />}
          {tab === 'dictionary' && <DictionaryPanel key={`u-${activeId}`} pushToast={pushToast} canEdit={canEdit} />}
          {tab === 'catalog' && <CatalogPanel key={`c-${activeId}`} pushToast={pushToast} canEdit={canEdit} />}
          {tab === 'approvals' && <ApprovalInbox pushToast={pushToast} />}
        </div>
      </div>
      <Toaster richColors position="bottom-center" toastOptions={{ style: { fontFamily: 'var(--ui)' } }} />
    </AppLayout>
  );
}
