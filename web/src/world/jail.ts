import * as THREE from 'three';
import { staticBox } from '../core/physics';
import { toonMat } from '../render/toon';
import { G } from '../game/ctx';

/** Admin jail (user: "punish players, put them in a jail"): a barred cell hanging in the sky over the sty. */
export const JAIL = { lift: 26, half: 1.5, h: 2.2, secs: 60 };

/**
 * Static cell (same spot on every machine, so an online player's own pig — predicted on their side — is boxed in
 * too). Floor, 4 barred sides and a roof are colliders; a chain runs up into the clouds. The host keeps jailed pigs
 * inside (`hold`) and lets them out when the time is up / the admin frees them.
 */
export class Jail {
  center: THREE.Vector3;
  private root = new THREE.Group();
  constructor(scene: THREE.Scene, over: THREE.Vector3) {
    const c = this.center = new THREE.Vector3(over.x, G.terrain.height(over.x, over.z) + JAIL.lift, over.z);
    const { half: H, h } = JAIL;
    const iron = toonMat(0x3a3d44), wood = toonMat(0x7a5232), gold = toonMat(0xffc94a);
    this.root.position.copy(c); scene.add(this.root);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + 0.3, 0.3, H * 2 + 0.3), wood);
    floor.position.y = -0.15; this.root.add(floor);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + 0.3, 0.18, H * 2 + 0.3), iron);
    roof.position.y = h + 0.09; this.root.add(roof);
    const bar = new THREE.CylinderGeometry(0.045, 0.045, h, 6);
    for (let side = 0; side < 4; side++) for (let i = 0; i <= 8; i++) {
      const u = -H + (i / 8) * H * 2, m = new THREE.Mesh(bar, iron);
      const x = side < 2 ? u : side === 2 ? -H : H, z = side >= 2 ? u : side === 0 ? -H : H;
      m.position.set(x, h / 2, z); this.root.add(m);
    }
    for (const y of [0.1, h - 0.1]) for (let side = 0; side < 4; side++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(side < 2 ? H * 2 : 0.1, 0.1, side < 2 ? 0.1 : H * 2), iron);
      r.position.set(side === 2 ? -H : side === 3 ? H : 0, y, side === 0 ? -H : side === 1 ? H : 0); this.root.add(r);
    }
    // the chain up into the sky + a big padlock on the front
    const link = new THREE.TorusGeometry(0.14, 0.04, 5, 10);
    for (let i = 0; i < 26; i++) { const l = new THREE.Mesh(link, iron); l.position.y = h + 0.3 + i * 0.24; l.rotation.y = (i % 2) * Math.PI / 2; this.root.add(l); }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.14), gold); lock.position.set(0, h * 0.5, H + 0.08); this.root.add(lock);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 6, 12, Math.PI), gold); shackle.position.set(0, h * 0.5 + 0.18, H + 0.08); this.root.add(shackle);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    // colliders
    staticBox(new THREE.Vector3(c.x, c.y - 0.15, c.z), new THREE.Vector3(H + 0.15, 0.15, H + 0.15));
    staticBox(new THREE.Vector3(c.x, c.y + h + 0.09, c.z), new THREE.Vector3(H + 0.15, 0.09, H + 0.15));
    for (const [dx, dz, hx, hz] of [[0, -H, H, 0.06], [0, H, H, 0.06], [-H, 0, 0.06, H], [H, 0, 0.06, H]] as const)
      staticBox(new THREE.Vector3(c.x + dx, c.y + h / 2, c.z + dz), new THREE.Vector3(hx, h / 2, hz));
  }
  /** Where a jailed pig stands (4 spots, one per seat). */
  spot(i: number, out = new THREE.Vector3()) { return out.set(this.center.x + (i % 2 ? 0.6 : -0.6), this.center.y + 0.7, this.center.z + (i < 2 ? -0.6 : 0.6)); }
  inside(p: THREE.Vector3) { return Math.abs(p.x - this.center.x) < JAIL.half + 0.4 && Math.abs(p.z - this.center.z) < JAIL.half + 0.4 && p.y > this.center.y - 1 && p.y < this.center.y + JAIL.h + 1; }
}
