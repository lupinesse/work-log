/**
 * @file filesystem.test.mjs
 * Regression coverage for issue #336: 05b-filesystem.js extracted to a leaf
 * ES module. Tests focus on error-handling paths and caching semantics, since
 * the browser-only APIs (IndexedDB, FSA) are replaced with minimal mocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// --- Browser API mocks -------------------------------------------------------

function makeIdbMock({ getResult = null, shouldFailOpen = false, shouldFailTx = false } = {}) {
  return {
    open(name, version) {
      const req = {};
      Promise.resolve().then(() => {
        if (shouldFailOpen) {
          req.error = new Error('IDB open failed');
          req.onerror?.();
        } else {
          const db = {
            transaction(stores, mode) {
              const store = {
                get(key) {
                  const r = {};
                  Promise.resolve().then(() => {
                    if (shouldFailTx) {
                      r.error = new Error('IDB tx failed');
                      r.onerror?.();
                    } else {
                      r.result = getResult;
                      r.onsuccess?.();
                    }
                  });
                  return r;
                },
                put() {
                  return {};
                },
                delete() {
                  return {};
                },
              };
              const tx = {
                objectStore() {
                  return store;
                },
                oncomplete: null,
                onerror: null,
              };
              if (!shouldFailTx) Promise.resolve().then(() => tx.oncomplete?.());
              return tx;
            },
            createObjectStore() {},
          };
          req.onsuccess?.({ target: { result: db } });
        }
      });
      req.onupgradeneeded = null;
      req.onsuccess = null;
      req.onerror = null;
      return req;
    },
  };
}

function makeDocumentMock() {
  const elements = {};
  return {
    getElementById(id) {
      return elements[id] ?? null;
    },
    createElement(tag) {
      const el = {
        tagName: tag,
        href: '',
        download: '',
        click() {},
        remove() {},
      };
      return el;
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
    _addElement(id, el) {
      elements[id] = el;
    },
  };
}

// Re-import the module after setting up globals for each test group.
// Since ESM caches imports, we control state via the module's own closure.
// We import once and reset state by calling clearDirHandle() between tests.
let mod;

async function loadMod() {
  if (!mod) {
    // Provide minimal globals Node.js doesn't have
    globalThis.indexedDB = makeIdbMock();
    globalThis.document = makeDocumentMock();
    globalThis.window = { showDirectoryPicker: null };
    globalThis.URL = {
      createObjectURL() {
        return 'blob:mock';
      },
      revokeObjectURL() {},
    };
    mod = await import('../../src/js/05b-filesystem.js');
  }
  return mod;
}

// ---------------------------------------------------------------------------

describe('filesystem.js — module exports', () => {
  it('exports the expected public symbols', async () => {
    const m = await loadMod();
    assert.equal(typeof m.openIDB, 'function');
    assert.equal(typeof m.getSavedDir, 'function');
    assert.equal(typeof m.storeDirHandle, 'function');
    assert.equal(typeof m.clearDirHandle, 'function');
    assert.equal(typeof m.writeExportFile, 'function');
    assert.equal(typeof m.pickSaveFolder, 'function');
    assert.equal(typeof m.renderFolderStatus, 'function');
  });
});

describe('renderFolderStatus', () => {
  it('returns without throwing when #folderStatus is not in the DOM', async () => {
    const { renderFolderStatus } = await loadMod();
    globalThis.document = makeDocumentMock(); // no #folderStatus element
    assert.doesNotThrow(() => renderFolderStatus());
  });

  it('populates #folderStatus text when a dir handle is cached', async () => {
    const { storeDirHandle, renderFolderStatus } = await loadMod();
    globalThis.indexedDB = makeIdbMock();
    const doc = makeDocumentMock();
    const el = { textContent: '', title: '', style: {} };
    doc._addElement('folderStatus', el);
    globalThis.document = doc;

    const fakeHandle = { name: 'MyExports' };
    await storeDirHandle(fakeHandle);
    renderFolderStatus();
    // give the async getSavedDir() promise time to resolve
    await new Promise((r) => setTimeout(r, 20));
    assert.match(el.textContent, /MyExports/);
    assert.equal(el.style.color, '#1D9E75');
  });

  it('shows "pick save folder" prompt when no dir handle is cached', async () => {
    const { clearDirHandle, renderFolderStatus } = await loadMod();
    globalThis.indexedDB = makeIdbMock({ getResult: null });
    await clearDirHandle();

    const doc = makeDocumentMock();
    const el = { textContent: '', title: '', style: {} };
    doc._addElement('folderStatus', el);
    globalThis.document = doc;

    renderFolderStatus();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(el.textContent, 'pick save folder');
    assert.equal(el.style.color, '');
  });
});

describe('getSavedDir — error handling', () => {
  it('returns null when IDB fails to open', async () => {
    const { clearDirHandle, getSavedDir } = await loadMod();
    await clearDirHandle();
    globalThis.indexedDB = makeIdbMock({ shouldFailOpen: true });
    const result = await getSavedDir();
    assert.equal(result, null);
  });

  it('returns null when the IDB transaction read fails', async () => {
    const { clearDirHandle, getSavedDir } = await loadMod();
    await clearDirHandle();
    globalThis.indexedDB = makeIdbMock({ shouldFailTx: true });
    const result = await getSavedDir();
    assert.equal(result, null);
  });
});

describe('clearDirHandle', () => {
  it('clears the cached handle so getSavedDir returns null next call', async () => {
    const { storeDirHandle, clearDirHandle, getSavedDir } = await loadMod();
    globalThis.indexedDB = makeIdbMock();
    globalThis.wlLog = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };

    await storeDirHandle({ name: 'Temp' });
    const before = await getSavedDir();
    assert.ok(before !== null);

    await clearDirHandle();
    // After clear, getSavedDir must go to IDB (returns null because no stored handle)
    globalThis.indexedDB = makeIdbMock({ getResult: null });
    const after = await getSavedDir();
    assert.equal(after, null);
  });
});

describe('pickSaveFolder', () => {
  it('shows an alert and returns early when FSA API is unavailable', async () => {
    const { pickSaveFolder } = await loadMod();
    let alerted = false;
    globalThis.alert = () => {
      alerted = true;
    };
    globalThis.window = {}; // no showDirectoryPicker

    await assert.doesNotReject(() => pickSaveFolder());
    assert.equal(alerted, true);
  });
});

describe('writeExportFile — FSA success path', () => {
  it('writes to the cached FSA directory handle when available', async () => {
    const { storeDirHandle, writeExportFile } = await loadMod();
    globalThis.indexedDB = makeIdbMock();
    globalThis.wlLog = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };

    const writes = [];
    const fakeWritable = {
      write: async (blob) => {
        writes.push(blob);
      },
      close: async () => {},
    };
    const fakeFileHandle = { createWritable: async () => fakeWritable };
    const fakeSubDir = { getFileHandle: async () => fakeFileHandle };
    const fakeDirHandle = {
      name: 'SavedExports',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getDirectoryHandle: async () => fakeSubDir,
    };

    await storeDirHandle(fakeDirHandle);

    const blob = new Blob(['content'], { type: 'text/plain' });
    const clicks = [];
    const doc = makeDocumentMock();
    doc.createElement = (tag) => {
      const el = {
        tagName: tag,
        href: '',
        download: '',
        click() {
          clicks.push(1);
        },
        remove() {},
      };
      return el;
    };
    globalThis.document = doc;

    await writeExportFile('timesheets', 'output.csv', blob);
    assert.equal(writes.length, 1);
    assert.equal(clicks.length, 0, 'should not fall back to browser download');
  });
});

describe('writeExportFile — browser download fallback', () => {
  it('falls back to a browser download when no FSA dir is cached', async () => {
    const { clearDirHandle, writeExportFile } = await loadMod();
    globalThis.indexedDB = makeIdbMock({ getResult: null });
    globalThis.wlLog = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    await clearDirHandle();

    const clicks = [];
    const doc = makeDocumentMock();
    doc.createElement = (tag) => {
      const el = {
        tagName: tag,
        href: '',
        download: '',
        click() {
          clicks.push(this.download);
        },
        remove() {},
      };
      return el;
    };
    doc.body.appendChild = () => {};
    doc.body.removeChild = () => {};
    globalThis.document = doc;

    const blob = new Blob(['test'], { type: 'text/plain' });
    await writeExportFile('timesheets', 'test.csv', blob);
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0], 'test.csv');
  });
});
