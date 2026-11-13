import * as THREE from 'three';
import { G, ADMIN } from './ctx';
import { t, type Key } from '../i18n';
import { fitted } from '../core/assets';
import { toonMat } from '../render/toon';
import { PROPS, type Prop } from '../world/props';
import type { Critter } from '../world/animals';
import { SETTINGS, saveSettings } from './settings';
import type { Game } from './game';

/**
 * M5 round loop (Burglin' Gnomes / Untitled Goose Game to-do list): steal loot into the stash in the sty (each item
 * has a coin value), do the pranks on the list, then everyone back to the stash — or hold out until the clock runs
 * out. 3 grilled pigs = busted. Stars + coins at the end (saved for the shop). Host-authoritative: the host runs
 * `step` / `onEvent`; players get the state through `netState` like any synced entity.
 */
export const ROUND = { quotaBase: 400, quotaPer: 200, startHour: 7, prankCoins: 40, stashR: 2.3 };

export type MissionId = 'quota' | 'knockBob' | 'staggerBob' | 'fartBob' | 'mugPond' | 'catBath' | 'lambStash' | 'hensOut' | 'wolfScare' | 'pumpkinWell'
  | 'sheepOut' | 'hayPond' | 'loseBob' | 'whackBob' | 'henPond'
  | 'smashPots' | 'melonSmash' | 'eggBob' | 'gnomePond' | 'undiesWell' | 'pieSteal' | 'mudPorch' | 'mazeTrophy';
const REQ_POOL: MissionId[] = ['knockBob', 'fartBob', 'mugPond', 'hensOut', 'pumpkinWell', 'lambStash', 'sheepOut', 'hayPond', 'loseBob', 'whackBob',
  'smashPots', 'eggBob', 'gnomePond', 'undiesWell', 'pieSteal', 'mudPorch'];
const BONUS_POOL: MissionId[] = ['catBath', 'wolfScare', 'staggerBob', 'henPond', 'melonSmash', 'mazeTrophy', ...REQ_POOL];
interface Mission { id: MissionId; req: boolean; done: boolean; n: number }
/** Places things get taken to (waypoint when you hold the thing). */
export type Where = 'pond' | 'well' | 'stash' | 'porch' | 'bob';
/** Counted pranks (progress shown as n / need). */
const NEED: Partial<Record<MissionId, number>> = { smashPots: 4, melonSmash: 3, eggBob: 2 };
/** Which props / critters a prank is about, and where they go. */
const MDEF: Partial<Record<MissionId, { props?: string[]; critters?: string[]; to?: Where; inCoop?: boolean; inPen?: boolean }>> = {
  mugPond: { props: ['mug'], to: 'pond' }, hayPond: { props: ['hay'], to: 'pond' }, gnomePond: { props: ['gnome'], to: 'pond' },
  catBath: { critters: ['cat'], to: 'pond' }, henPond: { critters: ['hen'], to: 'pond' },
  lambStash: { critters: ['sheep'], to: 'stash' }, pieSteal: { props: ['pie'], to: 'stash' }, mazeTrophy: { props: ['trophy'], to: 'stash' },
  pumpkinWell: { props: ['pumpkin', 'bigPumpkin'], to: 'well' }, undiesWell: { props: ['undies'], to: 'well' },
  hensOut: { critters: ['hen'], inCoop: true }, sheepOut: { critters: ['sheep'], inPen: true },
  smashPots: { props: ['flowerPot'] }, melonSmash: { props: ['melon'] }, eggBob: { props: ['egg'], to: 'bob' },
};
type Phase = 'play' | 'escape' | 'end';
const PHASES: Phase[] = ['play', 'escape', 'end'];

const COOP = { x0: 16, x1: 30, z0: -32, z1: -18 };
const SHEEP_PEN = { x0: -63, x1: -50, z0: -52, z1: -34 };
const inRect = (r: { x0: number; x1: number; z0: number; z1: number }, p: { x: number; z: number }) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;
const WELL = { x: 0, z: -56 };
const POND = { x: 50, z: -2 };
const v1 = new THREE.Vector3();

const CSS = `
#missions { position:absolute; left:16px; top:62px; width: 260px; padding: 8px 12px 9px; border-radius: 14px; background: var(--panel); font-size: 15px; }
#missions .mh { display:flex; justify-content:space-between; align-items:center; font-family: Title; font-size: 18px; color: var(--gold); }
#missions .mh .tm.low { color:#ff6a4a; }
#missions .bar { height: 8px; border-radius: 5px; background: rgba(255,246,230,.15); margin: 5px 0 7px; overflow:hidden; }
#missions .bar > div { height:100%; width:0%; background: linear-gradient(90deg, var(--gold), #fff3b0); transition: width .4s; }
#missions .m { display:flex; gap: 7px; align-items: baseline; margin: 2px 0; opacity: .95; }
#missions .m i { font-style: normal; width: 16px; flex: none; color: var(--gold); }
#missions .m.done { opacity: .55; text-decoration: line-through; }
#missions .m em { font-style: normal; font-size: 11px; color: #b6e36a; margin-left: auto; }
#missions .goal { color:#b6e36a; font-size: 14px; margin-top: 4px; }
.coin { display:inline-block; width: .8em; height: .8em; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fff3b0, #ffd166 45%, #c98a1b); box-shadow: 0 0 0 1.5px #7a4b12; vertical-align: -1px; margin-right: 3px; }
.val { color: var(--gold); white-space: nowrap; }
.wpt { position:absolute; left:0; top:0; font-family: Title; font-size: 17px; color: var(--gold); opacity:0; transition: opacity .25s; transform: translate(-50%,-100%); text-align:center; pointer-events:none;
  -webkit-text-stroke: 3px #3b2412; paint-order: stroke; white-space: nowrap; }
.wpt b { display:block; font-size: 26px; line-height: .9; }
.wpt.mission { color: #ff8ad8; }
#results { position:absolute; inset:0; display:none; align-items:center; justify-content:center; background: rgba(20,10,4,.55); z-index: 30; }
#results .panel { text-align:center; min-width: 380px; }
#results h1 { font-family: Title; font-weight: normal; font-size: 52px; margin: 0; color: var(--gold); }
#results h1.lose { color: #ff6a4a; }
#results .why { font-size: 18px; opacity: .85; margin-bottom: 6px; }
#results .stars { font-size: 54px; letter-spacing: 6px; color: rgba(255,246,230,.2); margin: 4px 0 8px; }
#results .stars b { color: var(--gold); text-shadow: 0 0 14px rgba(255,209,102,.7); font-weight: normal; }
#results ul { list-style: none; padding: 0; margin: 8px auto; text-align: left; display: inline-block; font-size: 17px; }
#results li { margin: 3px 0; } #results li i { font-style: normal; display:inline-block; width: 22px; }
#results li.ok i { color: #b6e36a; } #results li.no i { color: #ff6a4a; } #results li em { font-style: normal; font-size: 12px; color:#b6e36a; }
#results .sum { font-size: 20px; margin: 10px 0 2px; } #results .sum b { color: var(--gold); }
#results .tot { font-size: 15px; opacity: .8; margin-bottom: 14px; }
#results .btns { display:flex; gap: 12px; justify-content:center; }
`;

export class Round {
  phase: Phase = 'play';
  elapsed = 0;
  secs = 600;
  banked = 0;
  quota = ROUND.quotaBase;
  missions: Mission[] = [];
  won = false;
  reason = '';
  /** Round number (host counts; players see it change on a restart). */
  no = 0;
  stash: THREE.Vector3;
  private paid = -1;
  private lastMin = false;
  private panel: HTMLElement; private mark: HTMLElement; private mark2: HTMLElement; private res: HTMLElement;
  private ring: THREE.Mesh; private coin: THREE.Object3D;
  private panelKey = ''; private resNo = -1;
  private events = new Set<string>();

  constructor(scene: THREE.Scene, private game: Game, at: THREE.Vector3) {
    this.stash = at.clone();
    // ---- stash: mud pit, glowing ring, a sign and a big spinning coin
    const g = new THREE.Group(); g.position.copy(at); scene.add(g);
    const mud = new THREE.Mesh(new THREE.CircleGeometry(ROUND.stashR, 40), toonMat(0x5a3518));
    mud.rotation.x = -Math.PI / 2; mud.position.y = 0.04; mud.receiveShadow = true;
    (mud.material as THREE.Material).polygonOffset = true; (mud.material as THREE.Material).polygonOffsetFactor = -2;
    g.add(mud);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(ROUND.stashR, 0.07, 8, 56),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 }));
    this.ring.rotation.x = Math.PI / 2; this.ring.position.y = 0.1; g.add(this.ring);
    const sign = fitted('kenney/sign', { height: 1.1 }); sign.position.set(ROUND.stashR + 0.3, 0, -0.6); sign.rotation.y = -0.5; g.add(sign);
    this.coin = fitted('loot/Coin', { height: 0.7 }); this.coin.position.set(0, 2.2, 0); g.add(this.coin);
    // ---- HUD
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const hud = document.getElementById('hud')!;
    this.panel = el('div', 'missions', 'txt'); hud.appendChild(this.panel);
    this.mark = el('div', 'stashmark', 'txt wpt'); hud.appendChild(this.mark);
    this.mark2 = el('div', 'stashmark2', 'txt wpt'); hud.appendChild(this.mark2);
    this.res = el('div', 'results'); document.body.appendChild(this.res);
  }

  get timeLeft() { return Math.max(0, this.secs - this.elapsed); }
  inStash(p: { x: number; z: number }, margin = 0) { return Math.hypot(p.x - this.stash.x, p.z - this.stash.z) < ROUND.stashR + margin; }

  // ================================================================== host
  /** New round: fresh mission list (2 required pranks + 2 bonus), clock + loot back to zero. */
  start() {
    this.no++;
    this.phase = 'play'; this.elapsed = 0; this.banked = 0; this.won = false; this.reason = ''; this.lastMin = false;
    this.secs = ADMIN.roundMins * 60;
    this.events.clear();
    const req = pick(REQ_POOL, 2), bonus = pick(BONUS_POOL.filter((m) => !req.includes(m)), 2);
    this.missions = [{ id: 'quota', req: true, done: false, n: 0 }, ...req.map((id) => ({ id, req: true, done: false, n: 0 })), ...bonus.map((id) => ({ id, req: false, done: false, n: 0 }))];
  }

  /** Game events (host): Bob knocked down / coughing, wolves scared… */
  onEvent(type: string, text = '') {
    if (this.phase === 'end') return;
    if (type === 'smashed' && text === 'flowerPot') this.count('smashPots');
    if (type === 'smashed' && text === 'melon') this.count('melonSmash');
    if (type === 'splatBob') this.count('eggBob');
    if (type === 'knockdown') { this.done('knockBob'); this.done('staggerBob'); }
    if (type === 'stagger') this.done('staggerBob');
    if (type === 'bobCough') this.done('fartBob');
    if (type === 'wolfScared') this.done('wolfScare');
    if (type === 'bobGaveUp') this.done('loseBob');
    if (type === 'whacked') this.done('whackBob');
  }

  step(dt: number) {
    if (this.phase === 'end' || !this.missions.length) return;
    this.elapsed += dt;
    this.secs = ADMIN.roundMins * 60;
    const { props, critters } = this.game.farm;
    // players: solo = just you (the other pigs in the sty are idle extras); online = every connected pig
    const pigs = G.net === 'solo' ? [this.game.local] : this.game.pigs.filter((p) => !p.absent);
    this.quota = ROUND.quotaBase + ROUND.quotaPer * Math.max(0, pigs.length - 1);
    // loot dropped in the stash
    for (const pr of props) {
      if (pr.banked || pr.value <= 0 || pr.heldBy) continue;
      const p = pr.synced.currP;
      if (!this.inStash(p) || p.y > this.stash.y + 2.5) continue;
      const lv = pr.body.linvel();
      if (Math.hypot(lv.x, lv.y, lv.z) < 2.5) this.bankProp(pr);
    }
    // pranks that are places / states
    const inWater = this.game.farm.inWater;
    if (this.wants('mugPond')) this.check('mugPond', props.some((p) => p.def === PROPS.mug && !p.banked && inWater(p.synced.currP.x, p.synced.currP.z)));
    if (this.wants('catBath')) this.check('catBath', critters.some((c) => c.def.kind === 'cat' && inWater(c.pos.x, c.pos.z)));
    if (this.wants('lambStash')) this.check('lambStash', critters.some((c) => c.def.kind === 'sheep' && this.inStash(c.pos, 0.3)));
    if (this.wants('hensOut')) this.check('hensOut', critters.filter((c) => c.def.kind === 'hen' && !(c.pos.x > COOP.x0 && c.pos.x < COOP.x1 && c.pos.z > COOP.z0 && c.pos.z < COOP.z1)).length >= 3);
    if (this.wants('pumpkinWell')) this.check('pumpkinWell', props.some((p) => (p.def === PROPS.pumpkin || p.def === PROPS.bigPumpkin) && !p.banked && !p.heldBy
      && this.atWell(p.synced.currP)));
    if (this.wants('sheepOut')) this.check('sheepOut', critters.filter((c) => c.def.kind === 'sheep' && !inRect(SHEEP_PEN, c.pos)).length >= 2);
    if (this.wants('hayPond')) this.check('hayPond', props.some((p) => p.def === PROPS.hay && !p.banked && inWater(p.synced.currP.x, p.synced.currP.z)));
    if (this.wants('henPond')) this.check('henPond', critters.some((c) => c.def.kind === 'hen' && inWater(c.pos.x, c.pos.z)));
    if (this.wants('gnomePond')) this.check('gnomePond', props.some((p) => p.def === PROPS.gnome && !p.banked && inWater(p.synced.currP.x, p.synced.currP.z)));
    if (this.wants('undiesWell')) this.check('undiesWell', props.some((p) => p.def === PROPS.undies && !p.banked && !p.heldBy && this.atWell(p.synced.currP)));
    if (this.wants('mudPorch')) {
      const door = this.game.farm.zones.door;
      this.check('mudPorch', pigs.some((p) => p.muddy > 0 && !p.out && Math.hypot(p.pos.x - door.x, p.pos.z - door.z) < 2.6));
    }
    this.check('quota', this.banked >= this.quota);
    // phases
    const reqDone = this.missions.every((m) => !m.req || m.done);
    if (this.phase === 'play' && reqDone) { this.phase = 'escape'; G.events.push({ type: 'roundEscape' }); }
    if (this.phase === 'escape') {
      const ready = pigs.filter((p) => !p.out);
      if (ready.length && ready.every((p) => this.inStash(p.pos, 0.4) && !p.heldBy && !p.cage)) return this.end(true, 'win');
    }
    if (G.grills >= 3) return this.end(false, 'grill');
    if (this.timeLeft <= 0) return this.end(reqDone, 'time');
    if (!this.lastMin && this.timeLeft < 60) { this.lastMin = true; G.events.push({ type: 'lastMinute' }); }
    G.farmer?.setFloor(this.timeLeft < 120 ? 2 : 0);   // the last 2 minutes: at least "on alert"
  }

  private atWell(p: THREE.Vector3) { return Math.hypot(p.x - WELL.x, p.z - WELL.z) < 1.6 && p.y > G.terrain.height(WELL.x, WELL.z) + 0.9; }
  private wants(id: MissionId) { return this.missions.some((m) => m.id === id && !m.done); }
  /** One more of a counted prank (pots smashed, eggs on Bob…). */
  private count(id: MissionId) {
    const m = this.missions.find((x) => x.id === id);
    if (!m || m.done) return;
    m.n++;
    if (m.n >= (NEED[id] ?? 1)) this.done(id);
    else G.events.push({ type: 'missionStep', text: 'm.' + id, why: `${m.n}/${NEED[id]}` });
  }
  private check(id: MissionId, ok: boolean) { if (ok) this.done(id); }
  private done(id: MissionId) {
    const m = this.missions.find((x) => x.id === id);
    if (!m || m.done) return;
    m.done = true;
    G.events.push({ type: 'missionDone', text: 'm.' + id });
    G.farmer?.raise('prank');   // he notices the mess: the farm gets more alert
    G.audio.play('fanfare', { vol: 0.5 });
  }
  bankProp(pr: Prop) {
    const p = v1.copy(pr.synced.currP);
    pr.bank();
    this.banked += pr.value;
    if (pr.def === PROPS.pie) this.done('pieSteal');
    if (pr.def === PROPS.trophy) this.done('mazeTrophy');
    G.audio.play('coins', { pos: p, vol: 0.9 });
    G.fx.bits(p, { count: 18, color: 0xffd166, spread: 0.3, speed: 3, up: 4, grav: 8, life: 0.9, size: 0.1, grow: 0, alpha: 1 });
    G.events.push({ type: 'banked', text: pr.label ?? '', why: String(pr.value) });
  }
  end(won: boolean, reason: string) {
    if (this.phase === 'end') return;
    this.phase = 'end'; this.won = won; this.reason = reason;
    G.events.push({ type: 'roundEnd' });
  }
  /** Admin: tick every mission. */
  finishAll() { for (const m of this.missions) if (m.id !== 'quota') this.done(m.id); this.banked = Math.max(this.banked, this.quota); }

  stars() { return this.won ? Math.min(3, 1 + this.missions.filter((m) => !m.req && m.done).length) : 0; }
  pranks() { return this.missions.filter((m) => m.id !== 'quota' && m.done).length; }
  coinsEarned() { return this.won ? this.banked + ROUND.prankCoins * this.pranks() : Math.floor(this.banked * 0.25); }

  // ================================================================== network (synced entity, no body)
  netState(n: number[], s: string[]) {
    let bits = 0; this.missions.forEach((m, i) => { if (m.done) bits |= 1 << i; });
    n.push(PHASES.indexOf(this.phase), Math.round(this.elapsed * 10) / 10, this.secs, this.banked, this.quota, this.won ? 1 : 0, bits, this.no, ...this.missions.map((m) => m.n));
    s.push(this.missions.map((m) => m.id + (m.req ? '!' : '')).join(','), this.reason);
  }
  netApply(n: number[], s: string[]) {
    if (n.length < 8) return;
    this.phase = PHASES[n[0]] ?? 'play'; this.elapsed = n[1]; this.secs = n[2]; this.banked = n[3]; this.quota = n[4];
    this.won = n[5] === 1; this.no = n[7];
    if (s[0] !== undefined) {
      const ids = s[0] ? s[0].split(',') : [];
      this.missions = ids.map((x, i) => ({ id: x.replace('!', '') as MissionId, req: x.endsWith('!'), done: (n[6] & (1 << i)) !== 0, n: 0 }));
    } else this.missions.forEach((m, i) => { m.done = (n[6] & (1 << i)) !== 0; });
    this.missions.forEach((m, i) => { m.n = n[8 + i] ?? m.n; });
    if (s[1] !== undefined) this.reason = s[1];
  }

  // ================================================================== every frame (all browsers)
  render(dt: number, camera: THREE.Camera) {
    const tt = G.time;
    this.coin.rotation.y += dt * 2.2;
    this.coin.position.y = 2.2 + Math.sin(tt * 2) * 0.12;
    const m = this.ring.material as THREE.MeshBasicMaterial;
    const hot = this.phase === 'escape' || this.carrying();
    m.opacity = 0.55 + Math.sin(tt * (hot ? 7 : 3)) * 0.3;
    this.ring.scale.setScalar(hot ? 1 + Math.sin(tt * 7) * 0.03 : 1);
    this.renderPanel();
    this.renderMark(camera);
    this.renderResults();
  }

  /** The {n} of a mission text key ('m.smashPots' → 4, 'm.quota' → the quota). */
  textN(key: string) { const id = key.replace('m.', '') as MissionId; return id === 'quota' ? this.quota : NEED[id] ?? 0; }
  /** Mission line: text + progress for counted pranks. */
  private mText(x: Mission) {
    if (x.id === 'quota') return t('m.quota', { n: this.quota });
    const need = NEED[x.id];
    return t(('m.' + x.id) as Key, { n: need ?? 0 }) + (need && !x.done ? ` <span class="val">${x.n}/${need}</span>` : '');
  }

  // ---------------------------------------------------------------- what to point at (markers.ts draws the arrows)
  /** Props / critters the open pranks are about (arrows over them). */
  missionThings(): { obj: Prop | Critter; id: MissionId }[] {
    const out: { obj: Prop | Critter; id: MissionId }[] = [];
    if (this.phase === 'end') return out;
    const { props, critters } = this.game.farm;
    for (const m of this.missions) {
      const d = MDEF[m.id]; if (m.done || !d) continue;
      if (d.props) for (const p of props) if (!p.banked && d.props.includes(p.def.id ?? '')) out.push({ obj: p, id: m.id });
      if (d.critters) for (const c of critters) {
        if (!d.critters.includes(c.def.kind)) continue;
        if (d.inCoop && !inRect(COOP, c.pos)) continue;
        if (d.inPen && !inRect(SHEEP_PEN, c.pos)) continue;
        out.push({ obj: c, id: m.id });
      }
    }
    return out;
  }
  /** Where an open prank wants this thing taken (null = nowhere special). */
  targetFor(h: unknown): { where: Where; id: MissionId } | null {
    if (this.phase === 'end' || !h) return null;
    const pr = h as Prop, cr = h as Critter;
    for (const m of this.missions) {
      const d = MDEF[m.id]; if (m.done || !d?.to) continue;
      if (d.props && pr.def && d.props.includes(pr.def.id ?? '')) return { where: d.to, id: m.id };
      if (d.critters && cr.kind === 'critter' && d.critters.includes(cr.def.kind)) return { where: d.to, id: m.id };
    }
    return null;
  }
  wherePos(w: Where, out: THREE.Vector3) {
    if (w === 'pond') out.set(POND.x, G.terrain.height(POND.x, POND.z), POND.z);
    else if (w === 'well') out.set(WELL.x, G.terrain.height(WELL.x, WELL.z) + 2.2, WELL.z);
    else if (w === 'porch') out.copy(this.game.farm.zones.door);
    else if (w === 'bob' && G.farmer) out.copy(G.farmer.pos).setY(G.farmer.pos.y + 1);
    else out.copy(this.stash);
    return out;
  }

  private carrying() { const h = this.game.local?.held as Prop | null; return !!h && (h as Prop).value > 0; }

  private renderPanel() {
    const left = Math.ceil(this.timeLeft), mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
    const key = [left, this.banked, this.quota, this.phase, this.missions.map((m) => m.id + m.done + m.n).join()].join('|');
    if (key === this.panelKey) return;
    this.panelKey = key;
    if (!this.missions.length) { this.panel.style.display = 'none'; return; }
    this.panel.style.display = this.phase === 'end' ? 'none' : '';
    const rows = this.missions.map((x) => {
      const txt = this.mText(x);
      return `<div class="m${x.done ? ' done' : ''}"><i>${x.done ? '✔' : x.req ? '•' : '★'}</i><span>${txt}</span>${x.req ? '' : `<em>${t('m.bonus')}</em>`}</div>`;
    }).join('');
    const pct = Math.min(100, (this.banked / Math.max(1, this.quota)) * 100);
    this.panel.innerHTML = `<div class="mh"><span class="tm${left < 60 ? ' low' : ''}">⏱ ${mm}:${ss}</span><span><i class="coin"></i>${this.banked} / ${this.quota}</span></div>` +
      `<div class="bar"><div style="width:${pct}%"></div></div>${rows}` + (this.phase === 'escape' ? `<div class="goal">${t('m.escape')}</div>` : '');
  }

  /** Waypoints: where the thing you hold goes (a prank's place, the stash), Bob's porch when you're muddy for that prank. */
  private renderMark(camera: THREE.Camera) {
    const L = this.game.local;
    const list: { at: THREE.Vector3; label: string; mission: boolean }[] = [];
    if (this.phase !== 'end' && L && !L.out && !L.cage) {
      const tg = this.targetFor(L.held);
      if (tg && tg.where !== 'bob') list.push({ at: this.wherePos(tg.where, this.wp[0]), label: t(('where.' + tg.where) as Key), mission: true });
      if (this.wants('mudPorch') && L.muddy > 0 && !tg) list.push({ at: this.wherePos('porch', this.wp[0]), label: t('where.porch'), mission: true });
      if ((this.carrying() && tg?.where !== 'stash') || (this.phase === 'escape' && !this.inStash(L.pos)) || tg?.where === 'stash')
        list.push({ at: this.wp[1].copy(this.stash), label: t('hud.stash'), mission: false });
    }
    let px = -1e9, py = -1e9;
    [this.mark, this.mark2].forEach((el, i) => {
      const m = list[i];
      el.style.opacity = m ? '1' : '0';
      if (!m) return;
      v1.copy(m.at).setY(m.at.y + 3).project(camera);
      const W = innerWidth, H = innerHeight;
      let x = (v1.x * 0.5 + 0.5) * W, y = (-v1.y * 0.5 + 0.5) * H;
      if (v1.z > 1) { x = W - x; y = H - 40; }
      x = Math.min(W - 60, Math.max(60, x)); y = Math.min(H - 40, Math.max(70, y));
      if (Math.abs(x - px) < 150 && Math.abs(y - py) < 46) y = py - 48;   // two waypoints the same way: stack them
      px = x; py = y;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.classList.toggle('mission', m.mission);
      const d = Math.hypot(L.pos.x - m.at.x, L.pos.z - m.at.z);
      const html = `<b>▼</b>${m.label} · ${Math.round(d)} m`;
      if (el.innerHTML !== html) el.innerHTML = html;
    });
  }
  private wp = [new THREE.Vector3(), new THREE.Vector3()];

  private renderResults() {
    if (this.phase !== 'end') { if (this.resNo !== -1) { this.res.style.display = 'none'; this.resNo = -1; } return; }
    if (this.resNo === this.no) return;
    this.resNo = this.no;
    const earned = this.coinsEarned();
    if (this.paid !== this.no) { this.paid = this.no; SETTINGS.coins += earned; SETTINGS.xp += earned; saveSettings(); }
    const stars = this.stars();
    const can = G.net !== 'client';
    const li = this.missions.map((x) => {
      const txt = this.mText(x);
      return `<li class="${x.done ? 'ok' : 'no'}"><i>${x.done ? '✔' : '✘'}</i>${txt}${x.req ? '' : ` <em>${t('m.bonus')}</em>`}</li>`;
    }).join('');
    this.res.innerHTML = `<div class="panel"><h1 class="${this.won ? '' : 'lose'}">${t(this.won ? 'r.win' : 'r.lose')}</h1>` +
      `<div class="why">${t(('r.why.' + (this.reason || 'time')) as Key)}</div>` +
      `<div class="stars">${[0, 1, 2].map((i) => (i < stars ? '<b>★</b>' : '★')).join('')}</div><ul>${li}</ul>` +
      `<div class="sum">${t('r.loot')}: <b><i class="coin"></i>${this.banked}</b> · ${t('r.coins')}: <b><i class="coin"></i>${earned}</b></div>` +
      `<div class="tot">${t('r.total', { n: SETTINGS.coins })}</div>` +
      `<div class="btns">${can ? `<button class="chip" data-r="again">${t('r.again')}</button>` : `<span class="tot">${t('r.wait')}</span>`}<button class="chip" data-r="menu">${t('r.menu')}</button></div></div>`;
    this.res.style.display = 'flex';
    document.exitPointerLock?.();
    this.res.querySelector('[data-r=again]')?.addEventListener('click', () => this.game.restartRound());
    this.res.querySelector('[data-r=menu]')?.addEventListener('click', () => { location.href = G.net === 'solo' ? location.pathname : location.pathname + '?lobby=1'; });
  }
}

function el(tag: string, id: string, cls = '') { const e = document.createElement(tag); e.id = id; if (cls) e.className = cls; return e; }
function pick<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
