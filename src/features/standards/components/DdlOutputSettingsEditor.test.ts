// Output settings sin DOM (hooks de mentira: ver
// reporting/components/fakeReact.testutil). Doc 105: «Save changes» se
// habilitaba SIN cambios y registraba una versión vacía.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import { DdlOutputForm, type DdlOutputSettings } from '@/features/ddl';
import { byText, nextStates, resetFake, runEffects, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../ddlRules.service', () => ({ saveDdlOutput: vi.fn(async () => ({ label: 'v9' })) }));
import { toast } from 'sonner';
import { saveDdlOutput } from '../ddlRules.service';
import DdlOutputSettingsEditor from './DdlOutputSettingsEditor';

const STORED = { identifierCase: 'lower', external: true, location: 's3://lake/{schema}', fileNames: { nameCase: 'upper' } };

let props: Parameters<typeof DdlOutputSettingsEditor>[0];
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = DdlOutputSettingsEditor(props);
  runEffects();
  return tree;
}
function open(output: Record<string, unknown> | undefined = STORED) {
  props = { projectId: 'p1', config: { lookups: {}, functions: [], output }, canEdit: true, onClose: vi.fn(), onApplied: vi.fn(async () => {}) };
  resetFake();
  const tree = DdlOutputSettingsEditor(props);
  runEffects();
  return tree;
}
const saveBtn = (tree: unknown) => byText(tree, 'button', 'Save changes');
const form = (tree: unknown) => [...walk(tree)].find((e) => e.type === DdlOutputForm)!;

beforeEach(() => { vi.clearAllMocks(); });

describe('Output settings: «Save changes» sólo con un cambio real (doc 105)', () => {
  it('sin cambios queda deshabilitado, con «No changes to apply» (también sin nada guardado: rigen los defaults)', () => {
    for (const tree of [open(), open(undefined)]) {
      expect(saveBtn(tree).props.disabled).toBe(true);
      expect(saveBtn(tree).props.title).toBe('No changes to apply');
    }
  });

  it('con un cambio se habilita; si el backend igual responde «sin cambios», el aviso es neutro', async () => {
    let tree = open();
    const value = form(tree).props.value as DdlOutputSettings;
    (form(tree).props.onChange as (v: DdlOutputSettings) => void)({ ...value, identifierCase: 'upper' });
    tree = rerender();
    expect(saveBtn(tree).props.disabled).toBe(false);

    vi.mocked(saveDdlOutput).mockRejectedValueOnce(new ApiError('There are no changes to apply.', 422));
    await (saveBtn(tree).props.onClick as () => Promise<void>)();
    expect(toast.info).toHaveBeenCalledWith('There are no changes to apply.');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
