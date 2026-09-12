import React, { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

export default function Dropzone({ accept, multiple = true, onFiles, label, hint }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (fileList) => {
      const arr = Array.from(fileList || []);
      if (arr.length) onFiles(arr);
    },
    [onFiles]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl2 border-2 border-dashed px-6 py-12 text-center transition-colors
        ${dragOver
          ? 'border-indigo-650 bg-indigo-650/5 [.theme-blossom_&]:border-blossom-400 [.theme-blossom_&]:bg-blossom-50'
          : 'border-ink/15 hover:border-ink/30 [.theme-blossom_&]:border-blossom-200 [.theme-blossom_&]:hover:border-blossom-400'}`}
    >
      <div className="rounded-full bg-ink/5 p-3 [.theme-blossom_&]:bg-blossom-100">
        <UploadCloud size={22} className="text-ink/60 [.theme-blossom_&]:text-blossom-600" />
      </div>
      <div>
        <p className="font-medium text-ink">{label || 'Drop files here, or click to browse'}</p>
        {hint && <p className="mt-1 text-sm text-ink/50">{hint}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
