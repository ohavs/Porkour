import * as THREE from 'three';
import { step, owners, world } from '../core/physics';
import type { Input } from '../core/input';
import type { Audio } from '../core/audio';
import { Gfx } from '../render/gfx';
import { Grass } from '../render/grass';
import { Fx } from '../render/fx';
import { googly } from '../render/googly';
import { Round, ROUND } from './round';
const ROUND_START_HOUR = ROUND.startHour;
import type { FarmBuild } from '../world/farmKit';
import { FARM_BUILDERS, farmId } from '../world/farms';
import { Farmer } from '../farmer/farmer';
import { Nav } from '../farmer/nav';
import { Pig, emptyInput, type PigInput } from '../pig/pig';
import { randomOutfit, defaultOutfit } from '../pig/cosmetics';
import { Prop } from '../world/props';
import { DayNight } from '../world/daynight';
import { MOD, type ModId } from './modifiers';
import { WolfPack } from '../world/wolf';
import { Traps } from '../world/traps';
import { Gates, type Gate } from '../world/gates';
import { Gadgets, type PoolId } from '../world/gadgets';
import { gadgetOfMsg } from './shop';
import { CamRig } from './camera';
import { Hud } from './hud';
import { Menu } from './menu';
import { Lockpick } from './lockpick';
import { Markers } from './markers';
import { G, ADMIN } from './ctx';
import { SETTINGS } from './settings';
import { GRASS_LEVEL, LAMP_LIGHTS, DETAIL_DIST } from '../render/quality';
import { cullDetail } from '../render/batch';
import { t, type Key } from '../i18n';
import { NetHost, NetClient } from '../net/sync';
import { online, type Peer } from '../net/online';
import { parseOutfit } from '../pig/cosmetics';

export const PLAYER_COLORS = [0xffc934, 0x38c6f4, 0x8be04e, 0xb57bff];
const FIXED = 1 / 60;
const PRESSES = ['jumpP', 'sprintP', 'fartP', 'standP', 'wallowP', 'grabP', 'grabR', 'oinkP', 'attackP', 'attackR', 'pickP', 'pickFailP'] as const;
const tmpV = new THREE.Vector3();
const NO_PRESSES = Object.fromEntries(PRESSES.map((k) => [k, false])) as Record<(typeof PRESSES)[number], false>;
/** Events the round counts (each one = +1): only seen inside the fixed step, never again in handleEvents. */
const COUNTED = new Set(['smashed', 'splatBob', 'treeShaken', 'pressed', 'cowTipped', 'milkSpilled', 'lanternOut']);

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
  traps!: Traps;
  gates!: Gates;
  /** Shop gadgets in the world (cherry / stink bombs, bones: pooled props). */
  gadgets!: Gadgets;
  /** My gadget count changed (a round used one): tell the host what I bring next. */
  onLoadout?: () => void;
  /** What the lock-pick puzzle is open on (the cage or a gate's padlock). */
  private pickOn: Gate | null = null;
  private acc = 0;
  private last = performance.now();
  private frames = 0; private fpsT = 0; fps = 0;
  /** Frame-rate limit bookkeeping, small-detail draw distance, "lower the graphics" tip shown. */
  private nextDraw = 0; private detailDist = Infinity; private slowTip = false;
  running = false;
  round!: Round;
  lockpick!: Lockpick;
  markers!: Markers;
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
    googly(scene);
    G.audio = this.audio;
    this.daynight = new DayNight(this.gfx);
    const { terrain, build, bounds } = FARM_BUILDERS[farmId()](scene);
    G.terrain = terrain;
    terrain.build(scene);
    this.farm = build(terrain, this.daynight);
    G.places = this.farm.places;
    // farm 4 plays at night: its own clock (dusk → dawn over a round)
    if (this.farm.clock) { G.secsPerHour = this.farm.clock.secsPerHour; this.daynight.setHour(this.farm.clock.start); }
    this.daynight.darkNight = this.farm.darkNight ?? 0;
    this.grass = new Grass(scene, terrain);
    this.farm.pigSpawns.forEach((p, i) => this.pigs.push(new Pig(scene, p, PLAYER_COLORS[i],
      i === 0 ? t('name.you') : t('name.p', { n: i + 1 }), i === 0 ? (SETTINGS.outfit ?? defaultOutfit()) : randomOutfit())));
    this.local = this.pigs[0];
    G.localPig = this.local;
    G.pigs = this.pigs;
    G.cage = this.farm.cage;
    const t0 = performance.now();
    this.nav = new Nav(bounds, terrain);
    console.log(`nav grid ${this.nav.w}x${this.nav.h} in ${(performance.now() - t0) | 0} ms`);
    this.farmer = new Farmer(scene, this.farm.farmerSpawn, this.nav, this.farm.chores, this.farm.cage, this.pigs, this.farm.zones);
    this.farmer.mower.onMow = (x, z, r) => this.grass.mow(x, z, r);
    if (new URLSearchParams(location.search).get('bob') === '0') { ADMIN.bob = false; this.farmer.setEnabled(false); }
    this.wolves = new WolfPack(scene, this.nav, bounds);
    if (this.farm.wolfHours) this.wolves.hours = this.farm.wolfHours;
    this.traps = new Traps(scene);
    this.gates = new Gates(scene, this.farm.gates);
    this.gadgets = new Gadgets(scene, this.farm.props);
    G.props = this.farm.props;
    // pen animals amble out when their gate is open
    const PEN_KINDS = ['hen', 'chick', 'rooster', 'sheep', 'alpaca', 'cow', 'horse', 'horse2', 'donkey', 'bull', 'reindeer', 'doe'];
    for (const c of this.farm.critters) {
      if (!PEN_KINDS.includes(c.def.kind)) continue;
      c.pen = this.gates.list.find((g) => { const r = g.def.rect; return c.home.x > r.x0 && c.home.x < r.x1 && c.home.z > r.z0 && c.home.z < r.z1; }) ?? null;
    }
    this.round = new Round(scene, this, this.farm.places.stash);
    this.markers = new Markers(scene, this);
    (window as any).__G = G;
    (window as any).__ADMIN = ADMIN;
    (window as any).__world = () => world;
    this.local.yaw = Math.PI;
    this.hud = new Hud();
    this.menu = new Menu(this);
    this.lockpick = new Lockpick();
    this.input.onPress = (b) => {
      if (!this.running || this.menu.blocking) return;
      if (this.lockpick.isOpen) {
        if (b === 'attack' || b === 'jump') this.lockpick.attempt(); else if (b === 'grab') this.lockpick.close();
        this.input.clearPresses();   // the puzzle ate it (no punch / jump when it closes)
        return;
      }
      // RMB at the cage latch: the lock-pick puzzle (the pig itself doesn't grab there)
      const L = this.local, cage = this.farm.cage;
      if (b === 'grab' && !L.held && cage.canPick(L)) { this.pickOn = null; this.lockpick.open(this.keyed(cage.pickOpts(L))); this.input.clearPresses(); return; }
      // RMB at a padlocked gate: the same puzzle on Bob's padlock
      const g = b === 'grab' && !L.held ? this.gates.latchOf(L) : null;
      if (g?.state === 'locked') { this.pickOn = g; this.lockpick.open(this.keyed(g.pickOpts(L))); this.input.clearPresses(); }
    };
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
    inp.attack = h.has('attack');
    if (first) {
      const { pressed, released } = this.input.consume();
      inp.jumpP = pressed.has('jump'); inp.sprintP = pressed.has('sprint'); inp.fartP = pressed.has('fart');
      inp.standP = pressed.has('stand'); inp.wallowP = pressed.has('wallow'); inp.grabP = pressed.has('grab');
      inp.grabR = released.has('grab'); inp.oinkP = pressed.has('oink');
      inp.attackP = pressed.has('attack'); inp.attackR = released.has('attack');
    }
    if (s) Object.assign(inp, s, { mx: inp.mx, mz: inp.mz });
    const lp = this.lockpick;
    if (lp.isOpen) {
      // picking the lock: the pig stands still, every key goes to the puzzle
      const yaw = inp.yaw, pitch = inp.pitch;
      Object.assign(inp, emptyInput(), { yaw, pitch });
    }
    if (first && (lp.solved || lp.slips)) { inp.pickP = lp.solved; inp.pickFailP = lp.slips > 0; lp.solved = false; lp.slips = 0; }
    return inp;
  }

  private fixed(withInput: boolean, first = false) {
    const host = this.net instanceof NetHost ? this.net : null;
    host?.beginStep();
    const ev0 = G.events.length;
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
      const a = owners.get(h1), b = owners.get(h2);
      if (a instanceof Prop) a.impact(force);
      if (b instanceof Prop) b.impact(force);
      // a thrown thing hits a static farm thing that reacts (fruit tree, beehive)
      if (a?.onImpact && b instanceof Prop) a.onImpact(b, force); else if (b?.onImpact && a instanceof Prop) b.onImpact(a, force);
    });
    for (const p of this.pigs) p.postStep(FIXED);
    this.farmer?.postStep();
    this.traps.step(FIXED);
    this.farm.cage.update(FIXED, this.pigs);
    this.gates.step(FIXED);
    for (const c of this.farm.critters) c.postStep();
    for (const w of this.wolves.wolves) w.postStep();
    this.wolves.update();
    for (const pr of this.farm.props) {
      pr.synced.capture();
      const y = pr.synced.currP.y;
      if (y < -20) { const g = this.farm.places.roadGate; pr.body.setTranslation({ x: g.x, y: g.y + 3, z: g.z - 8 }, true); pr.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    }
    this.gates.capture();
    this.farm.winter?.stepAll();
    // the pond washes the mud off
    for (const p of this.pigs) if (p.muddyUntil > G.time && this.farm.inWater(p.pos.x, p.pos.z)) {
      p.muddyUntil = G.time; G.audio.play('mudstep', { pos: p.pos, vol: 0.8 });
      if (p === this.local) this.hud.emote(p, 'splash', 1.2, 1.3);
    }
    // bushes / crops rustle when a pig pushes through them fast: a sound Bob can hear
    for (const p of this.pigs) {
      if (p.out || p.cage || p.heldBy || G.time < p.rustleAt) continue;
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (sp < 2.4 || !G.cover.at(p.pos)) continue;
      p.rustleAt = G.time + (sp > 5 ? 0.3 : 0.55);
      G.audio.play('rustle', { pos: p.pos, vol: Math.min(1, 0.4 + sp * 0.08), pitch: 0.9 + Math.random() * 0.25 });
      G.fx.bits(p.pos, { count: 5, color: 0x5cb83d, speed: 2.2, up: 2.2, life: 0.6, size: 0.12, grow: 0, drag: 2, alpha: 1 });
      G.noise(p.pos, sp > 5 ? 10 : 6);
    }
    G.clouds = G.clouds.filter((c) => c.until > G.time);
    if (G.net !== 'client') {
      this.round.step(FIXED);
      this.gadgets.step();
      this.farm.orchard?.step();
      this.farm.bees?.step(FIXED);
      this.farm.dairy?.stepHost();
      this.farm.pumpkins?.stepHost();
      this.farm.winter?.stepHost(FIXED);
      for (let i = ev0; i < G.events.length; i++) this.round.onEvent(G.events[i].type, G.events[i].text);
    }
    host?.endStep();
    if (this.scripted) for (const k of PRESSES) if (this.scripted[k]) this.scripted[k] = false;
  }

  private handleEvents() {
    for (const e of G.events) {
      if (G.net !== 'client' && !COUNTED.has(e.type)) this.round.onEvent(e.type, e.text);   // usually already seen inside the step; repeats are no-ops (counted ones aren't: only there)
      this.farm.orchard?.onEvent(e.type, e.text, e.why);
      this.farm.bees?.onEvent(e.type, e.text);
      this.farm.pumpkins?.onEvent(e.type, e.text);
      this.farm.winter?.onEvent(e.type);
      const me = e.who === this.local;
      const who = e.who?.label ?? '';
      // Less text on screen (user): what happens to someone pops as an icon over them; only a few short toasts stay
      // (coins, pranks, danger, the round's beats). No explanations under them.
      const H = this.hud, bob = this.farmer;
      switch (e.type) {
        case 'caught': if (!me) H.emote(e.who, 'carry'); break;
        case 'cage-open': H.toast(t('e.cageOpen'), 1.4, '', 'lock'); break;
        case 'grilled': H.toast(me ? t('e.grilledMe') : t('e.grilledOther', { who }), 1.8, '', 'flame'); break;
        case 'knockdown': case 'stagger': case 'bobSlipped': case 'bullBob': case 'cheeseBob': case 'catapultBob': case 'bobDunked': case 'bigSnowballBob':
          H.emote(bob, 'stars', 1.4, 2.4); break;
        case 'slapped': H.emote(e.who, 'stars', 1.2, 1.2); break;
        case 'bobDance': H.emote(bob, 'note', 1.6, 2.4); break;
        case 'wolves': H.toast(t('e.wolves'), 1.8, '', 'wolf'); break;
        case 'banked': H.toast(`+${e.why ?? ''} <i class="coin"></i>`, 1.1); break;
        case 'missionDone': H.toast(t((e.text ?? '') as Key, { n: this.round.textN(e.text ?? '') }), 2, '', 'check'); break;
        case 'missionStep': H.toast(e.why ?? '', 0.9, '', 'check'); break;
        case 'roundEscape': H.toast(t('e.roundEscape'), 3, '', 'stash'); break;
        case 'lastMinute': H.toast('1:00', 1.6); break;
        case 'alert': {
          const l = Number(e.why ?? 0);
          if (e.text === 'up' && l > 0) { if (l >= 2) H.toast(t(('e.alert' + l) as Key), 1.8, '', 'alarm'); G.audio.play(l >= 3 ? 'bob_oof' : 'bob_huh', { vol: 0.5 }); }
          H.alertFlash();
          break;
        }
        case 'aim': if (me) H.emote(bob, 'aim', 1, 2.4); break;
        case 'dogFound': case 'bullSees': case 'birdAlarm': if (me) H.emote(this.local, 'bang', 1.4, 1.3); break;
        case 'mod': H.toast(t(('mod.' + e.text) as Key), 2.4); break;
        case 'market': H.toast(t(e.text === 'gone' ? 'e.marketGone' : 'e.marketBack'), 2, '', 'cart'); break;
        case 'stung': case 'beesOut': if (me) H.emote(this.local, 'bee', 1.2, 1.3); break;
        case 'bobStung': H.emote(bob, 'bee', 1.2, 2.4); break;
        case 'pigSlipped': case 'pecked': case 'wolfBit': case 'shotHit': if (me) H.emote(this.local, 'stars', 1, 1.2); break;
        // farm 5: winter
        case 'bobTracks': H.emote(bob, 'feet', 2, 2.4); break;
        case 'pigDunked': H.emote(e.who, 'splash', 1.4, 1.3); break;
        case 'snowCoat': if (me) H.emote(this.local, 'snow', 1.4, 1.3); break;
        case 'roundEnd': break;
      }
    }
    G.events.length = 0;
  }

  /** Host / solo: everything back to the start, new mission list. */
  restartRound() {
    if (G.net === 'client') return;
    const cage = this.farm.cage;
    if (!cage.open) cage.setOpen(true, '');
    for (const p of this.pigs) { if (p.heldBy) p.heldBy.release?.(false); }
    this.farmer?.resetRound(this.farm.farmerSpawn);
    for (const p of this.pigs) if (!p.absent) { if (p.out && !p.absent) p.outUntil = G.time; p.respawn(); }
    for (const c of this.farm.critters) c.reset();
    for (const pr of this.farm.props) { if (pr.heldBy) pr.heldBy.release?.(false); pr.reset(); }
    this.wolves.clear();
    this.traps.clear();
    this.gates.reset();
    this.farm.orchard?.reset();
    this.farm.bees?.clear();
    this.farm.dairy?.reset();
    this.farm.pumpkins?.reset();
    this.farm.winter?.reset();
    this.gadgets.clear();
    this.daynight.setHour(this.farm.clock?.start ?? ROUND_START_HOUR);
    G.grills = 0;
    cage.setOpen(false);
    this.round.start();
    this.hud.toast(t('e.roundStart'), 2.2);
  }

  /** Admin panel buttons. */
  adminAction(a: string) {
    if (G.net === 'client') { this.hud.toast(t('net.hostOnly'), 1.6); return; }
    const L = this.local, cage = this.farm.cage, f = this.farmer;
    const tp = (x: number, z: number) => { if (L.heldBy) L.heldBy.release(false); L.body.setTranslation({ x, y: G.terrain.height(x, z) + 1.2, z }, true); L.body.setLinvel({ x: 0, y: 0, z: 0 }, true); };
    switch (a) {
      case 'grill': cage.grillNow(); break;
      case 'gates:lock': this.gates.all('locked'); break;
      case 'gates:shut': this.gates.all('shut'); break;
      case 'gates:open': this.gates.all('free'); break;
      case 'gate:smash': { const g = this.gates.nearest(L.pos); if (g) { if (g.state === 'free' || g.state === 'broken') g.setState('shut'); g.smash(tmpV.copy(g.def.out).negate(), L); } break; }
      case 'gate:bob': { const g = this.gates.nearest(L.pos); if (g && f) { if (g.state === 'shut' && f.level < 1) f.setAlert(1); f.gateNow(g); } this.menu.toggleAdmin(); break; }
      case 'tp:gate': { const g = this.gates.byId('chickens') ?? this.gates.list.find((x) => x.def.lockable); if (g) tp(g.latch.x + g.def.out.x * 1.1, g.latch.z + g.def.out.z * 1.1); this.menu.toggleAdmin(); break; }
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
      case 'danceNear': f?.danceSoon(); break;
      case 'slap': if (f && ADMIN.bob) { f.slapMe(L); } break;
      case 'mow': f?.forceMow(); break;
      case 'bed': f?.forceBed(); break;
      case 'day': this.daynight.setHour(7); this.wolves.clear(); break;
      case 'night': this.daynight.setHour(21.3); break;
      case 'wolves': for (let i = 0; i < 2; i++) this.wolves.spawn(); break;
      case 'nowolves': this.wolves.clear(); break;
      case 'roundWin': this.round.finishAll(); break;
      case 'roundEnd': this.round.end(this.round.missions.every((m) => !m.req || m.done), 'time'); break;
      case 'loot100': this.round.banked += 100; break;
      case 'roundNew': this.restartRound(); break;
      case 'bobHunt': if (f && ADMIN.bob && !L.out && !L.cage) f.loseMe(L); break;
      case 'tp:bush': {
        const b = G.cover.list.filter((c) => c.kind === 'bush' && c.r > 1.2).sort((a, b) => Math.hypot(a.x - L.pos.x, a.z - L.pos.z) - Math.hypot(b.x - L.pos.x, b.z - L.pos.z))[0];
        if (b) tp(b.x, b.z);
        break;
      }
      case 'tp:cage': tp(cage.front.x + 1.5, cage.front.z + 1.5); break;
      case 'tp:house': tp(this.farm.zones.door.x + 1, this.farm.zones.door.z + 2); break;
      case 'pick': { tp(cage.latch.x + 0.4, cage.latch.z + 0.9); this.menu.toggleAdmin(); setTimeout(() => { if (cage.canPick(L)) this.lockpick.open(this.keyed(cage.pickOpts(L))); else this.hud.toast(t('a.pickNo'), 1.4); }, 300); break; }
      case 'alert:0': case 'alert:1': case 'alert:2': case 'alert:3': f?.setAlert(Number(a.slice(6))); break;
      case 'trapMe': { const fw = L.forward; this.traps.place(new THREE.Vector3(L.pos.x + fw.x * 2, 0, L.pos.z + fw.z * 2)); break; }
      case 'dogMe': {
        const dog = this.farm.critters.find((c) => c.def.kind === 'dog');
        if (!dog || !f) break;
        if (f.level < 2) f.setAlert(2);
        const fw = L.forward, x = L.pos.x - fw.x * 7, z = L.pos.z - fw.z * 7;
        dog.body.setTranslation({ x, y: G.terrain.height(x, z) + 0.6, z }, true);
        dog.sicEm(L);
        break;
      }
      case 'mod:none': case 'mod:rain': case 'mod:fog': case 'mod:grumpy': case 'mod:market': {
        const m = a.slice(4) as ModId;
        ADMIN.mod = m; this.round.setMod(m);
        if (m === 'market') {   // test it now: just before he leaves (unless he's already in his away hours)
          if (!(G.hour >= MOD.market.leave - 0.3 && G.hour < MOD.market.back)) this.daynight.setHour(MOD.market.leave - 0.3);
          f?.resetMarket();
        }
        break;
      }
      case 'mod:random': ADMIN.mod = 'random'; break;
      case 'roosterMe': case 'turkeyMe': {
        const kind = a === 'roosterMe' ? 'rooster' : 'turkey', fw = L.forward;
        if (G.night > 0.6) this.daynight.setHour(10);
        this.farm.critters.filter((c) => c.def.alarm === kind).forEach((c, i) => {
          const d = kind === 'rooster' ? 4 : 6.5 + i, x = L.pos.x + fw.x * d + (i - 1) * 0.8, z = L.pos.z + fw.z * d;
          if (c.heldBy) c.heldBy.release?.(false);
          c.body.setTranslation({ x, y: G.terrain.height(x, z) + 0.5, z }, true); c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          c.sicBird(L);
        });
        break;
      }
      case 'gadget:cherryBomb': case 'gadget:stinkBomb': case 'gadget:bone': {
        const p = this.gadgets.giveAny(a.slice(7) as PoolId, L.pos, L.yaw);
        if (p) p.body.setTranslation({ x: p.body.translation().x, y: L.pos.y + 0.6, z: p.body.translation().z }, true);
        break;
      }
      case 'bringPot': case 'bringEgg': case 'bringGnome': case 'bringBone': {
        const id = a === 'bringPot' ? 'flowerPot' : a === 'bringEgg' ? 'egg' : a === 'bringBone' ? 'bone' : 'gnome';
        const f = L.forward, at = new THREE.Vector3(L.pos.x + f.x * 1.3, L.pos.y + 0.6, L.pos.z + f.z * 1.3);
        const it = this.farm.props.filter((p) => p.def.id === id && !p.banked && !p.heldBy).sort((x, y) => x.synced.currP.distanceTo(L.pos) - y.synced.currP.distanceTo(L.pos))[0];
        if (it) { it.body.setTranslation(at, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        break;
      }
      // farm 2: orchard + beehives
      case 'tree:shake': { const o = this.farm.orchard; const tr = o?.nearest(L.pos); if (o && tr) o.shake(tr, L.forward, L, 1); break; }
      case 'bees:me': this.farm.bees?.sic(L); break;
      case 'bringApples': {
        const o = this.farm.orchard; if (!o) break;
        const f = L.forward;
        o.apples.filter((p) => p.banked).slice(0, 6).forEach((p, i) => p.unbank(new THREE.Vector3(L.pos.x + f.x * 1.4 + (i % 3 - 1) * 0.3, L.pos.y, L.pos.z + f.z * 1.4 + Math.floor(i / 3) * 0.3), 0));
        break;
      }
      // farm 3: the dairy
      case 'bull:me': this.farm.dairy?.sic(L); break;
      case 'bull:out': { const g = this.gates.byId('bull'); if (g) this.farm.dairy?.letOut(g.outside); break; }
      case 'milk:spill': { const f = L.forward; this.farm.dairy?.spillAt(L.pos.x + f.x * 2.2, L.pos.z + f.z * 2.2); break; }
      case 'cow:tip': {
        const c = this.farm.critters.filter((x) => x.def.kind === 'cow').sort((x, y) => x.pos.distanceTo(L.pos) - y.pos.distanceTo(L.pos))[0];
        c?.knock(new THREE.Vector3(c.pos.x - L.pos.x, 0, c.pos.z - L.pos.z).normalize().multiplyScalar(2));
        break;
      }
      // farm 4: the pumpkin farm
      case 'lantern:out': { const pk = this.farm.pumpkins, l = pk?.nearest(L.pos, true); if (pk && l) pk.snuff(l, 'admin', L); break; }
      case 'lanterns:out': { const pk = this.farm.pumpkins; if (pk) for (const l of pk.lanterns) pk.snuff(l, 'admin', null); break; }
      case 'lanterns:on': { const pk = this.farm.pumpkins; if (pk) for (const l of pk.lanterns) pk.relight(l); break; }
      case 'bob:relight': { const pk = this.farm.pumpkins, l = pk?.nearest(L.pos, false); if (pk && l && f) f.jobNow(pk.jobOf(l, f.pos)); break; }
      case 'catapult:fire': this.farm.pumpkins?.cat?.fire(L); break;
      case 'catapult:me': { const c = this.farm.pumpkins?.cat; if (c) { const b = c.basket(); tp(b.x, b.z); } break; }
      case 'catapult:bob': { const c = this.farm.pumpkins?.cat; if (c && f) c.setYaw(Math.atan2(f.pos.x - c.x, f.pos.z - c.z)); break; }
      case 'giant:me': {
        const g = this.farm.props.find((p) => p.def.id === 'giantPumpkin' && !p.banked); if (!g) break;
        const fw = L.forward; g.body.setTranslation({ x: L.pos.x + fw.x * 2.6, y: L.pos.y + 1.2, z: L.pos.z + fw.z * 2.6 }, true);
        g.body.setLinvel({ x: 0, y: 0, z: 0 }, true); g.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        break;
      }
      // farm 5: winter
      case 'snowman:down': this.farm.winter?.topple(L.forward, L); break;
      case 'snowman:bob': { const w = this.farm.winter, j = f ? w?.jobOf(f.pos) : null; if (j && f) f.jobNow(j); break; }
      case 'bigball:me': {
        const w = this.farm.winter, b = w?.nearestBoulder(L.pos); if (!w || !b) break;
        const fw = L.forward; w.growBoulder(b, 1.0);
        b.p.body.setTranslation({ x: L.pos.x + fw.x * 2.8, y: L.pos.y + 1.4, z: L.pos.z + fw.z * 2.8 }, true);
        b.p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        break;
      }
      case 'bob:ice': if (f) f.slip('ice'); break;
      case 'snowcoat': L.muddyUntil = G.time + 60; break;
      case 'bringRag': case 'bringCheese': case 'bringPumpkin': case 'bringSnowball': {
        const id = a === 'bringRag' ? 'redRag' : a === 'bringPumpkin' ? 'patchPumpkin' : a === 'bringSnowball' ? 'snowball' : 'cheeseWheel';
        const f = L.forward, at = new THREE.Vector3(L.pos.x + f.x * 1.4, L.pos.y + 0.7, L.pos.z + f.z * 1.4);
        const it = this.farm.props.filter((p) => p.def.id === id && !p.banked && !p.heldBy).sort((x, y) => x.synced.currP.distanceTo(L.pos) - y.synced.currP.distanceTo(L.pos))[0];
        if (it) { it.body.setTranslation(at, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); it.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        break;
      }
      default: {
        const p = a.startsWith('tp:') ? this.farm.places.tp.find((x) => x[0] === a.slice(3)) : null;
        if (p) tp(p[1], p[2]);
      }
    }
  }

  /** Lock-pick puzzle options, easier with the shop's skeleton key this round (fewer pins, wider gold band, slower). */
  private keyed<T extends { pins: number; zone: number; speed: number }>(o: T): T {
    if (this.round.myGadget() !== 'key') return o;
    return { ...o, pins: Math.max(2, o.pins - 2), zone: o.zone * 1.5, speed: o.speed * 0.8 };
  }

  // ---------------------------------------------------------------- online
  /** Start (or join) the online game: host simulates, players show the host's world. */
  goOnline(role: 'host' | 'client') {
    G.net = role;
    const slot = online.mySlot();
    this.local = this.pigs[slot]; G.localPig = this.local;
    this.local.yaw = Math.PI;
    this.local.visual.setOutfit(SETTINGS.outfit ?? defaultOutfit());   // my seat's pig wears my outfit (a seat other than 1 had a random one)
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
        if (pig !== this.local) { const o = parseOutfit(peer.outfit); if (o) pig.visual.setOutfit(o); pig.gadget = gadgetOfMsg(peer.outfit); }
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
      L.input = n === 0 ? pin : { ...pin, ...NO_PRESSES };
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
    const pick = this.lockpick;
    if (pick.isOpen) {
      const still = this.pickOn ? this.pickOn.state === 'locked' && this.pickOn.atLatch(this.local, 0.6) : this.farm.cage.canPick(this.local, 0.6);
      if (Math.hypot(this.input.moveX, this.input.moveY) > 0.5 || !still || this.menu.blocking) pick.close();
      else pick.update(dt);
    }
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
    googly()?.update(dt);
    this.round.render(dt, this.gfx.camera);
    this.markers.update(this.gfx.camera, this.gfx.renderer.getPixelRatio());
    if (this.menu.blocking) document.getElementById('clickHint')?.classList.remove('show');
    for (const pr of this.farm.props) pr.synced.apply(alpha);
    this.gates.render(alpha);
    this.farm.orchard?.render(dt);
    this.farm.bees?.render(dt);
    this.farm.dairy?.render(dt);
    this.farm.pumpkins?.render(dt);
    this.farm.winter?.render(dt);
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
    const goal = this.round.targetFor(this.local.held);
    this.hud.update(this.local, SETTINGS.fps ? this.fps : 0, goal ? t(('where.' + goal.where) as Key) : '');
    if (G.net !== 'solo') this.hud.updateTags(this.pigs, this.local, this.gfx.camera);
    // caged: a lock pulses over the latch (that's where you pick it) instead of a sentence
    if (this.local.cage && !this.farm.cage.canPick(this.local)) this.hud.emote(this.farm.cage.latch, 'lock', 1.1, 0.5);
    this.hud.updateEmotes(this.gfx.camera);
    if (this.farmer) {
      this.hud.updateFarmer(this.farmer, this.local, this.gfx.camera);
      // music: a little faster per alert level, fastest in a chase
      this.audio.setMusicRate(this.farmer.chasing || this.farmer.state === 'carry' ? 1.12 + this.farmer.level * 0.02 : 1 + this.farmer.level * 0.03);
    }
    this.handleEvents();
    this.gfx.render(dt);
    if (this.running) this.gfx.updateDynRes(dt);
    if (this.gfx.slowFor >= 8 && !this.slowTip && SETTINGS.preset !== 'low') { this.slowTip = true; this.hud.toast(t('toast.slowTip'), 5); }
    requestAnimationFrame(this.frame);
  };
}

export { THREE };
