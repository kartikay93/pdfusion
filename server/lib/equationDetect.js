import JSZip from 'jszip';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { DOMParser } from '@xmldom/xmldom';
import {
  R_NS,
  firstChildNS, elementsByLocalName,
  firstDescendantByLocalName, textContent
} from './xmlHelpers.js';

const EMU_PER_INCH = 914400;

// Starting thresholds — deliberately tentative. This project's own testing
// this session could reproduce LibreOffice decomposing equations into
// scattered text shapes, but not (without a LaTeX-produced source PDF,
// unavailable in this environment) the raster-image case this heuristic
// targets. Tune these against real data once a genuine example is
// available; until then they're calibrated against confirmed real data
// points: a full-column photo came through at ~3.12"x4.85" (a negative
// control), and a synthetic small equation-like image at 2.0"x0.4" scored
// 1.0 (see server/test/equationRecovery.test.js).
const SIZE_GOOD_MAX_IN = { width: 3.5, height: 1.8 };
const SIZE_BAD_MIN_IN = { width: 5, height: 4 };
const MONOCHROME_GOOD = 0.97;
const MONOCHROME_BAD = 0.85;
const SCORE_THRESHOLD = 0.6;
const EQUATION_NUMBER_RE = /^\(?\d{1,3}[a-z]?\)?$/;
// Academic tables are conventionally captioned with Roman numerals ("TABLE
// I", "TABLE II"), not Arabic digits like figures ("Fig. 1") — a plain \d
// misses "TABLE I" entirely, silently disabling the caption veto for every
// table. Matches Arabic digits for fig/figure/table, and either Arabic or
// Roman numerals specifically for table (Roman numeral figure captions are
// not a real-world convention, so figures stay Arabic-only).
const CAPTION_RE = /^(fig\.?|figure)\s*\d|^table\s*([ivxlcdm]+\b|\d)/i;

// Proximity is measured as actual vertical distance (EMU), not document-
// order index count — hand-inspection this session found every drawing's
// <wp:positionV><wp:posOffset> shares the same reference frame (all
// relativeFrom="paragraph", values forming a clean monotonically
// increasing top-to-bottom sequence for a single-page document), so
// subtracting two offsets gives a real, comparable distance. Index-based
// "±N nearby drawings" was tried first and broke on short/dense documents:
// a decoy figure's own caption sat within 3 slots of an unrelated equation
// candidate purely because the whole page only had ~8 drawings, vetoing a
// real candidate that was actually inches away. This assumption can still
// break across a page boundary (each page may restart its own reference
// paragraph) — a known limitation, not fixed here.
const EQUATION_NUMBER_MAX_DISTANCE_IN = 1.0;
// Tighter than the equation-number distance on purpose: this check is
// meant to catch text sharing the SAME visual line as the image (normal
// line-height gap, well under 0.5in), not the next paragraph down (a
// normal paragraph gap in this session's own test data was ~0.85in) —
// tune further once real-world documents are available.
const OTHER_TEXT_MAX_DISTANCE_IN = 0.5;
const CAPTION_VETO_MAX_DISTANCE_IN = 3.0;
// Generous cap for the broader Gemini-classified path (findContentCandidates)
// — big enough to admit a full-column table, small enough to skip an
// obvious full-page photo/scan.
const CONTENT_MAX_IN = { width: 6.5, height: 9 };

function sizeSignal(widthIn, heightIn) {
  if (widthIn <= SIZE_GOOD_MAX_IN.width && heightIn <= SIZE_GOOD_MAX_IN.height) return 1;
  if (widthIn > SIZE_BAD_MIN_IN.width || heightIn > SIZE_BAD_MIN_IN.height) return 0;
  const wFrac = Math.max(0, (SIZE_BAD_MIN_IN.width - widthIn) / (SIZE_BAD_MIN_IN.width - SIZE_GOOD_MAX_IN.width));
  const hFrac = Math.max(0, (SIZE_BAD_MIN_IN.height - heightIn) / (SIZE_BAD_MIN_IN.height - SIZE_GOOD_MAX_IN.height));
  return Math.min(wFrac, hFrac);
}

async function colorComplexitySignal(imageBuffer) {
  try {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);

    const step = 4; // sample every 4th pixel
    let sampled = 0;
    let nearMonochrome = 0;
    for (let i = 0; i < data.length; i += 4 * step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      sampled++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const isNearBlack = max < 60;
      const isNearWhite = min > 200;
      const isGrayish = max - min < 20;
      if (isNearBlack || isNearWhite || isGrayish) nearMonochrome++;
      if (sampled >= 2500) break;
    }
    if (sampled === 0) return 0;

    const fraction = nearMonochrome / sampled;
    if (fraction >= MONOCHROME_GOOD) return 1;
    if (fraction < MONOCHROME_BAD) return 0;
    return (fraction - MONOCHROME_BAD) / (MONOCHROME_GOOD - MONOCHROME_BAD);
  } catch (err) {
    console.error('[equationDetect] color analysis failed, treating as non-equation:', err.message);
    return 0;
  }
}

/** Text content of a drawing, if it's a wps:wsp text-box shape (empty for a raster image). */
function drawingText(drawingNode) {
  return textContent(drawingNode).trim();
}

/**
 * The node that should be removed to excise just this one drawing —
 * its mc:AlternateContent ancestor when present (that wrapper holds both
 * the modern <w:drawing> and a legacy <w:pict> fallback representing the
 * SAME image; removing only the inner <w:drawing> would leave the
 * fallback behind), else the <w:drawing> itself. Multiple drawings can
 * share one carrier <w:r> as siblings (confirmed by hand-inspection this
 * session), so this must never be "the whole run."
 */
function findRemovableNode(drawingNode) {
  let node = drawingNode;
  while (node.parentNode) {
    if (node.parentNode.localName === 'AlternateContent') return node.parentNode;
    if (node.parentNode.localName === 'r' || node.parentNode.localName === 'p') break;
    node = node.parentNode;
  }
  return drawingNode;
}

/** Nearest ancestor <w:p> — where a replacement <m:oMath> gets inserted (oMath is a paragraph-level sibling of runs, never nested inside a <w:r>). */
function findHostParagraph(drawingNode) {
  let node = drawingNode.parentNode;
  while (node) {
    if (node.localName === 'p') return node;
    node = node.parentNode;
  }
  return null;
}

/** EMU value of a drawing's <wp:positionV><wp:posOffset>, or null if absent/non-numeric. */
function verticalOffsetEmu(drawingNode) {
  const posV = firstDescendantByLocalName(drawingNode, 'positionV');
  const offNode = posV ? firstDescendantByLocalName(posV, 'posOffset') : null;
  if (!offNode) return null;
  const val = Number.parseInt(offNode.textContent, 10);
  return Number.isFinite(val) ? val : null;
}

function aloneOnLineSignal(allDrawings, myIndex, myY) {
  if (myY === null) return 0.5; // no position data — stay neutral, don't guess
  let sawTrailingText = false;
  for (let i = 0; i < allDrawings.length; i++) {
    if (i === myIndex) continue;
    const otherY = verticalOffsetEmu(allDrawings[i]);
    if (otherY === null) continue;
    const distanceIn = Math.abs(otherY - myY) / EMU_PER_INCH;
    if (distanceIn > OTHER_TEXT_MAX_DISTANCE_IN) continue;

    const text = drawingText(allDrawings[i]);
    if (!text) continue;
    if (distanceIn <= EQUATION_NUMBER_MAX_DISTANCE_IN && EQUATION_NUMBER_RE.test(text)) {
      sawTrailingText = true;
      continue;
    }
    // Some other real text sitting close by. Weak negative signal (not a
    // hard veto), since plain body text can legitimately sit near a
    // correctly-flowing equation too.
    return 0.3;
  }
  return sawTrailingText ? 1 : 0.7;
}

function captionNearby(allDrawings, myIndex, myY) {
  if (myY === null) return false; // no position data — can't localize, don't guess
  for (let i = 0; i < allDrawings.length; i++) {
    if (i === myIndex) continue;
    const otherY = verticalOffsetEmu(allDrawings[i]);
    if (otherY === null) continue;
    const distanceIn = Math.abs(otherY - myY) / EMU_PER_INCH;
    if (distanceIn > CAPTION_VETO_MAX_DISTANCE_IN) continue;
    if (CAPTION_RE.test(drawingText(allDrawings[i]))) return true;
  }
  return false;
}

function resolveRelationshipTarget(relsXml, relId) {
  if (!relsXml) return null;
  const doc = new DOMParser().parseFromString(relsXml, 'text/xml');
  const rels = elementsByLocalName(doc.documentElement, 'Relationship');
  for (const rel of rels) {
    if (rel.getAttribute('Id') === relId) return rel.getAttribute('Target');
  }
  return null;
}

/**
 * Parses a .docx buffer and returns every embedded raster image drawing
 * found in word/document.xml, with the shared plumbing both detection
 * strategies below need (image bytes, dimensions, splice points). Does NOT
 * decide which of these are equation/table/photo — that's the caller's job.
 */
async function collectImageDrawings(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return { zip, doc: null, allDrawings: [], items: [] };

  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const body = firstChildNS(doc.documentElement, 'body');
  if (!body) return { zip, doc, allDrawings: [], items: [] };

  const allDrawings = elementsByLocalName(body, 'drawing');
  const items = [];

  for (let index = 0; index < allDrawings.length; index++) {
    const drawingNode = allDrawings[index];
    const blipNode = firstDescendantByLocalName(drawingNode, 'blip');
    if (!blipNode) continue; // a vector wps:wsp text shape, not a raster image

    const relId = blipNode.getAttributeNS(R_NS, 'embed');
    if (!relId) continue;

    const target = resolveRelationshipTarget(relsXml, relId);
    if (!target) continue;
    const mediaPath = 'word/' + target.replace(/^\.?\//, '');
    const imageFile = zip.file(mediaPath);
    if (!imageFile) continue;
    const imageBuffer = await imageFile.async('nodebuffer');

    const extentNode = firstDescendantByLocalName(drawingNode, 'extent');
    if (!extentNode) continue;
    const widthEmu = Number.parseInt(extentNode.getAttribute('cx'), 10);
    const heightEmu = Number.parseInt(extentNode.getAttribute('cy'), 10);
    if (!widthEmu || !heightEmu) continue;

    const hostParagraph = findHostParagraph(drawingNode);
    if (!hostParagraph) continue; // shouldn't happen in a well-formed docx, but never splice into nothing

    items.push({
      drawingIndex: index,
      drawingNode,
      removableNode: findRemovableNode(drawingNode),
      hostParagraph,
      relId,
      imageBuffer,
      widthEmu,
      heightEmu,
      widthIn: widthEmu / EMU_PER_INCH,
      heightIn: heightEmu / EMU_PER_INCH,
      y: verticalOffsetEmu(drawingNode)
    });
  }

  return { zip, doc, allDrawings, items };
}

/**
 * Scans a LibreOffice-generated .docx for images that look like a
 * flattened equation rather than a real figure/photo, using a weighted
 * heuristic (size + "alone on its line, maybe with a trailing equation
 * number" + monochromaticity), with a hard veto when a "Fig./Table N"
 * caption is nearby. Anything ambiguous is left out of the result by
 * construction — this function only returns candidates confident enough
 * to act on; everything else stays exactly as LibreOffice produced it.
 *
 * This is the narrow, local-only (pix2tex) path, used as a fallback when
 * no Gemini API key is configured — see findContentCandidates for the
 * broader, Gemini-classified path used when one is.
 *
 * Returns the LIVE parsed zip + DOM (not just metadata) so the caller can
 * edit and re-serialize the same parse rather than re-parsing the buffer.
 *
 * Important structural note (confirmed by hand-inspecting real converted
 * output, not assumed): LibreOffice's PDF-import does not give each
 * visual line/object its own <w:p> the way a normal flowing document
 * would — multiple <w:drawing> elements (both images and text-box shapes)
 * commonly end up as siblings inside a single "carrier" <w:r>, with the
 * actual visual layout expressed entirely via each drawing's <wp:anchor>
 * absolute position rather than document paragraph structure. So
 * candidates are found by scanning every <w:drawing> in document order
 * directly, not by walking paragraphs/runs as the unit of "one candidate."
 */
export async function findEquationCandidates(docxBuffer) {
  const { zip, doc, allDrawings, items } = await collectImageDrawings(docxBuffer);
  const candidates = [];

  for (const item of items) {
    if (captionNearby(allDrawings, item.drawingIndex, item.y)) {
      continue; // hard veto — likely a real, captioned figure
    }

    const signals = {
      size: sizeSignal(item.widthIn, item.heightIn),
      aloneOnLine: aloneOnLineSignal(allDrawings, item.drawingIndex, item.y),
      colorComplexity: await colorComplexitySignal(item.imageBuffer)
    };
    const score = 0.45 * signals.colorComplexity + 0.30 * signals.aloneOnLine + 0.25 * signals.size;

    console.log(
      `[equationDetect] drawing ${item.drawingIndex}: score=${score.toFixed(2)} ` +
      `(size=${signals.size.toFixed(2)} alone=${signals.aloneOnLine.toFixed(2)} color=${signals.colorComplexity.toFixed(2)}) ` +
      `${item.widthIn.toFixed(2)}x${item.heightIn.toFixed(2)}in`
    );

    if (score < SCORE_THRESHOLD) continue;

    candidates.push({ ...item, score, signals });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { zip, doc, candidates };
}

/**
 * Broader candidate finder for the Gemini-classified path: every embedded
 * image under a generous size cap (skipping only obvious full-page
 * photos/scans), with no monochrome/caption scoring at all — classification
 * of "equation vs table vs real photo" is left entirely to Gemini, which is
 * far better at that judgment than a pixel heuristic. Capped by `maxItems`
 * (cost/latency control) — kept in document order, so the earliest content
 * on the page is prioritized if a document has more images than the cap.
 */
export async function findContentCandidates(docxBuffer, maxItems = 15) {
  const { zip, doc, items } = await collectImageDrawings(docxBuffer);

  const candidates = items.filter(
    (item) => item.widthIn <= CONTENT_MAX_IN.width && item.heightIn <= CONTENT_MAX_IN.height
  );

  return { zip, doc, candidates: candidates.slice(0, maxItems), skipped: Math.max(0, candidates.length - maxItems) };
}
