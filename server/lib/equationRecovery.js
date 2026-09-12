import { XMLSerializer } from '@xmldom/xmldom';
import { findEquationCandidates } from './equationDetect.js';
import { recognizeEquation, isMathOcrAvailable } from './mathOcr.js';
import { latexToOmml } from './latexToOmml.js';

/**
 * Detects flattened equation images in a LibreOffice-generated .docx and
 * replaces the ones it can confidently recognize with real, editable Word
 * equations (<m:oMath>). Never throws — the caller should still wrap this
 * in its own try/catch as defense in depth, but every internal failure
 * mode here already degrades to "leave that candidate as an image" plus a
 * warning, never a broken document.
 */
export async function recoverEquations(docxBuffer) {
  const { zip, doc, candidates } = await findEquationCandidates(docxBuffer);
  if (candidates.length === 0) return { buffer: docxBuffer, warnings: [] };

  if (!(await isMathOcrAvailable())) {
    return {
      buffer: docxBuffer,
      warnings: [{
        code: 'EQUATION_RECOVERY_UNAVAILABLE',
        message: `${candidates.length} equation-like image(s) were found but automatic equation recovery isn't set up on this server — they remain as images.`
      }]
    };
  }

  const warnings = [];
  let recoveredCount = 0;
  let naryCaveatSeen = false;

  for (const candidate of candidates) {
    const latex = await recognizeEquation(candidate.imageBuffer);
    if (!latex) continue;

    let omml;
    try {
      omml = latexToOmml(latex);
    } catch (err) {
      console.error('[equationRecovery] latexToOmml failed for a candidate:', err.message);
      continue;
    }

    // Remove just this one drawing's wrapper (never the whole carrier
    // <w:r> — other drawings can be its siblings) and insert the
    // <m:oMath> as a new child of the drawing's host paragraph. <m:oMath>
    // is a paragraph-level sibling of runs in the OOXML math schema, never
    // nested inside a <w:r>, so it can't simply replace the drawing in place.
    candidate.removableNode.parentNode.removeChild(candidate.removableNode);
    candidate.hostParagraph.appendChild(omml.ommlNode);
    recoveredCount++;
    if (/<m:nary/.test(omml.ommlXmlString)) naryCaveatSeen = true;
  }

  if (recoveredCount === 0) {
    return {
      buffer: docxBuffer,
      warnings: [{
        code: 'EQUATION_RECOVERY_PARTIAL',
        message: `${candidates.length} equation-like image(s) were found, but none could be automatically recognized — they remain as images. (If this is the pix2tex model's first use, it may still be downloading its weights; try again shortly.)`
      }]
    };
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  warnings.push({
    code: 'EQUATIONS_RECOVERED',
    message: `${recoveredCount} equation image(s) were recognized and replaced with editable Word equations.`
  });
  if (naryCaveatSeen) {
    warnings.push({
      code: 'EQUATION_NARY_APPROXIMATE',
      message: 'One or more recovered equations contain a sum, product or integral — these may render with a minor spacing/placeholder imperfection next to the integrand. The equation is still fully editable.'
    });
  }
  const leftAsImage = candidates.length - recoveredCount;
  if (leftAsImage > 0) {
    warnings.push({
      code: 'EQUATION_RECOVERY_PARTIAL',
      message: `${leftAsImage} equation-like image(s) could not be automatically converted and remain as image(s).`
    });
  }

  return { buffer, warnings };
}
