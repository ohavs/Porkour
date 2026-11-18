/**
 * Small HUD icons (24×24 SVG, cartoon: fat shapes with a dark brown outline) so the HUD can show things instead of
 * telling them: what a key does, what's going on with you, what just happened over someone's head.
 */
const O = 'stroke="#3b2412" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';
const svg = (body: string, w = 24) => `<svg class="ic" viewBox="0 0 ${w} 24" width="${w}" height="24">${body}</svg>`;

export const IC = {
  /** Mouse with the left / right button lit. */
  lmb: svg(`<rect x="5" y="2" width="14" height="20" rx="7" fill="#fff6e6" ${O}/><path d="M12 2v8H5V9a7 7 0 0 1 7-7z" fill="#ffd166" ${O}/><path d="M12 2v8M5 10h14" fill="none" ${O}/>`),
  rmb: svg(`<rect x="5" y="2" width="14" height="20" rx="7" fill="#fff6e6" ${O}/><path d="M12 2v8h7V9a7 7 0 0 0-7-7z" fill="#ffd166" ${O}/><path d="M12 2v8M5 10h14" fill="none" ${O}/>`),
  /** Hoof grabbing. */
  grab: svg(`<path d="M6 13V8.5a1.6 1.6 0 0 1 3.2 0V12m0-5.5a1.6 1.6 0 0 1 3.2 0V12m0-4.6a1.6 1.6 0 0 1 3.2 0V12m0-2.6a1.6 1.6 0 0 1 3.2 0v4.8a7 7 0 0 1-7 7h-.6A6.6 6.6 0 0 1 6 13z" fill="#ffb3c7" ${O}/>`),
  /** Put it down. */
  drop: svg(`<path d="M12 3v11m-5-5 5 5 5-5" fill="none" stroke="#fff6e6" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke="#ffd166" stroke-width="3" stroke-linecap="round"/>`),
  /** Throw (an arc). */
  throw: svg(`<path d="M3 20C5 9 13 5 20 6" fill="none" stroke="#fff6e6" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 4.2"/><path d="m15.5 2.6 5.3 3.2-3.6 4.9" fill="none" stroke="#ffd166" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="19" r="2.6" fill="#ffd166" ${O}/>`),
  /** Hold the button (a filling ring). */
  hold: svg(`<circle cx="12" cy="12" r="8" fill="none" stroke="rgba(255,246,230,.3)" stroke-width="3.4"/><path d="M12 4a8 8 0 1 1-7.6 10.5" fill="none" stroke="#ffd166" stroke-width="3.4" stroke-linecap="round"/>`),
  fist: svg(`<rect x="5" y="6" width="13" height="12" rx="4.5" fill="#ffb3c7" ${O}/><path d="M9 6v5m4-5v5m-8 2h6" fill="none" ${O}/><path d="M19 8l3-2M19.5 12h3M19 16l3 2" stroke="#ffd166" stroke-width="2" stroke-linecap="round"/>`),
  /** Whack with a weapon. */
  whack: svg(`<rect x="3" y="3" width="11" height="7" rx="2" transform="rotate(-35 8.5 6.5)" fill="#c9ced8" ${O}/><path d="m10 10 9 10" stroke="#8a5a35" stroke-width="3.4" stroke-linecap="round"/><path d="M17 3.5l2-2M20 7l3-.5" stroke="#ffd166" stroke-width="2" stroke-linecap="round"/>`),
  check: svg(`<circle cx="12" cy="12" r="10" fill="#7cc95a" ${O}/><path d="m7 12.5 3.4 3.4L17.5 8.6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`),
  lock: svg(`<path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#c9ced8" stroke-width="3"/><rect x="5" y="10.5" width="14" height="11" rx="2.5" fill="#ffd166" ${O}/><circle cx="12" cy="15.5" r="1.6" fill="#3b2412"/><path d="M12 16.5v2.2" ${O}/>`),
  /** Mash the key. */
  mash: svg(`<rect x="2" y="9" width="20" height="9" rx="3" fill="#fff6e6" ${O}/><path d="M6 6 4.5 3.5M12 5.5V2.5M18 6l1.5-2.5" stroke="#ffd166" stroke-width="2.2" stroke-linecap="round"/>`),
  /** Hidden (closed eye with leaves). */
  hidden: svg(`<path d="M3 11c4 5 14 5 18 0" fill="none" stroke="#9be36a" stroke-width="2.6" stroke-linecap="round"/><path d="M6 14.5 4.5 17M12 16v3M18 14.5l1.5 2.5" stroke="#9be36a" stroke-width="2.2" stroke-linecap="round"/>`),
  /** Seen / head sticking out (open eye). */
  eye: svg(`<path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z" fill="#fff6e6" ${O}/><circle cx="12" cy="12" r="3.6" fill="#3b2412"/><circle cx="13.2" cy="10.8" r="1.1" fill="#fff"/>`),
  trap: svg(`<path d="M3 15a9 7 0 0 1 18 0z" fill="#9aa0aa" ${O}/><path d="m5 15 2-3 2 3 2-3 2 3 2-3 2 3 2-3 1 3" fill="none" stroke="#fff6e6" stroke-width="1.6" stroke-linejoin="round"/><path d="M2 18h20" stroke="#ff5a3c" stroke-width="2.6" stroke-linecap="round"/>`),
  flame: svg(`<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3-1-3 0-6 1-9z" fill="#ff7a3c" ${O}/><path d="M12 13c1.5 1.5 2.5 2.5 2.5 4a2.5 2.5 0 0 1-5 0c0-1.5 1-2.5 2.5-4z" fill="#ffd166"/>`),
  /** In the light (a lit lantern's glow). */
  light: svg(`<circle cx="12" cy="12" r="5" fill="#ffd166" ${O}/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" stroke="#ffd166" stroke-width="2.2" stroke-linecap="round"/>`),
  mud: svg(`<path d="M12 3c3 4.5 6 8 6 11a6 6 0 0 1-12 0c0-3 3-6.5 6-11z" fill="#8a5a35" ${O}/><circle cx="10" cy="14" r="1.6" fill="#b07a4a"/>`),
  snow: svg(`<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7" stroke="#eaf4ff" stroke-width="2.6" stroke-linecap="round"/><path d="m9.5 3.5 2.5 2.5 2.5-2.5M9.5 20.5 12 18l2.5 2.5" fill="none" stroke="#eaf4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  /** Playing dead (pig on its back). */
  dead: svg(`<ellipse cx="12" cy="15" rx="8" ry="5" fill="#ffb3c7" ${O}/><path d="M7 10V7m3.5 3V6.5m3 3.5V6.5M17 10V7" stroke="#ffb3c7" stroke-width="2.4" stroke-linecap="round"/><path d="m8 15 2 2m0-2-2 2m6-2 2 2m0-2-2 2" stroke="#3b2412" stroke-width="1.4" stroke-linecap="round"/>`),
  pig: svg(`<circle cx="12" cy="13" r="8" fill="#ffb3c7" ${O}/><path d="M6 7 4.5 3.5 9 5.5M18 7l1.5-3.5L15 5.5" fill="#ffb3c7" ${O}/><ellipse cx="12" cy="15" rx="3.6" ry="2.6" fill="#ff8fab" ${O}/><circle cx="10.8" cy="15" r=".8" fill="#3b2412"/><circle cx="13.2" cy="15" r=".8" fill="#3b2412"/><circle cx="9" cy="10.5" r="1" fill="#3b2412"/><circle cx="15" cy="10.5" r="1" fill="#3b2412"/>`),
  /** Footprints in the snow. */
  feet: svg(`<ellipse cx="8" cy="16" rx="2.6" ry="3.6" fill="#9db2d4" ${O}/><ellipse cx="15.5" cy="8" rx="2.6" ry="3.6" fill="#9db2d4" ${O}/><path d="M8 13.2v5.6M15.5 5.2v5.6" stroke="#3b2412" stroke-width="1.2"/>`),
  /** Dizzy stars. */
  stars: svg(`<path d="m12 2 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 7.3l5-.7z" fill="#fff1a8" ${O}/><circle cx="4" cy="19" r="2" fill="#fff1a8"/><circle cx="19.5" cy="19.5" r="1.6" fill="#fff1a8"/>`),
  bee: svg(`<ellipse cx="13" cy="14" rx="7" ry="5" fill="#ffd23a" ${O}/><path d="M11 9.4v9.2M15 9.4v9.2" stroke="#3b2412" stroke-width="2"/><ellipse cx="10" cy="7" rx="3" ry="4" fill="#dff2ff" ${O} transform="rotate(-30 10 7)"/><path d="M20 14h3" ${O}/>`),
  splash: svg(`<path d="M6 4c1.5 2.5 3 4.2 3 5.8a3 3 0 0 1-6 0C3 8.2 4.5 6.5 6 4zM17 7c2 3 4 5 4 7a4 4 0 0 1-8 0c0-2 2-4 4-7zM9 14c1.3 2 2.5 3.3 2.5 4.6a2.5 2.5 0 0 1-5 0c0-1.3 1.2-2.6 2.5-4.6z" fill="#8fd3ff" ${O}/>`),
  /** ! burst (you've been noticed). */
  bang: svg(`<path d="m12 1 2.6 5.4 5.9-1.6-2.5 5.6L23 13.7l-5.8 1.6 1 5.9-5.3-3L8 22l-.4-6L2 13.8l4.9-3.4L4.6 5l5.6 1.4z" fill="#ff5a3c" ${O}/><path d="M12 7.5v5.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.4" fill="#fff"/>`),
  /** Bob's moods / doings. */
  question: svg(`<circle cx="12" cy="12" r="10" fill="#ffd166" ${O}/><path d="M9 9.2a3 3 0 1 1 4.4 2.7c-1 .5-1.4 1.1-1.4 2.1" fill="none" stroke="#3b2412" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.4" fill="#3b2412"/>`),
  alarm: svg(`<circle cx="12" cy="12" r="10" fill="#ff5a3c" ${O}/><path d="M12 6.5v7" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.5" fill="#fff"/>`),
  work: svg(`<path d="M14.5 3.5a5 5 0 0 0-5.7 6.8l-6 6a2 2 0 0 0 2.9 2.9l6-6a5 5 0 0 0 6.8-5.7l-3 3-2.8-.7-.7-2.8z" fill="#c9ced8" ${O}/>`),
  walk: svg(`<circle cx="13" cy="4.5" r="2.4" fill="#ffd9b8" ${O}/><path d="M12.5 8 10 14l3 3v5M10 14l-3 7M12.5 8l4 4 3-1M12 10l-4 2-1 3" fill="none" stroke="#fff6e6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  zzz: svg(`<path d="M4 9h6l-6 7h6M13 4h5l-5 6h5M16 14h4l-4 5h4" fill="none" stroke="#cfe8ff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  note: svg(`<path d="M9 18V5l11-2v13" fill="none" stroke="#ff9ad2" stroke-width="2.6"/><circle cx="6.5" cy="18" r="3" fill="#ff9ad2" ${O}/><circle cx="17.5" cy="16" r="3" fill="#ff9ad2" ${O}/>`),
  cough: svg(`<path d="M7 18a4 4 0 0 1-.6-8A5 5 0 0 1 16 8.5 3.8 3.8 0 0 1 17.5 18z" fill="#b6e36a" ${O}/>`),
  /** Bob's outhouse (a door with a moon). */
  loo: svg(`<path d="M4 9 12 3l8 6" fill="#8a5a35" ${O}/><rect x="5.5" y="8" width="13" height="14" rx="1" fill="#b9814a" ${O}/><rect x="8.5" y="11" width="7" height="11" fill="#d9a46a" ${O}/><path d="M13.6 13.2a1.9 1.9 0 1 0 0 3.4 2.4 2.4 0 0 1 0-3.4z" fill="#3b2412"/>`),
  /** Too heavy alone: two pigs needed. */
  /** An old telephone receiver. */
  phone: svg(`<path d="M5.5 4.5c1.6-1.3 3.4-1 4.2.4l1.3 2.4c.6 1.1.2 2.2-.8 2.8l-1.1.6c.9 2.3 2.5 4 4.9 5l.7-1c.7-.9 1.9-1.2 2.9-.5l2.2 1.5c1.3.9 1.4 2.8.1 4.2-1.5 1.6-4 2-6.9.4C8.6 17.9 5.2 13.7 4 9.3c-.6-2.1 0-3.8 1.5-4.8z" fill="#3b2f2a" ${O}/><path d="M15 3.5a6 6 0 0 1 5.5 5.5M15 7a2.6 2.6 0 0 1 2 2" fill="none" stroke="#ffd166" stroke-width="2" stroke-linecap="round"/>`),
  /** A plug pulled out of its socket. */
  plug: svg(`<rect x="2.5" y="6" width="7" height="12" rx="2" fill="#c9ced8" ${O}/><path d="M5 10h2M5 14h2" ${O}/><rect x="13" y="8" width="6.5" height="8" rx="1.6" fill="#3b2f2a" ${O}/><path d="M13 10.3h-2.4M13 13.7h-2.4" stroke="#ffd166" stroke-width="1.8" stroke-linecap="round"/><path d="M19.5 12c2 0 2.5 2 2.5 4v4" fill="none" stroke="#3b2f2a" stroke-width="2.2" stroke-linecap="round"/>`),
  /** An old TV with rabbit ears. */
  tv: svg(`<path d="M9 7 6 2.5M15 7l3-4.5" stroke="#3b2412" stroke-width="1.8" stroke-linecap="round"/><rect x="2.5" y="7" width="19" height="13.5" rx="2.4" fill="#9a6a3c" ${O}/><rect x="5" y="9.3" width="11" height="9" rx="2" fill="#8fd3ff" ${O}/><circle cx="18.7" cy="11.5" r="1.2" fill="#ffd166"/><circle cx="18.7" cy="15.5" r="1.2" fill="#ffd166"/>`),
  /** A grandfather clock. */
  clock: svg(`<path d="M8 4.5 12 2l4 2.5V22H8z" fill="#7a4a26" ${O}/><circle cx="12" cy="8" r="3" fill="#fff6e6" ${O}/><path d="M12 6.4V8l1.2.8" fill="none" stroke="#3b2412" stroke-width="1.2" stroke-linecap="round"/><rect x="10" y="12.5" width="4" height="7" rx="1" fill="#ffd166" opacity=".35" ${O}/><path d="M12 12.8v4" stroke="#ffd166" stroke-width="1.4"/><circle cx="12" cy="17.6" r="1.3" fill="#ffd166" ${O}/>`),
  two: svg(`<ellipse cx="8" cy="14" rx="6" ry="4.6" fill="#ffb3c7" ${O}/><ellipse cx="17" cy="11.5" rx="5.6" ry="4.3" fill="#ff9ab4" ${O}/><circle cx="20.6" cy="11" r="1.6" fill="#ff7aa0" ${O}/><circle cx="11.8" cy="13.6" r="1.6" fill="#ff7aa0" ${O}/><path d="M5 18.4v2.6M10 18.4v2.6M15 15.6v2.4M19.5 15.6v2.4" ${O}/>`),
  cart: svg(`<path d="M2 4h3l2.5 11h11L21 7H6.5" fill="none" stroke="#fff6e6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="19.5" r="1.8" fill="#ffd166" ${O}/><circle cx="17" cy="19.5" r="1.8" fill="#ffd166" ${O}/>`),
  aim: svg(`<circle cx="12" cy="12" r="8" fill="none" stroke="#ff5a3c" stroke-width="2.6"/><circle cx="12" cy="12" r="2.4" fill="#ff5a3c"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="#ff5a3c" stroke-width="2.4" stroke-linecap="round"/>`),
  carry: svg(`<circle cx="12" cy="13" r="7" fill="#ffb3c7" ${O}/><path d="M5 7l3 3m11-3-3 3" stroke="#ffd9b8" stroke-width="3" stroke-linecap="round"/><path d="m9 13 1.5 1.5M9 14.5 10.5 13m3.5 0 1.5 1.5M14 14.5l1.5-1.5" stroke="#3b2412" stroke-width="1.3"/>`),
  /** Places a waypoint can point at. */
  stash: svg(`<circle cx="12" cy="12" r="9.5" fill="#ffd166" ${O}/><circle cx="12" cy="12" r="6" fill="none" stroke="#c98a1b" stroke-width="1.6"/><path d="M12 8.5v7" stroke="#c98a1b" stroke-width="2" stroke-linecap="round"/>`),
  water: svg(`<path d="M12 3c3 4.5 6 8 6 11a6 6 0 0 1-12 0c0-3 3-6.5 6-11z" fill="#8fd3ff" ${O}/>`),
  well: svg(`<path d="M4 9 12 3l8 6" fill="#c8402e" ${O}/><path d="M6 9v12M18 9v12" ${O}/><rect x="4" y="14" width="16" height="7" rx="1.5" fill="#9aa0aa" ${O}/>`),
  house: svg(`<path d="M3 11 12 3l9 8v10H3z" fill="#e8c9a0" ${O}/><rect x="10" y="14" width="4" height="7" fill="#8a5a35" ${O}/>`),
  apple: svg(`<circle cx="9" cy="14" r="6" fill="#e0302c" ${O}/><circle cx="15" cy="14" r="6" fill="#e0302c" ${O}/><path d="M12 8c0-2 1-4 2-5" stroke="#5a3a1e" stroke-width="2" fill="none"/>`),
  bob: svg(`<circle cx="12" cy="13" r="8" fill="#f3b38f" ${O}/><path d="M4 9h16" stroke="#f0cb6c" stroke-width="3.4" stroke-linecap="round"/><circle cx="9" cy="12.5" r="1.2" fill="#3b2412"/><circle cx="15" cy="12.5" r="1.2" fill="#3b2412"/><path d="M8.5 16.5c2 1.2 5 1.2 7 0" stroke="#7a4a2a" stroke-width="2.2" stroke-linecap="round"/>`),
  gate: svg(`<path d="M3 5v16M21 5v16M3 8h18M3 13h18M3 18h18M5 18 19 8" stroke="#c9a06a" stroke-width="2.4" stroke-linecap="round"/><circle cx="18.5" cy="13" r="2" fill="#ff5a3c" ${O}/>`),
  wolf: svg(`<path d="M4 4l4 5h8l4-5v9a8 8 0 0 1-16 0z" fill="#7d8696" ${O}/><circle cx="9" cy="12" r="1.2" fill="#ffd166"/><circle cx="15" cy="12" r="1.2" fill="#ffd166"/><path d="M10 16h4l-2 2z" fill="#3b2412"/>`),
  /** Snacks: a cigarette with smoke; eat (a can + a bite); the 4 boosts. */
  cig: svg(`<path d="M7 9c-1.5-1.5 0-3 1.4-3.6C10 4.8 9.5 3 8.6 2M11 9c-1.2-1.2 0-2.6 1.2-3.1" fill="none" stroke="#d6d6d6" stroke-width="1.8" stroke-linecap="round"/><rect x="2" y="13" width="20" height="5" rx="1.5" fill="#faf6ef" ${O}/><rect x="2" y="13" width="5" height="5" rx="1.2" fill="#d98b3a" ${O}/><circle cx="21" cy="15.5" r="2" fill="#ff5a1f"/>`),
  eat: svg(`<rect x="4" y="7" width="14" height="14" rx="2.5" fill="#c9ced8" ${O}/><rect x="4" y="10" width="14" height="7" fill="#e8792e" ${O}/><path d="M15 3c3 0 5 2 5 5" fill="none" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round"/><path d="M19 4.5 21 3" stroke="#ffd166" stroke-width="2" stroke-linecap="round"/>`),
  boost_beans: svg(`<path d="M5 18a4 4 0 0 1-.4-8A5 5 0 0 1 14 8.6 3.6 3.6 0 0 1 15.5 15" fill="#9ccf4f" ${O}/><ellipse cx="16" cy="17" rx="4.6" ry="3.2" fill="#ff5a2a" ${O}/><ellipse cx="9.5" cy="19" rx="3.4" ry="2.4" fill="#ff7a3a" ${O}/>`),
  boost_spinach: svg(`<path d="M5 20c0-6 2-9 5-10l-1-4 4-1 2 5c3 1 5 3 5 6 0 3-3 4-6 4z" fill="#ffb3c7" ${O}/><path d="M11 14c1.5-1 3.5-1 5 .5" fill="none" ${O}/><path d="M16 4c3 1 4 3 3 6-3-1-4-3-3-6z" fill="#3f9d3a" ${O}/>`),
  boost_energy: svg(`<path d="M13.5 1.5 4.5 13.5h6l-2 9 10-13h-6.2z" fill="#ffe14a" ${O}/>`),
  boost_dogfood: svg(`<path d="M6.6 9.6a2.6 2.6 0 1 1 3.8-3.4l3.4 3.4a2.6 2.6 0 1 1 3.4 3.8 2.6 2.6 0 1 1-3.4 3.8l-3.4-3.4a2.6 2.6 0 1 1-3.8-3.4z" fill="#fff4e6" ${O} transform="rotate(10 12 12)"/>`),
  // ---- chain modes (farms 6 / 7)
  /** A plain mouse (move it). */
  mouse: svg(`<rect x="6" y="2" width="12" height="20" rx="6" fill="#fff6e6" ${O}/><path d="M12 2v6" fill="none" ${O}/>`),
  /** Cannabis leaf (7 leaflets). */
  leaf: svg(`<g fill="#5cb83d" ${O}><path d="M12 13C11 8 11 4 12 1c1 3 1 7 0 12z"/><path d="M12 13c-2.5-3-5-5-8.5-6 1.5 3 4.5 5 8.5 6z"/><path d="M12 13c2.5-3 5-5 8.5-6-1.5 3-4.5 5-8.5 6z"/><path d="M12 13.5c-3-.5-6 0-9 2 3 1 6 .4 9-2z"/><path d="M12 13.5c3-.5 6 0 9 2-3 1-6 .4-9-2z"/></g><path d="M12 13v9" fill="none" ${O}/>`),
  /** Watering can pouring. */
  can: svg(`<path d="M5 9h10v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="#6fb7e8" ${O}/><path d="M15 12l6-5" fill="none" ${O}/><path d="M7 9a4 4 0 0 1 6 0" fill="none" ${O}/><path d="M21 9v3M19.5 11v3" stroke="#4fb3ff" stroke-width="1.6" stroke-linecap="round"/>`),
  /** Harvest: sickle. */
  sickle: svg(`<path d="M6 21l5-6" fill="none" stroke="#8a5a2a" stroke-width="3" stroke-linecap="round"/><path d="M11 15C8 9 11 3 18 3c-4 2-6 6-4 11z" fill="#cfd6de" ${O}/>`),
  /** Grinder (cog). */
  gear: svg(`<path d="M10 2h4l.6 2.6 2.3 1 2.3-1.4 2.8 2.8-1.4 2.3 1 2.3 2.4.4v4l-2.6.6-1 2.3 1.4 2.3-2.8 2.8-2.3-1.4-2.3 1-.4 2.4h-4l-.6-2.6-2.3-1-2.3 1.4-2.8-2.8 1.4-2.3-1-2.3L2 14v-4l2.6-.6 1-2.3-1.4-2.3 2.8-2.8 2.3 1.4 2.3-1z" fill="#c9ced8" ${O} transform="scale(.92) translate(1 1)"/><circle cx="12" cy="12" r="3.5" fill="#5cb83d" ${O}/>`),
  /** A rolled joint with a curl of smoke. */
  joint: svg(`<path d="M3 17l15-6 2 3-15 6z" fill="#fff6e6" ${O}/><path d="M18 11l2 3 1.6-.8-1.8-3z" fill="#ff8a3a" ${O}/><path d="M20 8c-1-1.5 1-2.5 0-4.5" fill="none" stroke="#c8c8c8" stroke-width="1.6" stroke-linecap="round"/>`),
  /** Bong. */
  bong: svg(`<path d="M9 2h5v9l3 4a5 5 0 0 1-4 7h-3a5 5 0 0 1-4-7l3-4z" fill="#8fdcc8" ${O}/><path d="M6.6 16.5h10" stroke="#4fb3ff" stroke-width="2"/><path d="M14 15l5-4 1.4 1.4" fill="none" ${O}/>`),
  /** Cookie. */
  cookie: svg(`<circle cx="12" cy="12" r="9" fill="#d9a35a" ${O}/><circle cx="9" cy="9" r="1.4" fill="#5a3518"/><circle cx="14.5" cy="11" r="1.4" fill="#5a3518"/><circle cx="10" cy="15" r="1.4" fill="#5a3518"/><path d="M15 15l1 1M13 7l1 0" stroke="#5cb83d" stroke-width="1.6" stroke-linecap="round"/>`),
  /** Oven. */
  oven: svg(`<rect x="3" y="3" width="18" height="18" rx="2" fill="#e8e1d6" ${O}/><rect x="6" y="9" width="12" height="9" rx="1.5" fill="#ff9a3a" ${O}/><circle cx="8" cy="6" r="1.2" fill="#3b2412"/><circle cx="12" cy="6" r="1.2" fill="#3b2412"/>`),
  /** Lighter with a flame. */
  lighter: svg(`<rect x="7" y="10" width="10" height="12" rx="2" fill="#ff5a6a" ${O}/><rect x="9" y="7" width="6" height="3" fill="#c9ced8" ${O}/><path d="M12 7c-2-2-1-4 0-6 1 2 2 4 0 6z" fill="#ffb13a" ${O}/>`),
  /** Rolling papers. */
  paper: svg(`<rect x="4" y="6" width="16" height="13" rx="1.5" fill="#fff6e6" ${O}/><path d="M7 10h10M7 13h10" stroke="#d8c8a8" stroke-width="1.4"/><rect x="4" y="15" width="16" height="4" fill="#5cb83d" ${O}/>`),
  /** Butter / stick of magic butter. */
  butter: svg(`<path d="M3 13l5-5h13v7l-5 5H3z" fill="#ffe27a" ${O}/><path d="M3 13h13l5-5M16 13v7" fill="none" ${O}/>`),
  /** Mixing bowl. */
  bowl: svg(`<path d="M3 10h18a9 8 0 0 1-18 0z" fill="#9fd3ea" ${O}/><path d="M15 10l5-8" fill="none" stroke="#c98a4a" stroke-width="2.4" stroke-linecap="round"/>`),
  /** Beer mug with foam. */
  beer: svg(`<rect x="5" y="7" width="11" height="14" rx="2" fill="#ffc23a" ${O}/><path d="M16 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" fill="none" ${O}/><path d="M4.5 8a2.5 2.5 0 0 1 3-3.5A3 3 0 0 1 13 4a2.5 2.5 0 0 1 3.5 4z" fill="#fffaf0" ${O}/>`),
  /** Barrel. */
  barrel: svg(`<path d="M6 3h12c2 6 2 12 0 18H6C4 15 4 9 6 3z" fill="#b5793d" ${O}/><path d="M5 8h14M5 16h14" stroke="#5c5f66" stroke-width="2"/>`),
  /** Wheat ear. */
  wheat: svg(`<path d="M12 22V6" fill="none" stroke="#c9a24a" stroke-width="2" stroke-linecap="round"/><g fill="#ffd166" ${O}><ellipse cx="9.5" cy="8" rx="2" ry="3" transform="rotate(-30 9.5 8)"/><ellipse cx="14.5" cy="8" rx="2" ry="3" transform="rotate(30 14.5 8)"/><ellipse cx="9.5" cy="13" rx="2" ry="3" transform="rotate(-30 9.5 13)"/><ellipse cx="14.5" cy="13" rx="2" ry="3" transform="rotate(30 14.5 13)"/><ellipse cx="12" cy="4" rx="1.8" ry="2.8"/></g>`),
  /** Fire (kettle / kiln). */
  fire: svg(`<path d="M12 22c-5 0-7-3-7-6 0-4 4-6 4-10 3 2 3 5 3 5s1-2 1-4c4 3 6 6 6 9 0 3-2 6-7 6z" fill="#ff7a2a" ${O}/><path d="M12 22c-2 0-3-1-3-3s2-3 2-5c2 1 4 3 4 5s-1 3-3 3z" fill="#ffd166"/>`),
  /** Balance (a pig on a log). */
  beam: svg(`<path d="M2 19h20" stroke="#8a5a2a" stroke-width="4" stroke-linecap="round"/><path d="M12 17V9" fill="none" ${O}/><circle cx="12" cy="7" r="3" fill="#ffb3c8" ${O}/><path d="M5 11l7-2 7-2" fill="none" ${O}/>`),
  /** Heart (a hug). */
  heart: svg(`<path d="M12 21C5 16 2 12 2 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 10 2.5C22 12 19 16 12 21z" fill="#ff6fa8" ${O}/>`),
  /** Visions: a swirly eye. */
  swirl: svg(`<circle cx="12" cy="12" r="10" fill="#b57bff" ${O}/><path d="M12 12a1.5 1.5 0 1 1 1.5 1.5A3 3 0 1 1 10.5 9a4.5 4.5 0 1 1-3 6" fill="none" stroke="#fff6e6" stroke-width="1.8" stroke-linecap="round"/>`),
  /** A cloud (lie back and watch them). */
  cloud: svg(`<path d="M6 19a4 4 0 0 1-.5-8A6 6 0 0 1 17 9a4.5 4.5 0 0 1 1 10z" fill="#ffffff" ${O}/>`),
  /** Seeds in a hoof. */
  seed: svg(`<ellipse cx="8" cy="12" rx="2.4" ry="3.4" fill="#c9a24a" ${O} transform="rotate(-20 8 12)"/><ellipse cx="15" cy="9" rx="2.4" ry="3.4" fill="#c9a24a" ${O} transform="rotate(25 15 9)"/><ellipse cx="14" cy="17" rx="2.4" ry="3.4" fill="#c9a24a" ${O}/>`),
  /** Tip it over: pour (a tipped jug, a stream). */
  pour: svg(`<path d="M3 8l9-4 3 6-9 4z" fill="#6fb7e8" ${O}/><path d="M15 10l2.5 1.2" fill="none" ${O}/><path d="M18 12c.5 2.5-.3 4.5 0 7M20.5 13c.4 2 0 3.5.2 5.5" fill="none" stroke="#4fb3ff" stroke-width="2" stroke-linecap="round"/><path d="M14 21h9" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round"/>`),
  /** Reach further: the mouse wheel (rolled forward) + a stretched arm. */
  reach: svg(`<rect x="2" y="5" width="9" height="15" rx="4.5" fill="#fff6e6" ${O}/><rect x="5.4" y="7.5" width="2.2" height="4.5" rx="1.1" fill="#ffd166" ${O}/><path d="M13 13h6" stroke="#ffb3c7" stroke-width="3.4" stroke-linecap="round"/><path d="M18 9.5l4 3.5-4 3.5" fill="none" stroke="#ffd166" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`),
  /** Lick it (a tongue). */
  tongue: svg(`<path d="M5 8h14" stroke="#ffb3c7" stroke-width="3" stroke-linecap="round"/><path d="M8 8v6a4 4 0 0 0 8 0V8z" fill="#ff6f8f" ${O}/><path d="M12 9v5" stroke="#d94a6a" stroke-width="1.4" stroke-linecap="round"/>`),
  /** A filter tip (a little rolled card). */
  filter: svg(`<rect x="6" y="8" width="12" height="8" rx="4" fill="#e8c48a" ${O}/><path d="M9 9c1 2 1 4 0 6M12 9c1 2 1 4 0 6M15 9c1 2 1 4 0 6" fill="none" stroke="#b58a4a" stroke-width="1.2"/>`),
  coin: svg(`<circle cx="12" cy="12" r="8" fill="#ffd166" ${O}/><circle cx="12" cy="12" r="5" fill="none" stroke="#c99a2a" stroke-width="1.4"/><path d="M12 9v6" stroke="#c99a2a" stroke-width="1.8" stroke-linecap="round"/>`),
  /** Circle the mouse (crank / stir). */
  circle: svg(`<path d="M18.5 8A8 8 0 1 0 20 13" fill="none" stroke="#fff6e6" stroke-width="2.6" stroke-linecap="round"/><path d="M15.5 7.5l3.3.6.4-3.4" fill="none" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.2" fill="#ffd166" ${O}/>`),
  /** A spoon stirring a pot. */
  stir: svg(`<path d="M4 12h16l-1.5 7a2 2 0 0 1-2 1.6H7.5a2 2 0 0 1-2-1.6z" fill="#9aa3ad" ${O}/><path d="M7 12c2-1.6 8-1.6 10 0" fill="#e9d36a" ${O}/><path d="M14 13 19 3" stroke="#b5793d" stroke-width="2.6" stroke-linecap="round"/>`),
  /** A lever / handle being pulled. */
  lever: svg(`<rect x="4" y="16" width="16" height="5" rx="1.5" fill="#9aa3ad" ${O}/><path d="M12 17 17 5" stroke="#5c5f66" stroke-width="2.8" stroke-linecap="round"/><circle cx="17" cy="5" r="2.6" fill="#ff5a3c" ${O}/><path d="M7 8a6 6 0 0 1 4-4" fill="none" stroke="#ffd166" stroke-width="2" stroke-linecap="round"/>`),
  /** A door (open it). */
  door: svg(`<rect x="5" y="3" width="12" height="18" rx="1" fill="#b5793d" ${O}/><circle cx="14.5" cy="12.5" r="1.3" fill="#ffd166" ${O}/><path d="M17 3l3 2v15l-3 1" fill="#8a5a2a" ${O}/>`),
};
export type IconId = keyof typeof IC;

/** A key cap (letters / Space / Shift) in the HUD style. */
export const kc = (k: string) => `<kbd class="kc">${k}</kbd>`;
