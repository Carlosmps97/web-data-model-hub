/**
 * Authentication & authorization types.
 *
 * Shape of user records, roles, and permission grants as they live
 * both in Cosmos DB (`users` collection) and in the in-memory session
 * shape exposed to the frontend (`AuthUser`, which never includes the
 * password hash).
 */

export type UserRole = 'admin' | 'editor' | 'viewer';

/**
 * A single permission grant. `admin` users do not use this list — they
 * have implicit access to everything. `editor` / `viewer` users must
 * have at least one matching grant to access a project or model.
 *
 *   - `project` scope: access to the project AND every model inside it.
 *   - `model`   scope: access to a single model (plus implicit read of
 *                      its parent project's metadata).
 *
 * The `level` determines what the user can do within that scope:
 *   - `view`  → read-only
 *   - `edit`  → full read + write
 *
 * A user's effective level for a resource is the MAX across all
 * matching grants. E.g. a grant of `view` at project-level plus `edit`
 * at model-level gives `edit` for that model but `view` for its
 * siblings.
 */
export type PermissionLevel = 'view' | 'edit';

export type Permission =
  | {
      scope: 'project';
      projectId: string;
      level: PermissionLevel;
    }
  | {
      scope: 'model';
      /** The parent project — needed so the UI can surface the project. */
      projectId: string;
      modelId: string;
      level: PermissionLevel;
    };

/**
 * User record as stored in Cosmos DB's `users` collection.
 * Includes the password hash, so it must NEVER leak to the frontend.
 */
export interface UserRecord {
  id: string;
  username: string;
  /** bcrypt hash of the plaintext password. Never exposed to clients. */
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  permissions: Permission[];
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. Updated whenever `isActive` changes. */
  statusUpdatedAt: string;
  /** ISO 8601. Updated whenever the user successfully signs in. */
  lastLoginAt?: string;
}

/**
 * Sanitized view of a user, safe to send to the frontend. This is the
 * shape stored in `useAuthStore` and returned by `/api/auth/me`.
 */
export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  permissions: Permission[];
  createdAt: string;
  statusUpdatedAt: string;
  lastLoginAt?: string;
}

/** Shape of the JWT payload we sign at login. */
export interface AuthJwtClaims {
  /** Subject — the user id. */
  sub: string;
  username: string;
  role: UserRole;
  /** Issued-at / expiration epochs (seconds). Populated by `jose`. */
  iat?: number;
  exp?: number;
}
