import React, { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import Dropzone from '../Dropzone.jsx';
import ResultBar from '../ResultBar.jsx';
import { imagesToPdf } from '../../lib/pdfEngine.js';

export default function ImageToPdf() {
  const [files, setFiles] = useState([]);
  const [bw, setBw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const addFiles = (arr) => {
    setResult(null);
    setFiles((prev) => [...prev, ...arr.map((f) => ({ file: f, url: URL.createObjectURL(f), id: crypto.randomUUID() }))]);
  };

  const remove = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const build = async () => {
    setBusy(true);
    try {
      const bytes = await imagesToPdf(files.map((f) => f.file), { blackAndWhite: bw });
      setResult(bytes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Dropzone
        accept="image/*"
        onFiles={addFiles}
        label="Drop images here, or click to browse"
        hint="JPG, PNG, WebP — each image becomes one page, in the order you add them"
      />

      {files.length > 0 && (
        <>
          <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {files.map((f) => (
              <div key={f.id} className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-ink/10 bg-ink/[0.02]">
                <img src={f.url} alt="" className={`h-full w-full object-cover ${bw ? 'grayscale' : ''}`} />
                <button
                  onClick={() => remove(f.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <label className="flex select-none items-center gap-2 text-sm text-ink/70">
              <input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} className="h-4 w-4 rounded accent-indigo-650" />
              Convert to black &amp; white
            </label>
            <button
              onClick={build}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 [.theme-blossom_&]:bg-blossom-500"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Building PDF…' : `Create PDF from ${files.length} image${files.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      <ResultBar bytes={result} defaultName="images.pdf" />
    </div>
  );
}
