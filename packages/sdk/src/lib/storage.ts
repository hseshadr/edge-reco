import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "edgereco";
const STORE_NAME = "profile";
const SINGLETON_KEY = "singleton";
const DB_VERSION = 1;

export interface PersistedProfile {
  categoryAffinity: Record<string, number>;
  tagAffinity: Record<string, number>;
  recentlyViewed: string[];
  sessionClickCount: number;
}

export interface ProfileStorage {
  load(): Promise<PersistedProfile | null>;
  save(profile: PersistedProfile): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

async function openProfileDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

export async function createProfileStorage(): Promise<ProfileStorage> {
  const db = await openProfileDb();
  return {
    async load(): Promise<PersistedProfile | null> {
      const value = (await db.get(STORE_NAME, SINGLETON_KEY)) as
        | PersistedProfile
        | undefined;
      return value ?? null;
    },
    async save(profile: PersistedProfile): Promise<void> {
      await db.put(STORE_NAME, profile, SINGLETON_KEY);
    },
    async clear(): Promise<void> {
      await db.delete(STORE_NAME, SINGLETON_KEY);
    },
    close(): void {
      db.close();
    },
  };
}
