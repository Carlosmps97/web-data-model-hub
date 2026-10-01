import { useState } from 'react';
import { Tags } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import type { ParentDomain } from '@/services/governance.service';
import type { DomainUdpOffer, DomainUdpOfferItem } from '../lib/domainInherit';

/**
 * Doc 85 §3.6 — «Inherit from domain X». Aparece SOLO al elegir un dominio
 * DISTINTO del actual que tenga UDP por defecto: el modelador elige cuáles
 * copiar a la columna (ambas facetas, todo marcado por defecto — D4). `also`
 * resume lo que se aplica de todos modos (tipo; nombres + definiciones si el
 * dominio es «atributo estándar»). Skip = ningún UDP (el resto se aplica igual).
 */
export default function DomainInheritPopup({ domain, offer, also, onConfirm, onSkip }: {
  domain: ParentDomain;
  offer: DomainUdpOffer;
  also: string[];
  onConfirm: (picked: DomainUdpOfferItem[]) => void;
  onSkip: () => void;
}) {
  const all = [...offer.logical, ...offer.physical];
  const [checked, setChecked] = useState<Set<string>>(() => new Set(all.map((i) => i.def.id)));
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const group = (title: string, items: DomainUdpOfferItem[], color: string) => (items.length === 0 ? null : (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color, marginBottom: 6 }}>{title}</div>
      {items.map((i) => (
        <label key={i.def.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5, color: '#1A2B4A', cursor: 'pointer' }}>
          <input type="checkbox" checked={checked.has(i.def.id)} onChange={() => toggle(i.def.id)} />
          <Tags size={12} color={color} />
          <span style={{ flex: 1 }} title={i.def.description ?? undefined}>{i.def.name}</span>
          <span className="rd-mono" style={{ color: '#48526A' }}>{i.value}</span>
        </label>
      ))}
    </div>
  ));
  return (
    <Modal title={`Inherit from domain ${domain.name}`} icon="columns" onClose={onSkip}
      footer={<>
        <button className="rd-btn rd-btn-secondary rd-btn-sm" onClick={onSkip}>Skip</button>
        <button className="rd-btn rd-btn-primary rd-btn-sm" onClick={() => onConfirm(all.filter((i) => checked.has(i.def.id)))}>
          Inherit selected ({checked.size})
        </button>
      </>}>
      {also.length > 0 && <div className="rd-small" style={{ color: '#6B7689' }}>Also applied: {also.join(' · ')}.</div>}
      <div className="rd-small" style={{ marginTop: 6, color: '#6B7689' }}>
        Pick the UDP defaults to copy into this column. Unchecked ones keep their current value.
      </div>
      {group('Logical · attribute UDPs', offer.logical, '#6D3FC4')}
      {group('Physical · column UDPs', offer.physical, '#1F4FD8')}
    </Modal>
  );
}
