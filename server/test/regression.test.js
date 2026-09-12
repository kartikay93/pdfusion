import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'regression.docx');
const LEGACY_FIXTURE = path.join(__dirname, 'fixtures', 'regression.doc');
const PDF_FIXTURE = path.join(__dirname, 'fixtures', 'regression.pdf');
const SCANNED_PDF_FIXTURE = path.join(__dirname, 'fixtures', 'scanned.pdf');
const PORT = 5175;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

before(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: 'pipe'
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start in time')), 15000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.on('error', reject);
  });
});

after(() => {
  serverProcess?.kill();
});

async function convert(style, fixturePath = FIXTURE, filename = 'regression.docx') {
  const buffer = await fs.readFile(fixturePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer]), filename);
  if (style) formData.append('style', JSON.stringify(style));
  const res = await fetch(`${BASE_URL}/api/docx-to-pdf`, { method: 'POST', body: formData });
  return res;
}

function parseWarningsHeader(res) {
  const raw = res.headers.get('x-conversion-warnings');
  return raw ? JSON.parse(decodeURIComponent(raw)) : [];
}

async function convertPdf(fixturePath, format) {
  const buffer = await fs.readFile(fixturePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer]), 'input.pdf');
  formData.append('format', format);
  return fetch(`${BASE_URL}/api/pdf-to-word`, { method: 'POST', body: formData });
}

async function extractText(pdfBytes) {
  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(' ') + '\n';
  }
  return text;
}

test('health check reports LibreOffice as detected', async () => {
  const res = await fetch(`${BASE_URL}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.libreoffice, 'detected');
});

test('rejects a non-docx upload', async () => {
  const formData = new FormData();
  formData.append('file', new Blob([Buffer.from('not a docx')]), 'fake.docx');
  const res = await fetch(`${BASE_URL}/api/docx-to-pdf`, { method: 'POST', body: formData });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'INVALID_DOCX');
});

test('converts the regression fixture with no style override (default path)', async () => {
  const res = await convert(null);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');

  const pdfBytes = new Uint8Array(await res.arrayBuffer());
  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 2, 'expected 2 pages: content page + page-break page');

  const text = await extractText(pdfBytes);
  assert.match(text, /Regression Test Document/);
  assert.match(text, /Header A/);
  assert.match(text, /Header B/);
  assert.match(text, /Second Page/);
  assert.match(text, /Final paragraph after the explicit page break/);
});

test('converts with a style override without corrupting structure', async () => {
  const res = await convert({ fontFamily: 'Arial', fontSizePt: 16, color: '#0000ff', alignment: 'center', lineSpacing: 1.5 });
  assert.equal(res.status, 200);

  const pdfBytes = new Uint8Array(await res.arrayBuffer());
  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 2, 'style override must not change page count for this fixture');

  const text = await extractText(pdfBytes);
  assert.match(text, /Regression Test Document/);
  assert.match(text, /Header A/);
  assert.match(text, /Row 1 B/);
  assert.match(text, /Second Page/);
});

test('converts a legacy .doc (OLE binary format) with no style override', async () => {
  const res = await convert(null, LEGACY_FIXTURE, 'regression.doc');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');

  const pdfBytes = new Uint8Array(await res.arrayBuffer());
  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 2);

  const text = await extractText(pdfBytes);
  assert.match(text, /Regression Test Document/);
  assert.match(text, /Second Page/);
});

test('a style override on a legacy .doc converts anyway and warns instead of failing', async () => {
  const res = await convert({ fontFamily: 'Arial', color: '#ff0000' }, LEGACY_FIXTURE, 'regression.doc');
  assert.equal(res.status, 200, 'must still convert, not fail, when style overrides do not apply to .doc');

  const warnings = parseWarningsHeader(res);
  assert.ok(
    warnings.some((w) => w.code === 'STYLE_NOT_SUPPORTED'),
    'expected a STYLE_NOT_SUPPORTED warning for a .doc file'
  );

  const pdfBytes = new Uint8Array(await res.arrayBuffer());
  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 2);
});

test('converts a normal text-based PDF to .docx with real extracted text', async () => {
  const res = await convertPdf(PDF_FIXTURE, 'docx');
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  const buffer = Buffer.from(await res.arrayBuffer());
  const { value: text } = await mammoth.extractRawText({ buffer });
  assert.match(text, /Regression Test Document/);
  assert.match(text, /Header A/);
  assert.match(text, /Row 1 B/);
  assert.match(text, /Second Page/);
  assert.match(text, /Final paragraph after the explicit page break/);
});

test('converts a normal text-based PDF to legacy .doc', async () => {
  const res = await convertPdf(PDF_FIXTURE, 'doc');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/msword');
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.ok(buffer.length > 0);
});

test('OCRs a scanned (image-only) page and appends recovered text to .docx output', async () => {
  const res = await convertPdf(SCANNED_PDF_FIXTURE, 'docx');
  assert.equal(res.status, 200);

  const buffer = Buffer.from(await res.arrayBuffer());
  const { value: text } = await mammoth.extractRawText({ buffer });

  // Page 2 has a real text layer — LibreOffice extracts it directly, no OCR needed.
  assert.match(text, /page 2 with real, selectable PDF text/);

  // Page 1 is image-only — OCR must have recovered its text and appended it,
  // clearly labeled, rather than silently dropping it.
  assert.match(text, /Recovered text from scanned pages \(OCR\)/);
  assert.match(text, /Page 1:/);
  assert.match(text, /SCANNED PAGE TEST/i);
  assert.match(text, /OCR should recover this sentence correctly/i);
}, { timeout: 60000 });

test('OCR-recovered text on a scanned PDF converted to .doc produces a warning instead of silent loss', async () => {
  const res = await convertPdf(SCANNED_PDF_FIXTURE, 'doc');
  assert.equal(res.status, 200, 'must still convert successfully');

  const warnings = parseWarningsHeader(res);
  assert.ok(
    warnings.some((w) => w.code === 'OCR_NOT_APPENDED'),
    'expected an OCR_NOT_APPENDED warning since OCR text cannot be inserted into legacy .doc output'
  );
}, { timeout: 60000 });

test('rejects a non-PDF upload to pdf-to-word', async () => {
  const formData = new FormData();
  formData.append('file', new Blob([Buffer.from('not a pdf')]), 'fake.pdf');
  formData.append('format', 'docx');
  const res = await fetch(`${BASE_URL}/api/pdf-to-word`, { method: 'POST', body: formData });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'INVALID_PDF');
});
