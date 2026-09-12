import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { withTempWorkspace } from '../lib/tempWorkspace.js';
import { validatePdfUpload } from '../lib/validateUpload.js';
import { convertFile, isLibreOfficeAvailable } from '../lib/libreoffice.js';
import { findLowTextPages, ocrPages, getPdfPageCount } from '../lib/pdfOcr.js';
import { appendOcrSection } from '../lib/appendOcrText.js';
import { recoverEquations } from '../lib/equationRecovery.js';
import { recoverContentWithGemini } from '../lib/contentRecovery.js';
import { isGeminiAvailable } from '../lib/geminiContentRecovery.js';
import { compareFidelity } from '../lib/fidelityCheck.js';
import { AppError, InvalidPdfError, ServerMisconfiguredError } from '../errors.js';

const FIDELITY_WARNING_THRESHOLD = 0.85;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 }
});

const router = Router();

const MIME_BY_FORMAT = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword'
};

router.post('/pdf-to-word', upload.single('file'), async (req, res, next) => {
  try {
    if (!(await isLibreOfficeAvailable())) {
      throw new ServerMisconfiguredError();
    }
    if (!req.file) {
      throw new InvalidPdfError('No file was uploaded.');
    }

    const format = req.body?.format === 'doc' ? 'doc' : 'docx';
    validatePdfUpload(req.file.buffer);

    const warnings = [];
    let ocrResults = [];

    // OCR is best-effort recovery for scanned/image-only pages — a failure
    // here must never fail the overall conversion, which LibreOffice can
    // still do perfectly well for the document's real text/images/tables.
    try {
      const lowTextPages = await findLowTextPages(req.file.buffer);
      if (lowTextPages.length > 0) {
        const pagesToOcr = lowTextPages.slice(0, config.ocrMaxPages);
        ocrResults = await ocrPages(req.file.buffer, pagesToOcr);

        if (lowTextPages.length > pagesToOcr.length) {
          warnings.push({
            code: 'OCR_PAGE_LIMIT',
            message: `Only the first ${config.ocrMaxPages} scanned pages were OCR'd — ${lowTextPages.length - pagesToOcr.length} more were skipped.`
          });
        }
        const recovered = new Set(ocrResults.map((r) => r.pageIndex));
        const unreadable = pagesToOcr.filter((idx) => !recovered.has(idx));
        if (unreadable.length > 0) {
          warnings.push({
            code: 'OCR_NO_TEXT_FOUND',
            message: `OCR couldn't recover readable text from ${unreadable.length} scanned page(s): page ${unreadable.map((i) => i + 1).join(', ')}.`
          });
        }
      }
    } catch (err) {
      console.error('[ocr] failed', err);
      warnings.push({
        code: 'OCR_FAILED',
        message: "Automatic text recovery for scanned pages failed — the document was converted without it."
      });
    }

    // LibreOffice's PDF-import reconstruction (floating text boxes per
    // line) gets noticeably slower per page than a flat conversion, so a
    // fixed timeout that's fine for a few-page PDF cuts off a long
    // document (e.g. a full book) well before it finishes. Scale the
    // timeout by page count instead of using one fixed cap for every size
    // of input; falls back to the flat default if page count can't be read.
    let conversionTimeoutMs = config.conversionTimeoutMs;
    try {
      const pageCount = await getPdfPageCount(req.file.buffer);
      conversionTimeoutMs = Math.min(
        config.conversionTimeoutMaxMs,
        Math.max(config.conversionTimeoutMs, pageCount * config.conversionTimeoutPerPageMs)
      );
    } catch (err) {
      console.error('[pdfToWord] page count lookup failed, using default timeout', err);
    }

    const outputBuffer = await withTempWorkspace(async ({ inputDir, outputDir, profileDir }) => {
      const inputPath = path.join(inputDir, `${crypto.randomUUID()}.pdf`);
      await fs.writeFile(inputPath, req.file.buffer);
      const outputPath = await convertFile(inputPath, outputDir, profileDir, format, {
        inFilter: 'writer_pdf_import',
        timeoutMs: conversionTimeoutMs
      });
      return fs.readFile(outputPath);
    });

    let finalBuffer = outputBuffer;
    if (ocrResults.length > 0) {
      if (format === 'docx') {
        finalBuffer = await appendOcrSection(outputBuffer, ocrResults);
      } else {
        warnings.push({
          code: 'OCR_NOT_APPENDED',
          message: "OCR-recovered text from scanned pages can only be appended to .docx output — convert to .docx to include it."
        });
      }
    }

    // Content recovery (flattened equation/table images -> real editable
    // Word content) only makes sense for .docx output, same reasoning as
    // the OCR-append block above — OOXML editing doesn't apply to legacy
    // .doc. A failure here must never fail the overall conversion. When a
    // Gemini API key is configured, the broader Gemini-classified path
    // handles both equations AND tables (classification of "equation vs
    // table vs a real photo to leave alone" done by Gemini itself, more
    // robust than a pixel heuristic); otherwise this falls back to the
    // narrower local-only (pix2tex, equations-only) path.
    if (format === 'docx') {
      try {
        const { buffer, warnings: contentWarnings } = isGeminiAvailable()
          ? await recoverContentWithGemini(finalBuffer)
          : await recoverEquations(finalBuffer);
        finalBuffer = buffer;
        warnings.push(...contentWarnings);
      } catch (err) {
        console.error('[contentRecovery] failed', err);
        warnings.push({
          code: 'EQUATION_RECOVERY_FAILED',
          message: 'Automatic equation/table recovery failed — they were left as images.'
        });
      }
    }

    // Best-effort fidelity check: how much of the source PDF's own
    // extractable text made it into the converted docx? Only meaningful
    // for .docx (mammoth can't read legacy .doc), and only catches text
    // that was genuinely extractable in the PDF but went missing — not
    // pre-existing image-only content (equations/tables), which the
    // recovery step above already handles separately. Never fails the
    // request; a check failure is silently skipped, not surfaced as loss.
    if (format === 'docx') {
      try {
        const report = await compareFidelity(req.file.buffer, finalBuffer);
        if (report.coverage < FIDELITY_WARNING_THRESHOLD) {
          warnings.push({
            code: 'FIDELITY_CHECK_LOW',
            message: `Only about ${Math.round(report.coverage * 100)}% of the original PDF's extractable text was found in the converted document — some content may be missing. (This check can't see text that was already an image in the PDF, like a flattened equation or table — that's handled by the recovery warnings above, not this one.)`
          });
        }
      } catch (err) {
        console.error('[fidelityCheck] failed', err);
      }
    }

    if (warnings.length > 0) {
      res.setHeader('X-Conversion-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    }
    res.setHeader('Content-Type', MIME_BY_FORMAT[format]);
    res.send(finalBuffer);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('TOO_LARGE', `File exceeds the ${config.maxUploadMb}MB upload limit.`, 413));
    }
    next(err);
  }
});

export default router;
