import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';

const EMPTY_STYLE = { fontFamily: null, fontSizePt: null, color: null, alignment: null, lineSpacing: null };

const FONT_OPTIONS = ['Calibri', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Cambria'];
const ALIGNMENTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justify' }
];

/**
 * Optional, collapsed-by-default style-override form. Emits a debounced
 * onChange(style) where every untouched field stays null — a null/empty
 * style means "no override," so the default conversion path is unaffected
 * unless the user actually opens this panel and changes something.
 */
export default function StylePanel({ onChange }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState(EMPTY_STYLE);
  const debounceRef = useRef(null);

  // Only fires onChange once the user has actually touched a field — merely
  // opening the panel must not trigger an extra conversion of its own.
  const emitDebounced = (next) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(next), 500);
  };

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const set = (key) => (e) => {
    const next = { ...style, [key]: e.target.value || null };
    setStyle(next);
    emitDebounced(next);
  };

  const reset = () => {
    clearTimeout(debounceRef.current);
    setStyle(EMPTY_STYLE);
    onChange(EMPTY_STYLE);
  };

  return (
    <div className="mt-4 rounded-lg border border-ink/10 bg-white/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink"
      >
        Customize style (optional)
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-ink/10 px-4 py-4 sm:grid-cols-2">
          <label className="text-xs text-ink/60">
            Font family
            <select
              value={style.fontFamily || ''}
              onChange={set('fontFamily')}
              className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink"
            >
              <option value="">Default</option>
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-ink/60">
            Font size (pt)
            <input
              type="number"
              min="6"
              max="72"
              value={style.fontSizePt || ''}
              onChange={set('fontSizePt')}
              placeholder="Default"
              className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink"
            />
          </label>

          <label className="text-xs text-ink/60">
            Text color
            <input
              type="color"
              value={style.color || '#1a1a1a'}
              onChange={set('color')}
              className="mt-1 h-9 w-full rounded-lg border border-ink/10 bg-white px-1.5 py-1"
            />
          </label>

          <label className="text-xs text-ink/60">
            Line spacing
            <input
              type="number"
              min="1"
              max="3"
              step="0.1"
              value={style.lineSpacing || ''}
              onChange={set('lineSpacing')}
              placeholder="Default"
              className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink"
            />
          </label>

          <div className="sm:col-span-2">
            <span className="text-xs text-ink/60">Alignment</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ALIGNMENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => {
                    const next = { ...style, alignment: style.alignment === a.value ? null : a.value };
                    setStyle(next);
                    emitDebounced(next);
                  }}
                  className={`rounded-lg border px-3 py-1 text-xs ${
                    style.alignment === a.value
                      ? 'border-ink bg-ink text-white [.theme-blossom_&]:border-blossom-500 [.theme-blossom_&]:bg-blossom-500'
                      : 'border-ink/10 bg-white text-ink/60'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1.5 text-xs text-ink/50 underline hover:text-ink"
            >
              <RotateCcw size={12} /> Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
