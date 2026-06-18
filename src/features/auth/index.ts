// Public API of the `auth` feature (login screen).
// Import from `@/features/auth`; never reach into its subdirectories.
// Session state/permissions live in the cross-cutting `@/store/useAuthStore`;
// HTTP in `@/services/auth.service`; JWT verification in `@/server/auth/jwt`.
export { default as LoginScreen } from './components/LoginScreen';
