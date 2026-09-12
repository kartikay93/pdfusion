# Debian-based (not alpine) — @napi-rs/canvas ships prebuilt glibc binaries,
# and LibreOffice's own packaging targets glibc distros.
FROM node:20-bookworm-slim

# LibreOffice headless for DOCX/DOC<->PDF conversion, plus fonts so PDF text
# metrics/rendering match what a real desktop install would produce.
# tesseract.js (OCR) and pix2tex are NOT installed here: tesseract.js bundles
# its own WASM engine (no system package needed), and pix2tex (local
# equation-OCR fallback) is intentionally skipped — it needs a multi-GB
# PyTorch install and this deployment relies on the Gemini API path instead
# (set GEMINI_API_KEY). Set MATH_OCR_ENABLED=false so the app doesn't waste
# time probing for a Python install that isn't here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-liberation \
    fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Render injects PORT itself; config.js already reads process.env.PORT.
EXPOSE 5174

CMD ["node", "server/index.js"]
