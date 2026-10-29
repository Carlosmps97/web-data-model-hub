// «Paste N tables» sin DOM (hooks simulados: ver
// features/reporting/components/fakeReact.testutil): la revisión de «Paste table»
// para un grupo — nombres finales sin repetir, checks una vez para todas, el detalle
// de cada tabla y un bloqueo de cualquiera deshabilita Paste (doc 134 §3.7).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, textOf, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const { pasteTables, STATE, SESSION } = vi.hoisted(() => {
  const col = (id: string, tableId: string, udp?: string) => ({ id, tableId, physicalName: 'COD', logicalName: 'Cod', dataType: 'STRING',
    typeOverridden: false, ordinal: 0, ...(udp ? { udpValues: { u: udp } } : {}) });
  return {
    pasteTables: vi.fn<(prepared: unknown) => Promise<string[] | null>>(async () => ['M_CLIENTE_copy_2', 'M_CLIENTE_copy_3']),
    SESSION: { pid: 'p1' as string | null },
    STATE: {
      viewMode: 'physical',
      groupClipboard: {
        source: { projectId: 'p1', projectName: 'Uno' },
        tables: [
          { table: { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'Core' }, cols: [col('c1', 't1', 'Si')], pos: { x: 0, y: 0 } },
          { table: { id: 't2', physicalName: 'M_CLIENTE_copy_1', logicalName: 'Cliente copy 1', schema: 'Core' }, cols: [col('c2', 't2', 'No')], pos: { x: 400, y: 0 } },
        ],
      } as object | null,
    },
  };
});
vi.mock('@/store/useModelerStore', () => {
  const hook = (pick: (s: unknown) => unknown) => pick({ ...STATE, pasteTables });
  hook.getState = () => ({ ...STATE, pasteTables });
  return { useModelerStore: hook, tableNamesTaken: vi.fn(async () => []) };
});
vi.mock('@/store/useSessionStore', () => ({
  sessionProjectId: () => { if (!SESSION.pid) throw new Error('Open a project first.'); return SESSION.pid; },
  useSessionStore: (pick: (s: unknown) => unknown) => pick({ activeProjectId: SESSION.pid }),
}));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('@/services/governance.service', () => ({ listDomains: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => null) }));
vi.mock('@/services/themes.service', () => ({ listThemes: vi.fn(async () => []) }));
vi.mock('../services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../lib/sessionGuard', () => ({ reportWriteError: (r: (e: unknown) => void) => async (e: unknown) => r(e) }));
import { GROUP_PASTE_FOREIGN } from '../lib/canvasMenu';
import { ALL_COPY } from '../lib/pasteReview';
import PasteTablesPopup from './PasteTablesPopup';

const UDP = { id: 'u', name: 'Particion', level: 'column', view: 'physical', dataType: 'list', allowedValues: ['Si', 'No'] };
const DATA = (maxLength = 0) => ({
  target: {
    udpDefs: [UDP], domains: [], themes: [], schemas: [{ id: 's', name: 'Core', kind: 'tables' as const }],
    naming: { column: { separator: '' as const, case: 'upper' as const, maxLength: 0 }, table: { separator: '' as const, case: 'upper' as const, maxLength } },
  },
  taken: ['M_CLIENTE', 'M_CLIENTE_copy_1'],
});
// Estados en orden: [facet, options, data, error, attempt, saving, openIdx].
function render(data: unknown = DATA(), over: Record<number, unknown> = {}) {
  resetFake((init, i) => (i in over ? over[i] : i === 2 ? data : init));
  return PasteTablesPopup({ onClose: vi.fn(), pushToast: vi.fn() });
}
const rows = (tree: unknown) => [...walk(tree)].filter((e) => e.props.className === 'wk-paste-group-row' || String(e.props.className ?? '').startsWith('wk-paste-group-row '));
const pasteBtn = (tree: unknown): El => [...walk(tree)].find((e) => e.type === 'button' && /^Paste 2 tables/.test(textOf(e)))!;

beforeEach(() => { pasteTables.mockClear(); });

describe('PasteTablesPopup', () => {
  it('los nombres finales, en orden y sin repetir', () => {
    expect(rows(render()).map((r) => textOf(r))).toEqual([
      expect.stringContaining('M_CLIENTE_copy_2'), expect.stringContaining('M_CLIENTE_copy_3'),
    ]);
  });

  it('los checks una sola vez, con lo de todas las tablas', () => {
    const tree = render();
    const checks = [...walk(tree)].filter((e) => String(e.props.label ?? '').startsWith('Physical UDPs'));
    expect(checks.map((c) => c.props.label)).toEqual(['Physical UDPs (2)']);
  });

  it('un nombre sobre el tope bloquea Paste y la tabla dice por qué', () => {
    const tree = render(DATA(12));
    expect(pasteBtn(tree).props.disabled).toBe(true);
    expect(textOf(tree)).toContain('Fix before pasting');
  });

  it('confirmar pega lo que mostró, en el orden del grupo', async () => {
    const tree = render();
    expect(pasteBtn(tree).props.disabled).toBe(false);
    await (pasteBtn(tree).props.onClick as () => Promise<void>)();
    const prepared = pasteTables.mock.calls[0][0] as { table: { physicalName: string }; cols: { udpValues?: Record<string, string> }[] }[];
    expect(prepared.map((p) => p.table.physicalName)).toEqual(['M_CLIENTE_copy_2', 'M_CLIENTE_copy_3']);
    expect(prepared[0].cols[0].udpValues).toEqual({ u: 'Si' });
  });

  // El proyecto de la sesión se lee por su suscripción (como «Paste table»): si la
  // sesión se cierra con el popup abierto, dibujarlo no lanza «Open a project first.».
  it('sin proyecto en la sesión, se dibuja sin romperse y no deja pegar', () => {
    SESSION.pid = null;
    try {
      let tree: unknown;
      expect(() => { tree = render(); }).not.toThrow();
      expect(textOf(tree)).toContain(GROUP_PASTE_FOREIGN);
      expect(pasteBtn(tree).props.disabled).toBe(true);
    } finally { SESSION.pid = 'p1'; }
  });

  it('la fila de una tabla con bloqueos se marca, y la marca tiene estilo', () => {
    expect(rows(render(DATA(12))).every((r) => String(r.props.className).includes('blocked'))).toBe(true);
    const css = readFileSync(resolve(__dirname, '../modeler.css'), 'utf-8');
    expect(css).toMatch(/\.wk-paste-group-row\.blocked\s*\{[^}]*color:/);
  });

  it('con los UDP físicos apagados, ninguna tabla los lleva', async () => {
    const tree = render(DATA(), { 1: { ...ALL_COPY, physicalUdps: false } });
    await (pasteBtn(tree).props.onClick as () => Promise<void>)();
    const prepared = pasteTables.mock.calls[0][0] as { cols: { udpValues?: Record<string, string> }[] }[];
    expect(prepared.every((p) => !p.cols[0].udpValues || !Object.keys(p.cols[0].udpValues).length)).toBe(true);
  });
});
