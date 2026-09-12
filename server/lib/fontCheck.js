import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import { DOMParser } from '@xmldom/xmldom';

const execFileAsync = promisify(execFile);

let installedFontsCache = null;

async function loadInstalledFontsWindows() {
  try {
    const entries = await fs.readdir('C:\\Windows\\Fonts');
    return new Set(
      entries
        .filter((f) => /\.(ttf|otf|ttc)$/i.test(f))
        .map((f) => f.replace(/\.(ttf|otf|ttc)$/i, '').toLowerCase())
    );
  } catch {
    return new Set();
  }
}

async function loadInstalledFontsUnix() {
  try {
    const { stdout } = await execFileAsync('fc-list', [':', 'family']);
    const names = stdout
      .split('\n')
      .flatMap((line) => line.split(','))
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    return new Set(names);
  } catch {
    return new Set();
  }
}

/** Computed once per process and cached — call fontCheck.reset() in tests if fonts change mid-run. */
async function getInstalledFonts() {
  if (installedFontsCache) return installedFontsCache;
  installedFontsCache = os.platform() === 'win32' ? await loadInstalledFontsWindows() : await loadInstalledFontsUnix();
  return installedFontsCache;
}

/** Parses word/fontTable.xml (Word's own manifest of fonts the document declares) for font names. */
function extractDeclaredFonts(fontTableXml) {
  const doc = new DOMParser().parseFromString(fontTableXml, 'text/xml');
  const names = [];
  const fonts = doc.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'font'
  );
  for (let i = 0; i < fonts.length; i++) {
    const name = fonts[i].getAttributeNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'name'
    );
    if (name) names.push(name);
  }
  return names;
}

function isInstalled(fontName, installedSet) {
  const needle = fontName.toLowerCase();
  for (const installed of installedSet) {
    if (installed === needle || installed.startsWith(needle) || needle.startsWith(installed)) return true;
  }
  return false;
}

/**
 * Returns a list of font names referenced by the docx (plus an optional
 * requested style-override font) that aren't installed on this server.
 * Never throws — a missing font is a warning, not a conversion failure,
 * since LibreOffice will substitute a fallback and still produce a PDF.
 */
export async function checkMissingFonts(zip, requestedFontFamily) {
  const declared = new Set();

  const fontTableXml = await zip.file('word/fontTable.xml')?.async('string');
  if (fontTableXml) {
    try {
      for (const name of extractDeclaredFonts(fontTableXml)) declared.add(name);
    } catch {
      // fontTable.xml is optional/best-effort metadata; ignore parse failures
    }
  }
  if (requestedFontFamily) declared.add(requestedFontFamily);

  if (declared.size === 0) return [];

  const installed = await getInstalledFonts();
  if (installed.size === 0) return []; // couldn't determine installed fonts — don't false-positive warn

  return [...declared].filter((font) => !isInstalled(font, installed));
}
