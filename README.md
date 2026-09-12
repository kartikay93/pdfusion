# PDFusion

A PDF workshop built in React + Vite. Convert images to PDF, merge PDFs,
drag-and-drop reorder/rotate/delete pages — entirely in the browser — and
convert between `.docx`/`.doc` and PDF via a small backend that runs
LibreOffice headless for real document fidelity (tables, images, pagination,
native Word equations, embedded fonts), with OCR for scanned pages,
optional Gemini-powered recovery of flattened equation/table images back
into real, editable Word content, and an automatic fidelity check that
flags likely missing text.

## Features

- **Images → PDF** — drop in JPG/PNG/WebP files, optionally apply a
  black-and-white filter, get one PDF with one image per page.
- **Merge PDFs** — drop two or more PDFs, drag to set the order, merge into one.
- **Reorder & edit pages** — drop a PDF, see every page as a thumbnail, drag
  pages into a new order, rotate or delete individual pages, export.
- **Word → PDF** — converts `.doc` or `.docx` via LibreOffice headless,
  preserving pagination, tables, images, and native Word equations as they
  actually are in the source file. For `.docx`, optionally customize
  font/size/color/alignment/line spacing before converting, with a live
  preview of the actual resulting PDF (not an approximation — the preview and
  the download come from the exact same conversion). Style customization
  isn't available for legacy `.doc` (a binary OLE format, not XML) — those
  convert with their original formatting. If the server or LibreOffice is
  unavailable, `.docx` falls back to an in-browser best-effort conversion (no
  style customization in that mode); `.doc` requires the server.
- **PDF → Word** — converts a `.pdf` to `.docx` or `.doc` via LibreOffice's
  own PDF-import (Writer) filter, reconstructing text, images, tables and
  layout as editable content rather than a flat picture of the page. Pages
  with little or no extractable text (typically scanned/photographed pages)
  are automatically detected and run through OCR (Tesseract, via
  `tesseract.js` — a pure WASM build with **no system OCR binary required**),
  with the recovered text appended in a clearly-labeled "Recovered text from
  scanned pages (OCR)" section rather than silently dropped or guessed at.
  For `.docx` output, equation and table images that LibreOffice's PDF
  import flattened into pictures are detected and — where a Gemini API key
  is configured (optional — see "Content recovery" below) — replaced with
  real, editable Word content: equations become native `<m:oMath>` objects
  and tables become real `<w:tbl>` grids, not flat pictures. A local
  equation-only fallback (no API key needed) is also available. A
  best-effort fidelity check compares the source PDF's own extractable text
  against the converted document and warns if some appears to be missing.
  Requires the server (no in-browser fallback exists for this direction).
- **Two themes** — the default "Studio" theme (indigo/graphite, glassy
  toolbar) and a "Blossom" theme (soft pink), toggled from the header.
- **Mostly client-side** — Images → PDF, Merge, and Reorder & edit hold files
  only in memory for the current tab and never touch a server. Word → PDF and
  PDF → Word are the exceptions: they upload your file to the backend for
  conversion, and the server deletes all temporary files immediately after
  responding (success or failure).

## Run it locally

Frontend only (Word → PDF will use the in-browser fallback; PDF → Word won't
work at all — it has no client-side path):

```bash
npm install
npm run dev
```

Full stack, including the LibreOffice-backed conversion (see "Server setup"
below first):

```bash
npm install
npm run dev:full
```

For a production build:

```bash
npm run build
npm run start
```

`npm run start` runs the backend and also serves the built frontend (`dist/`)
from the same process — there's no separate static host needed in production.

## Server setup

The Word ↔ PDF tools shell out to LibreOffice (`soffice --headless`) to
convert documents. You need LibreOffice installed wherever the server runs.

**Windows (dev):**

```powershell
winget install TheDocumentFoundation.LibreOffice
```

Then copy `.env.example` to `.env` and set `LIBREOFFICE_PATH` if it's not
auto-detected (the server checks the standard install locations first):

```
LIBREOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe
```

**Linux / Docker (prod):**

```bash
apt-get install -y libreoffice fontconfig
```

`soffice` is normally already on `PATH` there, so `LIBREOFFICE_PATH` can stay
unset. If your documents use fonts that aren't installed system-wide (e.g.
corporate/brand fonts), install them under `/usr/share/fonts/`, run
`fc-cache -f`, and restart the server — the font check is computed once at
server startup and cached.

OCR (`tesseract.js`) and PDF-page rasterization (`@napi-rs/canvas`) are both
plain npm packages with prebuilt native binaries — **no Tesseract binary or
other system package needs installing** for OCR to work, on any platform.

Other environment variables (see `.env.example`): `PORT` (default 5174),
`MAX_UPLOAD_MB` (default 20), `CONVERSION_CONCURRENCY` (default 2, how many
LibreOffice processes may run at once — each is heavyweight),
`CONVERSION_TIMEOUT_MS` (default 60000), and `OCR_MAX_PAGES` (default 30 — a
cap on how many likely-scanned pages get OCR'd per PDF, since OCR is
comparatively slow; pages beyond the cap are skipped with a warning rather
than blocking the request indefinitely).

### Content recovery — equations & tables (optional)

PDF → Word can detect equations *and tables* that LibreOffice's PDF import
flattened into plain images and replace them with real, editable Word
content — a native `<m:oMath>` equation object, or a real `<w:tbl>` grid —
instead of a flat picture. There are two independent ways this can work:

**Gemini (recommended — handles both equations and tables):** set
`GEMINI_API_KEY` in `.env` (get a key at
https://aistudio.google.com/apikey). Every embedded image below a generous
size cap is sent to Gemini with a single classification+extraction prompt:
"is this an equation, a table, or something else (a real photo/figure,
which must be left alone)?" — Gemini's own multimodal judgment replaces
this app's own pixel heuristics (size/monochrome-based scoring, a caption
regex) as the classifier, which is far more reliable, especially for
tables (no scoring heuristic here was ever built to recognize a *table*
shape at all — only Gemini's own understanding does). Recognized
equations still go through the same pure-npm LaTeX → MathML → OMML
pipeline (`mathjax-full` + `mathml2omml`) described below; recognized
tables are rebuilt as a real OOXML table from Gemini's structured
row/column output. `CONTENT_RECOVERY_MAX_IMAGES` (default 15) caps how
many images per document get sent, for cost/latency control.

**Local pix2tex fallback (equations only, no API key/network needed):**
if no `GEMINI_API_KEY` is set, PDF → Word falls back to a local Python
equation-recognition model (pix2tex / LaTeX-OCR) plus the same
`mathjax-full` + `mathml2omml` pipeline. This path only handles equations
— there's no local model wired up for table recognition, so without a
Gemini key, table images are left as images. This is entirely optional —
everything else in PDFusion, including the rest of PDF → Word, works with
neither a Gemini key nor Python installed at all; without either, equation
and table images are just left as images (the original behavior), and a
warning explains why.

The Python service is started lazily, on the first PDF that actually
contains a detected equation image — a plain text-only PDF never spawns
Python or pays any model-load cost. Its weights (~115MB total) download
once on first use and are cached afterward.

Windows (dev) / Linux / Docker (prod) — same commands, run inside a
dedicated virtual environment so this doesn't touch any other Python
project on the machine:

```bash
python -m venv server/python/venv
# Windows:
server/python/venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
server/python/venv/Scripts/python.exe -m pip install pix2tex fastapi "uvicorn[standard]" python-multipart Pillow
# Linux/macOS:
server/python/venv/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
server/python/venv/bin/python -m pip install pix2tex fastapi "uvicorn[standard]" python-multipart Pillow
```

(CPU-only torch is the sane default without a GPU; drop the `--index-url`
override if the host has a CUDA GPU and you want the standard GPU build
instead.) Deliberately don't install pix2tex's `[api]` extras — that pulls
in a Streamlit GUI frontend this project doesn't use. **pix2tex pins some
older dependencies** (`timm==0.5.4`, `x-transformers==0.15.0`) that can
lack wheels for very new Python versions — Python 3.11 is known to work;
if your default `python` is much newer, point the venv at a 3.11 install
specifically.

The server automatically looks for `server/python/venv` first — nothing
further to configure if you installed it there. Set `MATH_OCR_PYTHON_PATH`
in `.env` only if you're using a different Python location. See
`.env.example` for the remaining `MATH_OCR_*` variables (port, timeouts,
explicit disable).

### Fidelity check (automatic, no setup)

Every `.docx` conversion runs a best-effort check: it extracts the source
PDF's own text (via `pdfjs-dist`) and compares it against the converted
document's text, reporting a coverage percentage. If less than 85% of the
PDF's extractable words are found in the output, a `FIDELITY_CHECK_LOW`
warning is surfaced. This is deliberately narrow in scope — see "Known
limitations" below for exactly what it can and can't catch — but it's
always on and needs no configuration. Run it standalone against any pair of
files with:

```bash
npm run compare -- path/to/input.pdf path/to/output.docx
```

### Automated test

```bash
npm run test:server
```

Runs a Node-test-runner suite against the real backend + real LibreOffice:
DOCX/DOC → PDF (with and without a style override) and PDF → DOCX/DOC
(including a synthetic scanned-page fixture to exercise the OCR path),
asserting page counts, PDF/DOCX validity, and that expected text survives
extraction — not just "no exception was thrown." Requires LibreOffice to be
installed and discoverable, same as the app itself. The equation-recovery
tests (`server/test/equationRecovery.test.js`) additionally verify
detection correctly picks out a real equation-like image while leaving a
captioned decoy figure alone; they skip automatically (not fail) if
Python/pix2tex isn't set up in the test environment. The fidelity-check
tests (`server/test/fidelityCheck.test.js`) are pure unit tests (no server
needed) — including a regression test for a real bug this feature's own
development caught: LibreOffice's output duplicates every text run inside
both an `mc:Choice` and a legacy `mc:Fallback` copy, which silently
double-counted every word and made a deliberately-truncated test document
still score 100% coverage until the extractor was fixed to read only the
`mc:Choice` copy.

### Known limitations

- The style-override feature applies one global font/size/color/alignment/
  line-spacing choice across the whole document by rewriting the relevant
  OOXML before conversion. It flattens any *per-run* variation of whatever
  property you change (e.g. a word that was red for emphasis becomes your
  chosen color too, if you override color) — this is inherent to a
  single global override, not a bug.
- Content inside embedded OLE objects, SmartArt, or embedded charts, and text
  baked into images, is not affected by style overrides.
- List bullet/number glyph styling isn't swept by the override — only list
  item text is.
- A missing font (in the source document or requested as an override) doesn't
  fail the conversion — LibreOffice substitutes a fallback and a warning is
  surfaced in the UI, but this can shift layout slightly from what a machine
  with that font installed would produce.
- **PDF → Word fidelity depends on what's actually in the PDF.** A PDF has no
  semantic document model — just positioned glyphs, paths and images — so
  LibreOffice's import is a best-effort *reconstruction* of paragraphs,
  tables and images from that, not a perfect reversal of "whatever created
  the PDF." Simple documents (most Word/Google Docs exports) come back very
  clean; dense multi-column layouts, heavy custom typography, or PDFs
  produced by unusual tools can come back with a plausible-but-imperfect
  approximation of the original structure.
- **Justified text does not survive as justified.** LibreOffice's PDF
  import reconstructs each visual *line* as its own small floating text box,
  auto-sized to fit only that line's own content — not the original
  column's full width. Since justification only has an effect when a line
  is stretched across a box wider than its natural content, and these boxes
  are sized with zero extra room by construction, justified paragraphs come
  back left-aligned/ragged-right. This is a structural property of how
  LibreOffice's PDF-import filter rebuilds a page (confirmed by inspecting
  its actual output XML: no `w:jc` is set, and each shape's
  `<wp:extent>` matches its text's natural width, not the source column
  width) — the original spacing is already gone by the time this app
  receives the converted document, so there's no post-processing fix
  available for it here.
- **Mathematical equations in a PDF are, almost always, just glyphs and
  vector paths** — a PDF (outside rare tagged/accessible PDFs) has no
  embedded semantic equation structure (no OMML/MathML) the way a `.docx`
  does. Depending on how the source PDF encoded the equation's font/glyphs,
  LibreOffice's PDF import will carry the equation's *appearance* across
  either as text (often fragmented across several small floating text
  boxes rather than one flowing line — this is a general characteristic of
  how LibreOffice's PDF import reconstructs a page, not equation-specific)
  or, when it can't map the glyphs to text at all (common for
  LaTeX/pdfTeX-produced PDFs with non-standard math-font encodings), as a
  flattened image. The optional equation-recovery feature (see above)
  targets that second case specifically: it looks for small, near-
  monochrome images sitting alone on their own line (optionally followed by
  an equation number like "(1)") and replaces confidently-detected ones
  with a real `<m:oMath>` equation. **Without Gemini configured**, detection
  falls back to a heuristic (size + near-monochrome + "alone on its line,
  maybe with a trailing equation number") with a caption veto so a real,
  captioned figure is never touched — conservative by design: ambiguous
  cases are left as images rather than risking mangled content, verified by
  an automated test that a captioned decoy figure is never touched. **With
  Gemini configured**, that heuristic is bypassed almost entirely — every
  embedded image under the size cap is shown to Gemini directly, which
  judges "equation vs table vs a real photo to leave alone" itself, which
  is far more reliable than the pixel heuristic (in particular, the
  heuristic path has no way to recognize a *table* shape at all — only the
  Gemini path can recover tables). **The recovered equation is inserted
  using normal document flow, not the flattened image's exact original
  floating position** — so its content becomes correctly editable, but it
  can end up positioned differently on the page than the image was
  (page-reflow generally, not just this feature). Equations that
  LibreOffice instead reconstructs as fragmented text (rather than a
  flattened image) are not addressed by either path and remain fragmented.
- **Recovered tables approximate the original structure, not its exact
  look.** Column widths are split evenly across the page's usable width
  (Gemini's output is just rows of text, not the original PDF's column
  proportions), and there's no way to recover cell shading, merged cells,
  or borders style — the result is a genuinely real, editable Word table
  with the right rows/columns/text, not a pixel-accurate reproduction of
  the original table's appearance. Gemini's transcription, like any OCR/
  vision model, can occasionally misread a character (especially unusual
  symbols or subscripts) — spot-check recovered tables and equations against
  the source, the same way you would with any automated transcription.
  **Tables can hit the same font-encoding flattening as equations** — a
  table with Greek/math symbols (units tables are a common case) can get
  rasterized into one image by LibreOffice the same way an equation does.
  The local (non-Gemini) heuristic path specifically guards against ever
  touching such an image as if it were an equation: a nearby caption veto
  matches academic tables' actual caption convention (Roman numerals, e.g.
  "TABLE I" — not Arabic digits like figures' "Fig. 1"; an earlier version
  of this check missed that distinction and could silently replace an
  unrecognized table image with a nonsense equation — covered by a
  regression test). The Gemini path doesn't need this veto in the same way,
  since Gemini's own classification recognizes a table as a table rather
  than guessing it might be an equation.
- **The fidelity check only sees text that was already extractable in the
  source PDF.** It compares the PDF's own extractable text against the
  converted document's text — so it can only ever catch text that was
  readable in the PDF but went missing in conversion (a real regression),
  not content that was already a flattened image in the PDF to begin with
  (an equation or table with unusual font encoding) — pdfjs can't read text
  out of a picture any more than this check can. That case is what the
  equation/table recovery features address separately, with their own
  warnings. The check also can't detect layout/formatting loss (like the
  justification issue above) — only whether the *words* survived, not
  whether they look right.
- **OCR is best-effort text recovery, not layout reconstruction.** For
  scanned/image-only pages, recovered text is appended in a separate labeled
  section rather than positioned/formatted to match the original scan — so
  reading order, columns, and any table structure on a scanned page are not
  preserved for that text. OCR accuracy also depends on scan quality; low-
  resolution, skewed, or handwritten pages will recognize worse than a clean
  print scan, and equations/symbols in a scanned image are the least
  reliable case since OCR is trained mainly on natural-language text.

## Stack

React 18, Vite, Tailwind CSS, `pdf-lib` (create/merge/rebuild PDFs),
`pdfjs-dist` (render page thumbnails, text-content inspection for OCR page
detection and the fidelity check), `@dnd-kit` (drag-and-drop), `lucide-react`
(icons); a small Node/Express backend using LibreOffice headless for
DOCX/DOC ↔ PDF conversion in both directions, `jszip` + `@xmldom/xmldom`
for the OOXML style-override rewrite and OCR-text/equation/table-append,
`tesseract.js` + `@napi-rs/canvas` for pure-npm (no system binary) OCR of
scanned PDF pages, `@google/genai` (optional) for Gemini-based
classification and extraction of flattened equation/table images,
`mathjax-full` + `mathml2omml` for the LaTeX → MathML → OMML pipeline any
recognized equation goes through regardless of which recognizer found it
(paired with an optional local pix2tex Python service as the equation-only
fallback when no Gemini key is set), and `mammoth` + `html2canvas` +
`jspdf` as the in-browser fallback DOCX → PDF path when the server is
unavailable.
