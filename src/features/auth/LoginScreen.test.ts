// LoginScreen sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil).
// Cuando la sesión termina sola (usuario deshabilitado, sesión vencida), el login
// dice por qué.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, runEffects, textOf, walk } from '../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
const route = { state: undefined as { from?: string } | undefined };
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(), useLocation: () => ({ state: route.state }),
  Navigate: function Navigate() { return null; },
}));
vi.mock('@/services/warmup', () => ({ ensureBackendSession: vi.fn(async () => {}) }));
const auth = { status: 'anon' as 'loading' | 'anon' | 'authed', notice: null as string | null, login: vi.fn(), loginSso: vi.fn() };
vi.mock('@/store/useAuthStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel(auth) }));
import { Navigate } from 'react-router-dom';
import { Splash } from './guards';
import LoginScreen from './LoginScreen';

function render() {
  resetFake();
  const tree = LoginScreen();
  runEffects();
  return tree;
}

beforeEach(() => { auth.notice = null; auth.status = 'anon'; route.state = undefined; });

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
  it('sesión válida → va al destino que motivó el login (o a Home), sin el formulario', () => {
    auth.status = 'authed';
    route.state = { from: '/model' };
    const tree = render() as unknown as { type: unknown; props: Record<string, unknown> };
    expect(tree.type).toBe(Navigate);
    expect(tree.props).toMatchObject({ to: '/model', replace: true });
    route.state = undefined;
    const home = render() as unknown as { type: unknown; props: Record<string, unknown> };
    expect(home.props).toMatchObject({ to: '/', replace: true });
  });

  it('mientras se verifica la sesión guardada: splash, no el formulario', () => {
    auth.status = 'loading';
    const tree = render() as unknown as { type: unknown };
    expect(textOf(tree)).not.toContain('Sign in');
    expect(tree.type).toBe(Splash);
  });
});
