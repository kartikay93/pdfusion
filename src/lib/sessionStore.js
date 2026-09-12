// This module itself is not currently used by any tool. Historically this
// comment claimed PDFusion never sends files to a server — that's still true
// for Images to PDF, Merge, and Reorder & edit, but the Word to PDF tool now
// uploads files to a backend for LibreOffice-based conversion (see
// src/lib/serverEngine.js) and deletes them server-side after responding.
// File bytes live only in memory (a Map). A lightweight, non-sensitive index
// (names + sizes, no bytes) is mirrored to sessionStorage purely so a
// reload of the SAME tab can restore the file list — sessionStorage itself
// is wiped by the browser the moment the tab or browser closes, and we also
// clear both explicitly on unload as a second guarantee.

const files = new Map();
const INDEX_KEY = 'pdfusion_index';

function readIndex() {
  try {
    return JSON.parse(sessionStorage.getItem(INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeIndex(list) {
  sessionStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function putFile(id, meta, blob) {
  files.set(id, blob);
  const idx = readIndex().filter((f) => f.id !== id);
  idx.push({ id, ...meta });
  writeIndex(idx);
}

export function getFile(id) {
  return files.get(id);
}

export function removeFile(id) {
  files.delete(id);
  writeIndex(readIndex().filter((f) => f.id !== id));
}

export function listIndex() {
  return readIndex();
}

export function clearAll() {
  files.clear();
  sessionStorage.removeItem(INDEX_KEY);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', clearAll);
  window.addEventListener('beforeunload', clearAll);
}
