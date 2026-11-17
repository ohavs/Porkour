/**
 * Full screen (user request). Entering it also asks Chrome / Edge to keep the Esc key for the game
 * (Keyboard Lock): Esc then opens the menu instead of leaving full screen (hold Esc to leave).
 */
export const isFull = () => !!document.fullscreenElement;
const listeners: (() => void)[] = [];
export const onFull = (f: () => void) => listeners.push(f);
document.addEventListener('fullscreenchange', () => { listeners.forEach((f) => f()); if (!isFull()) (navigator as any).keyboard?.unlock?.(); });

export async function setFull(on: boolean) {
  try {
    if (on && !isFull()) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      try { await (navigator as any).keyboard?.lock?.(['Escape']); } catch { /* not supported */ }
    } else if (!on && isFull()) await document.exitFullscreen();
  } catch { /* blocked (no click) / not supported (iPhone) */ }
}
export const toggleFull = () => setFull(!isFull());

/** Expand / shrink icon for buttons. */
export const fullIcon = (full = isFull()) => full
  ? '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="#fff6e6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/></svg>'
  : '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="#fff6e6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>';
