import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// pdfjs-dist v4's Node rendering path is built against @napi-rs/canvas
// specifically (its package.json disables the classic `canvas` package for
// Node resolution) — using a different canvas implementation here causes a
// cross-library `ctx.drawImage()` type mismatch ("Image or Canvas expected").
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Below this many extractable text characters, a page is treated as
// "likely scanned" — an embedded image with no real text layer, rather
// than a normal text-based page LibreOffice can already extract fine.
const MIN_CHARS_FOR_REAL_TEXT = 20;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Cheap metadata-only page count (no rendering) — used to scale the
 * LibreOffice conversion timeout for long documents.
 */
export async function getPdfPageCount(pdfBuffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  return doc.numPages;
}

/**
 * Returns 0-based indices of pages whose extractable text layer is sparse
 * enough to be considered likely-scanned.
 */
export async function findLowTextPages(pdfBuffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const lowTextPages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join('').trim();
    if (text.length < MIN_CHARS_FOR_REAL_TEXT) lowTextPages.push(i - 1);
  }
  return lowTextPages;
}

async function renderPageToPng(doc, pageIndex, scale) {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const factory = new NodeCanvasFactory();
  const canvasAndContext = factory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: canvasAndContext.context, viewport, canvasFactory: factory }).promise;
  return canvasAndContext.canvas.toBuffer('image/png');
}

/**
 * OCRs the given 0-based page indices of a PDF using Tesseract (pure WASM —
 * no system OCR binary required) and returns [{ pageIndex, text }]. A page
 * that fails or yields nothing usable is silently omitted rather than
 * failing the whole request — OCR here is best-effort recovery, not a hard
 * requirement of the conversion succeeding.
 */
export async function ocrPages(pdfBuffer, pageIndices, { scale = 2.5 } = {}) {
  if (pageIndices.length === 0) return [];

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  // Without an explicit cachePath, tesseract.js downloads/caches the
  // language data file (eng.traineddata) into process.cwd(), littering
  // whatever directory the server happens to be started from.
  const worker = await createWorker('eng', undefined, { cachePath: os.tmpdir() });
  const results = [];
  try {
    for (const pageIndex of pageIndices) {
      // tesseract.js's Node path expects a file path / data URL, not a raw
      // Buffer, so each rendered page is written to a scratch temp file.
      const tmpPath = path.join(os.tmpdir(), `pdfusion-ocr-${crypto.randomUUID()}.png`);
      try {
        const png = await renderPageToPng(doc, pageIndex, scale);
        await fs.writeFile(tmpPath, png);
        const { data } = await worker.recognize(tmpPath);
        const text = data.text.trim();
        if (text) results.push({ pageIndex, text });
      } catch (err) {
        console.error(`[ocr] page ${pageIndex + 1} failed:`, err.message);
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    }
  } finally {
    await worker.terminate();
  }
  return results;
}
