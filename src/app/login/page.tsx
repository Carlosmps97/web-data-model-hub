'use client';

/**
 * /login — standalone page outside AppLayout.
 *
 * The `?next=<encoded-path>` query param (set by the middleware when
 * it redirects an unauthenticated request) tells us where to send the
 * user after a successful login. We only honour same-origin relative
 * paths; anything else falls back to `/`.
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import type { ApiError } from '@/services';

function sanitizeNext(next: string | null): string {
  if (!next) return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

// Next.js 16 requires `useSearchParams()` to be wrapped in a Suspense
// boundary so the login page can be statically pre-rendered. Fallback
// renders an empty shell while the search params hydrate on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-shell" />}>
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

  // If the user is already authenticated (navigated here manually),
  // send them to their destination immediately.
  useEffect(() => {
    if (user) router.replace(sanitizeNext(search.get('next')));
  }, [user, router, search]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        await login(username, password);
        router.replace(sanitizeNext(search.get('next')));
      } catch (err) {
        const apiErr = err as ApiError;
        setError(apiErr?.message ?? 'No se pudo iniciar sesión.');
      } finally {
        setBusy(false);
      }
    },
    [username, password, login, router, search],
  );

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <Image
            src="/logo-dog.png"
            alt="Modeler"
            width={56}
            height={56}
            priority
            style={{ borderRadius: 12 }}
          />
          <div>
            <h1 className="login-title">Data Model Hub</h1>
            <p className="login-subtitle">
              Ingresa tus credenciales para continuar.
            </p>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit} autoComplete="on">
          <label className="login-label" htmlFor="login-username">
            Usuario
          </label>
          <input
            id="login-username"
            className="input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            disabled={busy}
          />

          <label className="login-label" htmlFor="login-password">
            Contraseña
          </label>
          <input
            id="login-password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={busy}
          />

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={busy || !username || !password}
          >
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
