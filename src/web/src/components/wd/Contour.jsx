import React from "react";

// Decorative contour field (matches prototype `field(op)`).
export default function Contour({ op = 0.5 }) {
  const lines = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <div className="contourfield" aria-hidden="true">
      <svg viewBox="0 0 1200 500" fill="none" stroke="#1769AA" strokeWidth="1" opacity={op}>
        {lines.map((i) => (
          <path
            key={i}
            d={`M-60 ${60 + i * 56} C 220 ${10 + i * 56}, 460 ${130 + i * 56}, 720 ${60 + i * 56} S 1120 ${5 + i * 56}, 1300 ${90 + i * 56}`}
            strokeOpacity={(0.06 + i * 0.016).toFixed(3)}
          />
        ))}
      </svg>
    </div>
  );
}
