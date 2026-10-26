import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Database, LogIn } from 'lucide-react';
import { ApiError } from '@/services/http';
import { ensureBackendSession } from '@/services/warmup';
import { useAuthStore } from '@/store/useAuthStore';
import { Splash } from './guards';

/**
 * LoginScreen: "Continue with Databricks" inicia la sesión por token con la
 * identidad del SSO de la plataforma (el correo debe estar asignado a un rol
 * en Admin — whitelist). Al autenticar, redirige al destino que motivó el
 * login (o a Home).
 */
export default function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const doLoginSso = useAuthStore((s) => s.loginSso);
  // Por qué terminó la sesión anterior sin que el usuario saliera.
  const notice = useAuthStore((s) => s.notice);
  const status = useAuthStore((s) => s.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Databricks Apps: si el navegador no tiene sesión SSO con el dominio
  // del backend, ningún fetch pasa el proxy. El probe lo detecta y hace una
  // navegación de ida y vuelta por /api/auth/warmup. Con un solo
  // origen (server.mjs) es no-op; se conserva para setups locales cross-origin.
  useEffect(() => { void ensureBackendSession(); }, []);

  const goHome = () => navigate(location.state?.from ?? '/', { replace: true });

  // Con la red o el servidor caídos el token se conserva y el aviso pide
  // recargar; al recargar aquí la sesión se restaura y se sigue al destino en vez
  // de pedir entrar otra vez. Mientras se verifica, se muestra el splash.
  if (status === 'authed') return <Navigate to={location.state?.from ?? '/'} replace />;
  if (status === 'loading') return <Splash />;

  const ssoSignIn = async () => {
    setBusy(true); setError(null);
    try {
      await doLoginSso();
      goHome();
    } catch (err) {
      // El 403 trae el mensaje accionable del backend ("ask an administrator…").
      setError(err instanceof ApiError ? err.message : "Couldn't sign in with Databricks.");
      setBusy(false);
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
        {notice && <div className="dmh-login-notice" role="status" id="dmh-login-notice">{notice}</div>}

        <button type="button" className="dmh-login-btn" onClick={ssoSignIn}
          disabled={busy} autoFocus aria-describedby={notice ? 'dmh-login-notice' : undefined}>
          {busy ? <span className="rd-spin" aria-hidden /> : <LogIn size={15} aria-hidden />}
          {busy ? 'Signing in…' : 'Continue with Databricks'}
        </button>
        <p className="dmh-login-hint">
          Uses your Databricks account. Access requires an administrator to
          assign your email to a role.
        </p>
        {error && <div className="dmh-login-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}
