import { W_NS } from './xmlHelpers.js';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const TOTAL_TABLE_WIDTH_DXA = 9350; // ~6.5in of usable width at 1440 dxa/inch

function setAttr(el, name, value) {
  el.setAttributeNS(W_NS, `w:${name}`, String(value));
}

function buildBorders(doc) {
  const borders = doc.createElementNS(W_NS, 'w:tblBorders');
  for (const edge of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    const b = doc.createElementNS(W_NS, `w:${edge}`);
    setAttr(b, 'val', 'single');
    setAttr(b, 'sz', '4');
    setAttr(b, 'space', '0');
    setAttr(b, 'color', 'auto');
    borders.appendChild(b);
  }
  return borders;
}

function buildCell(doc, text, colWidthDxa) {
  const tc = doc.createElementNS(W_NS, 'w:tc');
  const tcPr = doc.createElementNS(W_NS, 'w:tcPr');
  const tcW = doc.createElementNS(W_NS, 'w:tcW');
  setAttr(tcW, 'w', Math.round(colWidthDxa));
  setAttr(tcW, 'type', 'dxa');
  tcPr.appendChild(tcW);
  tc.appendChild(tcPr);

  const p = doc.createElementNS(W_NS, 'w:p');
  const r = doc.createElementNS(W_NS, 'w:r');
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text ?? ''));
  r.appendChild(t);
  p.appendChild(r);
  tc.appendChild(p);
  return tc;
}

/**
 * Builds a real OOXML <w:tbl> element (in the given Document, ready to
 * splice into word/document.xml) from a plain rows-of-strings 2D array —
 * the shape Gemini's structured table extraction returns. Column widths
 * are split evenly across a fixed usable-page-width budget; this won't
 * match the original PDF table's exact column proportions, but produces a
 * genuinely valid, readable, editable Word table rather than an image.
 */
export function buildTableXml(doc, rows) {
  const numCols = Math.max(1, ...rows.map((r) => r.length));
  const colWidthDxa = TOTAL_TABLE_WIDTH_DXA / numCols;

  const tbl = doc.createElementNS(W_NS, 'w:tbl');

  const tblPr = doc.createElementNS(W_NS, 'w:tblPr');
  const tblW = doc.createElementNS(W_NS, 'w:tblW');
  setAttr(tblW, 'w', TOTAL_TABLE_WIDTH_DXA);
  setAttr(tblW, 'type', 'dxa');
  tblPr.appendChild(tblW);
  tblPr.appendChild(buildBorders(doc));
  tbl.appendChild(tblPr);

  const tblGrid = doc.createElementNS(W_NS, 'w:tblGrid');
  for (let c = 0; c < numCols; c++) {
    const gridCol = doc.createElementNS(W_NS, 'w:gridCol');
    setAttr(gridCol, 'w', Math.round(colWidthDxa));
    tblGrid.appendChild(gridCol);
  }
  tbl.appendChild(tblGrid);

  rows.forEach((row, rowIndex) => {
    const tr = doc.createElementNS(W_NS, 'w:tr');
    if (rowIndex === 0) {
      // Mark the first row as a repeating header row — a reasonable
      // default for extracted tables, and harmless if the source table
      // didn't actually have one distinct header style.
      const trPr = doc.createElementNS(W_NS, 'w:trPr');
      trPr.appendChild(doc.createElementNS(W_NS, 'w:tblHeader'));
      tr.appendChild(trPr);
    }
    for (let c = 0; c < numCols; c++) {
      tr.appendChild(buildCell(doc, row[c], colWidthDxa));
    }
    tbl.appendChild(tr);
  });

  return tbl;
}
