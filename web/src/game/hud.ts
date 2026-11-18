import * as THREE from 'three';
import type { Pig } from '../pig/pig';
import { clamp } from '../core/util';
import { ALERT, type Farmer } from '../farmer/farmer';
import { G, ADMIN } from './ctx';
import { t, onLang, type Key } from '../i18n';
import { sightPoint } from '../world/cover';
import { IC, kc, type IconId } from './icons';
import { SNACK_IDS } from '../world/snacks';

const v1 = new THREE.Vector3();

export const ICONS: Record<string, string> = {
  sprint: '<svg viewBox="0 0 24 24" width="30" height="30"><path fill="#fff6e6" d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  fart: '<svg viewBox="0 0 24 24" width="32" height="32"><path fill="#b6e36a" d="M7 18a4 4 0 0 1-.6-8A5 5 0 0 1 16 8.5 3.8 3.8 0 0 1 17.5 18z"/><circle cx="4" cy="20" r="1.6" fill="#b6e36a"/><circle cx="2.4" cy="16.8" r="1" fill="#b6e36a"/></svg>',
  wallow: '<svg viewBox="0 0 24 24" width="32" height="32"><path fill="none" stroke="#c98a4b" stroke-width="2.6" stroke-linecap="round" d="M2 15c3-3 5 3 8 0s5 3 8 0 3-1 4-1M2 20c3-3 5 3 8 0s5 3 8 0 3-1 4-1"/><circle cx="12" cy="7" r="3.2" fill="#ffb3c7"/></svg>',
  stand: '<svg viewBox="0 0 24 24" width="30" height="30"><rect x="8" y="3" width="8" height="11" rx="2.5" fill="#ffb3c7"/><path stroke="#ffb3c7" stroke-width="2.6" stroke-linecap="round" d="M10 15v6M14 15v6M8 8 4 11M16 8l4 3"/></svg>',
  grab: '<svg viewBox="0 0 24 24" width="30" height="30"><path fill="#fff6e6" d="M7 11V6.5a1.5 1.5 0 0 1 3 0V10V4.5a1.5 1.5 0 0 1 3 0V10V5.5a1.5 1.5 0 0 1 3 0V12l1-2a1.5 1.5 0 0 1 2.7 1.3L17 18a5 5 0 0 1-4.6 3H11a5 5 0 0 1-5-5v-3.5a1.5 1.5 0 0 1 1-1.5z"/></svg>',
};
export const SVG = {
  soundOn: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="#fff6e6" d="M4 9h4l5-4v14l-5-4H4z"/><path fill="none" stroke="#fff6e6" stroke-width="2" stroke-linecap="round" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="#fff6e6" d="M4 9h4l5-4v14l-5-4H4z"/><path stroke="#ff7a5a" stroke-width="2.4" stroke-linecap="round" d="m16 9 6 6m0-6-6 6"/></svg>',
  help: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="2" y="6" width="20" height="13" rx="3" fill="none" stroke="#fff6e6" stroke-width="2"/><path stroke="#fff6e6" stroke-width="2" stroke-linecap="round" d="M6 10h1M10 10h1M14 10h1M18 10h0M7 15h10"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="#fff6e6" d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9 4.6v-2.2l-2.4-.6a7 7 0 0 0-.7-1.7l1.3-2.1-1.6-1.6-2.1 1.3a7 7 0 0 0-1.7-.7L13.1 3h-2.2l-.6 2.4a7 7 0 0 0-1.7.7L6.5 4.8 4.9 6.4l1.3 2.1a7 7 0 0 0-.7 1.7L3 10.9v2.2l2.4.6c.2.6.4 1.2.7 1.7l-1.3 2.1 1.6 1.6 2.1-1.3c.5.3 1.1.5 1.7.7l.6 2.5h2.2l.6-2.4a7 7 0 0 0 1.7-.7l2.1 1.3 1.6-1.6-1.3-2.1c.3-.5.5-1.1.7-1.7z"/></svg>',
};

/** Icon-first HUD (user: "too much text"): prompts are key + icon, status is a row of badges, events pop over heads. */
const CSS = `
#prompt { display:flex; flex-direction:column; align-items:center; gap:4px; }
#prompt .pr { display:flex; align-items:center; gap:14px; }
.pp { display:inline-flex; align-items:center; gap:3px; padding:3px 7px; border-radius:12px; background: rgba(30,16,6,.55); }
.pp.dim { opacity:.6; }
.ic { display:block; filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
.pp .ic { width:30px; height:30px; }
kbd.kc { font-family: Title; font-size:16px; color:#3b2412; background:#fff6e6; border-radius:6px; padding:1px 7px 2px; box-shadow: 0 2px 0 #c9b49a; line-height:1.25; }
.mbar { width:120px; height:10px; border-radius:6px; background: rgba(0,0,0,.4); overflow:hidden; }
.mbar i { display:block; height:100%; background: linear-gradient(90deg, var(--pink), var(--gold)); }
.big { font-family: Title; font-size: 34px; color: var(--gold); }
#status { display:flex; gap:8px; align-items:flex-end; }
.sb { display:inline-flex; align-items:center; gap:3px; padding:3px 7px; border-radius:12px; background: rgba(30,16,6,.5); font-family: Title; font-size:18px; color: var(--cream); }
.sb .ic { width:28px; height:28px; }
.sb.warn { animation: sbFlash .6s ease-in-out infinite alternate; }
@keyframes sbFlash { from { background: rgba(30,16,6,.5); } to { background: rgba(255,90,60,.55); } }
#bob.ico { padding:2px 8px; display:flex; gap:2px; } #bob.ico .ic { width:30px; height:30px; }
#alert span { display:none; }
.ab .lbl { display:none; }
.emote { position:absolute; left:0; top:0; pointer-events:none; animation: emPop .28s cubic-bezier(.3,1.6,.6,1) both; }
.emote .ic { width:38px; height:38px; }
.emote.out { opacity:0; transition: opacity .35s; }
@keyframes emPop { from { transform: var(--tr) scale(.2); } to { transform: var(--tr) scale(1); } }
.wpt .ic { width:30px; height:30px; margin: 0 auto 1px; }
#toast .ic { display:inline-block; width:38px; height:38px; vertical-align:-8px; margin-right:6px; }
`;

/** HTML HUD: ability rings with cooldowns, clock, Bob's chip + marker, prompts, toasts, a controls card that fades out. */
export class Hud {
  /** Icons that pop over someone's head for a moment (what just happened to them) instead of a line of text. */
  private emotes: { el: HTMLElement; at: { pos: THREE.Vector3 } | THREE.Vector3; h: number; until: number }[] = [];
  private ab: Record<string, { el: HTMLElement; cd: HTMLElement; lbl: HTMLElement; was: number }> = {};
  private prompt = document.getElementById('prompt')!;
  private status = document.getElementById('status')!;
  private toastEl = document.getElementById('toast')!;
  private charge = document.getElementById('charge')!;
  private chargeBar = this.charge.firstElementChild as HTMLElement;
  private wob = document.getElementById('wobble')!;
  private wobBar = this.wob.firstElementChild as HTMLElement;
  private help = document.getElementById('help')!;
  private fps = document.getElementById('fps')!;
  private clockEl = document.getElementById('clock')!;
  private toastUntil = 0;
  private bob = document.getElementById('bob')!;
  private mark = document.getElementById('bobmark')!;
  private helpTimer = 0;
  showHelp = true;
  /** Farm alert meter under Bob's chip: his face (redder per level), 3 pips filling toward the next level, the level name. */
  private alertEl: HTMLElement; private alertKey = '';

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const box = document.getElementById('abilities')!;
    const defs: [string, string][] = [['grab', 'key.rmb'], ['sprint', 'key.shift'], ['fart', 'Q'], ['wallow', 'C'], ['stand', 'E']];
    for (const [id, key] of defs) {
      const el = document.createElement('div'); el.className = 'ab';
      el.innerHTML = `<div class="cd"></div><div class="lbl txt"></div>${ICONS[id]}<div class="key" data-k="${key}"></div>`;
      box.appendChild(el);
      this.ab[id] = { el, cd: el.querySelector('.cd') as HTMLElement, lbl: el.querySelector('.lbl') as HTMLElement, was: 1 };
    }
    document.getElementById('bHelp')!.insertAdjacentHTML('afterbegin', SVG.help);
    document.getElementById('bMenu')!.insertAdjacentHTML('afterbegin', SVG.menu);
    this.renderHelp();
    onLang(() => this.renderHelp());
    this.alertEl = document.createElement('div'); this.alertEl.id = 'alert'; this.alertEl.className = 'txt l0';
    document.getElementById('hud')!.appendChild(this.alertEl);
    // hidden on the title screen (it covered the logo); shown when the game starts (flashHelp)
    this.showHelp = false; this.help.classList.add('hide');
  }

  /** Controls card: shown at the start (and on H), fades out by itself. */
  flashHelp(secs = 14) {
    this.showHelp = true; this.help.classList.remove('hide');
    clearTimeout(this.helpTimer);
    this.helpTimer = window.setTimeout(() => { this.showHelp = false; this.help.classList.add('hide'); }, secs * 1000);
  }
  toggleHelp() { if (this.showHelp) { this.showHelp = false; this.help.classList.add('hide'); clearTimeout(this.helpTimer); } else this.flashHelp(20); }

  renderHelp() {
    const row = (k: string, a: Key) => `<div class="row"><kbd>${k}</kbd><span>${t(a)}</span></div>`;
    this.help.innerHTML = `<h3>${t('help.title')}</h3>` +
      row('WASD', 'help.move') + row(t('key.mouse'), 'help.look') + row(t('key.space'), 'help.jump') +
      row(t('key.rmb'), 'help.grab') + row(t('key.lmb'), 'help.punch') + row(t('key.shift'), 'help.sprint') + row('Q', 'help.fart') +
      row('C', 'help.wallow') + row('E', 'help.stand') + row('F', 'help.oink') + `<div class="keys">${t('help.keys')}</div>`;
    const labels: Record<string, Key> = { grab: 'ab.grab', sprint: 'ab.sprint', fart: 'ab.fart', wallow: 'ab.wallow', stand: 'ab.stand' };
    for (const k in this.ab) {
      this.ab[k].lbl.textContent = t(labels[k]);
      const kk = this.ab[k].el.querySelector('.key') as HTMLElement; kk.textContent = t(kk.dataset.k!);
    }
  }

  toast(text: string, secs = 1.4, sub = '', icon?: IconId) {
    this.toastEl.innerHTML = (icon ? IC[icon] : '') + text + (sub ? `<small>${sub}</small>` : ''); this.toastEl.style.opacity = '1';
    this.toastUntil = performance.now() / 1000 + secs;
  }
  /** An icon pops over a pig / Bob / an animal (or a spot) for a moment. */
  emote(at: { pos: THREE.Vector3 } | THREE.Vector3 | null | undefined, icon: IconId, secs = 1.6, h = 1.7) {
    if (!at) return;
    const tgt = (at as { pos?: THREE.Vector3 }).pos ?? (at as THREE.Vector3);
    if (this.emotes.some((e) => e.at === at && e.el.dataset.i === icon && e.until > performance.now() / 1000 + 0.3)) return;
    const el = document.createElement('div'); el.className = 'emote'; el.dataset.i = icon; el.innerHTML = IC[icon];
    document.getElementById('hud')!.appendChild(el);
    this.emotes.push({ el, at: (at as { pos?: THREE.Vector3 }).pos ? at as { pos: THREE.Vector3 } : tgt.clone(), h, until: performance.now() / 1000 + secs });
  }
  updateEmotes(cam: THREE.Camera) {
    const now = performance.now() / 1000;
    this.emotes = this.emotes.filter((e) => {
      if (now > e.until + 0.4) { e.el.remove(); return false; }
      if (now > e.until) e.el.classList.add('out');
      const p = (e.at as { pos?: THREE.Vector3 }).pos ?? (e.at as THREE.Vector3);
      v1.copy(p); v1.y += e.h + (1 - Math.max(0, e.until - now) / 2) * 0.4;
      v1.project(cam);
      if (v1.z > 1 || Math.abs(v1.x) > 1.1 || Math.abs(v1.y) > 1.1) { e.el.style.opacity = '0'; return true; }
      e.el.style.opacity = '';
      const tr = `translate(${((v1.x + 1) / 2) * innerWidth}px, ${((1 - v1.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
      e.el.style.setProperty('--tr', tr); e.el.style.transform = tr;
      return true;
    });
  }
  private ring(id: string, f: number, active = false) {
    const a = this.ab[id];
    const deg = clamp(f, 0, 1) * 360;
    a.cd.style.background = f >= 1 ? 'none' : `conic-gradient(transparent ${deg}deg, rgba(20,10,3,.72) ${deg}deg)`;
    if (f >= 1 && a.was < 1) { a.el.classList.remove('ready'); void a.el.offsetWidth; a.el.classList.add('ready'); }
    a.el.classList.toggle('active', active);
    a.was = f;
  }

  private lastClock = '';
  updateClock() {
    const h = G.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
    const txt = `${t('clock.day', { n: G.day })} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (txt === this.lastClock) return;
    this.lastClock = txt;
    // dial: sun or moon on an arc
    const night = G.night > 0.5;
    const a = night ? (((h + 24 - 19.5) % 24) / 10.5) * Math.PI : ((h - 6) / 13.5) * Math.PI;
    const x = 16 - Math.cos(clamp(a, 0, Math.PI)) * 11, y = 24 - Math.sin(clamp(a, 0, Math.PI)) * 13;
    const body = night ? `<circle cx="${x}" cy="${y}" r="5" fill="#fff6d8"/><circle cx="${x + 2.2}" cy="${y - 1.5}" r="4.2" fill="#2a3570"/>`
      : `<circle cx="${x}" cy="${y}" r="5" fill="#ffd166"/>`;
    this.clockEl.querySelector('svg')!.innerHTML = `<path d="M3 24a13 13 0 0 1 26 0" fill="none" stroke="rgba(255,246,230,.35)" stroke-width="2"/>${body}`;
    this.clockEl.querySelector('span')!.textContent = txt;
  }

  alertFlash() { this.alertEl.classList.remove('flash'); void this.alertEl.offsetWidth; this.alertEl.classList.add('flash'); }
  private updateAlert(bob: Farmer) {
    const l = bob.level, at = ALERT.at;
    const fills = [1, 2, 3].map((k) => (l >= k ? 1 : clamp((bob.heat - at[k - 1]) / (at[k] - at[k - 1]), 0, 1)));
    const key = l + ':' + fills.map((f) => Math.round(f * 20)).join(',') + ':' + t('alert.' + l);
    if (key === this.alertKey) return;
    this.alertKey = key;
    // Bob's face: brows angle down and the face reddens per level
    const skin = ['#f3b38f', '#f5a07e', '#f7835f', '#ff5a3c'][l], b = [0, 0.18, 0.4, 0.62][l] * 10;
    const face = `<svg class="face" viewBox="0 0 26 26"><path d="M3 11h20l-3-4H6z" fill="#f0cb6c"/><rect x="7" y="4" width="12" height="5" rx="2" fill="#f0cb6c"/>`
      + `<circle cx="13" cy="16" r="8" fill="${skin}"/><circle cx="10" cy="15" r="1.4" fill="#1b1010"/><circle cx="16" cy="15" r="1.4" fill="#1b1010"/>`
      + `<path d="M7.5 ${12 - b * 0.15}l4 ${b * 0.3}M18.5 ${12 - b * 0.15}l-4 ${b * 0.3}" stroke="#7a4a2a" stroke-width="1.6" stroke-linecap="round"/>`
      + `<ellipse cx="13" cy="19.3" rx="4.2" ry="1.6" fill="#7a4a2a"/><circle cx="13" cy="17.4" r="1.6" fill="#ec8f78"/></svg>`;
    this.alertEl.className = 'txt l' + l + (this.alertEl.classList.contains('flash') ? ' flash' : '');
    this.alertEl.innerHTML = face + `<div class="pips">${fills.map((f) => `<i><b style="width:${Math.round(f * 100)}%"></b></i>`).join('')}</div><span>${t('alert.' + l)}</span>`;
  }

  /** Bob's activity chip + the ? / ! marker over his head (clamped to the screen edge when he's off-screen). */
  updateFarmer(bob: Farmer, pig: Pig, cam: THREE.Camera) {
    this.alertEl.style.display = ADMIN.bob ? '' : 'none';
    if (!ADMIN.bob) { this.bob.textContent = t('bob.off'); this.bob.className = 'txt'; this.bob.dataset.i = ''; this.mark.style.opacity = '0'; return; }
    this.updateAlert(bob);
    const s = bob.sus.get(pig) ?? 0;
    const onMe = bob.target === pig && bob.chasing;
    // Bob's chip: one icon for what he's up to (no sentence); the words stay as a tooltip
    let txt = t('bob.doing', { what: t(bob.activity) }), cls = '', ic: IconId = bob.doing ? 'work' : 'walk';
    const st = bob.state;
    if (bob.activity.startsWith('bob.')) { txt = t(bob.activity); ic = 'work'; }
    if (st === 'carry') { txt = bob.carrying === pig ? t('bob.carryYou') : t('bob.carryPig'); cls = 'red'; ic = 'carry'; }
    else if (st === 'slapWind' || st === 'slap' || st === 'taunt') { txt = t('bob.slap'); cls = 'red'; ic = 'alarm'; }
    else if (bob.chasing) { txt = onMe ? t('bob.chaseYou') : t('bob.chasePig'); cls = 'red'; ic = 'alarm'; if (st === 'pant') txt = t('bob.pant'); }
    else if (st === 'suspect') { txt = t('bob.suspect'); cls = 'yellow'; ic = 'question'; }
    else if (st === 'search' && bob.hunt) { txt = bob.hunt === pig ? t('bob.searchYou') : t('bob.searchPig'); cls = 'yellow'; ic = 'question'; }
    else if (st === 'investigate' && bob.activity === 'bob.tracks') { txt = t('bob.tracks'); cls = 'yellow'; ic = 'feet'; }
    else if (st === 'investigate' || st === 'search') { txt = t('bob.heard'); cls = 'yellow'; ic = 'question'; }
    else if (st === 'down') { txt = t('bob.down'); cls = 'green'; ic = 'stars'; }
    else if (st === 'stagger') { txt = t('bob.stagger'); cls = 'green'; ic = 'stars'; }
    else if (st === 'cough') { txt = t('bob.cough'); cls = 'green'; ic = 'cough'; }
    else if (st === 'fist') { txt = t('bob.fist'); cls = 'yellow'; ic = 'alarm'; }
    else if (st === 'dance') { txt = t('bob.dance'); cls = 'green'; ic = 'note'; }
    else if (st === 'sleep') { txt = t('bob.sleep'); cls = 'blue'; ic = 'zzz'; }
    else if (st === 'away') { txt = t('bob.market'); cls = 'blue'; ic = 'cart'; }
    else if (st === 'loo' || st === 'inLoo') { txt = t(st === 'loo' ? 'bob.loo' : 'bob.inLoo'); cls = 'blue'; ic = 'loo'; }
    else if (st === 'phone' || st === 'onPhone') { txt = t(st === 'phone' ? 'bob.phone' : 'bob.onPhone'); cls = 'blue'; ic = 'phone'; }
    else if (st === 'shoo') { txt = t('bob.shoo'); cls = 'yellow'; ic = 'wolf'; }
    else if (st === 'setTrap') { txt = t('bob.trap'); cls = 'yellow'; ic = 'trap'; }
    else if (bob.doing && bob.chores[bob.choreIdx]?.anim === 'nap') ic = 'zzz';
    if (st === 'aim' || st === 'shoot') { txt = t('bob.aim'); cls = 'red'; ic = 'aim'; }
    if (this.bob.dataset.i !== ic + cls) { this.bob.dataset.i = ic + cls; this.bob.innerHTML = IC[ic]; this.bob.className = 'txt ico ' + cls; }
    this.bob.title = txt;
    // marker
    let sym = '', col = '#ffd166', fill = 0;
    if (st === 'sleep' || st === 'away' || st === 'inLoo') { this.mark.style.opacity = '0'; return; }
    if (bob.chasing || st === 'carry' || st === 'taunt') { sym = '!'; col = '#ff5a3c'; fill = 1; }
    else if (st === 'down' || st === 'stagger') { sym = '✦'; col = '#fff1a8'; fill = 1; }
    else if (st === 'cough') { sym = '~'; col = '#b6e36a'; fill = 1; }
    else if (st === 'dance') { sym = '♪'; col = '#ff9ad2'; fill = 1; }
    else if (s > 0.04 || st === 'suspect' || st === 'investigate' || st === 'search') { sym = '?'; fill = Math.max(s, 0.3); }
    else if (bob.doing && bob.chores[bob.choreIdx].anim === 'nap') { sym = 'z'; col = '#cfe8ff'; fill = 1; }
    if (!sym) { this.mark.style.opacity = '0'; return; }
    bob.visual.root.getWorldPosition(v1); v1.y += 2.55;
    v1.project(cam);
    let x = v1.x, y = v1.y;
    const behind = v1.z > 1;
    if (behind) { x = -x; y = -y; }
    const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.88;
    if (off) { const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.88, 1e-3); x /= k; y /= k; if (behind && Math.abs(y) < 0.88) y = -0.88; }
    const show = !off || sym === '!' || fill >= 0.3;
    this.mark.style.opacity = show ? '1' : '0';
    this.mark.style.transform = `translate(${((x + 1) / 2) * innerWidth}px, ${((1 - y) / 2) * innerHeight}px) translate(-50%, -50%) scale(${off ? 0.75 : 1})`;
    this.mark.innerHTML = `<span style="color:${col};-webkit-text-stroke:3px #3b2412;paint-order:stroke">${sym}</span>` +
      (sym === '?' ? `<i style="height:${Math.round(clamp(fill, 0, 1) * 100)}%"></i>` : '');
    this.mark.classList.toggle('pulse', sym === '!');
  }

  /** Online: player names over the other pigs (fade with distance, hidden behind the camera). */
  private tags: HTMLElement[] = [];
  updateTags(pigs: Pig[], local: Pig, cam: THREE.Camera) {
    const box = document.getElementById('hud')!;
    pigs.forEach((p, i) => {
      let el = this.tags[i];
      if (!el) { el = this.tags[i] = document.createElement('div'); el.className = 'tag txt'; box.appendChild(el); }
      if (p === local || p.out || p.absent) { el.style.opacity = '0'; return; }
      p.visual.root.getWorldPosition(v1); v1.y += p.standing ? 1.75 : 1.35;
      const d = v1.distanceTo(cam.position);
      v1.project(cam);
      if (v1.z > 1 || d > 70) { el.style.opacity = '0'; return; }
      const html = `<i style="background:#${p.color.toString(16).padStart(6, '0')}"></i>${p.label.replace(/[<>&]/g, '')}`;
      if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
      el.style.opacity = String(clamp(1.3 - d / 60, 0.35, 1));
      el.style.transform = `translate(${((v1.x + 1) / 2) * innerWidth}px, ${((1 - v1.y) / 2) * innerHeight}px) translate(-50%, -100%) scale(${clamp(14 / d, 0.7, 1.1)})`;
    });
  }

  /** `goal`: where a prank wants the thing you hold (shown instead of the stash hint). */
  update(pig: Pig, fps: number, goal = '') {
    this.ring('sprint', pig.readiness('sprint'), pig.sprinting);
    this.ring('fart', pig.readiness('fart'));
    this.ring('wallow', 1, pig.mode === 'wallow');
    this.ring('stand', 1, pig.standing);
    this.ring('grab', 1, !!pig.held);
    this.updateClock();
    // prompt: key + icon pairs, no sentences (what a thing is and where it goes: the arrows / coin value show that)
    const P = (...xs: string[]) => `<span class="pp">${xs.join('')}</span>`, row = (...xs: string[]) => `<div class="pr">${xs.join('')}</div>`;
    const SPACE = kc(t('key.space')), mashBar = (n: number, need: number) => `<span class="mbar"><i style="width:${Math.round(clamp(n / Math.max(need, 1), 0, 1) * 100)}%"></i></span>`;
    let p = '';
    const gate = G.gates?.latchOf(pig) as { state: string; padHp: number; label: string } | null | undefined;
    const loo = G.loos.find((o: { boltNear(p: Pig): boolean }) => o.boltNear(pig)) as { bolted: boolean } | undefined;
    const use = G.uses.find((u) => u.near(pig));
    const coop = (h: unknown) => (h as { def?: { coop?: boolean } } | null)?.def?.coop === true;
    const stuck = !pig.out && !pig.cage && !pig.heldBy && !pig.held ? G.traps?.list.find((tr: { holding: Pig | null; pos: THREE.Vector3 }) => tr.holding
      && tr.holding !== pig && Math.hypot(tr.pos.x - pig.pos.x, tr.pos.z - pig.pos.z) < 1.4) : null;
    const weapon = !!(pig.held as { def?: { weapon?: number } } | null)?.def?.weapon;
    const snack = pig.held as { def?: { snack?: string; smokes?: boolean }; left?: number } | null;
    const useIc = snack?.left && !pig.eating ? (snack.def?.smokes ? (pig.smoking ? '' : IC.cig) : snack.def?.snack ? IC.eat : '') : '';
    if (pig.out) p = row(P(IC[pig.outReason === 'wolf' ? 'wolf' : 'flame'], `<span class="big">${Math.ceil(pig.outUntil - pig.now)}</span>`));
    else if (pig.mode === 'held' && pig.heldBy?.kind === 'farmer') p = row(P(SPACE, IC.mash, mashBar(pig.escape, pig.escapeNeed())), P(kc('Q'), ICONS.fart));
    else if (pig.mode === 'held' && (pig.heldBy?.kind === 'wolf' || pig.heldBy?.kind === 'trap')) p = row(P(SPACE, IC.mash, mashBar(pig.escape, pig.escapeNeed())));
    else if (pig.mode === 'ragdoll' || pig.mode === 'held') p = row(P(SPACE, IC.mash));
    else if (pig.cage) p = G.cage?.canPick(pig) ? row(P(IC.rmb, IC.lock)) : '';
    else if (G.phones?.oinkNow(pig)) p = row(P(kc('F'), IC.pig, IC.phone));
    else if (pig.held) p = row(P(IC.rmb, IC.drop), coop(pig.held) && !(pig.held as { helper?: unknown }).helper ? P(IC.two) : '', useIc ? P(IC.lmb, useIc) : '', P(IC.lmb, IC.hold, IC.throw), weapon ? P(IC.lmb, IC.whack) : '', val(pig.held) ? P(val(pig.held)) : '',
      gate?.state === 'locked' && weapon ? P(IC.lmb, IC.whack, IC.lock, `<b>${gate.padHp}</b>`) : gate?.state === 'shut' ? P(IC.rmb, IC.gate) : '');
    else if (G.cage?.canPick(pig)) p = row(P(IC.rmb, IC.lock));
    else if (gate) p = gate.state === 'locked' ? row(P(IC.rmb, IC.lock), P(kc(t('key.shift')), ICONS.sprint)) : row(P(IC.rmb, IC.gate));
    else if (loo) p = row(P(IC.rmb, loo.bolted ? IC.loo : IC.lock));
    else if (use) p = row(P(IC.rmb, IC[use.icon(pig) as IconId] ?? ''));
    else if (stuck) p = row(P(IC.rmb, IC.trap));
    else {
      const tg = pig.findGrabTarget();
      if (tg) p = row(P(IC.rmb, IC.grab, val(tg)), coop(tg) && !tg.heldBy ? P(IC.two) : '');
      else if (pig.standing && pig.wobble <= 0.55) p = `<div class="pr"><span class="pp dim">${IC.lmb}${IC.fist}</span></div>`;
    }
    const c = pig.charge();
    if (this.prompt.dataset.h !== p) { this.prompt.dataset.h = p; this.prompt.innerHTML = p; }
    this.charge.style.opacity = c > 0 ? '1' : '0';
    this.chargeBar.style.width = `${c * 100}%`;
    const w = pig.standing ? clamp(pig.wobble, 0, 1) : 0;
    this.wob.style.opacity = w > 0.25 ? '1' : '0';
    this.wobBar.style.width = `${w * 100}%`;
    // status: a row of badges (icon + a number when it counts down)
    const st: string[] = [];
    const B = (ic: string, n = '', warn = false) => `<span class="sb${warn ? ' warn' : ''}">${ic}${n}</span>`;
    if (pig.muddy > 0) st.push(B(G.snowy ? IC.snow : IC.mud, String(Math.ceil(pig.muddyUntil - pig.now))));
    if (pig.mode === 'wallow') st.push(B(IC.dead));
    for (const k of SNACK_IDS) if (pig.boosted(k)) st.push(B(IC[`boost_${k}`], String(Math.ceil(pig.boostUntil[k] - pig.now))));
    if (pig.smoking) st.push(B(IC.cig, String(Math.ceil(pig.cigUntil - pig.now))));
    if (!pig.out && !pig.heldBy && G.traps?.list.some((tr: { active: boolean; armed: boolean; pos: THREE.Vector3 }) => tr.active && tr.armed
      && Math.hypot(tr.pos.x - pig.pos.x, tr.pos.z - pig.pos.z) < 3.5)) st.push(B(IC.trap, '', true));
    if (ADMIN.showSight && G.farmer) st.push(B(IC.eye, G.farmer.sees(pig) ? ' ✔' : ' ✘', G.farmer.sees(pig)));
    if (!pig.out && !pig.cage && !pig.heldBy && G.cover.at(pig.pos)) st.push(G.cover.at(sightPoint(pig, v1)) ? B(IC.hidden) : B(IC.eye, '', true));
    // farm 4 at night: standing in a jack-o'-lantern's light = Bob sees you like by day
    if (G.litAt && G.night > 0.5 && !pig.out && !pig.cage && !pig.heldBy && G.litAt(pig.pos.x, pig.pos.z)) st.push(B(IC.light, '', true));
    if (pig.cage) st.push(B(IC.flame, String(Math.max(0, Math.ceil(pig.grillAt - pig.now))), pig.grillAt - pig.now < 20));
    if (G.grills) st.push(B(IC.pig, `${G.grills}/3`));
    const sh = st.join('');
    if (this.status.dataset.h !== sh) { this.status.dataset.h = sh; this.status.innerHTML = sh; }
    if (this.toastUntil && performance.now() / 1000 > this.toastUntil) { this.toastEl.style.opacity = '0'; this.toastUntil = 0; }
    this.fps.textContent = fps ? `${fps | 0} fps` : '';
  }
}

/** Loot value tag for prompts (M5). */
function val(h: unknown) { const v = (h as { value?: number }).value ?? 0; return v > 0 ? ` <span class="val"><i class="coin"></i>${v}</span>` : ''; }
