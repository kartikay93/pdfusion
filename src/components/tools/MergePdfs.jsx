import React, { useState } from 'react';
import { GripVertical, X, Loader2, FileText } from 'lucide-react';
import Dropzone from '../Dropzone.jsx';
import ResultBar from '../ResultBar.jsx';
import { mergePdfs } from '../../lib/pdfEngine.js';

export default function MergePdfs() {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const dragIndex = React.useRef(null);

  const addFiles = (arr) => {
    setResult(null);
    setFiles((prev) => [...prev, ...arr.map((f) => ({ file: f, id: crypto.randomUUID() }))]);
  };

  const remove = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const onDrop = (index) => {
    const from = dragIndex.current;
    if (from === null || from === index) return;
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndex.current = null;
  };

  const build = async () => {
    setBusy(true);
    try {
      const buffers = await Promise.all(files.map((f) => f.file.arrayBuffer()));
      const bytes = await mergePdfs(buffers);
      setResult(bytes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Dropzone
        accept="application/pdf"
        onFiles={addFiles}
        label="Drop two or more PDFs here"
        hint="Reorder them below — they'll merge top to bottom"
      />

      {files.length > 0 && (
        <>
          <div className="mt-5 flex flex-col gap-2">
            {files.map((f, i) => (
              <div
                key={f.id}
                draggable
                onDragStart={() => (dragIndex.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(i)}
                className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-3 py-2 shadow-soft"
              >
                <GripVertical size={15} className="cursor-grab text-ink/30" />
                <FileText size={16} className="text-indigo-650 [.theme-blossom_&]:text-blossom-500" />
                <span className="flex-1 truncate text-sm text-ink">{f.file.name}</span>
                <span className="text-xs text-ink/40">{(f.file.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => remove(f.id)} className="rounded p-1 text-ink/40 hover:bg-red-50 hover:text-red-500">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end">
            <button
              onClick={build}
              disabled={busy || files.length < 2}
              className="flex items-center gap-2 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 [.theme-blossom_&]:bg-blossom-500"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Merging…' : `Merge ${files.length} PDFs`}
            </button>
          </div>
        </>
      )}

      <ResultBar bytes={result} defaultName="merged.pdf" />
    </div>
  );
}
