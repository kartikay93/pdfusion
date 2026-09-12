import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { firstChildNS } from './xmlHelpers.js';

function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0);
}

function wordCounts(words) {
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return counts;
}

async function extractPdfText(pdfBuffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(' ') + '\n';
  }
  return { text, pageCount: doc.numPages };
}

/**
 * Walks word/document.xml collecting <w:t> text, but skips every
 * mc:Fallback subtree. LibreOffice's PDF-import output wraps each shape in
 * <mc:AlternateContent><mc:Choice>...<w:drawing>...</mc:Choice>
 * <mc:Fallback>...<w:pict>...(the SAME text, duplicated for legacy Word
 * versions)...</mc:Fallback></mc:AlternateContent> — a naive text walk (or
 * mammoth, which doesn't special-case mc:AlternateContent) picks up BOTH
 * copies of every run, silently doubling every word count. That makes a
 * coverage ratio useless: removing one duplicate still leaves the other,
 * so genuine data loss can hide behind an artificially-inflated count.
 * Confirmed by hand-testing this exact scenario before trusting this
 * function — a deliberately truncated docx showed 100% "coverage" with
 * the naive (mammoth) approach and correctly dropped once this fix went in.
 */
function textSkippingFallback(node, out) {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType !== 1) continue;
    if (child.localName === 'Fallback') continue;
    if (child.localName === 't') {
      out.push(child.textContent || '');
    } else {
      textSkippingFallback(child, out);
    }
  }
}

async function extractDocxText(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return '';
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const body = firstChildNS(doc.documentElement, 'body');
  if (!body) return '';
  const chunks = [];
  textSkippingFallback(body, chunks);
  return chunks.join(' ');
}

/**
 * Compares extractable text between a source PDF and the converted .docx
 * to estimate how much content survived the conversion. Deliberately a
 * coarse, best-effort signal, not a guarantee of pixel/layout fidelity —
 * see the caveat below before trusting a low score as "we lost data."
 *
 * Important caveat: text that only ever existed as a flattened image in
 * the PDF (an equation/table whose glyph encoding LibreOffice couldn't map
 * to real text) was never part of the PDF's OWN *extractable* text either
 * — pdfjs can't read text out of a picture any more than a human eye can
 * read pixels as Unicode. So this check can only ever catch text that WAS
 * genuinely extractable in the source PDF but is missing afterward (a real
 * regression in the conversion) — not pre-existing image-only content,
 * which is what the equation/table recovery features (see
 * contentRecovery.js / equationRecovery.js) address separately.
 */
export async function compareFidelity(pdfBuffer, docxBuffer) {
  const [{ text: pdfText, pageCount }, docxText] = await Promise.all([
    extractPdfText(pdfBuffer),
    extractDocxText(docxBuffer)
  ]);

  const pdfWords = normalizeWords(pdfText);
  const docxWords = normalizeWords(docxText);
  const pdfCounts = wordCounts(pdfWords);
  const docxCounts = wordCounts(docxWords);

  let overlap = 0;
  const missing = [];
  for (const [word, count] of pdfCounts) {
    const found = Math.min(count, docxCounts.get(word) || 0);
    overlap += found;
    if (found < count) missing.push({ word, missingCount: count - found });
  }
  missing.sort((a, b) => b.missingCount - a.missingCount);

  const coverage = pdfWords.length > 0 ? overlap / pdfWords.length : 1;

  return {
    pdfPageCount: pageCount,
    pdfWordCount: pdfWords.length,
    docxWordCount: docxWords.length,
    coverage,
    topMissingWords: missing.slice(0, 20).map((m) => m.word)
  };
}
