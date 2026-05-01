/**
 * `users` collection adapter. Piggybacks on the shared Mongo
 * connection established in `./mongo.ts` via a small internal getter,
 * to avoid opening a second client.
 *
 * Indexes:
 *   - `username` (unique, case-sensitive for simplicity; usernames are
 *     lowercased at write time by callers).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient, type Db } from 'mongodb';
import type { UserRecord } from '@/types/auth';

let _client: MongoClient | null = null;
let _db: Db | null = null;

async function getDb(): Promise<Db> {
  if (_db) return _db;
  const uri = process.env.COSMOS_CONNECTION_STRING;
  const dbName = process.env.COSMOS_DATABASE ?? 'db_modeler';
  if (!uri) throw new Error('COSMOS_CONNECTION_STRING is not set');
  _client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  await _client.connect();
  _db = _client.db(dbName);
  await ensureIndexes(_db);
  return _db;
}

async function ensureIndexes(db: Db): Promise<void> {
  // Cosmos DB for MongoDB throws NamespaceExists (code 48) if the
  // collection was already created implicitly. The index is still
  // created successfully; we just swallow that specific error.
  try {
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
  } catch (err: any) {
    if (err?.code !== 48 && err?.code !== 11000) throw err;
  }
}

const col = (db: Db) => db.collection('users') as any;

function toRecord(doc: any): UserRecord {
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id) };
}

export async function listUsers(): Promise<UserRecord[]> {
  const db = await getDb();
  // Cosmos DB for MongoDB (RU) rejects .sort() on fields without an explicit
  // index. The users collection is always small, so we sort in JS instead.
  const docs = await col(db).find({}).toArray();
  return docs
    .map(toRecord)
    .sort((a: UserRecord, b: UserRecord) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const db = await getDb();
  const doc = await col(db).findOne({ _id: id });
  return doc ? toRecord(doc) : null;
}

export async function getUserByUsername(username: string): Promise<UserRecord | null> {
  const db = await getDb();
  const doc = await col(db).findOne({ username });
  return doc ? toRecord(doc) : null;
}

export async function createUser(user: UserRecord): Promise<UserRecord> {
  const db = await getDb();
  const { id, ...rest } = user;
  await col(db).insertOne({ _id: id, ...rest });
  return user;
}

export async function updateUser(
  id: string,
  updates: Partial<Omit<UserRecord, 'id'>>,
): Promise<UserRecord | null> {
  const db = await getDb();
  const result = await col(db).findOneAndUpdate(
    { _id: id },
    { $set: updates },
    { returnDocument: 'after' },
  );
  return result ? toRecord(result) : null;
}

/**
 * Hard-delete. Users are managed from the admin UI — we expose this
 * so the admin can revoke an account permanently. The soft-delete /
 * `isActive` flag is what we use for a "temporary lock-out".
 */
export async function deleteUser(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await col(db).deleteOne({ _id: id });
  return result.deletedCount > 0;
}

/** Stamp `lastLoginAt` on successful login. Best-effort; never throws. */
export async function markLoginSuccess(id: string): Promise<void> {
  try {
    const db = await getDb();
    await col(db).updateOne(
      { _id: id },
      { $set: { lastLoginAt: new Date().toISOString() } },
    );
  } catch {
    /* swallow — login itself must not fail because of an audit write */
  }
}
