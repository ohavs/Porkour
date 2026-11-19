import { PADDEV } from './padGlyph';
import * as THREE from 'three';
import { step, owners, world, raycast, L as L_ } from '../core/physics';
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
import type { Outhouse } from '../world/outhouse';
import type { Phones } from '../world/phone';
import { HeavyLoot } from '../world/heavyLoot';
import { Jail } from '../world/jail';
import type { Hammock } from '../world/hammock';
import type { Porch } from '../world/porch';
import { Mines } from '../world/mines';
import { Gulag } from '../world/gulag';
import { EmoteWheel } from './emotes';
import { Lounge } from '../world/lounge';
import { SEATS } from '../world/seats';
import { Interiors } from '../world/interiors';
import { Fireballs } from '../world/fireball';
import { Gadgets, type PoolId } from '../world/gadgets';
import { scatterSnacks, SNACK_IDS } from '../world/snacks';
import { LobbyStage, STAGE } from './lobbyStage';
import { FARM_IDS } from '../world/farms';
import { gadgetOfMsg } from './shop';
import { CamRig } from './camera';
import { Hud } from './hud';
import { Menu } from './menu';
import { Lockpick } from './lockpick';
import { HANDS } from '../world/hands';
import { FpHands } from './fpHands';
import { Markers } from './markers';
import { G, ADMIN } from './ctx';
import { SETTINGS, setPreset, saveSettings } from './settings';
import { GRASS_LEVEL, LAMP_LIGHTS, DETAIL_DIST, PRESET_ORDER, presetOf, setTuned } from '../render/quality';
import { cullDetail } from '../render/batch';
import { t, type Key } from '../i18n';
import type { IconId } from './icons';
import { NetHost, NetClient } from '../net/sync';
import { online, type Peer } from '../net/online';
import { parseOutfit } from '../pig/cosmetics';

export const PLAYER_COLORS = [0xffc934, 0x38c6f4, 0x8be04e, 0xb57bff];
const FIXED = 1 / 60;
const PRESSES = ['jumpP', 'sprintP', 'fartP', 'standP', 'wallowP', 'grabP', 'grabR', 'oinkP', 'attackP', 'attackR', 'pickP', 'pickFailP'] as const;
const tmpV = new THREE.Vector3();
const NO_PRESSES = Object.fromEntries(PRESSES.map((k) => [k, false])) as Record<(typeof PRESSES)[number], false>;
/** Events the round counts (each one = +1): only seen inside the fixed step, never again in handleEvents. */
const COUNTED = new Set(['smashed', 'splatBob', 'treeShaken', 'pressed', 'cowTipped', 'milkSpilled', 'lanternOut', 'made', 'vision', 'munch', 'fridge', 'flush']);

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
  /** Bob's outhouse(s) (toilet breaks). */
  loos: Outhouse[] = [];
  /** Bob's phone + the payphone (world/phone.ts). */
  phones: Phones | null = null;
  /** The grandfather clock's hands / ticking / hourly bongs (world/heavyLoot.ts). */
  heavy!: HeavyLoot;
  /** Bob's hammock (his siesta). */
  hammock: Hammock | null = null;
  /** Bob's coffee break on the porch (side table, mug, hot sauce). */
  porch: Porch | null = null;
  /** Land mines (a few each round). */
  mines!: Mines;
  /** The pigs' gulag (dead pigs work their way out), when the farm has room for it. */
  gulag: Gulag | null = null;
  /** The emote wheel (hold B) and the dance it picked (sent with the next controls). */
  wheel = new EmoteWheel(); private pendingEmote = 0;
  /** Cannabis mode: the smoking lounge (the couch); my seat last frame (the camera swings round when I sit). */
  lounge: Lounge | null = null; private seatWas = -1;
  /** Furniture inside the buildings (seats, lamps, fridges, the washer). */
  interiors!: Interiors;
  /** Shop gadgets in the world (cherry / stink bombs, bones: pooled props). */
  gadgets!: Gadgets;
  /** Fart + fire = fireball (s25). */
  fireballs = new Fireballs();
  /** My gadget count changed (a round used one): tell the host what I bring next. */
  onLoadout?: () => void;
  /** What the lock-pick puzzle is open on (the cage or a gate's padlock). */
  private pickOn: Gate | null = null;
  private acc = 0;
  private last = performance.now();
  private frames = 0; private fpsT = 0; fps = 0;
  /** Frame-rate limit bookkeeping, small-detail draw distance, "lower the graphics" tip shown. */
  private nextDraw = 0; private detailDist = Infinity; private slowTip = false;
  /** Auto graphics: frame-rate windows measured while playing (autoTune). */
  private tune = { t: 0, n: 0, time: 0, low: 0, last: 0 };
  /** Start measuring afresh (settings → "Test my PC"). */
  retune() { this.tune = { t: 0, n: 0, time: 0, low: 0, last: 0 }; }
  /**
   * "Auto" graphics measured on this machine (user: "it has to run smooth and never get stuck — recommended
   * settings?"): while playing on Auto, every 6 s window's real frame rate is checked (after 5 s for the shaders to
   * settle); two slow windows in a row (or dynamic resolution stuck low) → one preset lower, kept for this device.
   * Never steps up on its own (settings → "Test my PC" starts again from the graphics card's guess).
   */
  private autoTune() {
    const s = this.tune, now = performance.now() / 1000, dt = s.last ? now - s.last : 0;   // real time (the frame's dt is capped)
    s.last = now;
    if (SETTINGS.preset !== 'auto' || this.mode !== 'play' || !this.running || document.hidden || dt <= 0 || dt > 1.5) return;   // (very slow frames count: that's the point)
    s.t += dt;
    if (s.t < 5) return;
    s.n++; s.time += dt;
    if (s.time < 6) return;
    const fps = s.n / s.time; s.n = 0; s.time = 0;
    const cur = presetOf('auto')!, i = PRESET_ORDER.indexOf(cur), cap = SETTINGS.gfx.fpsCap === 30 ? 30 : 60;
    const slow = fps < cap * 0.7 || (this.gfx.dyn <= 0.65 && fps < cap * 0.9);
    s.low = slow ? s.low + 1 : 0;
    if (s.low >= 2 && i > 0) {
      SETTINGS.tuned = PRESET_ORDER[i - 1]; setTuned(SETTINGS.tuned); setPreset('auto'); saveSettings(); this.applyGfx();
      this.hud.toast(t('toast.tuned', { p: t(('g.' + SETTINGS.tuned) as Key) }), 2.4, '', 'gear');
      this.retune();
    } else if (SETTINGS.tuned !== cur && !slow) { SETTINGS.tuned = cur; setTuned(cur); saveSettings(); }   // runs fine: remember it
  }
  running = false;
  /** 'lobby' = the menu stage (fixed camera, pigs play around), 'play' = the round on the farm. */
  mode: 'lobby' | 'play' = 'play';
  stage!: LobbyStage;
  private farmSpawns: THREE.Vector3[] = [];
  round!: Round;
  lockpick!: Lockpick;
  /** Admin first-person test: the pig's arms on screen. */
  fpHands!: FpHands;
  markers!: Markers;
  private wardrobeEl = document.getElementById('wardrobe')!;
  /** Test hook: overrides keyboard input when set. */
  scripted: Partial<PigInput> | null = null;
  /** Admin: the furnished room the last "next room" teleport went to. */
  private intRoom = -1;
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
    {   // rivers / streams count as water everywhere a pond does (washes mud, pranks "into the water", no mines there)
      const pond = this.farm.inWater;
      if (terrain.waters.length) this.farm.inWater = (x, z) => pond(x, z) || terrain.waterAt(x, z) > 0.15;
    }
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
    this.loos = this.farm.loos ?? []; G.loos = this.loos;
    this.phones = this.farm.phones ?? null; G.phones = this.phones;
    this.hammock = this.farm.hammock ?? null; G.hammock = this.hammock;
    G.house = this.farm.house ?? null;
    this.porch = this.farm.porch ?? null; G.porch = this.porch;
    if (this.porch) this.porch.troughs = this.farm.troughs ?? [];
    this.mines = new Mines(scene, this.nav, bounds, () => [this.farm.places.stash, this.farm.cage.center, this.farm.farmerSpawn, ...this.farmSpawns,
      ...(this.porch ? [this.porch.chair] : [])], this.farm.inWater);
    G.mines = this.mines;
    {   // the gulag: a cabin on open ground (the same spot on every machine)
      const f = this.farm, avoid = [f.cage.center, f.farmerSpawn, ...f.chores.map((c) => new THREE.Vector3(c.at[0], 0, c.at[1])),
        ...this.loos.map((o) => o.base), ...(this.hammock ? [this.hammock.base] : []), ...(this.porch ? [this.porch.chair] : [])];
      const gs = Gulag.findSpot(this.nav, bounds, f.places.stash, avoid, f.inWater);
      if (gs && !f.chain) { this.gulag = new Gulag(scene, f.props, gs.at, gs.yaw); }
      G.gulag = this.gulag;
      // cannabis mode: the smoking lounge near the shed (its open front faces the shed)
      const shed = f.places.tp.find((x) => x[0] === 'shed');
      if (f.chain?.kind === 1 && shed) {
        const sp = new THREE.Vector3(shed[1], 0, shed[2]);
        const ls = Gulag.findSpot(this.nav, bounds, sp, avoid, f.inWater, { min: 9, max: 36, pref: 16, half: 5 });
        if (ls) { this.lounge = new Lounge(scene, f.props, ls.at, ls.yaw); f.places.tp.push(['lounge', ls.at.x + Math.sin(ls.yaw) * 4, ls.at.z + Math.cos(ls.yaw) * 4]); }
      }
      G.lounge = this.lounge;
      // furniture inside every building a pig can walk into
      this.interiors = new Interiors(scene, f.props, this.nav, f.buildings ?? [], f.places.stash, f.house ?? null);
      G.uses.push({ near: (p: Pig) => p.seat < 0 && SEATS.seatFor(p) >= 0, icon: () => 'couch' });   // RMB at any free seat: sit
    }
    G.chain = this.farm.chain ?? null;
    if (G.chain) { ADMIN.chill = true; this.gfx.useBuzz(); }   // chain modes: Bob is laid-back by default (admin → Bob can switch it)
    G.cam = this.gfx.camera;
    this.gadgets = new Gadgets(scene, this.farm.props);
    // the BBQ grill's coals burn all round: a fart next to it goes up in a fireball
    { const cg = this.farm.cage; G.flames.push({ r: 1.0, at: (o) => o.copy(cg.grillPos).setY(cg.grillPos.y + 0.95) }); }
    // snacks: food cans (boosts) and cigarette packs scattered around (same spots on every machine)
    scatterSnacks(scene, this.farm.props, this.nav, FARM_IDS.indexOf(farmId()) + 1, this.farm.inWater, this.farm.places.stash);
    this.stage = new LobbyStage(scene, this.farm.props);
    this.farmSpawns = this.pigs.map((p) => p.spawn.clone());
    G.props = this.farm.props;
    this.heavy = new HeavyLoot(this.farm.props);
    // pen animals amble out when their gate is open
    const PEN_KINDS = ['hen', 'chick', 'rooster', 'sheep', 'alpaca', 'cow', 'horse', 'horse2', 'donkey', 'bull', 'reindeer', 'doe'];
    for (const c of this.farm.critters) {
      if (!PEN_KINDS.includes(c.def.kind)) continue;
      c.pen = this.gates.list.find((g) => { const r = g.def.rect; return c.home.x > r.x0 && c.home.x < r.x1 && c.home.z > r.z0 && c.home.z < r.z1; }) ?? null;
    }
    this.round = new Round(scene, this, this.farm.places.stash);
    G.jail = new Jail(scene, this.farm.places.stash);
    this.markers = new Markers(scene, this);
    (window as any).__G = G;
    (window as any).__ADMIN = ADMIN;
    (window as any).__HANDS = HANDS; (window as any).__SEATS = SEATS;
    (window as any).__world = () => world;
    this.local.yaw = Math.PI;
    this.hud = new Hud();
    this.menu = new Menu(this);
    this.lockpick = new Lockpick();
    HANDS.init(scene, this.farm.props);
    this.porch?.reset();   // his mug in its spot on the table
    if (!this.gfx.camera.parent) this.gfx.scene.add(this.gfx.camera);   // so first-person arms (camera children) draw
    this.fpHands = new FpHands(this.gfx.camera);
    this.wheel.onPick = (id) => { if (id) this.pendingEmote = id; };
    // the wheel's pictures (my pig in each dance pose): drawn when the game is idle, not on the first B press
    setTimeout(() => { const cb = () => this.wheel.icons(this.local.visual.color, this.local.visual.outfit); ('requestIdleCallback' in window) ? requestIdleCallback(cb, { timeout: 4000 }) : cb(); }, 6000);
    this.input.onPress = (b) => {
      if (!this.running || this.menu.blocking) return;
      if (b === 'view') { if (this.mode === 'play' && !this.lockpick.isOpen) this.toggleView(); return; }
      if (b === 'emote') { if (!this.lockpick.isOpen && !this.local.out) { this.wheel.icons(this.local.visual.color, this.local.visual.outfit); this.wheel.open(); } return; }
      if (this.wheel.isOpen && b === 'attack') { this.pendingEmote = this.wheel.close(); this.input.clearPresses(); return; }   // click = pick
      if (this.lockpick.isOpen) {
        if (b === 'attack' || b === 'jump') this.lockpick.attempt(); else if (b === 'grab' || b === 'fart') this.lockpick.close();   // (pad B = back)
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
    };
    // first person: the default in the chain modes (cannabis / beer: work with the hooves where you look), else third
    // person; V / the eye button / the gamepad's View button switch freely (?fp=1 / ?fp=0 force it, tests)
    const fpQ = new URLSearchParams(location.search).get('fp');
    ADMIN.fp = fpQ !== null ? fpQ !== '0' : !!this.farm.chain;
    this.viewIcon();
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
    inp.face = this.fpNow();   // first person: the body turns with the camera (the hooves work where I look)
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
      inp.passP = pressed.has('pass');
      if (this.pendingEmote) { inp.emote = this.pendingEmote; this.pendingEmote = 0; }
    }
    if (this.mode === 'lobby') {
      // lobby: W = away from the fixed camera; the pig faces where it walks, the pointer when it holds something /
      // clicks (aim: throws fly toward the pointer), the camera when it just stands there
      const L = this.local, at = PADDEV.on ? this.padAim(L, tmpV) : this.stage.floorAt(this.gfx.camera, this.input.mouseX, this.input.mouseY, tmpV);
      const aim = Math.atan2(at.x - L.pos.x, at.z - L.pos.z), moving = inp.mx * inp.mx + inp.mz * inp.mz > 0.01;
      // idle: face the camera (like a lobby character); holding / aiming / clicking: face the pointer
      inp.yaw = moving && !L.held && L.chargeStart < 0 ? Math.atan2(inp.mx, inp.mz) : L.held || L.chargeStart >= 0 || inp.attack || inp.grab || inp.attackP || inp.grabP ? aim : 0;
      inp.pitch = 0.15;
    }
    if (s) Object.assign(inp, s, { mx: inp.mx, mz: inp.mz });
    const lp = this.lockpick;
    if (lp.isOpen) {
      // picking the lock: the pig stands still, every key goes to the puzzle
      const yaw = inp.yaw, pitch = inp.pitch;
      Object.assign(inp, emptyInput(), { yaw, pitch });
    }
    if (first && (lp.solved || lp.slips)) { inp.pickP = lp.solved; inp.pickFailP = lp.slips > 0; lp.solved = false; lp.slips = 0; }
    this.aimInput(inp);
    if (s) for (const k of ['ax', 'ay', 'az', 'reach', 'tilt'] as const) if (s[k] !== undefined) (inp as unknown as Record<string, unknown>)[k] = s[k];
    return inp;
  }
  /**
   * Lobby on a gamepad (no pointer): the right stick points where to aim on the stage floor (screen directions: up =
   * away from the camera); let go = straight ahead of the pig.
   */
  private padAim(L: Pig, out: THREE.Vector3) {
    const rx = this.input.padRX, ry = this.input.padRY, cam = this.gfx.camera;
    cam.getWorldDirection(out); out.y = 0; out.normalize();
    let dx: number, dz: number;
    if (Math.hypot(rx, ry) > 0.25) { dx = out.x * -ry - out.z * rx; dz = out.z * -ry + out.x * rx; }   // forward × up + screen-right × right
    else { dx = Math.sin(L.yaw); dz = Math.cos(L.yaw); }
    const n = Math.hypot(dx, dz) || 1;
    return out.set(L.pos.x + (dx / n) * 4, L.pos.y, L.pos.z + (dz / n) * 4);
  }
  /** First person right now (knocked over, carried or out of the round: the camera steps back to third person). */
  fpNow() {
    const L = this.local;
    return ADMIN.fp && this.mode === 'play' && !L.out && L.mode !== 'ragdoll' && L.mode !== 'held' && L.seat < 0 && !L.danceId;   // (sitting on the couch / dancing: you see your pig)
  }
  /** V / the eye button / the gamepad's View: first ↔ third person. */
  toggleView() {
    ADMIN.fp = !ADMIN.fp;
    this.viewIcon();
    this.hud.emote(this.local, ADMIN.fp ? 'eye' : 'pig', 0.9, 1.9);
    if (ADMIN.open) this.menu.renderAdmin();
  }
  /** The HUD's view button shows what V switches to. */
  viewIcon() { document.getElementById('bView')?.classList.toggle('on', ADMIN.fp); }
  /**
   * The crosshair (world/hands.ts: what I hold goes there, what I grab is picked there): from the camera through the
   * middle of the screen to the first thing it meets (not my own pig / what I hold); the lobby: the mouse pointer.
   * Sent as an offset from my pig (≤ 2.5 m: the host keeps it within reach).
   */
  private aimInput(inp: PigInput) {
    const L = this.local, cam = this.gfx.camera;
    if (this.mode === 'lobby') {
      this.stage.floorAt(cam, this.input.mouseX, this.input.mouseY, this.aimP); this.aimP.y = L.pos.y + 0.3;
    } else {
      cam.getWorldDirection(this.aimD);
      const held = L.held?.body;
      const hit = raycast(cam.position, this.aimD, 40, L_.STATIC | L_.PROP | L_.PIG | L_.FARMER | L_.CRITTER, L.body, (c) => c.parent() !== held);
      let dist = hit ? hit.dist : this.cam.dist + 3;
      // first person, something in the hooves / a machine part: looking past it (far away, the sky), it stays at a
      // comfortable distance in front of the eyes (the wheel pushes it further); near a surface it goes onto it
      if (inp.face && (L.held || L.handle)) { const hold = 0.8 + 0.6 * this.input.reach; if (!hit || hit.dist > hold + 0.5) dist = hold; }
      this.aimP.copy(cam.position).addScaledVector(this.aimD, dist);
    }
    const off = tmpV.copy(this.aimP).sub(L.pos);
    if (off.length() > 2.5) off.setLength(2.5);
    inp.ax = off.x; inp.ay = off.y; inp.az = off.z;
    inp.reach = this.input.reach; inp.tilt = this.input.held.has('tilt');
  }
  private aimP = new THREE.Vector3(); private aimD = new THREE.Vector3();

  private fixed(withInput: boolean, first = false) {
    const host = this.net instanceof NetHost ? this.net : null;
    host?.beginStep();
    const ev0 = G.events.length;
    G.time += FIXED;
    if (this.mode !== 'lobby') this.daynight.tick(FIXED);
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
    if (this.mode === 'lobby' && G.net !== 'client') this.stage.step(this.pigs);
    if (G.net !== 'client') {
      this.round.step(FIXED);
      this.gadgets.step();
      this.farm.orchard?.step();
      this.farm.bees?.step(FIXED);
      this.farm.dairy?.stepHost();
      this.farm.pumpkins?.stepHost();
      this.farm.winter?.stepHost(FIXED);
      if (this.mode === 'play') this.farm.chain?.stepHost(FIXED);
      for (const o of this.loos) o.step(FIXED);
      if (this.mode === 'play') { this.phones?.stepHost(); this.heavy.stepHost(); this.hammock?.step(FIXED); this.farm.house?.step(); this.porch?.step(); this.mines.step(); this.gulag?.step(); this.lounge?.step(); this.interiors.step(); }
      this.fireballs.step();
      for (const pr of this.farm.props) pr.scrape();
      for (let i = ev0; i < G.events.length; i++) this.round.onEvent(G.events[i].type, G.events[i].text, G.events[i].why);
    }
    host?.endStep();
    if (G.net !== 'client') HANDS.stepHost(FIXED);
    if (G.net !== 'client' && (++this.nanT & 15) === 0) this.nanWatch();
    if (this.scripted) { for (const k of PRESSES) if (this.scripted[k]) this.scripted[k] = false; this.scripted.emote = 0; this.scripted.passP = false; }
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
        // mines, HP, the gulag
        case 'mined': H.emote(e.who, 'bang', 1.6, 1.6); break;
        case 'mineBob': H.emote(bob, 'bang', 1.6, 2.4); break;
        case 'fireball': if (e.who) H.emote(e.who, 'flame', 1.6, 1.6); break;
        case 'bobFireball': H.emote(bob, 'flame', 1.8, 2.4); break;
        case 'bacon': H.emote(e.who, 'flame', 1.6, 1.0); if (me) H.toast(t('e.baconMe'), 1.6, '', 'flame'); break;
        case 'hurt': if (me) H.hurtFlash(Number(e.why ?? 20)); break;
        case 'died': H.toast(me ? t('e.diedMe') : t('e.diedOther', { who }), 2, '', 'lock'); break;
        case 'gulagOut': if (me) H.toast(t('e.gulagOut'), 1.6, '', 'check'); break;
        case 'vomit': H.emote(e.who, 'vomit', 1.4, 1.4); break;
        case 'bobDance': H.emote(bob, 'note', 1.6, 2.4); break;
        case 'ate': H.emote(e.who, ('boost_' + e.text) as IconId, 1.8, 1.5); break;
        case 'lightUp': H.emote(e.who, 'cig', 1.4, 1.5); break;
        case 'pigCough': H.emote(e.who, 'cough', 1.4, 1.5); break;
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
        // Bob's outhouse
        case 'bobLoo': H.emote(bob, 'loo', 2.2, 2.4); break;
        case 'tooHeavy': H.emote(e.who, 'two', 1.8, 1.5); break;
        case 'looLocked': case 'looStuck': { const o = this.nearLoo(bob?.pos ?? this.local.pos); if (o) H.emote(o.markPos.clone(), 'alarm', 2.2, 0.3); break; }
        case 'looBolted': if (me) { const o = this.nearLoo(this.local.pos); if (o) H.emote(o.boltAt.clone(), 'lock', 1.2, 0.5); } break;
        // Bob's phone
        case 'phoneRing': { const at = this.phones?.phoneMark; if (at) H.emote(at.clone(), 'phone', 1.6, 0); break; }
        case 'bobPhone': H.emote(bob, 'phone', 1.6, 2.4); break;
        case 'hangUp': case 'prankCall': case 'bobWise': H.emote(bob, 'alarm', 1.6, 2.4); break;
        case 'unplugged': if (me) { const at = this.phones?.jackMark; if (at) H.emote(at.clone(), 'plug', 1.2, 0); } break;
        case 'dialed': if (me) { const at = this.phones?.payMark; if (at) H.emote(at.clone(), 'phone', 1.4, 0); } break;
        // Bob's siesta
        case 'bobNap': H.emote(bob, 'zzz', 2, 2.4); break;
        case 'hammockFlip': H.emote(bob, 'stars', 1.6, 1.4); break;
        case 'bedTumble': H.emote(bob, 'stars', 1.6, 1.4); break;
        case 'mudFace': H.emote(bob, 'mud', 1.4, 0.6); break;
        // Bob's coffee break
        case 'bobCoffee': H.emote(bob, 'mug', 1.8, 2.4); break;
        case 'coffeeSpiked': if (e.who === this.local && this.porch) H.emote(this.porch.markPos.clone(), e.why === 'mud' ? 'mud' : 'chili', 1.2, 0); break;
        case 'coffeeSpit': H.emote(bob, e.why === 'mud' ? 'mud' : 'fire', 2, 2.4); break;
        case 'mugGone': H.emote(bob, 'question', 1.8, 2.4); break;
        case 'clockBong': { const at = this.heavy.clockPos(Number(e.why ?? 0)); if (at) H.emote(at.clone(), 'clock', 1, 2.6); break; }
        case 'prankOink': if (me) H.emote(this.local, 'pig', 1.2, 1.3); break;
        case 'pigDunked': H.emote(e.who, 'splash', 1.4, 1.3); break;
        case 'snowCoat': if (me) H.emote(this.local, 'snow', 1.4, 1.3); break;
        // chain modes
        case 'made': if (me) H.toast(`+${e.why ?? ''} <i class="coin"></i>`, 1.1); break;
        case 'smokeAlarm': H.toast(t('e.smokeAlarm'), 1.8, '', 'alarm'); break;
        case 'bongRip': case 'puff': H.emote(e.who, 'cloud', 1.2, 1.5); break;
        case 'litUp': H.emote(e.who, 'lighter', 1.2, 1.5); break;
        case 'cookieEaten': H.emote(e.who, 'cookie', 1.4, 1.5); break;
        case 'vision': H.emote(e.who, 'swirl', 1.4, 1.5); break;
        case 'munch': H.emote(e.who, 'eat', 1.2, 1.5); break;
        case 'hugBob': case 'serenade': H.emote(bob, 'heart', 1.8, 2.4); break;
        case 'cloudGaze': H.emote(e.who, 'cloud', 2, 1.2); break;
        case 'beamCrossed': H.emote(e.who, 'beam', 1.6, 1.8); break;
        case 'burp': case 'sip': H.emote(e.who, 'beer', 1.2, 1.5); break;
        case 'tableDance': H.emote(e.who, 'note', 1.8, 2); break;
        case 'stompBeat': if (me) H.emote(e.who, 'note', 0.6, 1.4); break;
        case 'gooey': case 'burnt': H.emote(e.who, e.type === 'burnt' ? 'flame' : 'cookie', 1.4, 1.5); break;
        case 'wortReady': case 'beerReady': { const at = (this.farm.chain as { tap?: { markPos: THREE.Vector3 } } | undefined)?.tap?.markPos; if (at) H.emote(at.clone(), 'beer', 1.6, 0); break; }
        case 'jailed': if (me) H.toast(t('e.jailedMe'), 1.6, '', 'lock'); else H.toast(t('e.jailed', { who }), 1.6, '', 'lock'); break;
        case 'frozen': H.emote(e.who, 'snow', 1.6, 1.3); break;
        case 'roundEnd': break;
      }
    }
    G.events.length = 0;
  }

  /** The lobby: everybody on the stage, a fixed camera, the clock stopped on a sunny afternoon. */
  enterLobby() {
    this.mode = 'lobby'; G.lobby = true; this.running = true; this.input.lobby = true;
    document.body.classList.add('inLobby');
    this.input.free = true; this.cam.yaw = Math.PI;
    this.daynight.setHour(STAGE.hour);
    this.wolves.clear();
    this.pigs.forEach((p, i) => {
      p.spawn.copy(this.stage.spot(i));
      if (G.net !== 'client' && !p.absent && !p.out) { if (p.heldBy) p.heldBy.release?.(false); p.respawn(); p.yaw = 0; }
    });
    this.stage.placeCamera(this.gfx.camera);
  }
  /** PLAY (host / solo; players follow the host): a fresh round on the farm. */
  startPlay() {
    this.mode = 'play'; G.lobby = false; this.input.lobby = false;
    document.body.classList.remove('inLobby');
    this.input.free = false;
    this.pigs.forEach((p, i) => p.spawn.copy(this.farmSpawns[i]));
    if (G.net !== 'client') this.restartRound();
    this.local.yaw = Math.PI; this.cam.yaw = Math.PI;
  }

  /** Host / solo: everything back to the start, new mission list. */
  restartRound() {
    if (G.net === 'client') return;
    const cage = this.farm.cage;
    if (!cage.open) cage.setOpen(true, '');
    for (const p of this.pigs) { if (p.heldBy) p.heldBy.release?.(false); p.letGo(); }
    HANDS.reset();
    this.farmer?.resetRound(this.farm.farmerSpawn);
    for (const p of this.pigs) if (!p.absent) { if (p.out && !p.absent) p.outUntil = G.time; p.respawn(); }
    for (const p of this.pigs) { p.clearSnacks(); p.clearBuzz(); }
    for (const c of this.farm.critters) c.reset();
    for (const pr of this.farm.props) { if (pr.heldBy) pr.heldBy.release?.(false); if (pr.heldBy) pr.heldBy.release?.(false); pr.reset(); }
    this.wolves.clear();
    this.traps.clear();
    this.gates.reset();
    for (const o of this.loos) o.reset();
    this.phones?.reset();
    this.heavy.reset();
    this.hammock?.reset();
    this.porch?.reset();
    this.mines.reset();
    this.gulag?.reset();
    this.interiors.reset();
    for (const p of this.pigs) p.resetHealth();
    this.farm.orchard?.reset();
    this.farm.bees?.clear();
    this.farm.dairy?.reset();
    this.farm.pumpkins?.reset();
    this.farm.winter?.reset();
    this.farm.chain?.reset();
    this.gadgets.clear();
    this.daynight.setHour(this.farm.clock?.start ?? ROUND_START_HOUR);
    G.grills = 0;
    cage.setOpen(false);
    this.round.start();
    this.hud.toast(t('e.roundStart'), 2.2);
  }

  /** The outhouse nearest to a spot. */
  nearLoo(p: THREE.Vector3) { let b: Outhouse | null = null, bd = Infinity; for (const o of this.loos) { const d = o.base.distanceTo(p); if (d < bd) { bd = d; b = o; } } return b; }

  /** Admin → Players: punish / help one pig (host / solo). */
  adminPig(i: number, a: string, secs: number) {
    if (G.net === 'client') { this.hud.toast(t('net.hostOnly'), 1.6); return; }
    const p = this.pigs[i], L = this.local;
    if (!p || p.absent) return;
    const loose = () => { if (p.held) p.release(false); if (p.heldBy) p.heldBy.release(false); if (p.cage) { p.cage.pigs = p.cage.pigs.filter((x: Pig) => x !== p); p.freed(); } };
    const put = (x: number, y: number, z: number) => { p.body.setTranslation({ x, y, z }, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.parts.snap(); p.hostTakes(0.5); };
    switch (a) {
      case 'jail': {
        if (p.out) break;
        loose(); if (p.mode === 'ragdoll') p.getUp();
        p.jailUntil = G.time + secs;
        const s = G.jail!.spot(i, tmpV); put(s.x, s.y, s.z);
        G.audio.play('metal', { pos: s, vol: 1, pitch: 0.6 });
        G.events.push({ type: 'jailed', who: p });
        break;
      }
      case 'unjail': if (p.jailUntil) { p.jailUntil = 0; p.respawn(); } break;
      case 'freeze': p.frozenUntil = G.time + 15; p.hostTakes(15); G.fx.puff(p.pos, { count: 10, color: 0xbfe8ff, speed: 1, up: 1, life: 0.8, size: 0.4, alpha: 0.7 }); G.events.push({ type: 'frozen', who: p }); break;
      case 'unfreeze': p.frozenUntil = 0; p.ctlUntil = 0; break;
      case 'launch': loose(); p.knock(new THREE.Vector3((Math.random() - 0.5) * 6, 24, (Math.random() - 0.5) * 6), true); G.audio.play('whoosh', { pos: p.pos, vol: 1, pitch: 0.7 }); break;
      case 'knock': loose(); p.knock(new THREE.Vector3(Math.sin(p.yaw) * -4, 5, Math.cos(p.yaw) * -4), true); break;
      case 'bring': { loose(); const f = L.forward; put(L.pos.x + f.x * 1.6, L.pos.y + 0.6, L.pos.z + f.z * 1.6); break; }
      case 'goto': { if (L.heldBy) L.heldBy.release(false); L.body.setTranslation({ x: p.pos.x + 1.4, y: p.pos.y + 0.8, z: p.pos.z }, true); L.body.setLinvel({ x: 0, y: 0, z: 0 }, true); break; }
      case 'ghost': p.pw.ghost = !p.pw.ghost; break;
    }
  }

  /** Admin panel buttons. */
  adminAction(a: string) {
    if (G.net === 'client') { this.hud.toast(t('net.hostOnly'), 1.6); return; }
    const L = this.local, cage = this.farm.cage, f = this.farmer;
    const tp = (x: number, z: number) => { if (L.heldBy) L.heldBy.release(false); L.body.setTranslation({ x, y: G.terrain.height(x, z) + 1.2, z }, true); L.body.setLinvel({ x: 0, y: 0, z: 0 }, true); };
    switch (a) {
      case 'respawn': L.jailUntil = 0; L.respawn(); break;
      case 'jail:others': this.pigs.forEach((p, i) => { if (p !== L && !p.absent && !p.jailed) this.adminPig(i, 'jail', 60); }); break;
      case 'jail:free': this.pigs.forEach((p) => { if (p.jailUntil) { p.jailUntil = 0; p.respawn(); } }); break;
      case 'grill': cage.grillNow(); break;
      // Bob's outhouse
      case 'loo:go': f?.looNow(false); this.menu.toggleAdmin(); break;
      case 'loo:in': f?.looNow(true); break;
      case 'loo:bolt': { const o = this.nearLoo(L.pos); o?.setBolt(!o.bolted, L); break; }
      case 'loo:tip': { const o = this.nearLoo(L.pos); if (o) { if (!o.upright) o.fix(); else o.knockOver(tmpV.set(o.base.x - L.pos.x, 0, o.base.z - L.pos.z).normalize(), L); } break; }
      case 'bringSafe': case 'tp:safe': {
        const sf = this.farm.props.find((p) => p.def.id === 'safe' && !p.banked); if (!sf) break;
        if (sf.heldBy) sf.heldBy.release?.(false); if (sf.heldBy) sf.heldBy.release?.(false);
        const fw = L.forward;
        if (a === 'bringSafe') { sf.unbank(tmpV.set(L.pos.x + fw.x * 1.8, G.terrain.height(L.pos.x + fw.x * 1.8, L.pos.z + fw.z * 1.8), L.pos.z + fw.z * 1.8), L.yaw); }
        else { const sp = sf.synced.currP; tp(sp.x - 1.6, sp.z); this.menu.toggleAdmin(); }
        break;
      }
      // Bob's phone
      case 'phone:ring': this.phones?.callNow(false); f?.phoneNow(); this.menu.toggleAdmin(); break;
      case 'phone:prank': this.phones?.callNow(true, L); f?.phoneNow(); this.menu.toggleAdmin(); break;
      case 'phone:plug': this.phones?.setPlug(!this.phones.plugged, L); break;
      case 'tp:phone': { const w = this.phones?.wall; if (w) tp(w.jack.x + (w.jack.x - w.base.x) * 0.3, w.jack.z + (w.jack.z - w.base.z) * 0.3); this.menu.toggleAdmin(); break; }
      case 'tp:pay': { const p = this.phones?.pay; if (p) tp(p.at.x + p.front.x * 0.8, p.at.z + p.front.z * 0.8); this.menu.toggleAdmin(); break; }
      case 'bring:tv': case 'bring:clock': {
        const pr = this.farm.props.find((p) => p.def.id === a.slice(6)); if (!pr) break;
        if (pr.heldBy) pr.heldBy.release?.(false); if (pr.heldBy) pr.heldBy.release?.(false);
        const fw = L.forward, x = L.pos.x + fw.x * 1.8, z = L.pos.z + fw.z * 1.8;
        pr.unbank(tmpV.set(x, G.terrain.height(x, z), z), L.yaw);
        break;
      }
      case 'clock:strike': this.heavy.strike(3); break;
      case 'nap:go': f?.napNow(false); this.menu.toggleAdmin(); break;
      case 'nap:in': f?.napNow(true); break;
      case 'nap:swing': this.hammock?.push(2.2, tmpV.set(this.hammock.side.x, 0, this.hammock.side.z)); break;
      case 'nap:mud': if (f && f.mudMarks < 3) f.setMud(f.mudMarks + 1); else f?.setMud(0); break;
      case 'coffee:go': f?.coffeeNow(); this.menu.toggleAdmin(); break;
      case 'coffee:sip': f?.coffeeNow(true); break;
      case 'coffee:hot': this.porch?.spike(1); break;
      case 'coffee:mud': this.porch?.spike(2); break;
      case 'coffee:sauce': {
        const pr = this.porch?.sauce; if (!pr) break;
        if (pr.heldBy) pr.heldBy.release?.(false);
        if (pr.dockedIn) HANDS.undock(pr, null, false);
        pr.setLeft(1);
        const fw = L.forward, x = L.pos.x + fw.x * 0.6, z = L.pos.z + fw.z * 0.6;   // within reach of the snout
        pr.unbank(tmpV.set(x, G.terrain.height(x, z), z), L.yaw);
        break;
      }
      case 'tp:porch': { const pc = this.porch; if (pc) { const p = pc.chair.clone().addScaledVector(pc.fwd, 2.4).addScaledVector(pc.right, 1.2); tp(p.x, p.z); } this.menu.toggleAdmin(); break; }
      case 'tp:hammock': { const h = this.hammock; if (h) { const p = h.getIn.clone().addScaledVector(h.side, 1.4); tp(p.x, p.z); } this.menu.toggleAdmin(); break; }
      case 'tp:loo': { const o = this.nearLoo(L.pos); if (o) tp(o.doorstep.x + o.front.x * 1.2, o.doorstep.z + o.front.z * 1.2); this.menu.toggleAdmin(); break; }
      // s23: furnished buildings (next room · nearest radio on / off, TV channel, bake now, fill the bath · Bob comes to switch it off)
      case 'int:room': { const it = this.interiors, rs = it.rooms; if (!rs.length) break; this.intRoom = (this.intRoom + 1) % rs.length; tp(rs[this.intRoom].x, rs[this.intRoom].z); this.menu.toggleAdmin(); break; }
      case 'int:radio': case 'int:tv': case 'int:bake': case 'int:bath': case 'int:gramo': case 'int:sink': case 'int:fire': this.interiors.admin(a.slice(4), L.pos); break;
      case 'int:tap': { const j = this.interiors.lureJob(L.pos, f ?? undefined, false, true); if (f && j) f.jobNow(j); break; }
      case 'fireball:me': { const fw = L.forward; this.fireballs.boom(null, tmpV.set(L.pos.x - fw.x * 0.6, L.pos.y, L.pos.z - fw.z * 0.6), L); break; }
      case 'fireball:bob': { if (f) this.fireballs.boom(null, tmpV.copy(f.pos).setY(f.pos.y + 0.6).addScaledVector(f.forward, 1.2), null); break; }
      case 'tp:grill': { const gp = this.farm.cage.grillPos, c = this.farm.cage.center; const dx = gp.x - c.x, dz = gp.z - c.z, d = Math.hypot(dx, dz) || 1; tp(gp.x + (dx / d) * 2.2, gp.z + (dz / d) * 2.2); this.menu.toggleAdmin(); break; }
      case 'int:disco': { const j = this.interiors.lureJob(L.pos, f ?? undefined, true); if (f && j) f.jobNow(j); break; }
      case 'int:lure': { const j = this.interiors.lureJob(L.pos, f ?? undefined); if (f && j) f.jobNow(j); break; }
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
      case 'hurtMe': L.hurt(30, 'admin'); break;
      case 'killMe': L.hurt(999, 'admin'); break;
      case 'mine:me': { const fw = L.forward; this.mines.add(tmpV.set(L.pos.x + fw.x * 2.5, 0, L.pos.z + fw.z * 2.5)); this.menu.toggleAdmin(); break; }
      case 'mines:new': this.mines.reset(); break;
      case 'tp:gulag': { const g = this.gulag; if (g) { const p = g.center.clone().addScaledVector(new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw)), 4.5); tp(p.x, p.z); } this.menu.toggleAdmin(); break; }
      case 'mine:bob': { const f = this.farmer; if (f) { const fw = f.forward; this.mines.add(tmpV.set(f.pos.x + fw.x * 1.2, 0, f.pos.z + fw.z * 1.2)); } break; }
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
      case 'snack:canBeans': case 'snack:canSpinach': case 'snack:canEnergy': case 'snack:canDog': case 'snack:cigPack': {
        const id = a.slice(6), fw = L.forward, at = new THREE.Vector3(L.pos.x + fw.x * 1.2, L.pos.y + 0.5, L.pos.z + fw.z * 1.2);
        const it = this.farm.props.filter((p) => p.def.id === id && !p.banked && !p.heldBy).sort((x, y) => x.synced.currP.distanceTo(L.pos) - y.synced.currP.distanceTo(L.pos))[0];
        if (it) { it.setLeft(it.def.servings ?? 1); it.body.setTranslation(at, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); it.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        break;
      }
      case 'boosts:all': for (const k of SNACK_IDS) L.boostUntil[k] = G.time + 30; break;
      case 'smoke:me': L.cigUntil = G.time + 14; break;
      case 'slap': if (f && ADMIN.bob) { f.slapMe(L); } break;
      case 'mow': f?.forceMow(); break;
      case 'bed': f?.forceBed(); break;
      case 'bedNow': f?.bedNow(); break;
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
        if (this.farm.chain?.admin(a, L)) break;
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
      const host = this.net = new NetHost(this, online);
      for (const id of online.peers.keys()) if (id !== online.myId) host.needKey.add(id);   // (back from a farm switch: players already in the room)
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
      L.input = n === 0 ? pin : { ...pin, ...NO_PRESSES, emote: 0, passP: false };
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
  /**
   * Physics watchdog (host / solo, a few times a second): a body that went NaN (a bad joint, an impossible overlap)
   * would poison the whole world — every body, the camera, the frame — and the game looks frozen. Put it back.
   */
  private nanT = 0;
  private nanWatch() {
    const bad = (b: { translation(): { x: number; y: number; z: number }; linvel(): { x: number; y: number; z: number } }) => { const t = b.translation(), v = b.linvel(); return !Number.isFinite(t.x + t.y + t.z + v.x + v.y + v.z); };
    for (const p of this.pigs) {
      if (p.out || !p.body.isEnabled()) continue;
      if (bad(p.body) || bad(p.grip.hand)) {
        console.warn('physics: pig went NaN — reset');
        if (p.held) p.release(false);
        p.grip.detach(); p.seat = -1;
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (p.mode === 'ragdoll') p.getUp();
        p.respawn();
      }
    }
    for (const pr of this.farm.props) {
      if (pr.banked || !pr.body.isEnabled() || !bad(pr.body)) continue;
      console.warn('physics: prop went NaN — reset', pr.def.id);
      if (pr.heldBy) pr.heldBy.release?.(false);
      pr.body.setLinvel({ x: 0, y: 0, z: 0 }, true); pr.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      pr.reset();
    }
    const f = this.farmer;
    if (f && f.body.isEnabled() && bad(f.body)) { console.warn('physics: Bob went NaN — reset'); f.body.setLinvel({ x: 0, y: 0, z: 0 }, true); f.resetRound(this.farm.farmerSpawn); }
  }
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

  /**
   * One rendered frame. An exception in it must not stop the loop (the game would freeze — "it crashed"): it's
   * logged (and counted in the crash heartbeat) and the next frame runs anyway.
   */
  frame = () => {
    try { this.frameInner(); } catch (e) {
      this.frameErrors++;
      if (this.frameErrors < 5) console.error('frame', e);
      try { localStorage.setItem('porkour.lastError', String((e as Error)?.stack ?? e).slice(0, 600)); } catch { /* */ }
      requestAnimationFrame(this.frame);
    }
  };
  private frameErrors = 0;
  private frameInner() {
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
    // the emote wheel: steer with the mouse / stick (lobby: the pointer), let go of B = dance
    if (this.wheel.isOpen) {
      if (this.input.free && !PADDEV.on) this.wheel.feed(0, 0), this.wheel.stick(this.input.mouseX * innerWidth / innerHeight * 3, -this.input.mouseY * 3);
      else { this.wheel.feed(this.input.lookX / this.input.sensitivity / 260, this.input.lookY / this.input.sensitivity / 260 * (this.input.invertY ? -1 : 1)); this.wheel.stick(this.input.padRX, this.input.padRY); }
      if (!this.input.held.has('emote') || this.menu.blocking) { const id = this.wheel.close(); if (id && !this.menu.blocking) this.pendingEmote = id; }
    }
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
        if (!this.local.predicting) this.local.input = inp;   // (the HUD's crosshair pick reads it)
        if (this.scripted) { for (const k of PRESSES) if (this.scripted[k]) this.scripted[k] = false; this.scripted.emote = 0; this.scripted.passP = false; }   // test hook: a press is one frame
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
    for (const o of this.loos) o.render(dt);
    this.phones?.render(dt);
    this.heavy.render();
    this.hammock?.render();
    this.farm.house?.render(dt, this.mode === 'play' ? this.local : null, this.fpNow(), !!this.farmer && !this.farmer.asleep && this.farmer.state !== 'off');
    this.porch?.render(dt);
    if (this.mode === 'play') this.mines.render(dt);
    this.gulag?.render();
    this.lounge?.render(dt);
    this.interiors.render(dt);
    this.farm.orchard?.render(dt);
    this.farm.bees?.render(dt);
    this.farm.dairy?.render(dt);
    this.farm.pumpkins?.render(dt);
    this.farm.winter?.render(dt);
    this.farm.chain?.render(dt);
    HANDS.render(dt);
    for (const s of this.farm.spinners) s.obj.rotateY(s.speed * dt);
    for (const u of this.farm.updaters) u(dt, G.time);
    const lp = this.local.visual.root.position;
    const look = this.running && !this.menu.blocking && !this.wheel.isOpen;
    // working with the hooves (a light thing / a machine part): the camera looks a little past the pig, at the work
    const L0 = this.local, work = this.mode === 'play' && ((!!L0.held && L0.held.mass <= L0.liftMax) || !!L0.handle) ? 1 : 0;
    // sitting down on the couch: the camera swings round in front of me (I see my pig's face); up again: back behind
    if (L0.seat !== this.seatWas) {
      if (L0.seat >= 0) { this.cam.yaw = SEATS.yaw(L0.seat) + Math.PI; this.cam.pitch = 0.1; this.cam.dist = 3.4; }
      else if (this.seatWas >= 0) { this.cam.yaw = L0.yaw; this.cam.dist = 4.8; }
      this.seatWas = L0.seat;
    }
    if (this.mode === 'lobby') this.stage.placeCamera(this.gfx.camera);
    else if (this.fpNow()) {
      // first person: eyes in the pig's head (a little in front of the neck pivot), my own pig hidden, its arms on screen
      const eye = this.local.visual.rig.head.getWorldPosition(tmpV), f = this.local.forward;
      eye.addScaledVector(f, 0.12); eye.y += 0.08;
      this.cam.updateFP(dt, look ? this.input.lookX : 0, look ? this.input.lookY : 0, eye);
    } else this.cam.update(dt, look ? this.input.lookX : 0, look ? this.input.lookY : 0, lp, this.local.standing, work);
    {   // test hook (headless screenshots): a fixed camera, `window.__camShot = { p: [x, y, z], at: [x, y, z] }`
      const cs = (window as unknown as { __camShot?: { p: number[]; at: number[] } }).__camShot;
      if (cs) { this.gfx.camera.position.fromArray(cs.p); this.gfx.camera.lookAt(cs.at[0], cs.at[1], cs.at[2]); }
    }
    const fp = this.fpNow();
    this.local.visual.root.visible = !fp && !this.local.out;
    this.fpHands.update(dt, this.local, fp);
    // high / drunk: the screen (post effect) and the camera (drunk: it rolls; high: it breathes)
    if (this.gfx.buzz) {
      const L = this.local, b = this.mode === 'play' ? L.buzz : 0, dr = L.buzzKind === 2, tt = G.time, cam = this.gfx.camera;
      this.gfx.buzz.set(dr ? 0 : b, dr ? b : 0, tt);
      if (b > 0.02) cam.rotateZ(Math.sin(tt * (dr ? 0.9 : 0.5)) * (dr ? 0.075 : 0.03) * b);
      const fov = 58 + (dr ? 0 : Math.sin(tt * 0.7) * 5 * b);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    }
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
    this.hud.reticle(this.local, this.gfx.camera, this.mode !== 'play' ? 0 : fp ? 2 : 1);
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
    this.autoTune();
    if (this.gfx.slowFor >= 8 && !this.slowTip && SETTINGS.preset !== 'low' && SETTINGS.preset !== 'auto') { this.slowTip = true; this.hud.toast(t('toast.slowTip'), 5); }
    requestAnimationFrame(this.frame);
  }
}

export { THREE };
