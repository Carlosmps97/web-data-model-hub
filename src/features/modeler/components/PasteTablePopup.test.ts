// Doc 118 — «Paste table» sin DOM (hooks de mentira: ver
// features/reporting/components/fakeReact.testutil): avisa el duplicado con las
// copias que ya existen, graba lo que mostró y un nombre sobre el tope bloquea;
// lo copiado en otro proyecto se revisa con los estándares de los dos.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, nextStates, resetFake, runEffects, textOf, unmount, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const { pasteTable, CLIP, STATE, loadSourceStandards } = vi.hoisted(() => {
  const CLIP = {
    table: { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core', udpValues: { 'src-tc': 'full' } },
    cols: [{ id: 'c1', tableId: 't1', physicalName: 'cod', logicalName: 'Cod', dataType: 'STRING', typeOverridden: false, ordinal: 0 }],
  };
  return {
    pasteTable: vi.fn<(prepared: unknown) => Promise<string>>(async () => 'M_CLIENTE_copy_2'),
    CLIP,
    STATE: { tblClipboard: CLIP as object, viewMode: 'physical' },
    loadSourceStandards: vi.fn<(projectId: string) => Promise<unknown>>(async () => null),
  };
});
vi.mock('@/store/useModelerStore', () => {
  const hook = (pick: (s: unknown) => unknown) => pick({ ...STATE, pasteTable });
  hook.getState = () => ({ ...STATE, pasteTable });
  return { useModelerStore: hook, tableNamesTaken: vi.fn(async () => []) };
});
vi.mock('@/store/useSessionStore', () => ({
  sessionProjectId: () => 'p1',
  useSessionStore: (pick: (s: unknown) => unknown) => pick({ activeProjectId: 'p1' }),
}));
vi.mock('../services/pasteSource.service', () => ({ loadSourceStandards }));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('@/services/governance.service', () => ({ listDomains: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => null) }));
vi.mock('@/services/themes.service', () => ({ listThemes: vi.fn(async () => []) }));
vi.mock('../services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../lib/sessionGuard', () => ({ reportWriteError: (r: (e: unknown) => void) => async (e: unknown) => r(e) }));
import PasteTablePopup, { existingCopies } from './PasteTablePopup';

const DATA = (maxLength = 0) => ({
  target: {
    udpDefs: [], domains: [], themes: [], schemas: [{ id: 's', name: 'Core', kind: 'tables' as const }],
    naming: { column: { separator: '' as const, case: 'upper' as const, maxLength }, table: { separator: '' as const, case: 'upper' as const, maxLength } },
  },
  taken: ['M_CLIENTE', 'M_CLIENTE_copy_1', 'M_CLIENTE_HIST'],
  same: true,
  source: null as unknown,
});

function render(data: unknown = DATA()) {
  resetFake((init, i) => (i === 2 ? data : init));          // `data` = 3.er useState
  return PasteTablePopup({ onClose: vi.fn(), pushToast: vi.fn() });
}

const FROM_B = { ...CLIP, source: { projectId: 'p2', projectName: 'UDV Piloto' } };
// «Tipo de Carga» con otro id y otra grafía en cada proyecto.
const tipoCarga = (id: string, allowedValues: string[]) =>
  ({ id, name: 'Tipo de Carga', level: 'table', view: 'physical', dataType: 'list', allowedValues });
const SRC_STD = { udpDefs: [tipoCarga('src-tc', ['Full', 'Delta'])], domains: [], themes: [] };

beforeEach(() => {
  STATE.tblClipboard = CLIP;
  pasteTable.mockClear();
  loadSourceStandards.mockReset();
  loadSourceStandards.mockResolvedValue(SRC_STD);
});

describe('existingCopies', () => {
  it('la tabla y sus copias (`_copy_n`), sin repetir y en orden natural', () => {
    expect(existingCopies('M_CLIENTE_copy_3', ['M_CLIENTE_copy_10', 'm_cliente', 'M_CLIENTE_copy_2', 'M_CLIENTE_HIST', 'M_CLIENTE_copy_x', 'M_CLIENTE']))
      .toEqual(['m_cliente', 'M_CLIENTE_copy_2', 'M_CLIENTE_copy_10']);
  });
});

describe('PasteTablePopup (doc 118)', () => {
  it('avisa que ya existe y con qué nombre se crea', () => {
    const head = [...walk(render())].find((e) => e.props.className === 'wk-paste-head')!;
    expect(textOf(head)).toContain('Already in this project: M_CLIENTE, M_CLIENTE_copy_1 —');
    expect(textOf(head)).toContain('it will be created as M_CLIENTE_copy_2');
  });

  it('confirmar graba lo revisado: nombre, esquema con la grafía del destino y el case de las columnas', async () => {
    const tree = render();
    (byText(tree, 'button', 'Paste table').props.onClick as () => void)();
    await vi.waitFor(() => expect(pasteTable).toHaveBeenCalledTimes(1));
    expect(pasteTable).toHaveBeenCalledWith(expect.objectContaining({
      table: expect.objectContaining({ physicalName: 'M_CLIENTE_copy_2', logicalName: 'Cliente copy 2', schema: 'Core' }),
      cols: [expect.objectContaining({ physicalName: 'COD' })],
    }));
  });

  it('un nombre sobre el tope del proyecto deshabilita el pegado', () => {
    expect(byText(render(DATA(10)), 'button', 'Paste table').props.disabled).toBe(true);
    expect(byText(render(DATA(0)), 'button', 'Paste table').props.disabled).toBe(false);
  });
});

describe('PasteTablePopup — copiado en otro proyecto (doc 118, fase 2)', () => {
  it('el subtítulo nombra el proyecto de origen y la revisión lee sus estándares', async () => {
    STATE.tblClipboard = FROM_B;
    resetFake();
    const tree = PasteTablePopup({ onClose: vi.fn(), pushToast: vi.fn() });
    expect(tree!.props.subtitle).toBe('M_CLIENTE from «UDV Piloto» → this canvas');
    runEffects();
    await vi.waitFor(() => expect(nextStates()[2]).toEqual(expect.objectContaining({ same: false, source: SRC_STD })));
    expect(loadSourceStandards).toHaveBeenCalledWith('p2');
  });

  it('del mismo proyecto no lee otros estándares ni nombra el origen', async () => {
    STATE.tblClipboard = { ...CLIP, source: { projectId: 'p1', projectName: 'Modelo Piloto' } };
    resetFake();
    const tree = PasteTablePopup({ onClose: vi.fn(), pushToast: vi.fn() });
    expect(tree!.props.subtitle).toBe('M_CLIENTE → this canvas');
    runEffects();
    await vi.waitFor(() => expect(nextStates()[2]).toEqual(expect.objectContaining({ same: true, source: null })));
    expect(loadSourceStandards).not.toHaveBeenCalled();
  });

  it('confirmar graba los UDP con los ids y la grafía del destino', async () => {
    STATE.tblClipboard = FROM_B;
    const data = { ...DATA(), target: { ...DATA().target, udpDefs: [tipoCarga('dst-tc', ['FULL'])] }, same: false, source: SRC_STD };
    (byText(render(data), 'button', 'Paste table').props.onClick as () => void)();
    await vi.waitFor(() => expect(pasteTable).toHaveBeenCalledTimes(1));
    expect(pasteTable).toHaveBeenCalledWith(expect.objectContaining({
      table: expect.objectContaining({ udpValues: { 'dst-tc': 'FULL' } }),
    }));
  });

  it('otra falla al leer los estándares del origen (red, 500): el error con Retry, no un pegado a medias', async () => {
    STATE.tblClipboard = FROM_B;
    loadSourceStandards.mockRejectedValueOnce(new Error('Network error'));
    resetFake();
    PasteTablePopup({ onClose: vi.fn(), pushToast: vi.fn() });
    runEffects();
    await vi.waitFor(() => expect(nextStates()[3]).toBe('Network error'));
    resetFake((init, i) => (i === 3 ? 'Network error' : init));
    const tree = PasteTablePopup({ onClose: vi.fn(), pushToast: vi.fn() });
    expect(textOf(tree)).toContain("Couldn't read the standards");
    expect(byText(tree, 'button', 'Retry')).toBeTruthy();
  });

  it('la respuesta que llega después de cerrar el popup no escribe', async () => {
    STATE.tblClipboard = FROM_B;
    let release!: (v: unknown) => void;
    loadSourceStandards.mockReturnValueOnce(new Promise((r) => { release = r; }));
    resetFake();
    PasteTablePopup({ onClose: vi.fn(), pushToast: vi.fn() });
    runEffects();
    unmount();
    release(SRC_STD);
    await new Promise((r) => setTimeout(r, 0));
    expect(nextStates()[2]).toBeNull();
  });

  it('un clipboard sin proyecto de origen se trata como del mismo proyecto', async () => {
    resetFake();
    PasteTablePopup({ onClose: vi.fn(), pushToast: vi.fn() });
    runEffects();
    await vi.waitFor(() => expect(nextStates()[2]).toEqual(expect.objectContaining({ same: true, source: null })));
    expect(loadSourceStandards).not.toHaveBeenCalled();
  });

  it('sin los estándares del origen lo avisa y deja pegar lo demás', () => {
    STATE.tblClipboard = FROM_B;
    const tree = render({ ...DATA(), same: false, source: null });
    // Los avisos los pinta PasteDetails (no se invoca): se leen de la revisión que recibe.
    const details = [...walk(tree)].find((e) => 'review' in e.props)!;
    expect((details.props.review as { warnings: string[] }).warnings)
      .toEqual(expect.arrayContaining([expect.stringContaining("The standards of «UDV Piloto» can't be read")]));
    expect(byText(tree, 'button', 'Paste table').props.disabled).toBe(false);
  });
});
