/* ── File System Access API ── */
let _cachedDirHandle = null;

/**
 * Opens (or creates) the IndexedDB database used to persist the FSA directory handle.
 * @returns {Promise<IDBDatabase>} Resolves with the opened database instance.
 */
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('wl_fs_v1', 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

/**
 * Retrieves the previously granted File System Access directory handle from
 * IndexedDB (with an in-memory cache).
 * @returns {Promise<FileSystemDirectoryHandle|null>} The handle, or null if none saved.
 */
async function getSavedDir() {
  if (_cachedDirHandle) return _cachedDirHandle;
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction('handles', 'readonly');
      const get = tx.objectStore('handles').get('saveDir');
      get.onsuccess = () => {
        _cachedDirHandle = get.result || null;
        res(_cachedDirHandle);
      };
      get.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * Persists a File System Access directory handle to IndexedDB for reuse
 * across sessions, and updates the in-memory cache.
 * @param {FileSystemDirectoryHandle} handle - The directory handle to store.
 * @returns {Promise<void>}
 */
async function storeDirHandle(handle) {
  _cachedDirHandle = handle;
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'saveDir');
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch (e) {
    wlLog.warn('saveDirHandle: failed to persist FSA handle to IndexedDB', e);
    // Future exports will fall back to browser downloads — data is not lost
  }
}

/**
 * Clears the persisted FSA directory handle from both IndexedDB and the
 * in-memory cache so future exports fall back to browser downloads.
 * @returns {Promise<void>}
 */
async function clearDirHandle() {
  _cachedDirHandle = null;
  try {
    const db = await openIDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('saveDir');
  } catch (e) {
    wlLog.warn('clearDirHandle: failed to remove FSA handle from IndexedDB', e);
    // In-memory cache is already cleared — future exports will fall back to browser downloads
  }
}

/**
 * Writes a Blob to `subfolder/filename` inside the user's chosen FSA directory.
 * Creates the subfolder if it does not exist. Falls back to a browser `<a>`
 * download if the FSA handle is missing or permission is not granted.
 * @param {string} subfolder - Name of the subfolder to write into.
 * @param {string} filename  - Name of the file to create or overwrite.
 * @param {Blob}   blob      - File content.
 * @returns {Promise<void>}
 */
async function writeExportFile(subfolder, filename, blob) {
  const dir = await getSavedDir();
  if (dir) {
    try {
      const perm = await dir.queryPermission({ mode: 'readwrite' });
      const granted =
        perm === 'granted'
          ? true
          : (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
      if (granted) {
        const subDir = await dir.getDirectoryHandle(subfolder, { create: true });
        const fh = await subDir.getFileHandle(filename, { create: true });
        const writable = await fh.createWritable();
        await writable.write(blob);
        await writable.close();
        renderFolderStatus();
        return;
      }
    } catch (e) {
      console.warn('[wl] FSA write failed, falling back to download:', e);
    }
  }
  // Fallback: browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Prompts the user to select a save folder via the File System Access API
 * and persists the resulting directory handle. Shows a fallback alert in
 * browsers that do not support the API.
 * @returns {Promise<void>}
 */
async function pickSaveFolder() {
  if (!window.showDirectoryPicker) {
    alert(
      "Your browser doesn't support the File System Access API.\nUse Chrome or Edge for automatic subfolder saving.\nFiles will download normally for now."
    );
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await storeDirHandle(handle);
    renderFolderStatus();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

/**
 * Updates the `#folderStatus` element to show the currently selected save
 * folder name (green) or a "pick save folder" prompt (default colour).
 */
function renderFolderStatus() {
  const el = document.getElementById('folderStatus');
  if (!el) return;
  getSavedDir().then((dir) => {
    if (dir) {
      el.textContent = `📁 ${dir.name}`;
      el.title =
        'Timesheets → ' +
        dir.name +
        '/timesheets/\nJSON backups → ' +
        dir.name +
        '/JSON backups/\nClick to change';
      el.style.color = '#1D9E75';
    } else {
      el.textContent = 'pick save folder';
      el.title =
        'Choose where exports are saved (creates timesheets/ and JSON backups/ subfolders)';
      el.style.color = '';
    }
  });
}
