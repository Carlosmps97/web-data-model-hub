/**
 * Password hashing and verification. Wraps `bcryptjs` so the rest of
 * the codebase doesn't have to care which library or cost we're using.
 *
 * Cost 10 is the community default for bcrypt in 2024+. Raising it to
 * 12+ triples login latency without meaningfully improving resistance
 * to offline attacks against the threat model here (internal
 * enterprise app, not public sign-up).
 */

import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Password cannot be empty.');
  }
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
