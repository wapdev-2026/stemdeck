import { Stem, StemCategory } from '../types/stem';
import { encodeAudioBufferToWav } from './audioUtils';

const DB_NAME = 'StemDeckDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

export interface SavedSession {
  id: string;
  title: string;
  createdAt: number;
  stems: Array<{
    name: string;
    rawName: string;
    fileName: string;
    arrayBuffer: ArrayBuffer;
    color: string;
    category?: StemCategory;
    characterNote?: string;
  }>;
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

export async function saveSessionToDb(title: string, stems: Stem[]): Promise<string> {
  const db = await openDatabase();
  const id = `session-${Date.now()}`;
  
  const serializedStems = await Promise.all(
    stems.map(async (stem) => {
      const arrayBuffer = encodeAudioBufferToWav(stem.buffer);
      return {
        name: stem.name,
        rawName: stem.rawName,
        fileName: stem.fileName,
        arrayBuffer,
        color: stem.color,
        category: stem.category,
        characterNote: stem.characterNote,
      };
    })
  );

  const session: SavedSession = {
    id,
    title: title || 'Saved Session',
    createdAt: Date.now(),
    stems: serializedStems,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(session);

    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error || new Error('Failed to save session to IndexedDB'));
  });
}

export async function getSavedSessions(): Promise<SavedSession[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result as SavedSession[]) || [];
        // Sort descending by creation date
        results.sort((a, b) => b.createdAt - a.createdAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error || new Error('Failed to retrieve sessions'));
    });
  } catch {
    return [];
  }
}

export async function deleteSavedSession(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to delete session'));
  });
}
