// 16 px stroke icons, decorative (the text next to them carries the meaning).
const base = { className: 'icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export const IconLive = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="6" />
  </svg>
);
export const IconClock = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </svg>
);
export const IconSnow = () => (
  <svg {...base}>
    <path d="M8 2v12M2.5 5l11 6M13.5 5l-11 6" />
  </svg>
);
export const IconFlag = () => (
  <svg {...base}>
    <path d="M4 14V2.5M4 3h8l-1.5 2.5L12 8H4" />
  </svg>
);
export const IconWarn = () => (
  <svg {...base}>
    <path d="M8 2 14.5 13.5h-13z" />
    <path d="M8 6.5v3.2M8 11.6v.1" />
  </svg>
);
export const IconUp = () => (
  <svg {...base}>
    <path d="M8 3 13 11H3z" fill="currentColor" />
  </svg>
);
export const IconDown = () => (
  <svg {...base}>
    <path d="M8 13 3 5h10z" fill="currentColor" />
  </svg>
);
export const IconClose = () => (
  <svg {...base}>
    <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
  </svg>
);
