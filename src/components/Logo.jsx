import React from 'react';
import { useTheme } from '../lib/ThemeContext.jsx';

export default function Logo({ size = 32, withWordmark = true }) {
  const { theme } = useTheme();
  const accent = theme === 'blossom' ? '#F2679A' : '#3F4FDB';
  const accentSoft = theme === 'blossom' ? '#FFC7DB' : '#C7CCF7';

  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* two source pages, offset, fusing into one on the right */}
        <rect x="4" y="7" width="16" height="22" rx="2.5" transform="rotate(-8 12 18)" fill={accentSoft} />
        <rect x="9" y="9" width="16" height="22" rx="2.5" transform="rotate(6 17 20)" fill={accent} fillOpacity="0.55" />
        <rect x="15" y="9" width="19" height="24" rx="2.5" fill={accent} />
        <path d="M20 16.5h9M20 21h9M20 25.5h5.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {withWordmark && (
        <span className="font-display text-lg tracking-tight text-ink wordmark">
          PDFusion
        </span>
      )}
    </div>
  );
}
