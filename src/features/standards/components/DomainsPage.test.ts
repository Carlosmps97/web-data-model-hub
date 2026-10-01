// Data Standards → Parent Domains sin DOM (hooks de mentira: ver
// reporting/components/fakeReact.testutil). Doc 105: «Apply changes» se
// habilitaba SIN cambios — también al revertir a una versión igual a la
// vigente — y el apply registraba una versión vacía.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { DomainHistoryEntry, SnapshotDomain, StandardsSnapshot } from '../standards.service';
import { byText, nextStates, resetFake, runEffects, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../standards.service', () => ({ applyStandards: vi.fn(), getDomainHistory: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({
  getDomainColumnImpact: vi.fn(async () => null), physicalize: vi.fn(async () => ({ physical: 'CODCLAVE' })),
}));
import { toast } from 'sonner';
import { applyStandards } from '../standards.service';
import DomainCascadeDialog from './DomainCascadeDialog';
import DomainHistory from './DomainHistory';
import DomainsPage from './DomainsPage';

const D1: SnapshotDomain = {
  id: 'd1', name: 'Codigo Clave', defaultDataType: 'INTEGER', logicalDataType: 'NUMBER', namingTerm: null,
  description: 'Clave del cliente', inheritsName: false, physicalName: null, physicalDescription: null, udpValues: {},
};
const snapshot = { domains: [D1], dict: [], udp: [], namingConfig: {} } as unknown as StandardsSnapshot;
const tick = () => new Promise((r) => setTimeout(r, 0));
const entry = (state: Partial<SnapshotDomain>): DomainHistoryEntry => ({
  seq: 3, label: 'v3', title: 't', author: 'ana', kind: 'domain', changed: [],
  state: { ...D1, ...state } as DomainHistoryEntry['state'],
});

let props: Parameters<typeof DomainsPage>[0];
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = DomainsPage(props);
  runEffects();
  return tree;
}
/** Monta la página con D1 elegido, en modo vista. */
async function mount() {
  props = { projectId: 'p1', snapshot, canEdit: true, onApplied: vi.fn() };
  resetFake();
  DomainsPage(props);
  runEffects();
  await tick();
  return rerender();
}
const click = (el: { props: Record<string, unknown> }) => (el.props.onClick as () => void)();
const applyBtn = (tree: unknown) => byText(tree, 'button', 'Apply changes');

beforeEach(() => { vi.clearAllMocks(); });

describe('Parent Domains: «Apply changes» sólo con un cambio real (doc 105)', () => {
  it('en edición y sin cambios queda deshabilitado, con «No changes to apply»', async () => {
    let tree = await mount();
    click(byText(tree, 'button', 'Edit domain'));
    tree = rerender();
    expect(applyBtn(tree).props.disabled).toBe(true);
    expect(applyBtn(tree).props.title).toBe('No changes to apply');
  });

  it('con un cambio se habilita; si el backend igual responde «sin cambios», el aviso es neutro', async () => {
    let tree = await mount();
    click(byText(tree, 'button', 'Edit domain'));
    tree = rerender();
    const desc = [...walk(tree)].find((e) => e.type === 'textarea')!;
    (desc.props.onChange as (e: unknown) => void)({ target: { value: 'Clave única del cliente' } });
    tree = rerender();
    expect(applyBtn(tree).props.disabled).toBe(false);

    vi.mocked(applyStandards).mockRejectedValueOnce(new ApiError('There are no changes to apply.', 422));
    click(applyBtn(tree));                                   // abre el popup de cascada
    tree = rerender();
    const dialog = [...walk(tree)].find((e) => e.type === DomainCascadeDialog)!;
    await (dialog.props.onApply as () => Promise<void>)();
    expect(toast.info).toHaveBeenCalledWith('There are no changes to apply.');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('«Revert» a una versión igual a la vigente no deja aplicar; a una distinta, sí', async () => {
    let tree = await mount();
    const history = () => [...walk(tree)].find((e) => e.type === DomainHistory)!;
    (history().props.onRevert as (e: DomainHistoryEntry) => void)(entry({}));
    tree = rerender();
    expect(applyBtn(tree).props.disabled).toBe(true);

    click(byText(tree, 'button', 'Cancel'));
    tree = rerender();
    (history().props.onRevert as (e: DomainHistoryEntry) => void)(entry({ defaultDataType: 'SMALLINT' }));
    tree = rerender();
    expect(applyBtn(tree).props.disabled).toBe(false);
  });
});
