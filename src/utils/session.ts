// Session persistence via IndexedDB using the idb library
import { openDB } from 'idb';
import type { DBSchema } from 'idb';

export interface SessionData {
  id: string;
  name: string;
  timestamp: number;
  molecules: SerializedMolecule[];
  objectives: Array<{ key: string; direction: 'min' | 'max' }>;
  formulaColumns: Array<{ name: string; expr: string }>;
  customPropNames: string[];
  activeTab: string;
  shortlist: number[];
}

// Molecule without non-serializable fields (fpPacked is Uint32Array)
export interface SerializedMolecule {
  name: string;
  smiles: string;
  formula: string;
  fingerprint: string;
  props: Record<string, number>;
  customProps: Record<string, number>;
  filters: Record<string, { pass: boolean; violations: number }>;
  lipinski?: { pass: boolean; violations: number };
  paretoRank: number | null;
  dominates: number[];
  dominatedBy: number[];
  series?: string;
}

interface MolParetoLabDB extends DBSchema {
  sessions: {
    key: string;
    value: SessionData;
    indexes: { 'by-timestamp': number };
  };
}

const DB_NAME = 'molparetolab';
const DB_VERSION = 1;

async function getDB() {
  return openDB<MolParetoLabDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('sessions', { keyPath: 'id' });
      store.createIndex('by-timestamp', 'timestamp');
    },
  });
}

const AUTO_SESSION_ID = '__autosave__';

/** Save session data (debounce externally). */
export async function saveSession(data: SessionData): Promise<void> {
  try {
    const db = await getDB();
    await db.put('sessions', data);
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

/** Save auto-session (the implicit "resume" session). */
export async function autoSave(data: Omit<SessionData, 'id' | 'name'>): Promise<void> {
  return saveSession({ ...data, id: AUTO_SESSION_ID, name: 'Auto-save' });
}

/** Load the auto-saved session if it exists. */
export async function loadAutoSession(): Promise<SessionData | null> {
  try {
    const db = await getDB();
    const session = await db.get('sessions', AUTO_SESSION_ID);
    return session ?? null;
  } catch {
    return null;
  }
}

/** Clear the auto-saved session. */
export async function clearAutoSession(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('sessions', AUTO_SESSION_ID);
  } catch {
    // ignore
  }
}

/** Save a named session. */
export async function saveNamedSession(name: string, data: Omit<SessionData, 'id' | 'name'>): Promise<string> {
  const id = `session_${Date.now()}`;
  await saveSession({ ...data, id, name });
  return id;
}

/** List all named sessions (excludes autosave). */
export async function listSessions(): Promise<SessionData[]> {
  try {
    const db = await getDB();
    const all = await db.getAll('sessions');
    return all.filter(s => s.id !== AUTO_SESSION_ID).sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/** Load a specific session by ID. */
export async function loadSession(id: string): Promise<SessionData | null> {
  try {
    const db = await getDB();
    return (await db.get('sessions', id)) ?? null;
  } catch {
    return null;
  }
}

/** Delete a session by ID. */
export async function deleteSession(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('sessions', id);
  } catch {
    // ignore
  }
}

/** Format a timestamp for display. */
export function formatSessionTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
