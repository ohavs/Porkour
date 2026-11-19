/**
 * Universal menu icons (user 2026-11-19: "universal, familiar icons — that's what catches the eye and is understood"):
 * play, gear, gamepad, shirt, wrench, home, speaker, note, mouse, globe, monitor… in the game's cartoon style
 * (fat fills + a dark ink outline) so they read on the cream tiles and on the wood panel alike.
 */
const INK = '#2a170b';
const O = `stroke="${INK}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"`;
const svg = (body: string, s = 24) => `<svg class="ui" viewBox="0 0 24 24" width="${s}" height="${s}">${body}</svg>`;
/** A thick ink line under a coloured line (reads on any background). */
const line = (d: string, c: string, w = 2.6) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 2.2}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const GEAR = 'M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4zm9.2 4.9v-2.4l-2.5-.6a7 7 0 0 0-.7-1.8l1.3-2.2-1.7-1.7-2.2 1.3a7 7 0 0 0-1.8-.7L13.2 2.8h-2.4l-.6 2.5a7 7 0 0 0-1.8.7L6.2 4.7 4.5 6.4l1.3 2.2a7 7 0 0 0-.7 1.8l-2.5.6v2.4l2.5.6c.2.6.4 1.2.7 1.8l-1.3 2.2 1.7 1.7 2.2-1.3c.6.3 1.2.5 1.8.7l.6 2.5h2.4l.6-2.5a7 7 0 0 0 1.8-.7l2.2 1.3 1.7-1.7-1.3-2.2c.3-.6.5-1.2.7-1.8z';
const SPEAKER = `<path d="M3.5 9h4l5.3-4.3v14.6L7.5 15h-4z" fill="#fff6e6" ${O}/>`;

const B = {
  play: `<path d="M7 4.2v15.6a1 1 0 0 0 1.5.9l12.3-7.8a1 1 0 0 0 0-1.8L8.5 3.3A1 1 0 0 0 7 4.2z" fill="#fff6e6" ${O}/>`,
  close: line('M6.5 6.5l11 11M17.5 6.5l-11 11', '#ff8a6a', 3),
  gear: `<path d="${GEAR}" fill="#ffd166" ${O}/><circle cx="12" cy="12" r="2" fill="${INK}"/>`,
  pad: `<path d="M7.2 7h9.6a5 5 0 0 1 4.8 3.8l1 4.6a2.6 2.6 0 0 1-4.6 2.1L16.4 15H7.6l-1.6 2.5a2.6 2.6 0 0 1-4.6-2.1l1-4.6A5 5 0 0 1 7.2 7z" fill="#8fb8ff" ${O}/>` +
    `<path d="M7.2 9.4v4M5.2 11.4h4" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/><circle cx="15.8" cy="10.2" r="1.25" fill="#ff7a5a" ${O}/><circle cx="18.1" cy="12.5" r="1.25" fill="#9be06a" ${O}/>`,
  shirt: `<path d="M8.4 3.2 3 6.2l2.1 5 2.6-1.1V21h8.6V10.1l2.6 1.1 2.1-5-5.4-3a3.6 3.6 0 0 1-7.2 0z" fill="#ff9ad2" ${O}/>`,
  wrench: `<path d="M15 2.8a5 5 0 0 0-5.3 6.9L3.3 16.1a2 2 0 0 0 0 2.8l1.8 1.8a2 2 0 0 0 2.8 0l6.4-6.4A5 5 0 0 0 21.2 9l-3.2 3.1-2.9-.8-.8-2.9z" fill="#c9d3dc" ${O}/>`,
  home: `<path d="M3 11.5 12 3.6l9 7.9" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M5.2 10.2V20.5h13.6V10.2L12 4.3z" fill="#fff6e6" ${O}/><path d="M10 20.5v-6h4v6z" fill="#c98a4b" ${O}/><path d="M3 11.5 12 3.6l9 7.9" fill="none" stroke="#e2584a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -.6)"/>`,
  exit: `<path d="M4 3.5h9v17H4z" fill="#c98a4b" ${O}/><circle cx="10.6" cy="12" r="1.1" fill="${INK}"/>` + line('M13.5 12h7.5m-3.2-3.6L21.4 12l-3.6 3.6', '#fff6e6', 2.4),
  link: line('M10.2 13.8a4 4 0 0 0 5.7 0l2.9-2.9a4 4 0 0 0-5.7-5.7l-1.1 1.1', '#ffd166', 2.4) + line('M13.8 10.2a4 4 0 0 0-5.7 0l-2.9 2.9a4 4 0 0 0 5.7 5.7l1.1-1.1', '#ffd166', 2.4),
  check: line('M4.5 12.8 9.6 18 19.5 6.5', '#9be06a', 3.2),
  yes: line('M4.5 12.8 9.6 18 19.5 6.5', '#fff6e6', 3.2),
  speaker: SPEAKER + line('M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8', '#fff6e6', 1.9),
  muted: SPEAKER + line('M16 9l5.5 6M21.5 9 16 15', '#ff7a5a', 2.2),
  music: `<path d="M9 17.5V5.2l11-2.2v12.4" fill="none" stroke="${INK}" stroke-width="4.2" stroke-linejoin="round"/><path d="M9 17.5V5.2l11-2.2v12.4" fill="none" stroke="#ff9ad2" stroke-width="2" stroke-linejoin="round"/>` +
    `<ellipse cx="6.4" cy="17.8" rx="3.1" ry="2.6" fill="#ff9ad2" ${O}/><ellipse cx="17.4" cy="15.6" rx="3.1" ry="2.6" fill="#ff9ad2" ${O}/>`,
  mouse: `<rect x="6" y="2.8" width="12" height="18.4" rx="6" fill="#fff6e6" ${O}/><path d="M12 2.8v6.4M6 9.2h12" fill="none" ${O}/><rect x="11" y="4.6" width="2" height="3.2" rx="1" fill="#ffd166" ${O}/>`,
  globe: `<circle cx="12" cy="12" r="9" fill="#8fd0ff" ${O}/><path d="M5.5 8.5c2 .4 3 2 2.5 3.6s1 2.6 2.4 2.2M14 3.6c-.6 1.8.6 3 2 3.2s2.8 1.6 1.8 3.4-.2 3.4 1.6 3.8" fill="none" stroke="#5fb33a" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" ${O}/>`,
  monitor: `<rect x="2.5" y="3.5" width="19" height="13" rx="2" fill="#8fb8ff" ${O}/><path d="M9 21h6M12 16.5V21" fill="none" ${O} stroke-width="2.2"/><path d="m5.5 13.5 4-4 3 3 2-2 3.5 3" fill="none" stroke="#fff6e6" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`,
  full: line('M3.5 9V3.5H9M15 3.5h5.5V9M20.5 15v5.5H15M9 20.5H3.5V15', '#fff6e6', 2.2),
  sliders: line('M5 4v16M12 4v16M19 4v16', '#fff6e6', 1.6) + `<circle cx="5" cy="15" r="2.4" fill="#ffd166" ${O}/><circle cx="12" cy="8" r="2.4" fill="#ffd166" ${O}/><circle cx="19" cy="13" r="2.4" fill="#ffd166" ${O}/>`,
  gauge: `<path d="M2.8 17a9.2 9.2 0 1 1 18.4 0z" fill="#fff6e6" ${O}/><path d="M5.6 14.2h1.6M12 6.4v1.6M18.4 14.2h-1.6M7.6 9l1.1 1.1M16.4 9l-1.1 1.1" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` +
    line('M12 16.6l4.4-5.2', '#e2584a', 1.8) + `<circle cx="12" cy="16.6" r="1.6" fill="${INK}"/>`,
  shadow: `<ellipse cx="13" cy="19.5" rx="8.5" ry="2.4" fill="#5a3820" ${O}/><circle cx="9" cy="8.5" r="4.2" fill="#ffd166" ${O}/>` + line('M9 1.6v1.2M2.2 8.5h1.2M4.2 3.7l.9.9M13.8 3.7l-.9.9', '#ffd166', 1.4),
  grass: `<path d="M3 21c1-5 2-8 4-11-.5 4 0 7 1 11M8 21c.5-6 2.5-11 6-14-2 4-2.5 9-2 14M12 21c1-4 3.5-8 8-10-3 3-4.2 6.5-4.5 10z" fill="#7cc95a" ${O}/>`,
  bulb: `<path d="M12 2.8a6.6 6.6 0 0 0-3.8 12c.8.6 1.2 1.4 1.2 2.3v.6h5.2v-.6c0-.9.4-1.7 1.2-2.3A6.6 6.6 0 0 0 12 2.8z" fill="#ffe27a" ${O}/><path d="M9.4 20.4h5.2M10.2 17.7h3.6" fill="none" ${O} stroke-width="2"/>`,
  far: `<path d="M1.8 19.5 8.4 8.2l3.8 6.2 2.4-3.6 7.6 8.7z" fill="#a7c4a0" ${O}/><path d="m6.6 11.3 1.8-3.1 1.9 3.1-1 .8-.9-.7-.9.7z" fill="#fff6e6" stroke="none"/>`,
  pencil: `<path d="M15.6 3.6a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L8.6 20.2 3 21l.8-5.6z" fill="#ffd166" ${O}/><path d="m13.6 5.6 4.8 4.8M3.8 15.4l4.8 4.8" fill="none" ${O}/>`,
  sparkle: `<path d="M12 2.5c.8 4.8 2.8 6.9 7.5 7.6-4.7.8-6.7 2.8-7.5 7.6-.8-4.8-2.8-6.8-7.5-7.6 4.7-.7 6.7-2.8 7.5-7.6z" fill="#fff4b0" ${O}/><path d="M19 15.5c.4 2.2 1.2 3.1 3.2 3.4-2 .4-2.8 1.2-3.2 3.4-.4-2.2-1.2-3-3.2-3.4 2-.3 2.8-1.2 3.2-3.4z" fill="#ffd166" ${O}/>`,
  smooth: line('M3 20 3 15h4v-4h4V7h4V3h5', '#ff9a7a', 1.6) + line('M4 21C10 20 20 12 21 4', '#9be06a', 1.8),
  pixels: `<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1" fill="#8fb8ff" ${O}/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1" fill="#fff6e6" ${O}/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1" fill="#fff6e6" ${O}/><rect x="13" y="13" width="7.5" height="7.5" rx="1" fill="#8fb8ff" ${O}/>`,
  fps: `<rect x="2" y="5" width="20" height="14" rx="3" fill="#2f4a2a" ${O}/><text x="12" y="15.6" text-anchor="middle" font-size="8.4" font-weight="900" font-family="sans-serif" fill="#9be06a">FPS</text>`,
  updown: line('M8 4v16M4.6 7.4 8 4l3.4 3.4M16 20V4M12.6 16.6 16 20l3.4-3.4', '#fff6e6', 2),
  rumble: `<path d="M8.4 8h7.2a4 4 0 0 1 3.9 3.1l.8 3.6a2 2 0 0 1-3.6 1.7L15.4 15H8.6l-1.3 1.4a2 2 0 0 1-3.6-1.7l.8-3.6A4 4 0 0 1 8.4 8z" fill="#8fb8ff" ${O}/>` + line('M2 6.5 3.6 4.4M22 6.5l-1.6-2.1M6 3.6 6.6 2M18 3.6 17.4 2', '#ffd166', 1.4),
  tree: `<path d="M12 2.6 5 12.4h3.4L4.4 18h15.2l-4-5.6H19z" fill="#7cc95a" ${O}/><path d="M10.6 18h2.8v3.4h-2.8z" fill="#c98a4b" ${O}/>`,
  res: `<rect x="2.5" y="4" width="19" height="14" rx="2" fill="#8fb8ff" ${O}/>` + line('M6 8.4V7h1.4M18 8.4V7h-1.4M6 13.6V15h1.4M18 13.6V15h-1.4', '#fff6e6', 1.4) + `<path d="M9 21h6" ${O} stroke-width="2.2"/>`,
  auto: `<rect x="2.5" y="4" width="19" height="14" rx="2" fill="#8fb8ff" ${O}/>` + line('M8 11a4 4 0 0 1 7-2.6M16 11a4 4 0 0 1-7 2.6', '#fff6e6', 1.5) + `<path d="m15.6 6.4-.4 2.6-2.4-.5M8.4 15.6l.4-2.6 2.4.5" fill="none" stroke="#fff6e6" stroke-width="1.4" stroke-linecap="round"/><path d="M9 21h6" ${O} stroke-width="2.2"/>`,
  keys: `<rect x="1.8" y="6" width="20.4" height="12.4" rx="2.4" fill="#fff6e6" ${O}/><path d="M5.2 9.6h1.2M8.6 9.6h1.2M12 9.6h1.2M15.4 9.6h1.2M18.2 9.6h.6M5.2 12.4h1.2M8.6 12.4h1.2M12 12.4h1.2M15.4 12.4h3.4M7.6 15.2h8.8" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  cart: `<path d="M1.8 4h3l2.6 11.2h11.2l2.2-8H6.4" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 7.2h15.2l-2.2 8H7.4z" fill="#ffd166"/><path d="M1.8 4h3l2.6 11.2h11.2l2.2-8H6.4" fill="none" stroke="#fff6e6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="19.4" r="1.9" fill="#fff6e6" ${O}/><circle cx="17" cy="19.4" r="1.9" fill="#fff6e6" ${O}/>`,
  people: `<circle cx="8.2" cy="8" r="3.4" fill="#ffb3c7" ${O}/><path d="M1.8 20.5a6.4 6.4 0 0 1 12.8 0z" fill="#ffb3c7" ${O}/><circle cx="16.4" cy="8.8" r="3" fill="#8fd0ff" ${O}/><path d="M12.6 14.6a5.6 5.6 0 0 1 9.6 5.9h-6.4" fill="#8fd0ff" ${O}/>`,
  back: line('M20 12H5m5.5-6L4.5 12l6 6', '#fff6e6', 2.6),
  retry: line('M19.5 12a7.5 7.5 0 1 1-2.4-5.5', '#fff6e6', 2.4) + `<path d="m20.6 3.4-.3 5.4-5.3-.6z" fill="#fff6e6" ${O}/>`,
  plus: line('M12 4.5v15M4.5 12h15', '#9be06a', 3),
  enter: `<path d="M11 3.5h9v17h-9" fill="#c98a4b" ${O}/>` + line('M2.5 12h10m-3.4-3.6 3.6 3.6-3.6 3.6', '#fff6e6', 2.4),
  copy: `<rect x="3" y="7" width="11.5" height="13.5" rx="2" fill="#fff6e6" ${O}/><rect x="9" y="3" width="11.5" height="13.5" rx="2" fill="#ffd166" ${O}/>`,
  crown: `<path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5l-2 10H5z" fill="#ffd166" ${O}/><circle cx="12" cy="5" r="1.3" fill="#ff7a5a" ${O}/>`,
};
export type UiIcon = keyof typeof B;
/** A universal menu icon at a given size (px). */
export const ui = (k: UiIcon, s = 24) => svg(B[k], s);

/**
 * Graphics quality as gem pips (1–4 filled; user: the old bars "look like internet"); 0 = auto (a magic wand).
 */
export function bars(n: number, s = 18) {
  if (n <= 0) return svg(`<path d="M4 20 15.5 8.5" fill="none" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/><path d="M4 20 15.5 8.5" fill="none" stroke="#c98a4b" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M17.5 2.5l1.1 2.6 2.6 1.1-2.6 1.1-1.1 2.6-1.1-2.6-2.6-1.1 2.6-1.1z" fill="#ffd166" ${O}/><circle cx="8" cy="5.5" r="1.3" fill="#fff4b0"/><circle cx="20" cy="14" r="1.1" fill="#fff4b0"/>`, s);
  let b = '';
  for (let i = 0; i < 4; i++) {
    const x = 4.5 + i * 7.6, on = i < n;
    b += `<path d="M${x} 1.8 ${x + 3.4} 6 ${x} 10.2 ${x - 3.4} 6z" fill="${on ? '#e2453a' : 'rgba(42,23,11,.22)'}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>` +
      (on ? `<path d="M${x - 1.3} 4.8 ${x} 3.3" stroke="#ffd0c0" stroke-width="1.1" stroke-linecap="round"/>` : '');
  }
  return `<svg class="ui" viewBox="0 0 32 12" width="${Math.round(s * 1.6)}" height="${Math.round(s * 0.6)}">${b}</svg>`;
}
