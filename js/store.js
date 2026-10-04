// Storage. Everything lives on the phone: projects and audio in IndexedDB,
// settings in localStorage. Nothing leaves except the text sent to Claude.

import { defaultVoice } from './voiceguard.js';

const DB_NAME = 'voice-director';
let _db;

function db() {
  return _db ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('audio', { keyPath: 'id' });
      d.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const listProjects = () => tx('projects', 'readonly', s => s.getAll());
export const getProject = id => tx('projects', 'readonly', s => s.get(id));
export const saveProject = p => { p.updated = Date.now(); return tx('projects', 'readwrite', s => s.put(structuredClone(p))); };
export const deleteProject = id => tx('projects', 'readwrite', s => s.delete(id));

export const saveAudio = (id, blob, mime) => tx('audio', 'readwrite', s => s.put({ id, blob, mime }));
export const getAudio = id => tx('audio', 'readonly', s => s.get(id));
export const deleteAudio = id => tx('audio', 'readwrite', s => s.delete(id));

export async function getMeta(key, fallback) {
  const r = await tx('meta', 'readonly', s => s.get(key));
  return r ? r.value : fallback;
}
export const setMeta = (key, value) => tx('meta', 'readwrite', s => s.put({ key, value: structuredClone(value) }));

export async function loadVoice() {
  return Object.assign(defaultVoice(), await getMeta('voice', {}));
}
export const saveVoice = v => setMeta('voice', v);

// In-progress take, autosaved every few seconds so a crash or a phone call never eats a take.
export const saveDraftTake = d => setMeta('draftTake', d);
export const loadDraftTake = () => getMeta('draftTake', null);
export const clearDraftTake = () => setMeta('draftTake', null);

const SETTINGS_KEY = 'vd_settings';
export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'high',
  lang: 'en-US',
  keepAudio: false,
  autoDirect: true,
  fallbacks: true,
  author: '',
  lastProject: '',
};

export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  const { fetch, ...rest } = s;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
}

export async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export async function backupAll() {
  return {
    app: 'voice-director', version: 1, kind: 'backup', exported: new Date().toISOString(),
    projects: await listProjects(), voice: await loadVoice(),
  };
}

export async function restoreBackup(data) {
  const list = data.kind === 'backup' ? data.projects : data.project ? [data.project] : [];
  if (!list.length) throw new Error('No projects found in that file.');
  for (const p of list) await tx('projects', 'readwrite', s => s.put(p));
  if (data.voice) await saveVoice(data.voice);
  return list.length;
}
