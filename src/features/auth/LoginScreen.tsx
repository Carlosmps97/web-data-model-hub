import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Database, LogIn, ShieldCheck } from 'lucide-react';
import { ApiError } from '@/services/http';
import { ensureBackendSession } from '@/services/warmup';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * LoginScreen (doc 38) — dos caminos hacia la misma sesión por token:
 *  1. "Continue with Databricks": un click; hereda la identidad del SSO de la
 *     plataforma (el correo debe estar asignado a un rol en Admin — whitelist).
 *  2. "Administrator": cuenta local `admin` con contraseña.
 * Al autenticar, redirige al destino que motivó el login (o a Home).
 */
export default function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const doLogin = useAuthStore((s) => s.login);
  const doLoginSso = useAuthStore((s) => s.loginSso);
  const [adminMode, setAdminMode] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'sso' | 'admin'>(null);
  const [error, setError] = useState<string | null>(null);

  // Databricks Apps: si el navegador aún no tiene sesión SSO con el DOMINIO
  // del backend, ningún fetch pasa el proxy. El probe lo detecta y hace una
  // navegación de ida y vuelta por /api/auth/warmup (doc 36). Con un solo
  // origen (server.mjs) es no-op; se conserva para setups locales cross-origin.
  useEffect(() => { void ensureBackendSession(); }, []);

  const goHome = () => navigate(location.state?.from ?? '/', { replace: true });

  const ssoSignIn = async () => {
    setBusy('sso'); setError(null);
    try {
      await doLoginSso();
      goHome();
    } catch (err) {
      // El 403 trae el mensaje accionable del backend ("ask an administrator…").
      setError(err instanceof ApiError ? err.message : "Couldn't sign in with Databricks.");
      setBusy(null);
    }
  };

  const adminSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy('admin'); setError(null);
    try {
      await doLogin('admin', password);
      goHome();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in.");
      setBusy(null);
    }
  };

  return (
    <div className="dmh-login">
      <div className="dmh-login-card">
        <div className="dmh-login-head">
          <span className="dmh-login-logo"><Database size={24} strokeWidth={1.6} aria-hidden /></span>
          <h1 className="dmh-login-title">Sign in</h1>
          <p className="dmh-login-sub">Data Model Hub</p>
        </div>

        {!adminMode ? (
          <>
            <button type="button" className="dmh-login-btn" onClick={ssoSignIn}
              disabled={busy !== null} autoFocus>
              {busy === 'sso' ? <span className="rd-spin" aria-hidden /> : <LogIn size={15} aria-hidden />}
              {busy === 'sso' ? 'Signing in…' : 'Continue with Databricks'}
            </button>
            <p className="dmh-login-hint">
              Uses your Databricks account. Access requires an administrator to
              assign your email to a role.
            </p>
            {error && <div className="dmh-login-error" role="alert">{error}</div>}
            <div className="dmh-login-divider"><span>or</span></div>
            <button type="button" className="dmh-login-btn dmh-login-btn--ghost"
              onClick={() => { setAdminMode(true); setError(null); }} disabled={busy !== null}>
              <ShieldCheck size={15} aria-hidden />
              Administrator
            </button>
          </>
        ) : (
          <form className="dmh-login-form" onSubmit={adminSignIn}>
            <label className="dmh-login-lbl" htmlFor="login-pass">Administrator password</label>
            <input id="login-pass" type="password" className="dmh-login-input"
              autoComplete="current-password" autoFocus value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            {error && <div className="dmh-login-error" role="alert">{error}</div>}
            <button type="submit" className="dmh-login-btn" disabled={busy !== null || !password}>
              {busy === 'admin' ? <span className="rd-spin" aria-hidden /> : <LogIn size={15} aria-hidden />}
              {busy === 'admin' ? 'Signing in…' : 'Sign in as administrator'}
            </button>
            <button type="button" className="dmh-login-back"
              onClick={() => { setAdminMode(false); setError(null); setPassword(''); }}>
              <ArrowLeft size={13} aria-hidden /> Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
