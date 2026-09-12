/**
 * Client for the server-side DOCX -> PDF conversion endpoint (LibreOffice
 * headless under the hood). Kept separate from pdfEngine.js, which is
 * pure-browser/no-network and relied on as such by every other tool.
 */

export class ServerConversionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function parseErrorResponse(res) {
  try {
    const body = await res.json();
    if (body?.error?.code) return new ServerConversionError(body.error.code, body.error.message);
  } catch {
    // fall through to generic error below
  }
  return new ServerConversionError('UNKNOWN', `Conversion failed (HTTP ${res.status}).`);
}

function parseWarnings(res) {
  const raw = res.headers.get('X-Conversion-Warnings');
  if (!raw) return [];
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return [];
  }
}

/**
 * Uploads a .docx (plus an optional style override) to the backend and
 * returns the converted PDF as an ArrayBuffer. `style` fields left null/
 * unset mean "no override" — the server converts the document unchanged.
 */
export async function convertDocxOnServer(file, style, onProgress) {
  onProgress?.('Uploading…');

  const formData = new FormData();
  formData.append('file', file);
  if (style && Object.values(style).some((v) => v !== null && v !== undefined && v !== '')) {
    formData.append('style', JSON.stringify(style));
  }

  const res = await fetch('/api/docx-to-pdf', { method: 'POST', body: formData });

  if (!res.ok) throw await parseErrorResponse(res);

  onProgress?.('Rendering…');
  const warnings = parseWarnings(res);
  const bytes = await res.arrayBuffer();
  return { bytes, warnings };
}

/**
 * Uploads a .pdf to the backend and returns the converted Word document
 * (.docx or .doc, per `format`) as an ArrayBuffer. Pages with little/no
 * extractable text (likely scanned) are OCR'd server-side and, for .docx
 * output, their recovered text is appended in a clearly-labeled section.
 */
export async function convertPdfToWordOnServer(file, format, onProgress) {
  onProgress?.('Uploading…');

  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);

  const res = await fetch('/api/pdf-to-word', { method: 'POST', body: formData });

  if (!res.ok) throw await parseErrorResponse(res);

  onProgress?.('Converting…');
  const warnings = parseWarnings(res);
  const bytes = await res.arrayBuffer();
  return { bytes, warnings };
}

export async function checkServerAvailable() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return false;
    const body = await res.json();
    return body.libreoffice === 'detected';
  } catch {
    return false;
  }
}
