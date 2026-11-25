import { adminGranted, isOwner } from './auth';

/**
 * Early access (user 2026-11-25): the game opens only with a tester code — or for the owner's Google account / someone
 * the owner gave the admin mode. Testers get a link (`?code=XXXX-XXXX-XXXX`): opening it once remembers the code in
 * that browser. The server checks the same list before online play (server.js `ACCESS`), so a code taken away there
 * can't play online. This repo is public: only SHA-256 fingerprints are kept here, never the codes themselves (the owner
 * keeps them). To take a code back: delete its line here AND in server.js. `EARLY_ACCESS = false` (+ the server's
 * env var EARLY_ACCESS=0) = open to everyone.
 */
export const EARLY_ACCESS = true;
const SALT = 'porkour-early-access:';
/** SHA-256(SALT + code without dashes) → tester number (#1 = the owner's own). */
const CODES = new Map<string, number>([
  ['758eb059da3a18befc77cf934c5442f7283188855975fb2de21597e12b182797', 1],
  ['045c05787c0f42f26c0b80f17234603211ee2ffcc8c48452836a38c10425edd3', 2],
  ['1bdb2ac98d442122e83c862f2cd57b2e9905c1f1fd44fad95af4d2f19ca605a1', 3],
  ['d05272cf4349f7ef094b5e725ab18cffa57137c5c9e461530f15afd4d4f87a46', 4],
  ['a0b3813afb8d15ab014b939213901433d4438283adee8a848e40452039526041', 5],
  ['9272aa07e89d84ecca3ed82055b961e441aaa9dbd7b5014bdf50e17876180a82', 6],
  ['f91209e0ee0b9bb94ff6d57f98db43a08ea408b2f111de445dd56a4db9e953f1', 7],
  ['c622a3ed9ae63d216f5b4454802d382e6aecbd2585191fda18bdda4e43080667', 8],
  ['08ee29b0b7da1ed213d0d0649353a2512ef8bc2d21c6260a83b2ce2956b49ca1', 9],
  ['ce5bc6bf5de4b1fbfc1b092a1b999da06a3e7e722eb15594df19e646ed934622', 10],
  ['ea16531352d6772005f76219d79ddfcc8384a86b2da0055f935319476c4b0910', 11],
  ['bb6b033b12273273b6f832101073ebe9fc29e9010ee4da132f25f9d764d85776', 12],
]);
const KEY = 'porkour.code';
/** (the code when this browser can't store it: private window) */
let mem = '';
export const normCode = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** Which tester a code belongs to (0 = not a code). */
export async function testerOf(code: string): Promise<number> {
  const c = normCode(code);
  if (c.length < 8 || !crypto?.subtle) return 0;
  try { return CODES.get(await sha(SALT + c)) ?? 0; } catch { return 0; }
}
/** The code this browser remembers ('' = none). Sent to the server in the hello. */
export function accessCode(): string { try { return localStorage.getItem(KEY) || mem; } catch { return mem; } }
/** A valid code is remembered (true); a wrong one isn't (false). */
export async function useCode(code: string): Promise<boolean> {
  if (!(await testerOf(code))) return false;
  try { localStorage.setItem(KEY, normCode(code)); } catch { /* private window: works for this visit */ }
  mem = normCode(code);
  return true;
}
/** Test builds on this machine skip the gate (`?gate=1` shows it anyway). */
const local = () => ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('gate') !== '1';
export async function hasAccess(): Promise<boolean> {
  if (!EARLY_ACCESS || local() || isOwner() || adminGranted()) return true;
  return (await testerOf(accessCode())) > 0;
}
