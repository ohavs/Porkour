import * as THREE from 'three';
import { G, ADMIN, type Carrier } from '../game/ctx';
import { fitted } from '../core/assets';
import { Grip } from '../core/grip';
import type { Pig } from '../pig/pig';

/** Where a trap holds a pig: low on its back end (a hind leg), pig body space. */
const LEG = new THREE.Vector3(0.1, -0.18, -0.32);
export const TRAP = { slots: 4, r: 0.5, escape: 10, escapeMuddy: 6, sprungFor: 20, freeR: 1.4 };
const v1 = new THREE.Vector3();

/**
 * One bear trap (Quaternius Survival, CC0). Armed: the first pig that steps on it is snapped by a hind leg — a joint
 * holds the leg at the trap, the rest of the pig flails (ragdoll). It is a Carrier like Bob's hand or a wolf's jaw:
 * mash Space to wriggle out, or a teammate opens it (RMB / LMB next to it). The SNAP is loud and Bob knows where.
 * A sprung trap lies there for a while, then Bob has collected it (gone). Throwing things on a trap sets it off.
 */
export class BearTrap implements Carrier {
  kind = 'trap' as const;
  active = false; armed = false;
  pos = new THREE.Vector3(); yaw = 0;
  holding: Pig | null = null;
  sprungAt = -1e9;
  root = new THREE.Group();
  private open: THREE.Object3D; private shut: THREE.Object3D;
  private grip: Grip | null = null;

  constructor(scene: THREE.Scene, public index: number) {
    this.open = fitted('cover/BearTrap_Open', { width: 0.78 });
    this.shut = fitted('cover/BearTrap_Closed', { width: 0.6 });
    this.root.add(this.open, this.shut);
    this.root.visible = false;
    scene.add(this.root);
  }

  escapeNeed(p: Pig) { return ADMIN.easyEscape && p === G.localPig ? 1 : p.muddy > 0 ? TRAP.escapeMuddy : TRAP.escape; }

  set(at: THREE.Vector3, yaw: number) {
    this.release(false);
    this.active = true; this.armed = true; this.yaw = yaw;
    this.pos.set(at.x, G.terrain.height(at.x, at.z), at.z);
    this.show();
  }
  clear() { this.release(false); this.active = false; this.armed = false; this.show(); }

  /** SNAP. `p` = the pig it caught (null: set off by something thrown on it). */
  snap(p: Pig | null) {
    this.armed = false; this.sprungAt = G.time;
    G.audio.play('snap', { pos: this.pos, vol: 1.3 });
    G.audio.play('metal', { pos: this.pos, vol: 0.8, pitch: 1.3 });
    G.fx.bits(v1.copy(this.pos).setY(this.pos.y + 0.2), { count: 10, color: 0xc9c9c9, speed: 3, up: 2.5, life: 0.4, size: 0.08, grow: 0, grav: 10, alpha: 1 });
    G.noise(this.pos, 26);
    if (p) {
      p.caughtBy(this);
      this.holding = p;
      this.grip ??= new Grip();
      this.grip.attach(p.body, p.pos, LEG);
      p.body.setLinvel({ x: 0, y: 3, z: 0 }, true);
      G.audio.play('squeal', { pos: p.pos, vol: 1 });
      G.shakeFor(p, 0.45);
      G.events.push({ type: 'trapped', who: p });
      G.farmer?.trapSprung(p, this.pos);
    }
    this.show();
  }

  /** The pig wriggled out / a teammate opened it / Bob took the pig. */
  release(_thrown: boolean) {
    const p = this.holding; if (!p) return;
    this.holding = null;
    this.grip?.detach();
    if (p.heldBy === this) {
      p.heldBy = null;
      p.body.setLinvel({ x: (Math.random() - 0.5) * 2, y: 5, z: (Math.random() - 0.5) * 2 }, true);
    }
    G.audio.play('unlock', { pos: this.pos, vol: 0.8, pitch: 1.2 });
  }

  /** Host, every fixed step. */
  step(dt: number) {
    if (!this.active) return;
    if (this.armed) {
      for (const p of G.pigs as Pig[]) {
        if (p.out || p.cage || p.heldBy || (p === G.localPig && ADMIN.god)) continue;
        if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < TRAP.r && p.pos.y - this.pos.y < 1.0) { this.snap(p); return; }
      }
      // things thrown on it set it off (disarm it with a pumpkin!)
      for (const h of G.holdables) {
        if (h.kind === 'pig' || h.heldBy) continue;
        const b = h.body.translation();
        if (Math.abs(b.x - this.pos.x) > 0.6 || Math.abs(b.z - this.pos.z) > 0.6) continue;
        const lv = h.body.linvel();
        if (Math.hypot(b.x - this.pos.x, b.z - this.pos.z) < 0.42 && b.y - this.pos.y < 0.7 && Math.hypot(lv.x, lv.y, lv.z) > 1) {
          this.snap(null);
          if (h.kind === 'critter') h.knock?.(v1.set(0, 5, 0), true);
          return;
        }
      }
      return;
    }
    const p = this.holding;
    if (p) {
      if (p.heldBy !== this || p.out) { this.holding = null; this.grip?.detach(); return; }
      // the leg stays in the jaws; the pig flails around it (it can't get far, it can't be lifted away)
      this.grip!.drive(v1.copy(this.pos).setY(this.pos.y + 0.12), p.body, p.mass + 4, dt, { up: 260, side: 3000, kp: 20, react: 0, g: 20 });
      if (this.grip!.strain > 1.6) { p.body.setTranslation({ x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z }, true); this.grip!.attach(p.body, p.pos, LEG); }
      // a teammate next to it opens the jaws (RMB or LMB)
      for (const q of G.pigs as Pig[]) {
        if (q === p || q.out || q.cage || q.heldBy) continue;
        if ((q.input.grabP || q.input.attackP) && Math.hypot(q.pos.x - this.pos.x, q.pos.z - this.pos.z) < TRAP.freeR) {
          this.release(false);
          G.events.push({ type: 'trapFreed', who: p });
          break;
        }
      }
      return;
    }
    if (G.time - this.sprungAt > TRAP.sprungFor) this.clear();   // Bob collected it
  }

  show() {
    this.root.visible = this.active;
    this.open.visible = this.armed; this.shut.visible = !this.armed;
    this.root.position.copy(this.pos); this.root.position.y += 0.01;
    this.root.rotation.y = this.yaw;
  }
}

/** Bob's bear traps (a fixed pool, synced as one entity). */
export class Traps {
  list: BearTrap[] = [];
  constructor(scene: THREE.Scene) {
    for (let i = 0; i < TRAP.slots; i++) this.list.push(new BearTrap(scene, i));
    G.traps = this;
  }
  armedCount() { return this.list.filter((t) => t.active && t.armed).length; }
  near(p: THREE.Vector3, r: number) { return this.list.some((t) => t.active && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < r); }
  /** Bob sets a trap here (a free slot, else the oldest sprung / armed one moves). */
  place(at: THREE.Vector3, yaw = Math.random() * 6.28) {
    const free = this.list.find((t) => !t.active)
      ?? this.list.filter((t) => !t.holding).sort((a, b) => (a.armed ? 1 : 0) - (b.armed ? 1 : 0) || a.sprungAt - b.sprungAt)[0];
    if (!free) return null;
    free.set(at, yaw);
    G.audio.play('metal', { pos: free.pos, vol: 0.6, pitch: 0.8 });
    return free;
  }
  clear() { for (const t of this.list) t.clear(); }
  step(dt: number) { for (const t of this.list) t.step(dt); }

  // ---------------------------------------------------------------- network (entity without a body)
  netState(n: number[]) {
    for (const t of this.list) {
      n.push(t.active ? (t.armed ? 2 : 1) : 0, Math.round(t.pos.x * 100) / 100, Math.round(t.pos.y * 100) / 100, Math.round(t.pos.z * 100) / 100,
        Math.round(t.yaw * 100) / 100, t.holding ? G.pigs.indexOf(t.holding) : -1);
    }
  }
  netApply(n: number[]) {
    if (n.length < this.list.length * 6) return;
    this.list.forEach((t, i) => {
      const k = i * 6;
      t.active = n[k] > 0; t.armed = n[k] === 2;
      t.pos.set(n[k + 1], n[k + 2], n[k + 3]); t.yaw = n[k + 4];
      t.holding = n[k + 5] >= 0 ? G.pigs[n[k + 5]] ?? null : null;
      t.show();
    });
  }
}
