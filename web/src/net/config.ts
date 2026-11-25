import { SETTINGS } from '../game/settings';

/**
 * Online configuration. Both values are public (not secrets):
 * - SERVER: the Porkour server (server/ in the repo, hosted on Render). wss://… address.
 * - GOOGLE_CLIENT_ID: OAuth "Web application" client id from Google Cloud Console (Sign in with Google).
 * Overrides (testing): ?server=ws://localhost:8080, Settings → Online server, VITE_SERVER_URL / VITE_GOOGLE_CLIENT_ID at build time.
 */
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
/** The online servers (Render, render.yaml), nearest to the players first (user 2026-11-20): Frankfurt ≈ 60 ms from
 *  Israel, Oregon ≈ 200 ms. A page uses the first one; the next one only when the first refuses at once (it doesn't
 *  exist / is down) — never while it is just waking up (free hosting holds the connection until it's up). */
const BUILT_IN_SERVERS = ['wss://porkour-server-eu.onrender.com', 'wss://porkour-server.onrender.com'];
/** Filled in once the Google OAuth client exists (server/README.md). */
const BUILT_IN_GOOGLE_CLIENT_ID = '186251969828-09ngofot9gbr3p951dmm2ad88oo9upum.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID || BUILT_IN_GOOGLE_CLIENT_ID;

/** Every server this page may use, in order (an override = just that one). */
export function serverUrls(): string[] {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.split(',');   // (tests: ?server=a,b = the fallback order)
  if (SETTINGS.server) return [SETTINGS.server];
  if (env.VITE_SERVER_URL) return [env.VITE_SERVER_URL];
  return BUILT_IN_SERVERS;
}
/** Which of `serverUrls()` this tab is on. Kept for the tab (reloads into a room stay on the room's server) and in
 *  invite / room links (`?srv=1`), so everyone in a room meets on the same server. */
const SRV_KEY = 'porkour.srv';
let pick = (() => {
  const q = Number(new URLSearchParams(location.search).get('srv'));
  if (Number.isInteger(q) && q > 0) return q;
  try { return Number(sessionStorage.getItem(SRV_KEY)) || 0; } catch { return 0; }
})();
export const serverPick = () => Math.min(pick, serverUrls().length - 1);
function setPick(n: number) { pick = n; try { if (n) sessionStorage.setItem(SRV_KEY, String(n)); else sessionStorage.removeItem(SRV_KEY); } catch { /* */ } }
/** The first server refused: move on to the next one (false = none left; back to the first for next time). */
export function nextServer(): boolean {
  if (serverPick() + 1 < serverUrls().length) { setPick(serverPick() + 1); return true; }
  setPick(0); return false;
}
/** 'EU' / 'US' for the built-in servers (shown in the online panel), '' for anything else. */
export const serverRegion = () => { const u = serverUrl(); return u.includes('-eu.') ? 'EU' : u.includes('porkour-server.') ? 'US' : ''; };

export function serverUrl(): string {
  const all = serverUrls();
  if (all.length) return all[serverPick()];
  // dev convenience: a local server when the game itself runs on localhost
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'ws://localhost:8080';
  return '';
}

/** Public STUN servers: let two browsers find a direct path (peer-to-peer) through home routers. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
