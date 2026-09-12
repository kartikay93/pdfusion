import JSZip from 'jszip';
import { InvalidDocxError, InvalidPdfError, TooLargeError } from '../errors.js';
import { config } from '../config.js';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" — modern .docx (OOXML)
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .doc (OLE Compound File)

/**
 * Validates an uploaded Word document by sniffing its real file format
 * rather than trusting the client filename/extension:
 *  - modern .docx is a zip (OOXML) — validated by loading it and checking
 *    for the parts every .docx must have; returns the loaded zip so callers
 *    can apply style overrides / font checks against its XML.
 *  - legacy .doc is an OLE Compound File — LibreOffice converts this format
 *    natively, but its binary structure isn't something we parse or rewrite
 *    the way we do OOXML, so callers get `zip: null` and skip style
 *    overrides / font-table checks for this kind.
 * Throws InvalidDocxError / TooLargeError; never trusts the client filename.
 */
export async function validateWordUpload(buffer) {
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (buffer.length > maxBytes) throw new TooLargeError(config.maxUploadMb);

  if (buffer.length >= OLE_MAGIC.length && buffer.subarray(0, 8).equals(OLE_MAGIC)) {
    return { kind: 'doc', zip: null };
  }

  if (buffer.length >= ZIP_MAGIC.length && buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    let zip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new InvalidDocxError();
    }
    if (!zip.file('word/document.xml') || !zip.file('[Content_Types].xml')) {
      throw new InvalidDocxError('The uploaded file does not look like a Word (.docx) document.');
    }
    return { kind: 'docx', zip };
  }

  throw new InvalidDocxError('The uploaded file is not a valid Word document (.doc or .docx).');
}

/** Validates that `buffer` is plausibly a real PDF: header magic bytes present. */
export function validatePdfUpload(buffer) {
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (buffer.length > maxBytes) throw new TooLargeError(config.maxUploadMb);
  // The PDF header must appear within the first kilobyte (some producers
  // prepend a small amount of leading junk/whitespace before it).
  const head = buffer.subarray(0, 1024).toString('latin1');
  if (!head.includes('%PDF-')) {
    throw new InvalidPdfError();
  }
}
