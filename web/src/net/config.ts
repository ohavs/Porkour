import { SETTINGS } from '../game/settings';

/**
 * Online configuration. Both values are public (not secrets):
 * - SERVER: the Porkour server (server/ in the repo, hosted on Render). wss://… address.
 * - GOOGLE_CLIENT_ID: OAuth "Web application" client id from Google Cloud Console (Sign in with Google).
 * Overrides (testing): ?server=ws://localhost:8080, Settings → Online server, VITE_SERVER_URL / VITE_GOOGLE_CLIENT_ID at build time.
 */
const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
/** Filled in once the server is deployed (server/README.md). */
const BUILT_IN_SERVER = 'wss://porkour-server.onrender.com';
/** Filled in once the Google OAuth client exists (server/README.md). */
const BUILT_IN_GOOGLE_CLIENT_ID = '186251969828-09ngofot9gbr3p951dmm2ad88oo9upum.apps.googleusercontent.com';
export const DEFAULT_SERVER = env.VITE_SERVER_URL || BUILT_IN_SERVER;
export const GOOGLE_CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID || BUILT_IN_GOOGLE_CLIENT_ID;

export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (SETTINGS.server) return SETTINGS.server;
  if (DEFAULT_SERVER) return DEFAULT_SERVER;
  // dev convenience: a local server when the game itself runs on localhost
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'ws://localhost:8080';
  return '';
}

/** Public STUN servers: let two browsers find a direct path (peer-to-peer) through home routers. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
