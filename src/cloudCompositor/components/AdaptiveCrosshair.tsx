import React from 'react';

interface Props {
  className?: string;
  size?: number; // pixel diameter
}

export function AdaptiveCrosshair({ className = "w-5 h-5", size = 20 }: Props) {
  return (
    <div className={`relative flex items-center justify-center pointer-events-none drop-shadow-xs ${className}`}>
      <svg viewBox="0 0 20 20" width={size} height={size} className="w-full h-full overflow-visible">
        {/* Outer Black Outline Strokes for high contrast over light backgrounds */}
        <line x1="10" y1="1" x2="10" y2="5" stroke="black" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="10" y1="15" x2="10" y2="19" stroke="black" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="1" y1="10" x2="5" y2="10" stroke="black" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="15" y1="10" x2="19" y2="10" stroke="black" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="10" r="3" fill="none" stroke="black" strokeWidth="1.6" />

        {/* Inner White Strokes for high contrast over dark backgrounds */}
        <line x1="10" y1="1" x2="10" y2="5" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="10" y1="15" x2="10" y2="19" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="1" y1="10" x2="5" y2="10" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="15" y1="10" x2="19" y2="10" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
        <circle cx="10" cy="10" r="3" fill="none" stroke="white" strokeWidth="0.8" />

        {/* Crisp Center Indicator */}
        <circle cx="10" cy="10" r="0.6" fill="black" />
        <circle cx="10" cy="10" r="0.3" fill="white" />
      </svg>
    </div>
  );
}
