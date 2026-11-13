import * as THREE from 'three';
import { step, owners } from '../core/physics';
import type { Input } from '../core/input';
import type { Audio } from '../core/audio';
import { Gfx } from '../render/gfx';
import { Grass } from '../render/grass';
import { Fx } from '../render/fx';
import { buildFarm1, FARM, type FarmBuild } from '../world/farm1';
import { Farmer } from '../farmer/farmer';
import { Nav } from '../farmer/nav';
import { Pig, emptyInput, type PigInput } from '../pig/pig';
import { randomOutfit, defaultOutfit } from '../pig/cosmetics';
import { Prop } from '../world/props';
import { DayNight } from '../world/daynight';
import { WolfPack } from '../world/wolf';
import { CamRig } from './camera';
import { Hud } from './hud';
import { Menu } from './menu';
import { G, ADMIN } from './ctx';
import { SETTINGS } from './settings';
import { GRASS_LEVEL, LAMP_LIGHTS, DETAIL_DIST } from '../render/quality';
import { cullDetail } from '../render/batch';
import { t } from '../i18n';
import { NetHost, NetClient } from '../net/sync';
import { online, type Peer } from '../net/online';
import { parseOutfit } from '../pig/cosmetics';

export const PLAYER_COLORS = [0xffc934, 0x38c6f4, 0x8be04e, 0xb57bff];
const FIXED = 1 / 60;
const PRESSES = ['jumpP', 'sprintP', 'fartP', 'standP', 'wallowP', 'grabP', 'grabR', 'oinkP'] as const;
const tmpV = new THREE.Vector3();

export class Game {
  pigs: Pig[] = [];
  local!: Pig;
  farm!: FarmBuild;
  grass!: Grass;
  cam: CamRig;
  hud!: Hud;
  menu!: Menu;
  farmer: Farmer | null = null;
  nav!: Nav;
  daynight!: DayNight;
  wolves!: WolfPack;
  private acc = 0;
  private last = performance.now();
  private frames = 0; private fpsT = 0; fps = 0;
  /** Frame-rate limit bookkeeping, small-detail draw distance, "lower the graphics" tip shown. */
  private nextDraw = 0; private detailDist = Infinity; private slowTip = false;
  running = false;
  private wardrobeEl = document.getElementById('wardrobe')!;
  /** Test hook: overrides keyboard input when set. */
  scripted: Partial<PigInput> | null = null;
  /** Online: host simulation + snapshots, or player view of the host's world. */
  net: NetHost | NetClient | null = null;
  private bgWorker: Worker | null = null;
  /** Online player: my own pig's prediction clock and presses that haven't had a step yet. */
  private pacc = 0; private pendP: PigInput | null = null;

  constructor(public gfx: Gfx, public audio: Audio, public input: Input) {
    this.cam = new CamRig(gfx.camera);
  }

  build() {
    const scene = this.gfx.scene;
    G.fx = new Fx(scene);
    G.audio = this.audio;
    this.daynight = new DayNight(this.gfx);
    const { terrain, build } = buildFarm1(scene);
    G.terrain = terrain;
    terrain.build(scene);
    this.farm = build(terrain, this.daynight);
    this.grass = new Grass(scene, terrain);
    this.farm.pigSpawns.forEach((p, i) => this.pigs.push(new Pig(scene, p, PLAYER_COLORS[i],
      i === 0 ? t('name.you') : t('name.p', { n: i + 1 }), i === 0 ? (SETTINGS.outfit ?? defaultOutfit()) : randomOutfit())));
    this.local = this.pigs[0];
    G.localPig = this.local;
    G.pigs = this.pigs;
    G.cage = this.farm.cage;
    const t0 = performance.now();
    this.nav = new Nav(FARM, terrain);
    console.log(`nav grid ${this.nav.w}x${this.nav.h} in ${(performance.now() - t0) | 0} ms`);
    this.farmer = new Farmer(scene, this.farm.farmerSpawn, this.nav, this.farm.chores, this.farm.cage, this.pigs, this.farm.zones);
    this.farmer.mower.onMow = (x, z, r) => this.grass.mow(x, z, r);
    if (new URLSearchParams(location.search).get('bob') === '0') { ADMIN.bob = false; this.farmer.setEnabled(false); }
    this.wolves = new WolfPack(scene, this.nav, FARM);
    (window as any).__G = G;
    (window as any).__ADMIN = ADMIN;
    this.local.yaw = Math.PI;
    this.hud = new Hud();
    this.menu = new Menu(this);
    this.input.onKey = (code) => {
      if (code === 'Backquote') { this.menu.toggleAdmin(); return; }
      if (this.menu.blocking && code !== 'KeyM') return;
      if (code === 'KeyH') this.hud.toggleHelp();
      if (code === 'KeyM') this.menu.toggleSound();
      if (code === 'KeyP') this.menu.cyclePreset();
      if (code === 'KeyR' && this.input.held.size === 0 && G.net !== 'client') this.local.respawn();
    };
    const h = new URLSearchParams(location.search).get('hour');
    if (h) this.daynight.setHour(parseFloat(h));
    this.applySettings();
    this.applyGfx();
    // warm up physics so everything settles before the first frame
    for (let i = 0; i < 30; i++) this.fixed(false);
  }

  /** Graphics options → renderer, grass, lamp lights, small-detail distance. */
  applyGfx() {
    const o = SETTINGS.gfx;
    this.gfx.apply(o);
    this.grass.setLevel(GRASS_LEVEL[o.grass].density, GRASS_LEVEL[o.grass].range);
    this.daynight.setLampLights(LAMP_LIGHTS[o.lamps]);
    this.detailDist = DETAIL_DIST[o.detail];
  }

  applySettings() {
    this.input.sensitivity = 0.0024 * SETTINGS.sens;
    this.input.invertY = SETTINGS.invertY;
    this.audio.setVolumes({ sfx: SETTINGS.sfx, music: SETTINGS.music, ambience: SETTINGS.ambience });
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
    const host = this.net instanceof NetHost ? this.net : null;
    host?.beginStep();
    G.time += FIXED;
    this.daynight.tick(FIXED);
    for (const p of this.pigs) p.input = emptyInput();
    if (withInput) this.local.input = this.menu.blocking && G.net === 'host' ? emptyInput() : this.buildInput(first);
    if (host) this.pigs.forEach((p, i) => { if (p !== this.local && !p.absent) { p.input = host.inputFor(i) ?? p.input; p.remote = host.poseFor(i); } });
    for (const p of this.pigs) p.preStep(FIXED);
    this.farmer?.preStep(FIXED);
    for (const c of this.farm.critters) c.preStep(FIXED);
    for (const w of this.wolves.wolves) w.preStep(FIXED);
    for (const pr of this.farm.props) pr.synced.beforeStep();
    step((h1, h2, force) => {
      for (const h of [h1, h2]) { const o = owners.get(h); if (o instanceof Prop) o.impact(force); }
    });
    for (const p of this.pigs) p.postStep(FIXED);
    this.farmer?.postStep();
    this.farm.cage.update(FIXED, this.pigs);
    for (const c of this.farm.critters) c.postStep();
    for (const w of this.wolves.wolves) w.postStep();
    this.wolves.update();
    for (const pr of this.farm.props) {
      pr.synced.capture();
      const y = pr.synced.currP.y;
      if (y < -20) { pr.body.setTranslation({ x: 0, y: 3, z: 6 }, true); pr.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    }
    // the pond washes the mud off
    for (const p of this.pigs) if (p.muddyUntil > G.time && this.farm.inWater(p.pos.x, p.pos.z)) {
      p.muddyUntil = G.time; G.audio.play('mudstep', { pos: p.pos, vol: 0.8 });
      if (p === this.local) this.hud.toast(t('s.clean'), 1.2);
    }
    G.clouds = G.clouds.filter((c) => c.until > G.time);
    host?.endStep();
    if (this.scripted) { this.scripted.jumpP = this.scripted.fartP = this.scripted.sprintP = this.scripted.wallowP = this.scripted.standP = this.scripted.grabP = this.scripted.grabR = false; }
  }

  private handleEvents() {
    for (const e of G.events) {
      const me = e.who === this.local;
      const who = e.who?.label ?? '';
      switch (e.type) {
        case 'alarm': if (me) this.hud.toast(t('e.alarm'), 1.6); break;
        case 'caught': this.hud.toast(me ? t('e.caughtMe') : t('e.caughtOther', { who }), 1.6); break;
        case 'escaped': if (me) this.hud.toast(t('e.escaped'), 1.2); break;
        case 'caged': if (me) this.hud.toast(t('e.caged'), 1.6); break;
        case 'cage-open': this.hud.toast(this.local.cage === null && e.why ? t('e.cageOpenRun') : t('e.cageOpen'), 1.6); break;
        case 'grilled':
          this.hud.toast(me ? t('e.grilledMe') : t('e.grilledOther', { who }), 2);
          if (G.grills >= 3) { this.hud.toast(t('e.bobWins'), 3); G.grills = 0; }
          break;
        case 'knockdown': this.hud.toast(t('e.knockdown'), 1.4); break;
        case 'stagger': this.hud.toast(t('e.stagger'), 1.2); break;
        case 'slapped': this.hud.toast(t('e.slapped'), 2.4, (me ? '' : who + ': ') + t(e.text ?? 'insult.0')); break;
        case 'fell': if (me) this.hud.toast(t('e.fell'), 1.8); break;
        case 'night': this.hud.toast(t('e.night'), 2.5); break;
        case 'dawn': this.hud.toast(t('e.dawn'), 2); break;
        case 'wolves': this.hud.toast(t('e.wolves'), 2); break;
        case 'wolfBit': if (me) this.hud.toast(t('e.wolfBit'), 1.4); break;
        case 'wolfScared': break;
        case 'lostToWolf': this.hud.toast(t('e.lostToWolf', { who }), 2); break;
        case 'bobWakes': this.hud.toast(t('e.bobWakes'), 1.6); break;
      }
    }
    G.events.length = 0;
  }

  /** Admin panel buttons. */
  adminAction(a: string) {
    if (G.net === 'client') { this.hud.toast(t('net.hostOnly'), 1.6); return; }
    const L = this.local, cage = this.farm.cage, f = this.farmer;
    const tp = (x: number, z: number) => { if (L.heldBy) L.heldBy.release(false); L.body.setTranslation({ x, y: G.terrain.height(x, z) + 1.2, z }, true); L.body.setLinvel({ x: 0, y: 0, z: 0 }, true); };
    switch (a) {
      case 'grill': cage.grillNow(); break;
      case 'free': cage.setOpen(true, 'admin'); break;
      case 'catch': if (!L.cage && !L.out) { if (L.heldBy) L.heldBy.release(false); cage.lock(L); } break;
      case 'mud': L.muddyUntil = G.time + 60; break;
      case 'knock': if (!L.out && !L.heldBy) L.knock(new THREE.Vector3(Math.sin(L.yaw) * -3, 7, Math.cos(L.yaw) * -3), true); break;
      case 'bringCrate': case 'bringPig': {
        // drop something to grab right in front of me
        const f = L.forward, at = new THREE.Vector3(L.pos.x + f.x * 1.3, L.pos.y + 0.6, L.pos.z + f.z * 1.3);
        const it = a === 'bringPig' ? this.pigs.find((p) => p !== L && !p.out && !p.cage && !p.heldBy && !p.held)
          : this.farm.props.filter((p) => !p.heldBy && p.mass <= 20).sort((x, y) => x.synced.currP.distanceTo(L.pos) - y.synced.currP.distanceTo(L.pos))[0];
        if (it) { it.body.setTranslation(at, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        break;
      }
      case 'bobDown': if (f && ADMIN.bob) f.knockDown(); break;
      case 'bobCarry': if (f && ADMIN.bob && !L.out && !L.cage) { if (L.heldBy) L.heldBy.release(false); f.carryMe(L); } break;
      case 'dance': f?.forceDance(); break;
      case 'slap': if (f && ADMIN.bob) { f.slapMe(L); } break;
      case 'mow': f?.forceMow(); break;
      case 'bed': f?.forceBed(); break;
      case 'day': this.daynight.setHour(7); this.wolves.clear(); break;
      case 'night': this.daynight.setHour(21.3); break;
      case 'wolves': for (let i = 0; i < 2; i++) this.wolves.spawn(); break;
      case 'nowolves': this.wolves.clear(); break;
      case 'tp:sty': tp(30, 6); break;
      case 'tp:cage': tp(cage.front.x + 1.5, cage.front.z + 1.5); break;
      case 'tp:house': tp(this.farm.zones.door.x + 1, this.farm.zones.door.z + 2); break;
      case 'tp:barn': tp(0, 8); break;
      case 'tp:pasture': tp(30, -62); break;
    }
  }

  // ---------------------------------------------------------------- online
  /** Start (or join) the online game: host simulates, players show the host's world. */
  goOnline(role: 'host' | 'client') {
    G.net = role;
    const slot = online.mySlot();
    this.local = this.pigs[slot]; G.localPig = this.local;
    this.local.yaw = Math.PI;
    if (role === 'host') {
      this.net = new NetHost(this, online);
      this.startBackgroundTicks();
    } else {
      this.wolves.clear();
      this.net = new NetClient(this, online);
    }
    this.syncPeers();
  }

  /** Names, outfits, who is in the game (host decides presence; players get it in snapshots). */
  syncPeers() {
    const bySlot = new Map<number, Peer>();
    for (const p of online.peers.values()) bySlot.set(p.slot, p);
    this.pigs.forEach((pig, i) => {
      const peer = bySlot.get(i);
      if (peer) {
        pig.label = peer.name;
        if (pig !== this.local) { const o = parseOutfit(peer.outfit); if (o) pig.visual.setOutfit(o); }
      }
      if (G.net === 'host') pig.setPresent(!!peer || pig === this.local);
    });
  }
  peerLeft(id: number) { if (this.net instanceof NetHost) this.net.dropPeer(id); this.syncPeers(); }

  /**
   * Browsers stop drawing hidden tabs (alt-tab, minimized). The host's world must keep running for everyone,
   * so a tiny worker keeps ticking the simulation while the tab is hidden.
   */
  private startBackgroundTicks() {
    if (this.bgWorker) return;
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16);'], { type: 'text/javascript' }));
      this.bgWorker = new Worker(url);
      this.bgWorker.onmessage = () => {
        if (!document.hidden) return;
        const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        this.simulate(dt);
        this.handleEvents();
      };
    } catch { /* no workers: the game pauses while hidden */ }
  }

  /**
   * Online player: my own pig runs here, on my machine, at the same fixed rate (movement answers my keys at once);
   * only it is simulated — everything else is placed from the host's snapshots. The host follows my pig's pose.
   */
  private predict(dt: number, inp: PigInput) {
    const L = this.local;
    if (!L.predicting) { this.pacc = 0; this.pendP = null; return; }
    const pin = { ...inp };
    if (this.pendP) for (const k of PRESSES) pin[k] = pin[k] || this.pendP[k];
    this.pacc += dt;
    let n = 0;
    while (this.pacc >= FIXED && n < 8) {
      L.input = n === 0 ? pin : { ...pin, jumpP: false, sprintP: false, fartP: false, standP: false, wallowP: false, grabP: false, grabR: false, oinkP: false };
      G.mute = true;
      try { L.predictStep(FIXED); } finally { G.mute = false; }
      step();
      L.synced.capture();
      this.pacc -= FIXED; n++;
    }
    if (n >= 8) this.pacc = 0;
    this.pendP = n === 0 ? pin : null;   // no step this frame: keep the presses for the next one
  }

  /** Online player: what my (predicted) pig holds is drawn where my pig is, not where the host's older copy was. */
  private carryAlong() {
    const L = this.local, h = L.held as { synced?: { prevP: THREE.Vector3; currP: THREE.Vector3 } } | null;
    if (!L.predicting || !h?.synced || !(this.net instanceof NetClient)) return;
    const d = L.synced.pos(this.pacc / FIXED, tmpV).sub(this.net.ownSnap);
    if (d.lengthSq() > 9) return;
    h.synced.prevP.add(d); h.synced.currP.add(d);
  }

  /** Fixed simulation steps for the time that passed (solo / host). */
  private simulate(dt: number) {
    // settings menu / wardrobe pause the game (the admin panel doesn't: you test things live). Online never pauses.
    const paused = G.net === 'solo' && (this.menu.menuOpen || this.wardrobeEl.classList.contains('show'));
    if (this.running && !paused) {
      this.acc += dt * (G.net === 'solo' ? ADMIN.gameSpeed : 1);
      let first = true, n = 0;
      while (this.acc >= FIXED && n++ < 12) { this.fixed(true, first); first = false; this.acc -= FIXED; }
      if (n >= 12) this.acc = 0;
    }
  }

  frame = () => {
    const nowMs = performance.now();
    // frame-rate limit (battery / hot laptops): skip screen refreshes until the next frame is due
    const cap = SETTINGS.gfx.fpsCap;
    if (cap) {
      const stepMs = 1000 / cap;
      if (nowMs < this.nextDraw - stepMs * 0.25) { requestAnimationFrame(this.frame); return; }
      this.nextDraw = nowMs - this.nextDraw > stepMs ? nowMs + stepMs : this.nextDraw + stepMs;
    }
    const dt = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.input.poll();
    let alpha: number;
    if (this.net instanceof NetClient) {
      if (this.running) {
        const inp = this.menu.blocking ? emptyInput() : this.buildInput(true);
        this.predict(dt, inp);
        this.net.sendInput(inp, this.local.predicting ? this.local.pose() : null);
      }
      alpha = Math.max(0, this.net.frame(dt));
      this.carryAlong();
      this.farm.cage.animate(dt);
    } else {
      this.simulate(dt);
      alpha = this.acc / FIXED;
    }
    if (online.room) { online.tickStats(); if ((this.frames & 15) === 0) this.menu.netStats(); }
    for (const p of this.pigs) p.render(p === this.local && p.predicting ? this.pacc / FIXED : alpha, dt);
    for (const c of this.farm.critters) c.render(alpha, dt);
    for (const d of this.farm.decor) d.render(dt);
    for (const w of this.wolves.wolves) w.render(alpha, dt);
    this.farmer?.render(alpha, dt);
    for (const pr of this.farm.props) pr.synced.apply(alpha);
    for (const s of this.farm.spinners) s.obj.rotateY(s.speed * dt);
    for (const u of this.farm.updaters) u(dt, G.time);
    const lp = this.local.visual.root.position;
    const look = this.running && !this.menu.blocking;
    this.cam.update(dt, look ? this.input.lookX : 0, look ? this.input.lookY : 0, lp, this.local.standing);
    this.grass.update(G.time, this.gfx.camera.position, this.pigs.map((p) => p.visual.root.position));
    cullDetail(this.gfx.camera.position, this.detailDist);
    G.fx.update(dt);
    this.daynight.update(dt, this.gfx.camera.position);
    this.gfx.focusShadows(lp);
    this.audio.setListener(this.gfx.camera);
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    this.hud.update(this.local, SETTINGS.fps ? this.fps : 0);
    if (G.net !== 'solo') this.hud.updateTags(this.pigs, this.local, this.gfx.camera);
    if (this.farmer) {
      this.hud.updateFarmer(this.farmer, this.local, this.gfx.camera);
      this.audio.setMusicRate(this.farmer.chasing || this.farmer.state === 'carry' ? 1.12 : 1);
    }
    this.handleEvents();
    this.gfx.render(dt);
    if (this.running) this.gfx.updateDynRes(dt);
    if (this.gfx.slowFor >= 8 && !this.slowTip && SETTINGS.preset !== 'low') { this.slowTip = true; this.hud.toast(t('toast.slowTip'), 5); }
    requestAnimationFrame(this.frame);
  };
}

export { THREE };
