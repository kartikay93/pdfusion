import React from 'react';
import { Sparkles, Circle } from 'lucide-react';
import { useTheme } from '../lib/ThemeContext.jsx';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isBlossom = theme === 'blossom';

  return (
    <button
      onClick={toggle}
      aria-pressed={isBlossom}
      title={isBlossom ? 'Switch to Studio theme' : 'Switch to Blossom theme'}
      className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors
        ${isBlossom
          ? 'border-blossom-200 bg-blossom-50 text-blossom-600 hover:bg-blossom-100'
          : 'border-slate-200 bg-white text-ink hover:bg-slate-50'}`}
    >
      {isBlossom ? <Sparkles size={15} /> : <Circle size={15} />}
      {isBlossom ? 'Blossom' : 'Studio'}
    </button>
  );
}
