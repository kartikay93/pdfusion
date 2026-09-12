import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/* ---------- Images -> PDF ---------- */

async function fileToImageBitmap(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
  });
  URL.revokeObjectURL(url);
  return img;
}

function applyBlackAndWhite(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const gray = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    px[i] = px[i + 1] = px[i + 2] = gray;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * Converts a list of image files into a single PDF, one image per page.
 * @param {File[]} imageFiles
 * @param {{ blackAndWhite?: boolean, margin?: number }} options
 */
export async function imagesToPdf(imageFiles, options = {}) {
  const { blackAndWhite = false, margin = 24 } = options;
  const pdfDoc = await PDFDocument.create();

  for (const file of imageFiles) {
    const img = await fileToImageBitmap(file);
    let bytes;
    let embed;

    if (blackAndWhite) {
      const canvas = applyBlackAndWhite(img);
      const dataUrl = canvas.toDataURL('image/png');
      bytes = await (await fetch(dataUrl)).arrayBuffer();
      embed = await pdfDoc.embedPng(bytes);
    } else if (/png/i.test(file.type)) {
      bytes = await file.arrayBuffer();
      embed = await pdfDoc.embedPng(bytes);
    } else {
      bytes = await file.arrayBuffer();
      embed = await pdfDoc.embedJpg(bytes).catch(async () => {
        // fallback: draw to canvas and re-encode as jpeg for formats pdf-lib can't embed directly
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const jpegUrl = canvas.toDataURL('image/jpeg', 0.92);
        const jpegBytes = await (await fetch(jpegUrl)).arrayBuffer();
        return pdfDoc.embedJpg(jpegBytes);
      });
    }

    const pageW = embed.width + margin * 2;
    const pageH = embed.height + margin * 2;
    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(embed, { x: margin, y: margin, width: embed.width, height: embed.height });
  }

  return pdfDoc.save();
}

/* ---------- Merge PDFs ---------- */

/**
 * Merges multiple PDFs (ArrayBuffers, in order) into one.
 */
export async function mergePdfs(pdfBuffers) {
  const merged = await PDFDocument.create();
  for (const buf of pdfBuffers) {
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

/* ---------- Page thumbnails (for drag/reorder editor) ---------- */

/**
 * Renders every page of a PDF to a thumbnail data URL using pdf.js.
 * Returns [{ pageIndex, dataUrl, width, height }]
 */
export async function renderPdfThumbnails(pdfBytes, scale = 0.35) {
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
  const doc = await loadingTask.promise;
  const thumbs = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    thumbs.push({
      pageIndex: i - 1,
      dataUrl: canvas.toDataURL('image/png'),
      width: viewport.width,
      height: viewport.height
    });
  }
  return thumbs;
}

/* ---------- Reorder / delete / rotate pages ---------- */

/**
 * Rebuilds a PDF given a new page order (array of original 0-based indices).
 * Indices omitted from `order` are dropped from the output.
 */
export async function reorderPdfPages(pdfBytes, order, rotations = {}) {
  const src = await PDFDocument.load(pdfBytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order);
  copied.forEach((page, i) => {
    const originalIndex = order[i];
    if (rotations[originalIndex]) {
      page.setRotation(degrees(rotations[originalIndex]));
    }
    out.addPage(page);
  });
  return out.save();
}

/* ---------- DOCX -> PDF ---------- */

/**
 * Converts a .docx file to PDF by rendering its HTML into an off-screen
 * element and rasterizing it page-by-page. Preserves headings, paragraphs,
 * lists, bold/italic and basic layout — not pixel-perfect Word fidelity,
 * but very close for standard documents.
 *
 * Page breaks are chosen so they never cut through a paragraph, heading,
 * list item, table row or image — the break is nudged up to the top of
 * whichever block element it would otherwise slice through.
 */
export async function docxToPdf(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px'; // ~A4 at 96dpi
  container.style.padding = '48px';
  container.style.boxSizing = 'border-box';
  container.style.background = '#ffffff';
  container.style.fontFamily = 'Georgia, serif';
  container.style.fontSize = '15px';
  container.style.lineHeight = '1.6';
  container.style.color = '#1a1a1a';

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; }
    p, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, table { margin: 0 0 12px 0; }
    li { margin-bottom: 4px; }
    img { display: block; max-width: 100%; height: auto; margin: 12px 0; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 4px 8px; }
  `;
  container.appendChild(style);

  const content = document.createElement('div');
  content.innerHTML = html;
  container.appendChild(content);
  document.body.appendChild(container);

  onProgress?.('Rendering document…');
  const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });

  // Collect the pixel ranges (in canvas coordinates) of everything that
  // must not be split across a page break.
  const scale = canvas.width / container.offsetWidth;
  const containerTop = container.getBoundingClientRect().top;
  const unsafeRanges = [];
  content.querySelectorAll('p, li, img, h1, h2, h3, h4, h5, h6, tr, blockquote, pre').forEach((el) => {
    const rect = el.getBoundingClientRect();
    // Pad slightly: canvas text rendering (descenders, anti-aliasing) can
    // extend a couple of pixels past the DOM bounding box, so an unpadded
    // range can still let a cut clip the last sliver of a line's pixels.
    const pad = 4 * scale;
    const top = (rect.top - containerTop) * scale - pad;
    const bottom = (rect.bottom - containerTop) * scale + pad;
    if (bottom > top) unsafeRanges.push([top, bottom]);
  });

  document.body.removeChild(container);

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const pxToPt = pageW / canvas.width;
  const pageHeightPx = pageH / pxToPt;

  // Nudge a candidate cut line up to the top of any unsafe element it
  // currently falls inside of (picking the outermost such element).
  const adjustCut = (y) => {
    let best = y;
    for (const [top, bottom] of unsafeRanges) {
      if (y > top && y < bottom && top < best) best = top;
    }
    return best;
  };

  let cursor = 0;
  let first = true;
  const totalH = canvas.height;

  while (cursor < totalH) {
    let cut = Math.min(cursor + pageHeightPx, totalH);
    if (cut < totalH) {
      const adjusted = adjustCut(cut);
      // Only honor the adjustment if it makes real progress — otherwise
      // the element itself is taller than a page and must be hard-split.
      if (adjusted > cursor + 8) cut = adjusted;
    }

    const sliceH = cut - cursor;
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceH;
    pageCanvas.getContext('2d').drawImage(canvas, 0, cursor, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

    const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
    const imgHpt = sliceH * pxToPt;

    if (!first) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, 0, pageW, imgHpt);
    first = false;

    cursor = cut;
  }

  return pdf.output('arraybuffer');
}
