'use client';

/**
 * /login — standalone screen outside AppLayout.
 *
 * `?next=<encoded-path>` (set by the proxy on redirect) tells us where to send
 * the user after login. Only same-origin relative paths are honoured.
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import type { ApiError } from '@/services';

function sanitizeNext(next: string | null): string {
  if (!next) return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

const shellStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24, background: 'linear-gradient(180deg, var(--primary-soft), var(--bg))',
};

export default function LoginScreen() {
  return (
    <Suspense fallback={<div style={shellStyle} />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) router.replace(sanitizeNext(search.get('next'))); }, [user, router, search]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      router.replace(sanitizeNext(search.get('next')));
    } catch (err) {
      setError((err as ApiError)?.message ?? 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }, [username, password, login, router, search]);

  return (
    <div style={shellStyle}>
      <div className="rd-card" style={{ width: 400, maxWidth: '100%', padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <span style={{ width: 48, height: 48, borderRadius: 'var(--r)', background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            <img src="/logo-dog.png" alt="Data Model Hub" width={40} height={40} style={{ objectFit: 'contain' }} />
          </span>
          <div>
            <h1 className="rd-h2" style={{ marginBottom: 2 }}>Data Model Hub</h1>
            <p className="rd-small">Ingresa tus credenciales para continuar.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="on">
          <div style={{ marginBottom: 14 }}>
            <label className="rd-label" htmlFor="login-username">Usuario</label>
            <input id="login-username" className="rd-input" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required disabled={busy} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label className="rd-label" htmlFor="login-password">Contraseña</label>
            <input id="login-password" className="rd-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} />
          </div>

          {error && <div className="rd-small" style={{ color: 'var(--error)', marginBottom: 12 }}>{error}</div>}

          <button type="submit" className="rd-btn rd-btn-primary rd-btn-lg" style={{ width: '100%' }} disabled={busy || !username || !password}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
