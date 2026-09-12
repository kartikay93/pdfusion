import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Schema-correct relative ordering for the child elements we may insert,
// so a freshly-created <w:rPr>/<w:pPr> stays valid against the OOXML schema.
const RPR_ORDER = ['rFonts', 'color', 'sz', 'szCs'];
const PPR_ORDER = ['spacing', 'jc'];

export function hasAnyOverride(style) {
  if (!style) return false;
  return ['fontFamily', 'fontSizePt', 'color', 'alignment', 'lineSpacing'].some(
    (k) => style[k] !== null && style[k] !== undefined && style[k] !== ''
  );
}

function normalizeColorHex(color) {
  const hex = String(color).replace(/^#/, '').trim();
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

// OOXML alignment values: left | center | right | both (justify)
function normalizeAlignment(alignment) {
  const map = { left: 'left', center: 'center', right: 'right', justify: 'both' };
  return map[alignment] || null;
}

function firstChildNS(el, localName) {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 1 && node.localName === localName) return node;
  }
  return null;
}

/** Inserts `newEl` into `parent` at the position dictated by `order` (a list of localNames). */
function insertInOrder(doc, parent, newEl, order) {
  const newIndex = order.indexOf(newEl.localName ?? newEl.tagName.replace(/^w:/, ''));
  let refNode = null;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node.nodeType !== 1) continue;
    const name = node.localName ?? node.tagName.replace(/^w:/, '');
    const idx = order.indexOf(name);
    if (idx !== -1 && idx > newIndex) {
      refNode = node;
      break;
    }
  }
  parent.insertBefore(newEl, refNode);
}

function upsert(doc, parent, localName, attrs, order) {
  let el = firstChildNS(parent, localName);
  if (!el) {
    el = doc.createElementNS(W_NS, `w:${localName}`);
    insertInOrder(doc, parent, el, order);
  }
  for (const [attr, value] of Object.entries(attrs)) {
    el.setAttributeNS(W_NS, `w:${attr}`, String(value));
  }
  return el;
}

function applyRunPropertyOverrides(doc, rPr, style) {
  if (style.fontFamily) {
    upsert(doc, rPr, 'rFonts', { ascii: style.fontFamily, hAnsi: style.fontFamily, cs: style.fontFamily }, RPR_ORDER);
  }
  if (style.color) {
    const hex = normalizeColorHex(style.color);
    if (hex) upsert(doc, rPr, 'color', { val: hex }, RPR_ORDER);
  }
  if (style.fontSizePt) {
    const halfPoints = Math.round(style.fontSizePt * 2);
    upsert(doc, rPr, 'sz', { val: halfPoints }, RPR_ORDER);
    upsert(doc, rPr, 'szCs', { val: halfPoints }, RPR_ORDER);
  }
}

function applyParagraphPropertyOverrides(doc, pPr, style) {
  if (style.alignment) {
    const jc = normalizeAlignment(style.alignment);
    if (jc) upsert(doc, pPr, 'jc', { val: jc }, PPR_ORDER);
  }
  if (style.lineSpacing) {
    const line = Math.round(style.lineSpacing * 240);
    upsert(doc, pPr, 'spacing', { line, lineRule: 'auto' }, PPR_ORDER);
  }
}

function elementsByLocalName(doc, localName) {
  const out = [];
  const walk = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === 1) {
        if (child.localName === localName) out.push(child);
        walk(child);
      }
    }
  };
  walk(doc.documentElement);
  return out;
}

/** Sweeps every run (<w:r>) and paragraph (<w:p>) in a WordprocessingML part, applying overrides. */
function patchDocumentPart(xml, style) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  for (const run of elementsByLocalName(doc, 'r')) {
    let rPr = firstChildNS(run, 'rPr');
    if (!rPr) {
      rPr = doc.createElementNS(W_NS, 'w:rPr');
      run.insertBefore(rPr, run.firstChild);
    }
    applyRunPropertyOverrides(doc, rPr, style);
  }

  for (const para of elementsByLocalName(doc, 'p')) {
    let pPr = firstChildNS(para, 'pPr');
    if (!pPr) {
      pPr = doc.createElementNS(W_NS, 'w:pPr');
      para.insertBefore(pPr, para.firstChild);
    }
    applyParagraphPropertyOverrides(doc, pPr, style);
  }

  return new XMLSerializer().serializeToString(doc);
}

/** Upserts word/styles.xml's document-default run properties, covering any run with no explicit formatting. */
function patchStylesDefaults(xml, style) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const stylesRoot = doc.documentElement;

  let docDefaults = firstChildNS(stylesRoot, 'docDefaults');
  if (!docDefaults) {
    docDefaults = doc.createElementNS(W_NS, 'w:docDefaults');
    stylesRoot.insertBefore(docDefaults, stylesRoot.firstChild);
  }
  let rPrDefault = firstChildNS(docDefaults, 'rPrDefault');
  if (!rPrDefault) {
    rPrDefault = doc.createElementNS(W_NS, 'w:rPrDefault');
    docDefaults.appendChild(rPrDefault);
  }
  let rPr = firstChildNS(rPrDefault, 'rPr');
  if (!rPr) {
    rPr = doc.createElementNS(W_NS, 'w:rPr');
    rPrDefault.appendChild(rPr);
  }
  applyRunPropertyOverrides(doc, rPr, style);

  return new XMLSerializer().serializeToString(doc);
}

/**
 * Applies a global style override (font family/size/color/alignment/line
 * spacing) across a .docx's document defaults and every explicit run/
 * paragraph in the body, headers and footers. Returns the original buffer
 * unchanged (identity, no zip round-trip) when `style` has nothing set —
 * this is the concrete "default method when the user changes nothing" path.
 */
export async function applyStyleOverrides(docxBuffer, style) {
  if (!hasAnyOverride(style)) return docxBuffer;

  const zip = await JSZip.loadAsync(docxBuffer);

  const stylesPath = 'word/styles.xml';
  const stylesXml = await zip.file(stylesPath)?.async('string');
  if (stylesXml) {
    zip.file(stylesPath, patchStylesDefaults(stylesXml, style));
  }

  const targetPaths = Object.keys(zip.files).filter(
    (name) =>
      name === 'word/document.xml' ||
      /^word\/header\d*\.xml$/.test(name) ||
      /^word\/footer\d*\.xml$/.test(name)
  );

  for (const partPath of targetPaths) {
    const xml = await zip.file(partPath).async('string');
    zip.file(partPath, patchDocumentPart(xml, style));
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}
