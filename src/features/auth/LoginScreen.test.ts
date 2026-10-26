// LoginScreen sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil).
// Se entra con «Continue with Databricks»; cuando la sesión termina sola (usuario
// deshabilitado, sesión vencida), el login dice por qué.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, nextStates, resetFake, runEffects, textOf, walk } from '../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const route = { state: undefined as { from?: string } | undefined };
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate, useLocation: () => ({ state: route.state }),
  Navigate: function Navigate() { return null; },
}));
vi.mock('@/services/warmup', () => ({ ensureBackendSession: vi.fn(async () => {}) }));
const auth = { status: 'anon' as 'loading' | 'anon' | 'authed', notice: null as string | null, loginSso: vi.fn() };
vi.mock('@/store/useAuthStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel(auth) }));
import { Navigate } from 'react-router-dom';
import { ApiError } from '@/services/http';
import { Splash } from './guards';
import LoginScreen from './LoginScreen';

function render(override: ((init: unknown, i: number) => unknown) | null = null) {
  resetFake(override);
  const tree = LoginScreen();
  runEffects();
  return tree;
}
const buttons = (tree: unknown) => [...walk(tree)].filter((e) => e.type === 'button');
const click = (tree: unknown) => (buttons(tree)[0].props.onClick as () => Promise<void>)();

beforeEach(() => {
  auth.notice = null; auth.status = 'anon'; route.state = undefined;
  navigate.mockReset(); auth.loginSso.mockReset();
});

describe('LoginScreen: entrar con Databricks', () => {
  it('un solo botón, «Continue with Databricks», con el foco y sin campos', () => {
    const tree = render();
    expect(buttons(tree)).toHaveLength(1);
    expect(textOf(buttons(tree)[0])).toContain('Continue with Databricks');
    expect(buttons(tree)[0].props.autoFocus).toBe(true);
    expect([...walk(tree)].some((e) => e.type === 'input' || e.type === 'form')).toBe(false);
  });

  it('entra y va al destino que motivó el login', async () => {
    route.state = { from: '/model' };
    auth.loginSso.mockResolvedValue(undefined);
    await click(render());
    expect(fake.states[0].calls).toEqual([true]);           // ocupado mientras entra
    expect(navigate).toHaveBeenCalledWith('/model', { replace: true });
  });

  it('un 403 del backend muestra su mensaje y libera el botón', async () => {
    auth.loginSso.mockRejectedValue(new ApiError('This account has no access. Ask an administrator to assign your email to a role.', 403));
    await click(render());
    const [busy, error] = nextStates();
    expect(busy).toBe(false);
    expect(error).toBe('This account has no access. Ask an administrator to assign your email to a role.');
    expect(navigate).not.toHaveBeenCalled();
    const again = render((init, i) => (i === 0 ? false : i === 1 ? error : init));
    const alert = [...walk(again)].find((e) => e.props.role === 'alert');
    expect(alert && textOf(alert)).toBe(error);
    expect(buttons(again)[0].props.disabled).toBe(false);
  });

  it('una falla que no es del backend: mensaje genérico', async () => {
    auth.loginSso.mockRejectedValue(new TypeError('Failed to fetch'));
    await click(render());
    expect(nextStates()[1]).toBe("Couldn't sign in with Databricks.");
  });
});

describe('LoginScreen: por qué terminó la sesión', () => {
  it('muestra el aviso de la sesión que terminó sola, como estado (no como error)', () => {
    auth.notice = 'Your session ended. Please sign in again.';
    const tree = render();
    const box = [...walk(tree)].find((e) => e.props.role === 'status');
    expect(box && textOf(box)).toBe('Your session ended. Please sign in again.');
    // el botón con autoFocus lo anuncia (un role=status montado de entrada puede no leerse)
    const sso = [...walk(tree)].find((e) => e.type === 'button' && e.props.autoFocus);
    expect(box?.props.id).toBeTruthy();
    expect(sso?.props['aria-describedby']).toBe(box?.props.id);
  });

  it('sin aviso no muestra nada', () => {
    const tree = render();
    expect([...walk(tree)].some((e) => e.props.role === 'status')).toBe(false);
    expect(textOf(tree)).not.toContain('session ended');
  });
});

// Con la red o el servidor caídos al abrir la app, el token se conserva y el login
// dice «reload the page»; al recargar en /login con la sesión ya restaurada (status
// authed), la pantalla sigue al destino en vez de quedarse en «Sign in».
describe('LoginScreen con la sesión ya restaurada', () => {
  it('sesión válida → va al destino que motivó el login (o a Home), sin la pantalla de ingreso', () => {
    auth.status = 'authed';
    route.state = { from: '/model' };
    const tree = render() as unknown as { type: unknown; props: Record<string, unknown> };
    expect(tree.type).toBe(Navigate);
    expect(tree.props).toMatchObject({ to: '/model', replace: true });
    route.state = undefined;
    const home = render() as unknown as { type: unknown; props: Record<string, unknown> };
    expect(home.props).toMatchObject({ to: '/', replace: true });
  });

  it('mientras se verifica la sesión guardada: splash, no la pantalla de ingreso', () => {
    auth.status = 'loading';
    const tree = render() as unknown as { type: unknown };
    expect(textOf(tree)).not.toContain('Sign in');
    expect(tree.type).toBe(Splash);
  });
});
