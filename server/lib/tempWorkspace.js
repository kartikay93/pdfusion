import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Creates an isolated temp directory (input/output/profile subdirs) for one
 * conversion request, runs `fn`, and always removes the directory afterward
 * regardless of success or failure.
 */
export async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `pdfusion-${crypto.randomUUID()}-`));
  const dirs = {
    root,
    inputDir: path.join(root, 'input'),
    outputDir: path.join(root, 'output'),
    profileDir: path.join(root, 'profile')
  };
  try {
    await Promise.all([
      fs.mkdir(dirs.inputDir, { recursive: true }),
      fs.mkdir(dirs.outputDir, { recursive: true }),
      fs.mkdir(dirs.profileDir, { recursive: true })
    ]);
    return await fn(dirs);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
