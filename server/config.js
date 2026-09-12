import 'dotenv/config';

function int(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int('PORT', 5174),
  libreOfficePath: process.env.LIBREOFFICE_PATH || null,
  maxUploadMb: int('MAX_UPLOAD_MB', 20),
  conversionConcurrency: int('CONVERSION_CONCURRENCY', 2),
  conversionTimeoutMs: int('CONVERSION_TIMEOUT_MS', 120000),
  conversionTimeoutPerPageMs: int('CONVERSION_TIMEOUT_PER_PAGE_MS', 3000),
  conversionTimeoutMaxMs: int('CONVERSION_TIMEOUT_MAX_MS', 900000),
  ocrMaxPages: int('OCR_MAX_PAGES', 30),
  mathOcrEnabled: process.env.MATH_OCR_ENABLED !== 'false',
  mathOcrPythonPath: process.env.MATH_OCR_PYTHON_PATH || null,
  mathOcrPort: int('MATH_OCR_PORT', 5185),
  mathOcrStartupTimeoutMs: int('MATH_OCR_STARTUP_TIMEOUT_MS', 300000),
  mathOcrRequestTimeoutMs: int('MATH_OCR_REQUEST_TIMEOUT_MS', 20000),
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  contentRecoveryMaxImages: int('CONTENT_RECOVERY_MAX_IMAGES', 15),
  isProduction: process.env.NODE_ENV === 'production'
};
