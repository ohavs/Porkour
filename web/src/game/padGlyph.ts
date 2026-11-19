/**
 * Gamepad button glyphs (Xbox or PlayStation look, picked from the pad's name) in the HUD icon style, and which
 * device the player is using right now (`PADDEV.on`: the last input came from a gamepad → every prompt shows pad
 * buttons instead of keys / mouse buttons).
 */
export type PadG = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'LS' | 'RS' | 'L3' | 'R3' | 'DU' | 'DD' | 'DL' | 'DR' | 'DUD' | 'VIEW' | 'MENU';

export const PADDEV = { on: false, ps: false, listeners: [] as (() => void)[] };
/** Switch the prompts between keyboard / mouse and gamepad (called by `Input` when the device changes). */
export function setPadDev(on: boolean, ps = PADDEV.ps) {
  if (on === PADDEV.on && ps === PADDEV.ps) return;
  PADDEV.on = on; PADDEV.ps = ps;
  document.body.classList.toggle('padOn', on);
  for (const f of PADDEV.listeners) f();
}
export const onPadDev = (f: () => void) => { PADDEV.listeners.push(f); };
export const padOn = () => PADDEV.on;
/** Sony pads (DualShock / DualSense) by their USB vendor id or name. */
export const isPS = (id: string) => !/xbox|xinput|045e/i.test(id) && /054c|playstation|dualshock|dualsense|wireless controller/i.test(id);

const O = 'stroke="#3b2412" stroke-width="1.6" stroke-linejoin="round"';
const T = (s: string, x = 12, y = 16.2, size = 12, fill = '#fff') =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="Title, Arial Black, sans-serif" font-size="${size}" font-weight="bold" fill="${fill}">${s}</text>`;
const svg = (body: string, w = 24) => `<svg class="ic pg" viewBox="0 0 ${w} 24" width="${w}" height="24">${body}</svg>`;
const FACE_X: Record<string, [string, string]> = { A: ['#5cb85c', '#fff'], B: ['#e0453a', '#fff'], X: ['#3a8ee6', '#fff'], Y: ['#f2c230', '#3b2412'] };
/** PlayStation face symbols: cross, circle, square, triangle (same positions as A, B, X, Y). */
const FACE_PS: Record<string, string> = {
  A: '<path d="M8 8l8 8M16 8l-8 8" stroke="#8ab8ff" stroke-width="2.4" stroke-linecap="round"/>',
  B: '<circle cx="12" cy="12" r="4.6" fill="none" stroke="#ff7a7a" stroke-width="2.3"/>',
  X: '<rect x="7.8" y="7.8" width="8.4" height="8.4" fill="none" stroke="#f39ad9" stroke-width="2.2"/>',
  Y: '<path d="M12 7l5 8.6H7z" fill="none" stroke="#52d6a8" stroke-width="2.2" stroke-linejoin="round"/>',
};
const stick = (l: string, arrows: boolean) => svg(`<circle cx="12" cy="12" r="10.4" fill="#4a4752" ${O}/><circle cx="12" cy="12" r="6.6" fill="#6f6b7a"/>` +
  (arrows ? '<path d="M12 .9l2 2.4h-4zM12 23.1l2-2.4h-4zM.9 12l2.4 2v-4zM23.1 12l-2.4 2v-4z" fill="#ffd166"/>' : '') + T(l, 12, 15.6, 10));
const dpad = (lit: ('u' | 'd' | 'l' | 'r')[]) => {
  const arm = (d: 'u' | 'd' | 'l' | 'r', p: string) => `<path d="${p}" fill="${lit.includes(d) ? '#ffd166' : '#6f6b7a'}"/>`;
  return svg(`<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="#4a4752" ${O}/>` +
    arm('u', 'M10 3h4v6h-4z') + arm('d', 'M10 15h4v6h-4z') + arm('l', 'M3 10h6v4H3z') + arm('r', 'M15 10h6v4h-6z'));
};
const pill = (body: string) => svg(`<rect x="3" y="6.5" width="18" height="11" rx="5.5" fill="#4a4752" ${O}/>${body}`);

/** The glyph of one pad button (SVG string, sized like the other HUD icons). */
export function pg(g: PadG): string {
  const ps = PADDEV.ps;
  switch (g) {
    case 'A': case 'B': case 'X': case 'Y':
      return ps ? svg(`<circle cx="12" cy="12" r="10.4" fill="#2f2a3a" ${O}/>${FACE_PS[g]}`)
        : svg(`<circle cx="12" cy="12" r="10.4" fill="${FACE_X[g][0]}" ${O}/>${T(g, 12, 16.4, 13, FACE_X[g][1])}`);
    case 'LB': case 'RB':
      return svg(`<path d="M3 18V10a5 5 0 0 1 5-5h12a3 3 0 0 1 3 3v10z" fill="#4a4752" ${O} transform="${g === 'LB' ? '' : 'matrix(-1 0 0 1 26 0)'}"/>` +
        T(ps ? (g === 'LB' ? 'L1' : 'R1') : g, 13, 16.4, 10), 26);
    case 'LT': case 'RT':
      return svg(`<path d="M5 22V9a7 7 0 0 1 14 0v13z" fill="#4a4752" ${O}/><path d="M7.5 9a4.5 4.5 0 0 1 9 0" fill="none" stroke="#ffd166" stroke-width="1.8" stroke-linecap="round"/>` +
        T(ps ? (g === 'LT' ? 'L2' : 'R2') : g, 12, 18.6, 9.5));
    case 'LS': return stick('L', true);
    case 'RS': return stick('R', true);
    case 'L3': return stick('L3', false);
    case 'R3': return stick('R3', false);
    case 'DU': return dpad(['u']);
    case 'DD': return dpad(['d']);
    case 'DL': return dpad(['l']);
    case 'DR': return dpad(['r']);
    case 'DUD': return dpad(['u', 'd']);
    case 'VIEW': return pill('<rect x="8" y="9" width="5" height="4" rx=".8" fill="none" stroke="#fff" stroke-width="1.3"/><rect x="11" y="11" width="5" height="4" rx=".8" fill="#4a4752" stroke="#fff" stroke-width="1.3"/>');
    case 'MENU': return pill('<path d="M8.5 9.6h7M8.5 12h7M8.5 14.4h7" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>');
  }
}

/** Keyboard key (as written on the HUD key caps) → the pad button that does the same. */
export const KEY_PAD: Record<string, PadG> = {
  Q: 'B', C: 'X', E: 'Y', F: 'R3', R: 'RB', V: 'VIEW', B: 'DL', G: 'DR', Esc: 'MENU', W: 'LS', A: 'LS', S: 'LS', D: 'LS',
};
