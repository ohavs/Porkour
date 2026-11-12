import { GOOGLE_CLIENT_ID } from './config';

/** Who the player is online: a Google account (verified by the server) or a guest with a name. */
export interface Profile {
  name: string;
  picture: string;
  google: boolean;
  /** Google ID token (JWT, ~1 h) — sent once to the server, which verifies it. */
  token?: string;
  exp?: number;
}

const KEY = 'porkour.profile';
const GUEST_NAMES = ['Bacon', 'Truffle', 'Pumba', 'Hamlet', 'Oinkers', 'Porkchop', 'Snoutie', 'Mudpie', 'Wilbur', 'Peppa', 'Hamtaro', 'Sausage'];

function load(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p && typeof p.name === 'string') return p;
  } catch { /* ignore */ }
  return { name: GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)] + (10 + Math.floor(Math.random() * 90)), picture: '', google: false };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* ignore */ } }

export const profile: Profile = load();
export const googleEnabled = () => !!GOOGLE_CLIENT_ID;
const listeners: (() => void)[] = [];
export function onProfile(f: () => void) { listeners.push(f); }
const changed = () => { save(); for (const f of listeners) f(); };

export function setGuestName(name: string) {
  const n = name.replace(/[<>]/g, '').trim().slice(0, 16);
  if (n) { profile.name = n; changed(); }
}

/** Token still valid for at least a minute? */
export const tokenFresh = () => !!profile.token && (profile.exp ?? 0) * 1000 > Date.now() + 60_000;

function decodeJwt(t: string): any {
  const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(b).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  return JSON.parse(json);
}

let gsi: Promise<any> | null = null;
/** Load Google Identity Services (the official "Sign in with Google" script) once. */
function loadGsi(): Promise<any> {
  if (gsi) return gsi;
  gsi = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      const g = (window as any).google;
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (r: { credential: string }) => {
          const p = decodeJwt(r.credential);
          profile.google = true; profile.token = r.credential; profile.exp = p.exp;
          profile.name = String(p.given_name || p.name || profile.name).slice(0, 16);
          profile.picture = String(p.picture || '');
          changed();
        },
        auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true, itp_support: true,
      });
      resolve(g);
    };
    s.onerror = () => { gsi = null; reject(new Error('gsi')); };
    document.head.appendChild(s);
  });
  return gsi;
}

/** Draws Google's own sign-in button into `el` (does nothing when no client id is configured). */
export async function renderGoogleButton(el: HTMLElement, locale: string) {
  if (!googleEnabled()) return false;
  try {
    const g = await loadGsi();
    el.innerHTML = '';
    g.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale });
    return true;
  } catch { return false; }
}

/** Signed in before but the 1-hour token expired: ask Google quietly for a fresh one (One Tap / FedCM). */
export async function refreshToken(timeoutMs = 4000): Promise<boolean> {
  if (!googleEnabled() || !profile.google) return false;
  if (tokenFresh()) return true;
  try {
    const g = await loadGsi();
    return await new Promise<boolean>((res) => {
      const done = () => res(tokenFresh());
      const t = setTimeout(done, timeoutMs);
      const off = () => { clearTimeout(t); setTimeout(done, 50); };
      listeners.push(off);
      g.accounts.id.prompt();
    });
  } catch { return false; }
}

export function signOut() {
  (window as any).google?.accounts?.id?.disableAutoSelect?.();
  profile.google = false; profile.token = undefined; profile.exp = undefined; profile.picture = '';
  changed();
}
