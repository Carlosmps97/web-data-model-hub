# auth

Pantalla de login. El estado de sesión vive en @/store/useAuthStore; el HTTP en @/services/auth.service.

**API pública:** importa desde `@/features/auth` (el barrel `index.ts`) — nunca alcances los internals (el guard de ESLint lo vigila). Ver `doc/feature-architecture.md`.
