/**
 * DDL export rules — pestaña de Data Standards. La lista ordenada de reglas
 * (arriba = más prioridad) y, desde ella, el editor de una regla, las piezas y
 * variables y las Output settings. Las reglas escriben los archivos del Export
 * DDL con «Use export rules»; nunca tocan el modelo.
 */
import { useMemo, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

import type { DdlRule, DdlRulesetConfig, StandardsSnapshot } from '../standards.service';
import DdlRuleList from './DdlRuleList';
import DdlRuleEditor from './DdlRuleEditor';
import DdlPiecesEditor from './DdlPiecesEditor';
import DdlOutputSettingsEditor from './DdlOutputSettingsEditor';

type View = { t: 'list' } | { t: 'editor'; rule: DdlRule | null } | { t: 'pieces' };

const NO_CONFIG: DdlRulesetConfig = { pieces: '', variables: {}, output: {} };

export default function DdlRulesTab({ projectId, snapshot, canEdit, onApplied }: {
  projectId: string;
  snapshot: StandardsSnapshot;
  canEdit: boolean;
  onApplied: () => Promise<void> | void;
}) {
  const rules = useMemo(() => snapshot.ddlRules ?? [], [snapshot.ddlRules]);
  const config = snapshot.ddlConfig ?? NO_CONFIG;
  const [view, setView] = useState<View>({ t: 'list' });
  const [outputOpen, setOutputOpen] = useState(false);
  const canExport = useAuthStore((s) => s.has('export'));
  const toList = async () => { await onApplied(); setView({ t: 'list' }); };

  if (view.t === 'editor') {
    return (
      <DdlRuleEditor projectId={projectId} rule={view.rule} rules={rules} config={config} udpDefs={snapshot.udp}
        canEdit={canEdit} canPreview={canExport} onBack={() => setView({ t: 'list' })} onSaved={toList} />
    );
  }
  if (view.t === 'pieces') {
    return (
      <DdlPiecesEditor projectId={projectId} config={config} udpDefs={snapshot.udp} canEdit={canEdit}
        onBack={() => setView({ t: 'list' })} onSaved={toList} />
    );
  }
  return (
    <>
      <DdlRuleList projectId={projectId} rules={rules} config={config} canEdit={canEdit}
        onOpen={(rule) => setView({ t: 'editor', rule })} onNew={() => setView({ t: 'editor', rule: null })}
        onPieces={() => setView({ t: 'pieces' })} onOutput={() => setOutputOpen(true)} onApplied={onApplied} />
      {outputOpen && (
        <DdlOutputSettingsEditor projectId={projectId} config={config} canEdit={canEdit}
          onClose={() => setOutputOpen(false)} onApplied={onApplied} />
      )}
    </>
  );
}
