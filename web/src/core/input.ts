/**
 * Keyboard + mouse + gamepad → one Controls snapshot per frame.
 * Button presses are latched until a fixed physics step consumes them (no lost presses at high FPS).
 */
/**
 * grab = RMB (pick up / drop), attack = LMB (click = hit, hold = throw what you hold), tilt = R (tip what you hold: pour),
 * view = V (first ↔ third person; local only, never sent).
 */
import { setPadDev, isPS } from '../game/padGlyph';

export type Button = 'jump' | 'sprint' | 'fart' | 'stand' | 'wallow' | 'grab' | 'attack' | 'oink' | 'tilt' | 'view' | 'emote' | 'pass';

const KEYS: Record<string, Button> = {
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyQ: 'fart', KeyE: 'stand',
  KeyC: 'wallow', ControlLeft: 'wallow', KeyF: 'oink', KeyR: 'tilt', KeyV: 'view',
  KeyB: 'emote', KeyG: 'pass',
};
/** Gamepad: RB = tip (pour), R3 = oink, D-pad up / down = reach further / back, View (Back) = first ↔ third person. */
const PAD: Partial<Record<number, Button>> = { 0: 'jump', 1: 'fart', 2: 'wallow', 3: 'stand', 6: 'grab', 7: 'attack', 4: 'sprint', 10: 'sprint', 5: 'tilt', 11: 'oink', 8: 'view', 14: 'emote', 15: 'pass' };
/** Lobby: no first person there, so View holds the dance wheel (the D-pad moves the menu focus: `padSkip`). */
const PAD_LOBBY: Partial<Record<number, Button>> = { ...PAD, 8: 'emote', 14: undefined, 15: undefined };

export class Input {
  moveX = 0; moveY = 0;        // -1..1, y = forward
  lookX = 0; lookY = 0;        // radians this frame
  held = new Set<Button>();
  private pressed = new Set<Button>();
  private released = new Set<Button>();
  private keys = new Set<string>();
  private mdx = 0; private mdy = 0;
  private padPrev: boolean[] = [];
  locked = false;
  /** Lobby: the mouse isn't locked; clicks on the game still count, and the pointer is an aim (NDC). */
  free = false; mouseX = 0; mouseY = 0;
  private lockedAt = 0;
  sensitivity = 0.0024;
  invertY = false;
  /** Right stick this frame (the emote wheel picks with it on a gamepad). */
  padRX = 0; padRY = 0;
  /** Mouse wheel: how far the arms / neck reach out (0 = normal … 1 = stretched). */
  reach = 0;
  onKey?: (code: string) => void;
  /** A menu owns the gamepad (`PadNav`): the pig gets nothing from it until it lets go. */
  padBlock = false;
  /** Pad buttons the game ignores this frame (bit i = button i: the lobby's D-pad moves the menu focus). */
  padSkip = 0;
  /** Lobby button layout (View = dance wheel). */
  lobby = false;
  /** Buttons currently held on the pad (released when a menu takes it over). */
  private padHeld = new Set<Button>();
  private padT = 0;
  /** Every button press as it happens (UI that needs exact timing, e.g. the lock-pick). */
  onPress?: (b: Button) => void;

  constructor(private el: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.isTrusted) setPadDev(false);
      this.keys.add(e.code);
      const b = KEYS[e.code]; if (b) this.down(b);
      this.onKey?.(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); const b = KEYS[e.code]; if (b) this.up(b); });
    addEventListener('blur', () => { this.keys.clear(); for (const b of [...this.held]) this.up(b); });
    // the click that locks the pointer is not an attack
    el.addEventListener('mousedown', (e) => { setPadDev(false); if (!this.locked && !this.free) return; if (e.button === 0) this.down('attack'); if (e.button === 2) this.down('grab'); });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.up('attack'); if (e.button === 2) this.up('grab'); });
    addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) setPadDev(false); this.mouseX = (e.clientX / innerWidth) * 2 - 1; this.mouseY = -(e.clientY / innerHeight) * 2 + 1; if (this.locked && performance.now() - this.lockedAt > 150 && Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    // the first moves right after the lock can carry the whole jump of the cursor: ignore them (the camera spun)
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.el; this.lockedAt = performance.now(); this.mdx = this.mdy = 0; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // wheel forward = reach further, back = back to normal (Burglin' Gnomes style)
    addEventListener('wheel', (e) => { if (!this.locked && !this.free) return; this.reach = Math.min(1, Math.max(0, this.reach - Math.sign(e.deltaY) * 0.2)); }, { passive: true });
  }
  lock() { if (this.locked) return; try { (this.el.requestPointerLock?.() as any)?.catch?.(() => {}); } catch { /* needs a user gesture */ } }
  private down(b: Button) { if (!this.held.has(b)) { this.held.add(b); this.pressed.add(b); this.onPress?.(b); } }
  private up(b: Button) { if (this.held.has(b)) { this.held.delete(b); this.released.add(b); } }

  /** Call once per rendered frame. */
  poll() {
    const k = (c: string) => this.keys.has(c);
    let x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let y = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    this.lookX = this.mdx * this.sensitivity; this.lookY = this.mdy * this.sensitivity * (this.invertY ? -1 : 1);
    this.mdx = this.mdy = 0;
    const now = performance.now(), dt = Math.min(0.1, (now - (this.padT || now)) / 1000); this.padT = now;
    this.padRX = this.padRY = 0;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      const on = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      // any real use of the pad → the prompts show pad buttons
      if (pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.35)) setPadDev(true, isPS(pad.id));
      if (this.padBlock) {
        // a menu has it: let go of whatever the pig was holding, and don't fire presses when it hands the pad back
        for (const b of this.padHeld) this.up(b);
        this.padHeld.clear();
        pad.buttons.forEach((_, i) => { this.padPrev[i] = on(i); });
      } else {
        const px = dz(pad.axes[0] ?? 0), py = dz(pad.axes[1] ?? 0);
        if (px || py) { x = px; y = -py; }
        this.padRX = dz(pad.axes[2] ?? 0); this.padRY = dz(pad.axes[3] ?? 0);
        // right stick: a curve (fine aim near the middle), per second (same speed at any frame rate), the mouse
        // sensitivity setting scales it too
        const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.6), k = this.sensitivity / 0.0024;
        this.lookX += curve(this.padRX) * 3.4 * k * dt; this.lookY += curve(this.padRY) * 2.4 * k * dt * (this.invertY ? -1 : 1);
        const map = this.lobby ? PAD_LOBBY : PAD;
        pad.buttons.forEach((_, i) => {
          const b = map[i], o = on(i) && !(this.padSkip & (1 << i));
          if (b && o && !this.padPrev[i]) { this.down(b); this.padHeld.add(b); }
          if (b && !o && this.padPrev[i]) { this.up(b); this.padHeld.delete(b); }
          this.padPrev[i] = o;
        });
        const up = on(12) && !(this.padSkip & (1 << 12)), dn = on(13) && !(this.padSkip & (1 << 13));
        if (up || dn) this.reach = Math.min(1, Math.max(0, this.reach + (up ? 1 : -1) * 1.8 * dt));
      }
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.moveX = x; this.moveY = y;
  }
  /** Drop latched presses (a UI swallowed them). */
  clearPresses() { this.pressed.clear(); this.released.clear(); }
  /** Read & clear latched edges (called by the first fixed step of a frame). */
  consume(): { pressed: Set<Button>; released: Set<Button> } {
    const r = { pressed: this.pressed, released: this.released };
    this.pressed = new Set(); this.released = new Set();
    return r;
  }
}
