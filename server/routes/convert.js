import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { withTempWorkspace } from '../lib/tempWorkspace.js';
import { validateWordUpload } from '../lib/validateUpload.js';
import { applyStyleOverrides, hasAnyOverride } from '../lib/docxStyleOverride.js';
import { convertDocxToPdf, isLibreOfficeAvailable } from '../lib/libreoffice.js';
import { checkMissingFonts } from '../lib/fontCheck.js';
import { AppError, InvalidDocxError, ServerMisconfiguredError } from '../errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 }
});

const router = Router();

function parseStyle(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { fontFamily = null, fontSizePt = null, color = null, alignment = null, lineSpacing = null } = parsed;
    return { fontFamily, fontSizePt, color, alignment, lineSpacing };
  } catch {
    return null;
  }
}

router.get('/health', async (_req, res) => {
  res.json({ ok: true, libreoffice: (await isLibreOfficeAvailable()) ? 'detected' : 'missing' });
});

router.post('/docx-to-pdf', upload.single('file'), async (req, res, next) => {
  try {
    if (!(await isLibreOfficeAvailable())) {
      throw new ServerMisconfiguredError();
    }
    if (!req.file) {
      throw new InvalidDocxError('No file was uploaded.');
    }

    const style = parseStyle(req.body?.style);
    const { kind, zip } = await validateWordUpload(req.file.buffer);

    // Style overrides and the font-table check both work by rewriting/
    // reading OOXML parts inside the .docx zip — neither is possible for
    // legacy .doc (a binary OLE Compound File), so a .doc is converted as-is
    // and, if the caller asked for a style override anyway, a warning is
    // surfaced instead of silently ignoring the request.
    const warnings = [];
    let finalBuffer = req.file.buffer;

    if (kind === 'docx') {
      finalBuffer = await applyStyleOverrides(req.file.buffer, style);
      const missingFonts = await checkMissingFonts(zip, style?.fontFamily).catch(() => []);
      warnings.push(...missingFonts.map((font) => ({ code: 'FONT_MISSING', font })));
    } else if (hasAnyOverride(style)) {
      warnings.push({
        code: 'STYLE_NOT_SUPPORTED',
        message: 'Style customization only works on .docx files — this .doc file was converted with its original formatting.'
      });
    }

    const pdfBuffer = await withTempWorkspace(async ({ inputDir, outputDir, profileDir }) => {
      const ext = kind === 'doc' ? '.doc' : '.docx';
      const inputPath = path.join(inputDir, `${crypto.randomUUID()}${ext}`);
      await fs.writeFile(inputPath, finalBuffer);
      const outputPath = await convertDocxToPdf(inputPath, outputDir, profileDir);
      return fs.readFile(outputPath);
    });

    if (warnings.length > 0) {
      // HTTP header values are constrained to a Latin-1-ish byte range, so
      // arbitrary warning text (em dashes, non-Latin font names, etc.) is
      // percent-encoded here and decoded again in serverEngine.js.
      res.setHeader('X-Conversion-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('TOO_LARGE', `File exceeds the ${config.maxUploadMb}MB upload limit.`, 413));
    }
    next(err);
  }
});

export default router;
