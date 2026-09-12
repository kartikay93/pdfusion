import React, { useEffect, useState } from 'react';
import { Loader2, FileText, AlertTriangle } from 'lucide-react';
import Dropzone from '../Dropzone.jsx';
import ResultBar from '../ResultBar.jsx';
import { convertPdfToWordOnServer, checkServerAvailable } from '../../lib/serverEngine.js';

const FORMATS = [
  { value: 'docx', label: '.docx' },
  { value: 'doc', label: '.doc (legacy)' }
];

function warningText(w) {
  if (w.code === 'OCR_NO_TEXT_FOUND') return w.message;
  if (w.code === 'OCR_PAGE_LIMIT') return w.message;
  if (w.code === 'OCR_NOT_APPENDED') return w.message;
  if (w.code === 'OCR_FAILED') return w.message;
  if (w.code === 'EQUATIONS_RECOVERED') return w.message;
  if (w.code === 'EQUATION_RECOVERY_PARTIAL') return w.message;
  if (w.code === 'EQUATION_RECOVERY_UNAVAILABLE') return w.message;
  if (w.code === 'EQUATION_RECOVERY_FAILED') return w.message;
  if (w.code === 'TABLES_RECOVERED') return w.message;
  if (w.code === 'CONTENT_RECOVERY_SKIPPED_LIMIT') return w.message;
  if (w.code === 'FIDELITY_CHECK_LOW') return w.message;
  if (w.code === 'EQUATION_NARY_APPROXIMATE') return w.message;
  return w.message || 'The server reported a conversion warning.';
}

export default function PdfToWord() {
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState('docx');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [serverAvailable, setServerAvailable] = useState(null);

  useEffect(() => {
    checkServerAvailable().then(setServerAvailable);
  }, []);

  const pick = (arr) => {
    setFile(arr[0]);
    setResult(null);
    setWarnings([]);
    setError('');
  };

  const build = async () => {
    setBusy(true);
    setError('');
    try {
      const { bytes, warnings: w } = await convertPdfToWordOnServer(file, format, setStatus);
      setResult(bytes);
      setWarnings(w);
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
        accept=".pdf"
        multiple={false}
        onFiles={pick}
        label="Drop a .pdf file here"
        hint="Converts to an editable Word document — text, images, tables and layout via LibreOffice; scanned pages are OCR'd automatically"
      />

      {file && (
        <>
          <div className="mt-5 flex flex-col gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-ink">
              <FileText size={16} className="text-indigo-650 [.theme-blossom_&]:text-blossom-500" />
              {file.name}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border border-ink/10">
                {FORMATS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFormat(f.value)}
                    className={`px-3 py-1.5 text-xs font-medium ${
                      format === f.value
                        ? 'bg-ink text-white [.theme-blossom_&]:bg-blossom-500'
                        : 'bg-white text-ink/60 hover:bg-ink/5'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                onClick={build}
                disabled={busy || serverAvailable === false}
                className="flex items-center gap-2 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 [.theme-blossom_&]:bg-blossom-500"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {busy ? status || 'Converting…' : `Convert to ${FORMATS.find((f) => f.value === format).label}`}
              </button>
            </div>
          </div>

          {serverAvailable === false && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
              <AlertTriangle size={13} />
              PDF to Word conversion needs our server, which is unavailable right now. Please try again shortly.
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

      <ResultBar
        bytes={result}
        defaultName={file ? file.name.replace(/\.pdf$/i, `.${format}`) : `document.${format}`}
        mimeType={format === 'doc' ? 'application/msword' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
        label="Your document is ready"
      />
    </div>
  );
}
