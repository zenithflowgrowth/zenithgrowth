/**
 * Zenith Growth — Universal Client-Side File Handoff Protocol
 * Secure, in-memory/IndexedDB zero-upload file transfer between homepage dropzone and specialized tools.
 */
window.ZenithHandoff = {
  DB_NAME: 'ZenithHandoffDB',
  STORE_NAME: 'handoff_files',

  openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async setPendingFile(file, targetToolUrl) {
    if (!file) {
      if (targetToolUrl) window.location.href = targetToolUrl;
      return;
    }
    try {
      const db = await this.openDB();
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const record = {
        id: 'pending_file',
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        lastModified: file.lastModified || Date.now(),
        data: file,
        timestamp: Date.now()
      };
      store.put(record);
      await new Promise((resolve) => {
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (err) {
      console.warn('ZenithHandoff store warning:', err);
    }
    if (targetToolUrl) {
      window.location.href = targetToolUrl;
    }
  },

  async consumePendingFile() {
    try {
      const db = await this.openDB();
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get('pending_file');
      const record = await new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (record && record.data) {
        // Accept within 3 minutes of upload
        if (Date.now() - record.timestamp < 180000) {
          try { store.delete('pending_file'); } catch(e){}
          if (record.data instanceof File) {
            return record.data;
          } else if (record.data instanceof Blob) {
            return new File([record.data], record.name, {
              type: record.type,
              lastModified: record.lastModified
            });
          }
        }
      }
    } catch (err) {
      console.warn('ZenithHandoff consume warning:', err);
    }
    return null;
  }
};
