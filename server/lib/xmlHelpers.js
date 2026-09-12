// Shared OOXML namespace URIs and small DOM-walk helpers, used by every
// module that reads/edits a .docx's word/document.xml (docxStyleOverride.js
// and appendOcrText.js each still keep their own small local copy of
// firstChildNS — this shared module is for new code only, to avoid a 4th
// copy-paste of the same helper).

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** First direct child of `el` matching `localName`, regardless of namespace prefix. */
export function firstChildNS(el, localName) {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 1 && node.localName === localName) return node;
  }
  return null;
}

/** All direct children of `el` matching `localName`. */
export function childrenNS(el, localName) {
  const out = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === 1 && node.localName === localName) out.push(node);
  }
  return out;
}

/** Every descendant of `root` (depth-first) matching `localName`. */
export function elementsByLocalName(root, localName) {
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
  walk(root);
  return out;
}

/** First descendant of `root` (depth-first) matching `localName`, or null. */
export function firstDescendantByLocalName(root, localName) {
  if (root.childNodes) {
    for (let i = 0; i < root.childNodes.length; i++) {
      const child = root.childNodes[i];
      if (child.nodeType === 1) {
        if (child.localName === localName) return child;
        const found = firstDescendantByLocalName(child, localName);
        if (found) return found;
      }
    }
  }
  return null;
}

/** Concatenated text content of every <w:t> descendant of `el`. */
export function textContent(el) {
  return elementsByLocalName(el, 't')
    .map((t) => t.textContent || '')
    .join('');
}
