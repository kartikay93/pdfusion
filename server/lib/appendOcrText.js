import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

function firstChildNS(el, localName) {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 1 && node.localName === localName) return node;
  }
  return null;
}

function textParagraph(doc, text, { bold = false } = {}) {
  const p = doc.createElementNS(W_NS, 'w:p');
  const r = doc.createElementNS(W_NS, 'w:r');
  if (bold) {
    const rPr = doc.createElementNS(W_NS, 'w:rPr');
    rPr.appendChild(doc.createElementNS(W_NS, 'w:b'));
    r.appendChild(rPr);
  }
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  p.appendChild(r);
  return p;
}

/**
 * Appends a clearly-labeled "Recovered text from scanned pages (OCR)"
 * section to the end of a generated .docx's body — one labeled block per
 * OCR'd page. This deliberately does not attempt to reposition or reformat
 * the OCR'd text to match the original scanned layout (font, columns,
 * exact placement); it's appended as plain recovered text so it is at
 * least present, searchable, and copyable, with the limitation surfaced
 * to the user via the STYLE/OCR warning system rather than hidden.
 *
 * A no-op (returns the buffer unchanged) if there's nothing to append or
 * the file isn't a standard OOXML .docx (e.g. it's not really parseable —
 * in which case failing silently here is preferable to corrupting the
 * user's otherwise-successful conversion).
 */
export async function appendOcrSection(docxBuffer, ocrResults) {
  if (!ocrResults || ocrResults.length === 0) return docxBuffer;

  const zip = await JSZip.loadAsync(docxBuffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return docxBuffer;

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const body = firstChildNS(doc.documentElement, 'body');
  if (!body) return docxBuffer;

  // The body's own sectPr (section properties), when present, must stay the
  // LAST direct child per the OOXML schema — new content is inserted before it.
  const sectPr = firstChildNS(body, 'sectPr');

  body.insertBefore(textParagraph(doc, 'Recovered text from scanned pages (OCR)', { bold: true }), sectPr);
  body.insertBefore(doc.createElementNS(W_NS, 'w:p'), sectPr);

  for (const { pageIndex, text } of ocrResults) {
    body.insertBefore(textParagraph(doc, `Page ${pageIndex + 1}:`, { bold: true }), sectPr);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) body.insertBefore(textParagraph(doc, trimmed), sectPr);
    }
    body.insertBefore(doc.createElementNS(W_NS, 'w:p'), sectPr);
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'nodebuffer' });
}
