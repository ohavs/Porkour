import * as THREE from 'three';
import { toonMat } from '../render/toon';

/** Hip height (m). Bob faces +z, origin between the boots on the ground. */
export const HIP = 0.86;

export interface FarmerRig {
  tilt: THREE.Group;                       // whole-body pivot at the feet (knock-down, sit)
  hips: THREE.Group; torso: THREE.Group; head: THREE.Group; hat: THREE.Group;
  shoulderL: THREE.Group; shoulderR: THREE.Group; elbowL: THREE.Group; elbowR: THREE.Group;
  handL: THREE.Group; handR: THREE.Group;
  thighL: THREE.Group; thighR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group;
  browL: THREE.Mesh; browR: THREE.Mesh; mouth: THREE.Mesh; eyes: THREE.Group[]; belly: THREE.Group;
  face: { mat: THREE.MeshToonMaterial; base: THREE.Color }[];
  tools: Record<string, THREE.Object3D>;
}

const SKIN = 0xf3b38f, NOSE = 0xec8f78, SHIRT = 0xd8403a, DENIM = 0x3f6fb5, BOOT = 0x6a4128, HAIR = 0x9b8f86,
  STACHE = 0x7a4a2a, STRAW = 0xf0cb6c, BAND = 0xb33b2b;

/**
 * Farmer Bob, built from smooth shapes in the same cartoon style as the pigs: big round belly in denim overalls,
 * red shirt, rolled-up sleeves, straw hat, bushy moustache, big nose, boots. Returns a rig for procedural animation.
 */
export function buildFarmer(root: THREE.Group): FarmerRig {
  const face: FarmerRig['face'] = [];
  const skinMat = (c: number) => { const m = toonMat(c); face.push({ mat: m, base: new THREE.Color(c) }); return m; };
  const skin = skinMat(SKIN), nose = skinMat(NOSE), shirt = toonMat(SHIRT), denim = toonMat(DENIM), boot = toonMat(BOOT);
  const hair = toonMat(HAIR), stache = toonMat(STACHE), straw = toonMat(STRAW), band = toonMat(BAND);
  const white = toonMat(0xffffff), black = toonMat(0x1b1010), gold = toonMat(0xffd166), blush = toonMat(0xf28a86);
  const mouthM = toonMat(0x5a1f1f);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], parent: THREE.Object3D,
    s?: [number, number, number], r?: [number, number, number]) => {
    const o = new THREE.Mesh(g, m); o.position.set(...p); if (s) o.scale.set(...s); if (r) o.rotation.set(...r);
    o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  };
  const group = (parent: THREE.Object3D, p: [number, number, number]) => { const g = new THREE.Group(); g.position.set(...p); parent.add(g); return g; };
  const sphere = new THREE.SphereGeometry(1, 32, 22);

  const tilt = group(root, [0, 0, 0]);
  const hips = group(tilt, [0, HIP, 0]);
  // pelvis (denim seat)
  mesh(sphere, denim, [0, 0.04, -0.01], hips, [0.32, 0.22, 0.27]);

  // ---------------------------------------------------------------- torso
  const torso = group(hips, [0, 0, 0]);
  const belly = group(torso, [0, 0.27, 0.04]);
  mesh(sphere, shirt, [0, 0, 0], belly, [0.42, 0.42, 0.38]);
  // overalls: lower half of the belly + bib + straps + buttons
  const lower = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
  mesh(lower, denim, [0, 0, 0], belly, [0.43, 0.43, 0.39]);
  const bibG = new THREE.SphereGeometry(1, 20, 8, Math.PI / 2 - 0.62, 1.24, Math.PI * 0.24, Math.PI * 0.2);
  mesh(bibG, denim, [0, 0, 0], belly, [0.435, 0.435, 0.395]);
  for (const s of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.075, 0.26, 0.035), denim, [s * 0.15, 0.66, 0.2], torso, undefined, [-0.85, 0, s * 0.05]);
    mesh(new THREE.BoxGeometry(0.075, 0.3, 0.035), denim, [s * 0.15, 0.6, -0.21], torso, undefined, [0.55, 0, s * 0.05]);
    mesh(new THREE.SphereGeometry(0.03, 12, 8), gold, [s * 0.14, 0.56, 0.335], torso, [1, 1, 0.5]);
  }
  // chest + shoulders
  mesh(sphere, shirt, [0, 0.55, 0], torso, [0.37, 0.24, 0.29]);
  // collar
  mesh(new THREE.TorusGeometry(0.13, 0.04, 8, 20), shirt, [0, 0.71, 0.01], torso, undefined, [Math.PI / 2, 0, 0]);

  // ---------------------------------------------------------------- head
  const head = group(torso, [0, 0.72, 0.02]);
  mesh(sphere, skin, [0, 0.17, 0.01], head, [0.245, 0.25, 0.235]);
  mesh(sphere, skin, [0, 0.06, 0.06], head, [0.2, 0.13, 0.17]);                 // jowls / chin
  mesh(sphere, nose, [0, 0.15, 0.245], head, [0.09, 0.08, 0.085]);               // big nose
  for (const s of [-1, 1]) {
    mesh(sphere, stache, [s * 0.075, 0.075, 0.225], head, [0.105, 0.048, 0.055], [0, s * 0.35, s * 0.32]); // moustache
    mesh(sphere, skin, [s * 0.24, 0.16, -0.01], head, [0.045, 0.07, 0.035]);    // ears
    mesh(sphere, hair, [s * 0.2, 0.22, -0.09], head, [0.07, 0.09, 0.09]);       // side hair
    mesh(sphere, blush, [s * 0.155, 0.12, 0.18], head, [0.05, 0.03, 0.02]).castShadow = false;
  }
  mesh(sphere, hair, [0, 0.2, -0.2], head, [0.17, 0.1, 0.06]);
  const mouth = mesh(sphere, mouthM, [0, 0.035, 0.215], head, [0.055, 0.012, 0.03]);
  const eyes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = group(head, [s * 0.088, 0.235, 0.195]);
    mesh(new THREE.SphereGeometry(0.056, 16, 12), white, [0, 0, 0], e, [1, 1.12, 0.8]);
    mesh(new THREE.SphereGeometry(0.03, 12, 10), black, [s * -0.004, -0.004, 0.034], e);
    const hl = mesh(new THREE.SphereGeometry(0.01, 6, 5), white, [0.008, 0.01, 0.06], e); hl.castShadow = false;
    eyes.push(e);
  }
  const brow = (s: number) => mesh(new THREE.CapsuleGeometry(0.018, 0.07, 4, 8), stache, [s * 0.088, 0.3, 0.215], head, undefined, [0, 0, Math.PI / 2]);
  const browL = brow(1), browR = brow(-1);
  // straw hat
  const hat = group(head, [0, 0.36, -0.01]);
  hat.rotation.set(-0.08, 0, 0.06);
  mesh(new THREE.CylinderGeometry(0.43, 0.45, 0.025, 36), straw, [0, 0, 0], hat);
  mesh(new THREE.CylinderGeometry(0.2, 0.235, 0.19, 28), straw, [0, 0.1, 0], hat);
  mesh(sphere, straw, [0, 0.19, 0], hat, [0.2, 0.05, 0.2]);
  mesh(new THREE.CylinderGeometry(0.238, 0.238, 0.05, 28), band, [0, 0.04, 0], hat);

  // ---------------------------------------------------------------- arms (pivot at the shoulder, hanging down)
  const arm = (s: number) => {
    const sh = group(torso, [s * 0.38, 0.56, 0]);
    mesh(new THREE.SphereGeometry(0.115, 18, 12), shirt, [0, 0, 0], sh);
    mesh(new THREE.CapsuleGeometry(0.088, 0.18, 6, 14), shirt, [0, -0.15, 0], sh);
    const el = group(sh, [0, -0.31, 0]);
    mesh(new THREE.TorusGeometry(0.08, 0.035, 8, 16), shirt, [0, 0.02, 0], el, undefined, [Math.PI / 2, 0, 0]); // rolled sleeve
    mesh(new THREE.CapsuleGeometry(0.072, 0.16, 6, 12), skin, [0, -0.12, 0], el);
    const hand = group(el, [0, -0.29, 0]);
    mesh(sphere, skin, [0, 0, 0.01], hand, [0.09, 0.1, 0.085]);
    mesh(sphere, skin, [s * -0.06, 0.03, 0.04], hand, [0.035, 0.05, 0.035], [0, 0, s * 0.5]); // thumb
    return { sh, el, hand };
  };
  const L = arm(1), R = arm(-1);

  // ---------------------------------------------------------------- legs (pivot at the hip)
  const leg = (s: number) => {
    const th = group(hips, [s * 0.16, 0, 0]);
    mesh(new THREE.CapsuleGeometry(0.125, 0.22, 6, 14), denim, [0, -0.19, 0], th);
    const kn = group(th, [0, -0.4, 0]);
    mesh(new THREE.CapsuleGeometry(0.11, 0.2, 6, 14), denim, [0, -0.15, 0], kn);
    mesh(new THREE.CylinderGeometry(0.115, 0.12, 0.08, 16), denim, [0, -0.27, 0], kn); // turned-up hem
    mesh(sphere, boot, [0, -0.37, 0.05], kn, [0.13, 0.09, 0.2]);
    mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.12, 16), boot, [0, -0.33, 0], kn);
    return { th, kn };
  };
  const LL = leg(1), RL = leg(-1);

  // ---------------------------------------------------------------- tools (held in the right hand, shown per chore)
  const tools: Record<string, THREE.Object3D> = {};
  const tool = (name: string, build: (g: THREE.Group) => void, parent: THREE.Object3D = R.hand) => {
    const g = new THREE.Group(); build(g); g.visible = false; parent.add(g); tools[name] = g;
  };
  const metal = toonMat(0xaab4bd), wood = toonMat(0x9a6a3c), green = toonMat(0x58a64a), grain = toonMat(0xf2d27a);
  tool('bucket', (g) => {
    mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.22, 18, 1, true), toonMat(0xaab4bd, { side: THREE.DoubleSide }), [0, -0.2, 0], g);
    mesh(new THREE.CircleGeometry(0.1, 18), metal, [0, -0.31, 0], g, undefined, [-Math.PI / 2, 0, 0]);
    mesh(new THREE.CircleGeometry(0.115, 18), grain, [0, -0.13, 0], g, undefined, [-Math.PI / 2, 0, 0]);
    mesh(new THREE.TorusGeometry(0.13, 0.008, 6, 20, Math.PI), metal, [0, -0.09, 0], g);
  });
  tool('can', (g) => {
    mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.24, 18), green, [0, -0.17, 0.04], g);
    const sp = mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.32, 8), green, [0, -0.12, 0.25], g); sp.rotation.x = 1.0;
    mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.04, 10), green, [0, -0.02, 0.38], g, undefined, [1.0, 0, 0]);
  });
  tool('axe', (g) => {
    const h = new THREE.Group(); h.rotation.x = Math.PI / 2; g.add(h);
    mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.8, 8), wood, [0, 0.25, 0], h);
    mesh(new THREE.BoxGeometry(0.03, 0.14, 0.18), metal, [0, 0.58, 0.07], h);
  });
  tool('mug', (g) => {
    mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.11, 14), white, [0, -0.02, 0.07], g);
    mesh(new THREE.CircleGeometry(0.045, 14), toonMat(0x5a3218), [0, 0.036, 0.07], g, undefined, [-Math.PI / 2, 0, 0]);
  });
  tool('hammer', (g) => {
    const h = new THREE.Group(); h.rotation.x = Math.PI / 2; g.add(h);
    mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.36, 8), wood, [0, 0.08, 0], h);
    mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), metal, [0, 0.26, 0], h);
  });

  tool('paper', (g) => {
    const paper = toonMat(0xf4f1e8, { side: THREE.DoubleSide }), ink = toonMat(0x9a9a9a);
    for (const s of [-1, 1]) {
      const page = mesh(new THREE.PlaneGeometry(0.26, 0.34), paper, [s * 0.12, 0.05, 0.12], g, undefined, [0, -s * 0.35, 0]);
      for (let i = 0; i < 5; i++) mesh(new THREE.PlaneGeometry(0.18, 0.018), ink, [0, 0.1 - i * 0.05, 0.002 * -s], page).castShadow = false;
    }
  }, L.hand);
  tool('flashlight', (g) => {
    const h = new THREE.Group(); h.rotation.x = Math.PI / 2; g.add(h);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), toonMat(0x2b2b2b), [0, 0.05, 0], h);
    mesh(new THREE.CylinderGeometry(0.045, 0.032, 0.06, 12), toonMat(0x2b2b2b), [0, 0.17, 0], h);
    mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }), [0, 0.201, 0], h, undefined, [-Math.PI / 2, 0, 0]);
  });
  tool('shirt', (g) => {
    mesh(new THREE.BoxGeometry(0.3, 0.32, 0.02), toonMat(0x6fb3e0), [0, 0.1, 0.12], g);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), toonMat(0x6fb3e0), [s * 0.2, 0.2, 0.12], g, undefined, [0, 0, -s * 0.4]);
  });

  return {
    tilt, hips, torso, head, hat, belly,
    shoulderL: L.sh, shoulderR: R.sh, elbowL: L.el, elbowR: R.el, handL: L.hand, handR: R.hand,
    thighL: LL.th, thighR: RL.th, kneeL: LL.kn, kneeR: RL.kn,
    browL, browR, mouth, eyes, face, tools,
  };
}
