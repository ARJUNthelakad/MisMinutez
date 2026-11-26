import type { OfflineAudioChunk, OfflineMeetingMeta } from '../types';

const DB_NAME = 'misminutez_offline_store';
const DB_VERSION = 1;
const STORE_CHUNKS = 'audio_chunks';
const STORE_MEETINGS = 'offline_meetings';

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'chunkId' });
        chunkStore.createIndex('by_meeting', 'meetingId', { unique: false });
        chunkStore.createIndex('by_status', 'uploadStatus', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MEETINGS)) {
        db.createObjectStore(STORE_MEETINGS, { keyPath: 'meetingId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open local IndexedDB storage'));
  });
}

export async function saveOfflineMeetingMeta(meta: OfflineMeetingMeta): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEETINGS, 'readwrite');
    tx.objectStore(STORE_MEETINGS).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineMeetingMeta(meetingId: string): Promise<OfflineMeetingMeta | null> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEETINGS, 'readonly');
    const req = tx.objectStore(STORE_MEETINGS).get(meetingId);
    req.onsuccess = () => resolve((req.result as OfflineMeetingMeta) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listOfflineMeetings(userId: string): Promise<OfflineMeetingMeta[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEETINGS, 'readonly');
    const req = tx.objectStore(STORE_MEETINGS).getAll();
    req.onsuccess = () => {
      const all = (req.result as OfflineMeetingMeta[]) || [];
      resolve(all.filter((m) => m.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOfflineMeetingMeta(meetingId: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEETINGS, 'readwrite');
    tx.objectStore(STORE_MEETINGS).delete(meetingId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAudioChunk(chunk: OfflineAudioChunk): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    tx.objectStore(STORE_CHUNKS).put(chunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateAudioChunkStatus(
  chunkId: string,
  status: OfflineAudioChunk['uploadStatus'],
  extra?: { retryCount?: number; lastError?: string }
): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);
    const getReq = store.get(chunkId);
    getReq.onsuccess = () => {
      const existing = getReq.result as OfflineAudioChunk | undefined;
      if (!existing) {
        resolve();
        return;
      }
      store.put({
        ...existing,
        uploadStatus: status,
        retryCount: extra?.retryCount ?? existing.retryCount,
        lastError: extra?.lastError,
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChunksForMeeting(meetingId: string): Promise<OfflineAudioChunk[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readonly');
    const idx = tx.objectStore(STORE_CHUNKS).index('by_meeting');
    const req = idx.getAll(meetingId);
    req.onsuccess = () => {
      const items = (req.result as OfflineAudioChunk[]) || [];
      resolve(items.sort((a, b) => a.chunkIndex - b.chunkIndex));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllPendingChunks(userId: string): Promise<OfflineAudioChunk[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readonly');
    const req = tx.objectStore(STORE_CHUNKS).getAll();
    req.onsuccess = () => {
      const all = (req.result as OfflineAudioChunk[]) || [];
      resolve(
        all
          .filter((c) => c.userId === userId && c.uploadStatus !== 'processed')
          .sort((a, b) => a.createdAt - b.createdAt)
      );
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllLocalChunks(userId: string): Promise<OfflineAudioChunk[]> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readonly');
    const req = tx.objectStore(STORE_CHUNKS).getAll();
    req.onsuccess = () => {
      const all = (req.result as OfflineAudioChunk[]) || [];
      resolve(all.filter((c) => c.userId === userId).sort((a, b) => b.createdAt - a.createdAt));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAudioChunk(chunkId: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    tx.objectStore(STORE_CHUNKS).delete(chunkId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteChunksForMeeting(meetingId: string): Promise<void> {
  const chunks = await getChunksForMeeting(meetingId);
  if (chunks.length === 0) return;
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);
    chunks.forEach((c) => store.delete(c.chunkId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllLocalRecordings(userId: string): Promise<number> {
  const chunks = await getAllLocalChunks(userId);
  const meetings = await listOfflineMeetings(userId);
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_MEETINGS], 'readwrite');
    const cStore = tx.objectStore(STORE_CHUNKS);
    const mStore = tx.objectStore(STORE_MEETINGS);
    chunks.forEach((c) => cStore.delete(c.chunkId));
    meetings.forEach((m) => mStore.delete(m.meetingId));
    tx.oncomplete = () => resolve(chunks.length);
    tx.onerror = () => reject(tx.error);
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to encode audio blob'));
    reader.readAsDataURL(blob);
  });
}
