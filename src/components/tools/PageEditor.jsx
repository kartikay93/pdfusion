import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Dropzone from '../Dropzone.jsx';
import PageGrid from '../PageGrid.jsx';
import ResultBar from '../ResultBar.jsx';
import { renderPdfThumbnails, reorderPdfPages } from '../../lib/pdfEngine.js';

export default function PageEditor() {
  const [sourceBytes, setSourceBytes] = useState(null);
  const [pages, setPages] = useState([]);
  const [order, setOrder] = useState([]);
  const [rotations, setRotations] = useState({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = async (arr) => {
    const file = arr[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const thumbs = await renderPdfThumbnails(bytes);
      setSourceBytes(bytes);
      setPages(thumbs);
      setOrder(thumbs.map((t) => t.pageIndex));
      setRotations({});
    } finally {
      setLoading(false);
    }
  };

  const rotate = (pageIndex) => {
    setPages((prev) =>
      prev.map((p) => (p.pageIndex === pageIndex ? { ...p, rotation: ((p.rotation || 0) + 90) % 360 } : p))
    );
    setRotations((prev) => ({ ...prev, [pageIndex]: ((prev[pageIndex] || 0) + 90) % 360 }));
  };

  const del = (pageIndex) => {
    setOrder((prev) => prev.filter((i) => i !== pageIndex));
  };

  const build = async () => {
    setBusy(true);
    try {
      const bytes = await reorderPdfPages(sourceBytes, order, rotations);
      setResult(bytes);
    } finally {
      setBusy(false);
    }
  };

  if (!sourceBytes) {
    return (
      <Dropzone
        accept="application/pdf"
        multiple={false}
        onFiles={load}
        label={loading ? 'Reading PDF…' : 'Drop a PDF to edit its pages'}
        hint="Drag pages into a new order, rotate, or delete — then export"
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink/50">{order.length} page{order.length !== 1 ? 's' : ''} — drag to reorder</p>
        <button
          onClick={() => {
            setSourceBytes(null);
            setPages([]);
            setOrder([]);
            setResult(null);
          }}
          className="text-sm text-ink/50 underline hover:text-ink"
        >
          Load a different PDF
        </button>
      </div>

      <PageGrid pages={pages} order={order} onOrderChange={setOrder} onRotate={rotate} onDelete={del} />

      <div className="mt-6 flex justify-end">
        <button
          onClick={build}
          disabled={busy || order.length === 0}
          className="flex items-center gap-2 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 [.theme-blossom_&]:bg-blossom-500"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? 'Exporting…' : 'Export edited PDF'}
        </button>
      </div>

      <ResultBar bytes={result} defaultName="edited.pdf" />
    </div>
  );
}
