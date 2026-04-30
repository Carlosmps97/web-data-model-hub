/**
 * Creates the default admin account on first startup when missing.
 * Idempotent: re-running it after admin exists is a no-op.
 *
 * The admin credentials are hardcoded per requirements
 *   username: admin
 *   password: dogadmin2019
 *
 * This function is fire-and-forget, invoked from route handlers and
 * the admin-users endpoint so we don't need a separate bootstrap
 * script. It gates on a module-level flag to avoid hammering the DB.
 */

import { v4 as uuidv4 } from 'uuid';
import type { UserRecord } from '@/types/auth';
import { createUser, getUserByUsername } from '@/server/db/users';
import { hashPassword } from './password';

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'dogadmin2019';

let bootstrapped = false;
let inflight: Promise<void> | null = null;

export async function ensureBootstrapAdmin(): Promise<void> {
  if (bootstrapped) return;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const existing = await getUserByUsername(DEFAULT_ADMIN_USERNAME);
      if (existing) {
        bootstrapped = true;
        return;
      }
      const now = new Date().toISOString();
      const admin: UserRecord = {
        id: uuidv4(),
        username: DEFAULT_ADMIN_USERNAME,
        passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
        role: 'admin',
        isActive: true,
        permissions: [],
        createdAt: now,
        statusUpdatedAt: now,
      };
      await createUser(admin);
      bootstrapped = true;
      console.info('[auth] bootstrapped default admin user');
    } catch (err) {
      console.error('[auth] failed to bootstrap default admin:', err);
      // Leave bootstrapped=false so a later request can retry.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
