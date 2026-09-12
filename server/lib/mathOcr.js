import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A local venv at server/python/venv is the preferred, deterministic place
// to find pix2tex — see README "Equation recovery (optional)" setup. Older
// pix2tex dependencies (timm==0.5.4, x-transformers==0.15.0, etc.) can lack
// wheels for very new Python versions, so a pinned local venv avoids
// accidentally picking up an incompatible system/PATH Python.
const VENV_PYTHON_WIN = path.join(__dirname, '..', 'python', 'venv', 'Scripts', 'python.exe');
const VENV_PYTHON_UNIX = path.join(__dirname, '..', 'python', 'venv', 'bin', 'python');
const PATH_CANDIDATES = ['python3', 'python'];

let pythonPath = null;
let pythonPathChecked = false;

let serverState = 'stopped'; // 'stopped' | 'starting' | 'ready' | 'unavailable'
let serverProcess = null;
let startPromise = null;

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function probeCommand(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, ['--version']);
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Resolves the Python interpreter to run pix2tex's API server with:
 * MATH_OCR_PYTHON_PATH env override first, then the project-local venv
 * (server/python/venv), then python3/python on PATH. Cached after the
 * first lookup (success or exhaustion) — a failed lookup must not
 * re-probe on every request.
 */
export async function resolvePythonPath() {
  if (pythonPathChecked) return pythonPath;
  pythonPathChecked = true;

  if (config.mathOcrPythonPath) {
    if (await fileExists(config.mathOcrPythonPath)) {
      pythonPath = config.mathOcrPythonPath;
      return pythonPath;
    }
    console.error(`[mathOcr] MATH_OCR_PYTHON_PATH is set to "${config.mathOcrPythonPath}" but that file does not exist.`);
    return null;
  }

  const venvPython = process.platform === 'win32' ? VENV_PYTHON_WIN : VENV_PYTHON_UNIX;
  if (await fileExists(venvPython)) {
    pythonPath = venvPython;
    return pythonPath;
  }

  for (const candidate of PATH_CANDIDATES) {
    if (await probeCommand(candidate)) {
      pythonPath = candidate;
      return pythonPath;
    }
  }
  return null;
}

async function pollHealth(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function doStart() {
  const python = await resolvePythonPath();
  if (!python) {
    console.error('[mathOcr] No Python interpreter found — equation recovery will be skipped. See README "Equation recovery (optional)".');
    serverState = 'unavailable';
    return false;
  }

  const port = config.mathOcrPort;
  const child = spawn(python, ['-m', 'uvicorn', 'pix2tex.api.app:app', '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'pipe'
  });
  serverProcess = child;

  let stderrTail = '';
  child.stderr?.on('data', (d) => {
    stderrTail = (stderrTail + d).slice(-4000);
  });
  child.on('exit', (code) => {
    if (serverState === 'ready') {
      console.error(`[mathOcr] pix2tex server exited unexpectedly (code ${code}). Recent stderr:\n${stderrTail}`);
    }
    serverState = 'stopped';
    serverProcess = null;
  });

  const ready = await pollHealth(port, Date.now() + config.mathOcrStartupTimeoutMs);
  if (!ready) {
    console.error(`[mathOcr] pix2tex server did not become ready within ${config.mathOcrStartupTimeoutMs}ms. Recent stderr:\n${stderrTail}`);
    child.kill();
    serverProcess = null;
    serverState = 'unavailable';
    return false;
  }

  serverState = 'ready';
  return true;
}

/**
 * Lazily starts the pix2tex API server on first use and keeps it warm for
 * subsequent calls. A plain text-only PDF never triggers this at all —
 * only an actual equation-recovery attempt does. A failed start is cached
 * for the process lifetime (mirrors resolveLibreOfficePath's caching) so a
 * missing Python install costs one slow attempt, not one per request.
 */
export async function ensureServerRunning() {
  if (!config.mathOcrEnabled) return false;
  if (serverState === 'ready') return true;
  if (serverState === 'unavailable') return false;
  if (serverState === 'starting') return startPromise;

  serverState = 'starting';
  startPromise = doStart();
  return startPromise;
}

/**
 * Recognizes the LaTeX for a single equation image. Never throws — a
 * failure (Python unavailable, request timeout, bad response) returns
 * null, and callers treat that as "skip this candidate, leave the
 * original image untouched."
 */
export async function recognizeEquation(imageBuffer) {
  const ok = await ensureServerRunning();
  if (!ok) return null;

  try {
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer]), 'equation.png');

    const res = await fetch(`http://127.0.0.1:${config.mathOcrPort}/predict/`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(config.mathOcrRequestTimeoutMs)
    });

    if (!res.ok) {
      console.error(`[mathOcr] /predict/ returned HTTP ${res.status}`);
      return null;
    }

    // pix2tex's FastAPI endpoint returns a bare `str`, which FastAPI
    // serializes as a JSON string — the body is literally `"\\int_0^..."`.
    const text = await res.text();
    const latex = JSON.parse(text);
    return typeof latex === 'string' && latex.trim() ? latex.trim() : null;
  } catch (err) {
    console.error('[mathOcr] recognizeEquation failed:', err.message);
    return null;
  }
}

/** Cheap advisory check — lets callers skip detection work entirely when unavailable. */
export async function isMathOcrAvailable() {
  if (!config.mathOcrEnabled) return false;
  if (serverState === 'ready' || serverState === 'starting') return true;
  return (await resolvePythonPath()) !== null;
}

export function shutdownMathOcr() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    serverState = 'stopped';
  }
}
