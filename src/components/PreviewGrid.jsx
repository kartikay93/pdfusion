import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { renderPdfThumbnails } from '../lib/pdfEngine.js';

/**
 * Read-only preview of a PDF's pages, reusing the same thumbnail renderer
 * PageEditor/PageGrid use for the reorder tool. This is deliberately the
 * *actual* rendered PDF — not a separate HTML approximation — so what's
 * previewed here is exactly what downloading produces.
 */
export default function PreviewGrid({ bytes, loading }) {
  const [pages, setPages] = useState([]);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!bytes) {
      setPages([]);
      return;
    }
    setRendering(true);
    renderPdfThumbnails(new Uint8Array(bytes), 0.5)
      .then((thumbs) => {
        if (!cancelled) setPages(thumbs);
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (!bytes && !loading) return null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-2 text-sm text-ink/50">
        {(loading || rendering) && <Loader2 size={14} className="animate-spin" />}
        <span>{loading ? 'Converting…' : rendering ? 'Rendering preview…' : `Preview — ${pages.length} page${pages.length !== 1 ? 's' : ''}`}</span>
      </div>
      {pages.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {pages.map((p) => (
            <div key={p.pageIndex} className="overflow-hidden rounded-lg border border-ink/10 bg-white shadow-soft">
              <img src={p.dataUrl} alt={`Page ${p.pageIndex + 1}`} className="w-full" />
              <div className="border-t border-ink/5 px-2 py-1 text-center text-xs text-ink/40">
                Page {p.pageIndex + 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
