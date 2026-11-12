import * as THREE from 'three';
import { step, owners } from '../core/physics';
import type { Input } from '../core/input';
import type { Audio } from '../core/audio';
import { Gfx } from '../render/gfx';
import { Grass } from '../render/grass';
import { Fx } from '../render/fx';
import { buildFarm1, type FarmBuild } from '../world/farm1';
import { Pig, emptyInput, type PigInput } from '../pig/pig';
import { Prop } from '../world/props';
import { CamRig } from './camera';
import { Hud } from './hud';
import { G } from './ctx';

export const PLAYER_COLORS = [0xffc934, 0x38c6f4, 0x8be04e, 0xb57bff];
const FIXED = 1 / 60;

export class Game {
  pigs: Pig[] = [];
  local!: Pig;
  farm!: FarmBuild;
  grass!: Grass;
  cam: CamRig;
  hud!: Hud;
  private acc = 0;
  private last = performance.now();
  private frames = 0; private fpsT = 0; fps = 0;
  running = false;
  /** Test hook: overrides keyboard input when set. */
  scripted: Partial<PigInput> | null = null;

  constructor(public gfx: Gfx, public audio: Audio, public input: Input) {
    this.cam = new CamRig(gfx.camera);
  }

  build() {
    const scene = this.gfx.scene;
    G.fx = new Fx(scene);
    G.audio = this.audio;
    const { terrain, build } = buildFarm1(scene);
    G.terrain = terrain;
    terrain.build(scene);
    this.farm = build(terrain);
    this.grass = new Grass(scene, terrain, this.gfx.quality === 'high' ? 16 : 8);
    this.farm.pigSpawns.forEach((p, i) => this.pigs.push(new Pig(scene, p, PLAYER_COLORS[i], ['You', 'P2', 'P3', 'P4'][i])));
    this.local = this.pigs[0];
    G.localPig = this.local;
    (window as any).__G = G;
    this.local.yaw = Math.PI;
    this.hud = new Hud();
    this.input.onKey = (code) => {
      if (code === 'KeyH') { this.hud.showHelp = !this.hud.showHelp; this.hud.renderHelp(); }
      if (code === 'KeyM') this.audio.toggleMute();
      if (code === 'KeyP') { const q = new URLSearchParams(location.search); q.set('q', this.gfx.quality === 'high' ? 'low' : 'high'); location.search = q.toString(); }
      if (code === 'KeyR' && this.input.held.size === 0) this.local.respawn();
    };
    // warm up physics so everything settles before the first frame
    for (let i = 0; i < 30; i++) this.fixed(false);
  }

  private buildInput(first: boolean): PigInput {
    const inp = emptyInput();
    const { f, r } = this.cam.basis();
    const s = this.scripted;
    const mx = s?.mx ?? this.input.moveX, my = s?.mz ?? this.input.moveY;
    inp.mx = f.x * my + r.x * mx; inp.mz = f.z * my + r.z * mx;
    inp.yaw = this.cam.yaw; inp.pitch = this.cam.pitch;
    const h = this.input.held;
    inp.jump = h.has('jump'); inp.sprint = h.has('sprint'); inp.fart = h.has('fart'); inp.stand = h.has('stand');
    inp.wallow = h.has('wallow'); inp.grab = h.has('grab');
    if (first) {
      const { pressed, released } = this.input.consume();
      inp.jumpP = pressed.has('jump'); inp.sprintP = pressed.has('sprint'); inp.fartP = pressed.has('fart');
      inp.standP = pressed.has('stand'); inp.wallowP = pressed.has('wallow'); inp.grabP = pressed.has('grab');
      inp.grabR = released.has('grab'); inp.oinkP = pressed.has('oink');
    }
    if (s) Object.assign(inp, s, { mx: inp.mx, mz: inp.mz });
    return inp;
  }

  private fixed(withInput: boolean, first = false) {
    G.time += FIXED;
    for (const p of this.pigs) p.input = emptyInput();
    if (withInput) this.local.input = this.buildInput(first);
    for (const p of this.pigs) p.preStep(FIXED);
    for (const c of this.farm.critters) c.preStep(FIXED);
    for (const pr of this.farm.props) pr.synced.beforeStep();
    step((h1, h2, force) => {
      for (const h of [h1, h2]) { const o = owners.get(h); if (o instanceof Prop) o.impact(force); }
    });
    for (const p of this.pigs) p.postStep(FIXED);
    for (const c of this.farm.critters) c.postStep();
    for (const pr of this.farm.props) {
      pr.synced.capture();
      const y = pr.synced.currP.y;
      if (y < -20) { pr.body.setTranslation({ x: 0, y: 3, z: 6 }, true); pr.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    }
    G.clouds = G.clouds.filter((c) => c.until > G.time);
    if (this.scripted) { this.scripted.jumpP = this.scripted.fartP = this.scripted.sprintP = this.scripted.wallowP = this.scripted.standP = this.scripted.grabP = this.scripted.grabR = false; }
  }

  frame = () => {
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.input.poll();
    if (this.running) {
      this.acc += dt;
      let first = true;
      while (this.acc >= FIXED) { this.fixed(true, first); first = false; this.acc -= FIXED; }
    }
    const alpha = this.acc / FIXED;
    for (const p of this.pigs) p.render(alpha, dt);
    for (const c of this.farm.critters) c.render(alpha, dt);
    for (const pr of this.farm.props) pr.synced.apply(alpha);
    for (const m of this.farm.mixers) m.update(dt);
    for (const s of this.farm.spinners) s.obj.rotateY(s.speed * dt);
    const lp = this.local.visual.root.position;
    this.cam.update(dt, this.running ? this.input.lookX : 0, this.running ? this.input.lookY : 0, lp, this.local.standing);
    this.grass.update(G.time, this.gfx.camera.position, this.pigs.map((p) => p.visual.root.position));
    G.fx.update(dt);
    this.gfx.focusShadows(lp);
    this.audio.setListener(this.gfx.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    this.hud.update(this.local, this.fps);
    this.gfx.render(dt);
    requestAnimationFrame(this.frame);
  };
}

export { THREE };
