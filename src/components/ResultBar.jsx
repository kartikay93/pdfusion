import React, { useEffect, useState } from 'react';
import { Download, CheckCircle2 } from 'lucide-react';

export default function ResultBar({ bytes, defaultName = 'document.pdf', mimeType = 'application/pdf', label = 'Your PDF is ready' }) {
  const [name, setName] = useState(defaultName);

  // defaultName is derived from the source file and can change after this
  // component first mounts (it's rendered unconditionally by parent tools,
  // before any file is picked) — resync whenever a fresh result arrives.
  useEffect(() => {
    if (bytes) setName(defaultName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, defaultName]);

  if (!bytes) return null;

  // The output extension varies by tool (.pdf, .docx, .doc, …) — derive it
  // from defaultName instead of assuming .pdf, so a user editing the name
  // field can't accidentally save a Word doc with the wrong extension/MIME.
  const extMatch = defaultName.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0] : '.pdf';

  const handleDownload = () => {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-rise mt-6 flex flex-col items-center justify-between gap-3 rounded-xl2 border border-emerald-200 bg-emerald-50 px-5 py-4 sm:flex-row [.theme-blossom_&]:border-blossom-200 [.theme-blossom_&]:bg-blossom-50">
      <div className="flex items-center gap-2 text-emerald-700 [.theme-blossom_&]:text-blossom-600">
        <CheckCircle2 size={18} />
        <span className="font-medium">{label}</span>
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full min-w-0 flex-1 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm sm:w-48"
        />
        <button
          onClick={handleDownload}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 [.theme-blossom_&]:bg-blossom-500"
        >
          <Download size={14} /> Download
        </button>
      </div>
    </div>
  );
}
