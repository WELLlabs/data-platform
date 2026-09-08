import React from "react";

// Prototype icon set — inline SVG, currentColor-driven.
const P = {
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  chev: <path d="m6 9 6 6 6-6"/>,
  chevLeft: <path d="m15 18-6-6 6-6"/>,
  close: <path d="M18 6 6 18M6 6l12 12"/>,
  dl: <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>,
  cite: <path d="M7 8h10M7 12h6M5 4h14v13l-4-3H5V4Z"/>,
  check: <path d="M20 6 9 17l-5-5"/>,
  verified: <><path d="m9 12 2 2 4-4"/><path d="M12 3l2.3 1.6 2.8-.2 1 2.6 2.3 1.6-.8 2.7.8 2.7-2.3 1.6-1 2.6-2.8-.2L12 21l-2.3-1.6-2.8.2-1-2.6L3.6 15.4l.8-2.7-.8-2.7L5.9 8.4l1-2.6 2.8.2Z"/></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  link: <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>,
  loc: <><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
  file: <path d="M14 3v5h5M6 3h9l5 5v13H6Z"/>,
  fmt: <><path d="M8 4H5v16h14V9l-5-5H8Z"/><path d="M8 13h8M8 17h5"/></>,
  lic: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a3 3 0 1 1 0 5"/></>,
  org: <path d="M4 21V7l6-4 6 4v14M9 21v-5h2v5M14 9h4v12M18 13h.01M18 17h.01"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v4h1"/></>,
  star: <path d="M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>,
  trophy: <><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3"/><path d="M12 12v3M9 20h6M10 20v-2.5a2 2 0 0 1 4 0V20"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  medal: <><circle cx="12" cy="15" r="6"/><path d="M8.5 9.5 6 3h4l2 4M15.5 9.5 18 3h-4l-2 4"/><path d="m12 12.6.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9.1 14.8l2-.3.9-1.9Z"/></>,
  google: null,
};

export function Ic({ name, size = 16, sw = 2, className, style }) {
  if (name === "google") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
        <path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6Z"/>
        <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1a6 6 0 0 1-5.6-4.1H2.9v2.6A10 10 0 0 0 12 22Z"/>
        <path fill="#FBBC05" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.6H2.9a10 10 0 0 0 0 8.8l3.5-2.6Z"/>
        <path fill="#EA4335" d="M12 6.1c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.9 7.6l3.5 2.6A6 6 0 0 1 12 6.1Z"/>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      {P[name] || null}
    </svg>
  );
}

export default Ic;
