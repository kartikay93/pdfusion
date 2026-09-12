import { XMLSerializer } from '@xmldom/xmldom';
import { findContentCandidates } from './equationDetect.js';
import { recognizeContent } from './geminiContentRecovery.js';
import { latexToOmml } from './latexToOmml.js';
import { buildTableXml } from './tableToOoxml.js';
import { W_NS } from './xmlHelpers.js';
import { config } from '../config.js';

/** Splices a real <w:tbl> in as a body-level sibling right after the flattened image's host paragraph, then removes just that image. */
function insertTable(doc, candidate, rows) {
  const parent = candidate.hostParagraph.parentNode;
  const nextSibling = candidate.hostParagraph.nextSibling;
  const tbl = buildTableXml(doc, rows);
  const spacerParagraph = doc.createElementNS(W_NS, 'w:p');
  // A <w:tbl> is a body-level block like a paragraph, never nested inside
  // one (unlike <m:oMath>) — and per the OOXML schema a table can't be the
  // last body element before <w:sectPr>, so a following empty paragraph is
  // always added for safety, not just when this happens to be the last item.
  parent.insertBefore(tbl, nextSibling);
  parent.insertBefore(spacerParagraph, nextSibling);
  candidate.removableNode.parentNode.removeChild(candidate.removableNode);
}

/**
 * Detects flattened equation AND table images in a LibreOffice-generated
 * .docx and replaces the ones Gemini can confidently classify + transcribe
 * with real, editable Word content (<m:oMath> for equations, <w:tbl> for
 * tables). This is the broader Gemini-classified path, used instead of the
 * narrower local-only (pix2tex, equations-only) recoverEquations() when a
 * GEMINI_API_KEY is configured — classification of "equation vs table vs a
 * real photo/figure that must be left alone" is left to Gemini itself
 * rather than a pixel heuristic. Never throws — every internal failure
 * mode degrades to "leave that candidate as an image" plus a warning.
 */
export async function recoverContentWithGemini(docxBuffer) {
  const { zip, doc, candidates, skipped } = await findContentCandidates(docxBuffer, config.contentRecoveryMaxImages);
  if (candidates.length === 0) return { buffer: docxBuffer, warnings: [] };

  const warnings = [];
  let equationsRecovered = 0;
  let tablesRecovered = 0;
  let unrecognizedCount = 0;
  let naryCaveatSeen = false;

  for (const candidate of candidates) {
    let result;
    try {
      result = await recognizeContent(candidate.imageBuffer);
    } catch (err) {
      console.error('[contentRecovery] recognizeContent failed:', err.message);
      result = null;
    }
    if (!result || result.kind === 'other') continue;

    if (result.kind === 'equation') {
      let omml;
      try {
        omml = latexToOmml(result.latex);
      } catch (err) {
        console.error('[contentRecovery] latexToOmml failed for a candidate:', err.message);
        unrecognizedCount++;
        continue;
      }
      candidate.removableNode.parentNode.removeChild(candidate.removableNode);
      candidate.hostParagraph.appendChild(omml.ommlNode);
      equationsRecovered++;
      if (/<m:nary/.test(omml.ommlXmlString)) naryCaveatSeen = true;
      continue;
    }

    if (result.kind === 'table') {
      try {
        insertTable(doc, candidate, result.rows);
        tablesRecovered++;
      } catch (err) {
        console.error('[contentRecovery] table insertion failed for a candidate:', err.message);
        unrecognizedCount++;
      }
    }
  }

  const recoveredCount = equationsRecovered + tablesRecovered;
  if (recoveredCount === 0 && unrecognizedCount === 0 && skipped === 0) {
    return { buffer: docxBuffer, warnings: [] };
  }

  const buffer = recoveredCount > 0
    ? await (() => {
      zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
      return zip.generateAsync({ type: 'nodebuffer' });
    })()
    : docxBuffer;

  if (equationsRecovered > 0) {
    warnings.push({
      code: 'EQUATIONS_RECOVERED',
      message: `${equationsRecovered} equation image(s) were recognized and replaced with editable Word equations.`
    });
  }
  if (tablesRecovered > 0) {
    warnings.push({
      code: 'TABLES_RECOVERED',
      message: `${tablesRecovered} table image(s) were recognized and replaced with editable Word tables.`
    });
  }
  if (naryCaveatSeen) {
    warnings.push({
      code: 'EQUATION_NARY_APPROXIMATE',
      message: 'One or more recovered equations contain a sum, product or integral — these may render with a minor spacing/placeholder imperfection next to the integrand. The equation is still fully editable.'
    });
  }
  if (unrecognizedCount > 0) {
    warnings.push({
      code: 'EQUATION_RECOVERY_PARTIAL',
      message: `${unrecognizedCount} image(s) looked like they might contain an equation or table but could not be automatically converted, and remain as image(s).`
    });
  }
  if (skipped > 0) {
    warnings.push({
      code: 'CONTENT_RECOVERY_SKIPPED_LIMIT',
      message: `This document has more embedded images than the per-conversion limit (${config.contentRecoveryMaxImages}) — ${skipped} were not checked for recoverable equations/tables.`
    });
  }

  return { buffer, warnings };
}
