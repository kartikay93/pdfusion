import React, { useEffect, useState } from 'react';
import { Loader2, FileText, AlertTriangle } from 'lucide-react';
import Dropzone from '../Dropzone.jsx';
import ResultBar from '../ResultBar.jsx';
import StylePanel from '../StylePanel.jsx';
import PreviewGrid from '../PreviewGrid.jsx';
import { docxToPdf } from '../../lib/pdfEngine.js';
import { convertDocxOnServer, checkServerAvailable } from '../../lib/serverEngine.js';

function warningText(w) {
  if (w.code === 'FONT_MISSING') return `Font not available on the server: ${w.font} — a substitute was used, which may slightly change layout.`;
  if (w.code === 'STYLE_NOT_SUPPORTED') return w.message;
  return w.message || 'The server reported a conversion warning.';
}

export default function DocxToPdf() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [previewBytes, setPreviewBytes] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [style, setStyle] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [serverAvailable, setServerAvailable] = useState(null);

  useEffect(() => {
    checkServerAvailable().then(setServerAvailable);
  }, []);

  // Legacy .doc is a binary OLE format — the in-browser mammoth-based
  // fallback can only parse modern .docx (OOXML), and style overrides work
  // by rewriting OOXML parts, so neither applies to a .doc file.
  const isLegacyDoc = file && /\.doc$/i.test(file.name) && !/\.docx$/i.test(file.name);

  const pick = (arr) => {
    setFile(arr[0]);
    setResult(null);
    setPreviewBytes(null);
    setWarnings([]);
    setError('');
    setStyle(null);
  };

  const runConversion = async (onProgress) => {
    if (serverAvailable) {
      const { bytes, warnings: w } = await convertDocxOnServer(file, style, onProgress);
      setWarnings(w);
      return bytes;
    }
    if (isLegacyDoc) {
      throw new Error('Converting .doc files requires our server, which is unavailable right now. Please try again shortly.');
    }
    // Fallback: server/LibreOffice unavailable — use the client-side
    // rasterization pipeline (no style-override support in that path).
    return docxToPdf(file, onProgress);
  };

  const handleStyleChange = async (nextStyle) => {
    setStyle(nextStyle);
    if (!file) return;
    setPreviewing(true);
    setError('');
    try {
      const bytes = await runConversion();
      setPreviewBytes(bytes);
    } catch (err) {
      setError(err.message || 'Preview failed.');
    } finally {
      setPreviewing(false);
    }
  };

  const build = async () => {
    setBusy(true);
    setError('');
    try {
      const bytes = await runConversion(setStatus);
      setResult(bytes);
      setPreviewBytes(null);
    } catch (err) {
      setError(err.message || 'Conversion failed.');
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  return (
    <div>
      <Dropzone
        accept=".doc,.docx"
        multiple={false}
        onFiles={pick}
        label="Drop a .doc or .docx file here"
        hint="Keeps headings, paragraphs, lists, tables and formatting close to the original"
      />

      {file && (
        <>
          <div className="mt-5 flex items-center justify-between rounded-lg border border-ink/10 bg-white px-4 py-3 shadow-soft">
            <div className="flex items-center gap-2 text-sm text-ink">
              <FileText size={16} className="text-indigo-650 [.theme-blossom_&]:text-blossom-500" />
              {file.name}
            </div>
            <button
              onClick={build}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 [.theme-blossom_&]:bg-blossom-500"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? status || 'Converting…' : 'Convert to PDF'}
            </button>
          </div>

          {serverAvailable === false && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
              <AlertTriangle size={13} />
              {isLegacyDoc
                ? 'High-fidelity server conversion is unavailable right now — .doc files need it and can\'t use the in-browser fallback.'
                : 'High-fidelity server conversion is unavailable right now — using the in-browser fallback (style customization is disabled).'}
            </p>
          )}

          {serverAvailable && !isLegacyDoc && <StylePanel onChange={handleStyleChange} />}

          {serverAvailable && isLegacyDoc && (
            <p className="mt-3 text-xs text-ink/40">
              Style customization is only available for .docx files — this .doc file will convert with its original formatting.
            </p>
          )}

          {serverAvailable && (
            <p className="mt-3 text-xs text-ink/40">
              This tool sends your file to our server for conversion, then deletes it. Other tools in PDFusion stay fully in-browser.
            </p>
          )}
        </>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={13} /> Conversion warning
          </div>
          <ul className="mt-1 space-y-0.5 text-amber-700/80">
            {warnings.map((w, i) => (
              <li key={i}>{warningText(w)}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      <PreviewGrid bytes={result ? null : previewBytes} loading={previewing} />
      <ResultBar bytes={result} defaultName={file ? file.name.replace(/\.docx?$/i, '.pdf') : 'document.pdf'} />
    </div>
  );
}
