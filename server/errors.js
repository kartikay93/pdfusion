export class AppError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class InvalidDocxError extends AppError {
  constructor(message = 'The uploaded file is not a valid .docx document.') {
    super('INVALID_DOCX', message, 400);
  }
}

export class InvalidPdfError extends AppError {
  constructor(message = 'The uploaded file is not a valid PDF document.') {
    super('INVALID_PDF', message, 400);
  }
}

export class TooLargeError extends AppError {
  constructor(maxMb) {
    super('TOO_LARGE', `File exceeds the ${maxMb}MB upload limit.`, 413);
  }
}

export class ConversionFailedError extends AppError {
  constructor(message = 'Conversion failed — the document may be corrupted or use unsupported features.') {
    super('CONVERSION_FAILED', message, 422);
  }
}

export class TimeoutError extends AppError {
  constructor() {
    super('TIMEOUT', 'Conversion timed out.', 504);
  }
}

export class ServerMisconfiguredError extends AppError {
  constructor(message = 'The document conversion service is not available right now.') {
    super('SERVER_MISCONFIGURED', message, 503);
  }
}

export function errorMiddleware(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.status >= 500) console.error(`[${err.code}]`, err.message, err.cause || '');
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error('[INTERNAL]', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our end.' } });
}
