import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Database, LogIn } from 'lucide-react';
import { ApiError } from '@/services/http';
import { ensureBackendSession } from '@/services/warmup';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * LoginScreen (pantalla 13) — acceso usuario/contraseña de la auth propia.
 * Al autenticar, redirige al destino que motivó el login (o a Home).
 */
export default function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const doLogin = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Databricks Apps: si el navegador aún no tiene sesión SSO con el DOMINIO
  // del backend, ningún fetch pasa el proxy. El probe lo detecta y hace una
  // navegación de ida y vuelta por /api/auth/warmup (doc 36). En dev es no-op.
  useEffect(() => { void ensureBackendSession(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true); setError(null);
    try {
      await doLogin(username, password);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dmh-login">
      <form className="dmh-login-card" onSubmit={submit}>
        <div className="dmh-login-head">
          <span className="dmh-login-logo"><Database size={24} strokeWidth={1.6} aria-hidden /></span>
          <h1 className="dmh-login-title">Sign in</h1>
          <p className="dmh-login-sub">Data Model Hub</p>
        </div>

        <label className="dmh-login-lbl" htmlFor="login-user">Username</label>
        <input id="login-user" className="dmh-login-input" autoFocus autoComplete="username"
          value={username} onChange={(e) => setUsername(e.target.value)} placeholder="T#####" />

        <label className="dmh-login-lbl" htmlFor="login-pass">Password</label>
        <input id="login-pass" type="password" className="dmh-login-input" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

        {error && <div className="dmh-login-error" role="alert">{error}</div>}

        <button type="submit" className="dmh-login-btn" disabled={busy || !username.trim() || !password}>
          {busy ? <span className="rd-spin" aria-hidden /> : <LogIn size={15} aria-hidden />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
