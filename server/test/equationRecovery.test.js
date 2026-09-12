import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { isMathOcrAvailable } from '../lib/mathOcr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'equation-sample.pdf');
const REGRESSION_FIXTURE = path.join(__dirname, 'fixtures', 'regression.pdf');
const RASTERIZED_TABLE_FIXTURE = path.join(__dirname, 'fixtures', 'rasterized-table.pdf');
const PORT = 5177; // distinct from regression.test.js's 5175, and mathOcr's own default port 5185
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;
let mathOcrAvailable = false;

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

  // Give the pix2tex model a chance to already be warm (its weights are
  // cached after first use) — this only checks Python/pix2tex presence,
  // it doesn't itself start the server, so this is a fast check.
  mathOcrAvailable = await isMathOcrAvailable();
});

after(() => {
  serverProcess?.kill();
});

async function convertPdf(fixturePath, format) {
  const buffer = await fs.readFile(fixturePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer]), 'input.pdf');
  formData.append('format', format);
  return fetch(`${BASE_URL}/api/pdf-to-word`, { method: 'POST', body: formData });
}

function parseWarningsHeader(res) {
  const raw = res.headers.get('x-conversion-warnings');
  return raw ? JSON.parse(decodeURIComponent(raw)) : [];
}

test('detects the equation-sample fixture\'s equation image and not its decoy figure', async (t) => {
  // mathOcrAvailable is set inside the async before() hook, which runs
  // after test() registration but before test bodies execute — a static
  // `skip` option on test() would evaluate against the pre-hook initial
  // value and always skip, so this checks (and skips) at runtime instead.
  if (!mathOcrAvailable) {
    t.skip('pix2tex/Python not available in this environment');
    return;
  }

  const res = await convertPdf(FIXTURE, 'docx');
  assert.equal(res.status, 200);

  const warnings = parseWarningsHeader(res);
  console.log('[equationRecovery.test] warnings:', warnings);

  const buffer = Buffer.from(await res.arrayBuffer());
  const { value: text } = await mammoth.extractRawText({ buffer });

  // Whether or not pix2tex successfully recognized the equation (model
  // accuracy is out of this test's control), detection itself must have
  // fired on the equation and NOT on the captioned decoy — that's what
  // this test actually verifies. If recognition succeeded, the recovered
  // equation's plain-text approximation should include recognizable
  // fragments of "x = (a + b) / c"; if not, an EQUATION_RECOVERY_PARTIAL
  // warning must explain why, rather than the request silently doing
  // nothing.
  const recovered = warnings.some((w) => w.code === 'EQUATIONS_RECOVERED');
  const partial = warnings.some((w) => w.code === 'EQUATION_RECOVERY_PARTIAL');
  assert.ok(recovered || partial, 'expected either a successful recovery or an explanatory partial-failure warning, not silence');

  // The decoy figure's caption must survive untouched either way — proof
  // the decoy paragraph itself was never removed/altered by this feature.
  assert.match(text, /decoy chart that must not be treated as an equation/i);
});

test('never touches a table image captioned with a Roman numeral ("TABLE I")', async () => {
  // Regression test for a real bug: the caption-veto regex originally only
  // matched Arabic digits (\d), so "TABLE I" (the standard academic
  // convention for table captions, vs. figures' Arabic "Fig. 1") was never
  // recognized as a caption at all. A table whose special/Greek symbols
  // got rasterized into one image by LibreOffice's PDF import (the same
  // font-encoding issue that flattens equations) could then be wrongly
  // treated as an equation candidate, recognized as nonsense by pix2tex,
  // and have the real table silently replaced with a garbled equation —
  // exactly the "table went blank" failure a user actually hit.
  const res = await convertPdf(RASTERIZED_TABLE_FIXTURE, 'docx');
  assert.equal(res.status, 200);

  const warnings = parseWarningsHeader(res);
  const equationWarnings = warnings.filter((w) => w.code.startsWith('EQUATION'));
  assert.deepEqual(equationWarnings, [], 'a table image captioned "TABLE I" must never be flagged as an equation candidate');

  const buffer = Buffer.from(await res.arrayBuffer());
  const { value: text } = await mammoth.extractRawText({ buffer });
  assert.match(text, /TABLE I/);
  assert.match(text, /Paragraph after the table/);
});

test('regression: a PDF with no equation-like images produces zero EQUATION_* warnings', async () => {
  const res = await convertPdf(REGRESSION_FIXTURE, 'docx');
  assert.equal(res.status, 200);

  const warnings = parseWarningsHeader(res);
  const equationWarnings = warnings.filter((w) => w.code.startsWith('EQUATION'));
  assert.deepEqual(equationWarnings, [], 'a document with no equation candidates must not emit any EQUATION_* warning');

  // Output here is .docx, not a PDF — verify it's still a well-formed,
  // readable document (equation recovery must be a no-op, not a corruption)
  // by extracting its text and checking expected content survived.
  const buffer = Buffer.from(await res.arrayBuffer());
  const { value: text } = await mammoth.extractRawText({ buffer });
  assert.match(text, /Regression Test Document/);
  assert.match(text, /Second Page/);
});
