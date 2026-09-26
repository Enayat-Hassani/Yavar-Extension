// Tiny IndexedDB key/value store for what chrome.storage can't hold: the
// folder handles for local reading (lastFolder, recentFolders). The panel
// and the reader share it (same extension origin).

let db = null;

function open() {
  db = db || new Promise((resolve, reject) => {
    const req = indexedDB.open('yavar', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

export async function idbGet(key) {
  try {
    const d = await open();
    return await new Promise((resolve) => {
      const req = d.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}

export async function idbSet(key, value) {
  try {
    const d = await open();
    d.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
  } catch (e) { /* not critical */ }
}
