#!/usr/bin/env node
// Standalone CLI for the fidelity check used automatically by /api/pdf-to-word.
// Usage: node server/scripts/compareFidelity.js <input.pdf> <output.docx>
import fs from 'node:fs/promises';
import { compareFidelity } from '../lib/fidelityCheck.js';

async function main() {
  const [pdfPath, docxPath] = process.argv.slice(2);
  if (!pdfPath || !docxPath) {
    console.error('Usage: node server/scripts/compareFidelity.js <input.pdf> <output.docx>');
    process.exit(1);
  }

  const [pdfBuffer, docxBuffer] = await Promise.all([fs.readFile(pdfPath), fs.readFile(docxPath)]);
  const report = await compareFidelity(pdfBuffer, docxBuffer);

  console.log(`PDF pages:            ${report.pdfPageCount}`);
  console.log(`PDF extractable words: ${report.pdfWordCount}`);
  console.log(`DOCX words:            ${report.docxWordCount}`);
  console.log(`Text coverage:         ${(report.coverage * 100).toFixed(1)}%`);
  if (report.topMissingWords.length > 0) {
    console.log(`Most-missing words:    ${report.topMissingWords.join(', ')}`);
  }
  console.log();
  console.log('Note: this only measures text that was genuinely extractable in the');
  console.log('source PDF. It cannot see text that was already a flattened image in');
  console.log('the PDF (an equation/table) — that\'s a separate concern handled by');
  console.log('the equation/table recovery feature, not this check.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
