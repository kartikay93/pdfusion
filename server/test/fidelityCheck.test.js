import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFidelity } from '../lib/fidelityCheck.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_FIXTURE = path.join(__dirname, 'fixtures', 'rasterized-table.pdf');
const INTACT_DOCX = path.join(__dirname, 'fixtures', 'rasterized-table-out.docx');
const TRUNCATED_DOCX = path.join(__dirname, 'fixtures', 'truncated-table.docx');

test('reports full coverage for an intact conversion', async () => {
  const [pdf, docx] = await Promise.all([fs.readFile(PDF_FIXTURE), fs.readFile(INTACT_DOCX)]);
  const report = await compareFidelity(pdf, docx);
  assert.equal(report.coverage, 1);
});

test('detects real missing text — not masked by mc:Fallback double-counting', async () => {
  // Regression test for a real bug: LibreOffice's docx output wraps every
  // shape in <mc:AlternateContent><mc:Choice>...</mc:Choice>
  // <mc:Fallback>...(the SAME text again, for legacy Word)...</mc:Fallback>
  // </mc:AlternateContent>. A naive text extractor (including mammoth,
  // which has no special handling for mc:AlternateContent) reads BOTH
  // copies, so removing text from just one still leaves the fixture's
  // fallback duplicate intact — coverage reported 100% even with a
  // paragraph deliberately deleted, until the extractor was fixed to skip
  // mc:Fallback subtrees entirely.
  const [pdf, docx] = await Promise.all([fs.readFile(PDF_FIXTURE), fs.readFile(TRUNCATED_DOCX)]);
  const report = await compareFidelity(pdf, docx);
  assert.ok(report.coverage < 1, `expected coverage below 100% for a docx with deleted text, got ${report.coverage}`);
  assert.ok(report.topMissingWords.includes('paragraph') || report.topMissingWords.includes('table'));
});
