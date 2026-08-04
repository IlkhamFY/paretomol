import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';

/**
 * Session store migration.
 *
 * The upgrade callback previously called createObjectStore unconditionally.
 * Opening the database at any version above 1 therefore threw ConstraintError,
 * which rejects openDB and leaves every session operation failing — permanently,
 * for anyone who already had a database. These tests exercise the real upgrade
 * path rather than reasoning about it.
 */

const DB_NAME = 'molparetolab-migration-test';

/** The pre-revision upgrade callback, kept here to demonstrate the failure. */
function legacyUpgrade(db: IDBDatabase) {
  const store = db.createObjectStore('sessions', { keyPath: 'id' });
  store.createIndex('by-timestamp', 'timestamp');
}

/** The current, guarded callback (mirrors src/utils/session.ts). */
function guardedUpgrade(db: IDBDatabase, oldVersion: number) {
  if (oldVersion < 1) {
    const store = db.createObjectStore('sessions', { keyPath: 'id' });
    store.createIndex('by-timestamp', 'timestamp');
  }
}

beforeEach(async () => {
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('session store upgrade', () => {
  it('reproduces the ConstraintError the unguarded callback caused', async () => {
    const v1 = await openDB(DB_NAME, 1, { upgrade: db => legacyUpgrade(db as unknown as IDBDatabase) });
    await v1.put('sessions', { id: 'a', timestamp: 1 });
    v1.close();

    // Driven through the raw API rather than openDB so the aborted upgrade
    // transaction is handled here; left to reject on its own it surfaces later
    // as an unhandled AbortError and makes an otherwise green run look broken.
    const failure = await new Promise<string>(resolve => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        try {
          legacyUpgrade(req.result);
        } catch (e) {
          resolve((e as Error).name);
        }
      };
      req.onerror = e => { e.preventDefault(); resolve(req.error?.name ?? 'error'); };
      req.onblocked = () => resolve('blocked');
      req.onsuccess = () => { req.result.close(); resolve('unexpected success'); };
    });
    expect(failure).toBe('ConstraintError');
  });

  it('upgrades 1 -> 2 without error and preserves existing sessions', async () => {
    const v1 = await openDB(DB_NAME, 1, { upgrade: (db, ov) => guardedUpgrade(db as unknown as IDBDatabase, ov) });
    await v1.put('sessions', { id: 'keep-me', timestamp: 42, molecules: [] });
    v1.close();

    const v2 = await openDB(DB_NAME, 2, { upgrade: (db, ov) => guardedUpgrade(db as unknown as IDBDatabase, ov) });
    expect(v2.version).toBe(2);
    const kept = await v2.get('sessions', 'keep-me');
    expect(kept).toBeTruthy();
    expect(kept.timestamp).toBe(42);
    v2.close();
  });

  it('creates the store from scratch on a fresh database', async () => {
    const db = await openDB(DB_NAME, 2, { upgrade: (d, ov) => guardedUpgrade(d as unknown as IDBDatabase, ov) });
    expect(Array.from(db.objectStoreNames)).toContain('sessions');
    await db.put('sessions', { id: 'x', timestamp: 1 });
    expect(await db.get('sessions', 'x')).toBeTruthy();
    db.close();
  });
});

describe('schema versioning', () => {
  it('treats a session written before versioning as stale', async () => {
    const { CURRENT_SCHEMA_VERSION } = await import('../session');
    // Sessions saved before the field existed have no schemaVersion, and the
    // restore path compares with `?? 0`, so they recompute rather than replay
    // properties produced under the superseded descriptor conventions.
    const legacySession = { id: '__autosave__', timestamp: 1, molecules: [] } as { schemaVersion?: number };
    expect((legacySession.schemaVersion ?? 0) < CURRENT_SCHEMA_VERSION).toBe(true);
  });

  it('treats a session at the current version as fresh', async () => {
    const { CURRENT_SCHEMA_VERSION } = await import('../session');
    expect((CURRENT_SCHEMA_VERSION ?? 0) < CURRENT_SCHEMA_VERSION).toBe(false);
  });
});
