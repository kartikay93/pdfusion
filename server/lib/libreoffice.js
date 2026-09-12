import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { ConversionFailedError, ServerMisconfiguredError, TimeoutError } from '../errors.js';

let resolvedPath = null;
let resolvedPathChecked = false;

const CANDIDATE_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice'
];

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the soffice binary: LIBREOFFICE_PATH env var first, then a short
 * list of common install locations. Cached after the first successful (or
 * exhausted) lookup for the life of the process.
 */
export async function resolveLibreOfficePath() {
  if (resolvedPathChecked) return resolvedPath;
  resolvedPathChecked = true;

  if (config.libreOfficePath) {
    if (await fileExists(config.libreOfficePath)) {
      resolvedPath = config.libreOfficePath;
      return resolvedPath;
    }
    console.error(`[libreoffice] LIBREOFFICE_PATH is set to "${config.libreOfficePath}" but that file does not exist.`);
    return null;
  }

  for (const candidate of CANDIDATE_PATHS) {
    if (await fileExists(candidate)) {
      resolvedPath = candidate;
      return resolvedPath;
    }
  }
  return null;
}

/** Bounded in-process concurrency queue — LibreOffice headless is heavy per-process. */
class ConcurrencyQueue {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.pending = [];
  }

  async run(fn) {
    if (this.active >= this.limit) {
      await new Promise((resolve) => this.pending.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.pending.shift();
      if (next) next();
    }
  }
}

const queue = new ConcurrencyQueue(config.conversionConcurrency);

function runSoffice(binPath, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });

    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') timedOut = true;
      resolve({ code, timedOut, stdout, stderr });
    });
  });
}

/**
 * Converts a file on disk (`inputPath`) to `targetFormat` (e.g. 'pdf',
 * 'docx', 'doc') inside `outputDir`, using a fresh isolated LibreOffice
 * profile in `profileDir` so concurrent conversions don't collide on
 * LibreOffice's single-profile lock. Returns the path to the output file.
 *
 * `inFilter`, when given, forces which LibreOffice component/filter opens
 * the input — needed for PDF input specifically: LibreOffice's PDF import
 * defaults to opening it in Draw (as a flat graphics document), which has
 * no docx/doc export filter at all ("no export filter ... found, aborting").
 * Passing 'writer_pdf_import' forces the Writer PDF-import filter instead,
 * which reconstructs editable text/paragraphs/images and makes a Word
 * export possible.
 */
export async function convertFile(inputPath, outputDir, profileDir, targetFormat, { inFilter, timeoutMs } = {}) {
  const binPath = await resolveLibreOfficePath();
  if (!binPath) {
    throw new ServerMisconfiguredError(
      'LibreOffice was not found on the server. Set LIBREOFFICE_PATH or install LibreOffice.'
    );
  }

  const profileUrl = `file:///${profileDir.replace(/\\/g, '/')}`;
  const args = [
    '--headless',
    '--norestore',
    ...(inFilter ? [`--infilter=${inFilter}`] : []),
    '--convert-to', targetFormat,
    '--outdir', outputDir,
    inputPath,
    `-env:UserInstallation=${profileUrl}`
  ];

  const result = await queue.run(() => runSoffice(binPath, args, timeoutMs ?? config.conversionTimeoutMs));

  if (result.timedOut) {
    throw new TimeoutError();
  }
  if (result.code !== 0) {
    console.error('[libreoffice] non-zero exit', result.code, result.stderr || result.stdout);
    throw new ConversionFailedError();
  }

  const expectedName = path.basename(inputPath, path.extname(inputPath)) + '.' + targetFormat;
  const outputPath = path.join(outputDir, expectedName);
  if (!(await fileExists(outputPath))) {
    console.error('[libreoffice] exit 0 but no output file found', result.stdout, result.stderr);
    throw new ConversionFailedError();
  }

  return outputPath;
}

/** Convenience wrapper — kept so existing DOCX/DOC -> PDF call sites read clearly. */
export async function convertDocxToPdf(inputPath, outputDir, profileDir) {
  return convertFile(inputPath, outputDir, profileDir, 'pdf');
}

export async function isLibreOfficeAvailable() {
  return (await resolveLibreOfficePath()) !== null;
}
