import * as THREE from 'three';
import type { Pig } from '../pig/pig';
import { clamp } from '../core/util';
import type { Farmer } from '../farmer/farmer';
import { G, ADMIN } from './ctx';
import { t, onLang, type Key } from '../i18n';

const v1 = new THREE.Vector3();

const ICONS: Record<string, string> = {
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

/** HTML HUD: ability rings with cooldowns, clock, Bob's chip + marker, prompts, toasts, a controls card that fades out. */
export class Hud {
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

  constructor() {
    const box = document.getElementById('abilities')!;
    const defs: [string, string][] = [['grab', 'key.lmb'], ['sprint', 'key.shift'], ['fart', 'Q'], ['wallow', 'C'], ['stand', 'E']];
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
      row(t('key.lmb'), 'help.grab') + row(t('key.lmb'), 'help.punch') + row(t('key.shift'), 'help.sprint') + row('Q', 'help.fart') +
      row('C', 'help.wallow') + row('E', 'help.stand') + row('F', 'help.oink') +
      `<div class="tip">${t('help.tip1')}<br>${t('help.tip2')}</div><div class="keys">${t('help.keys')}</div>`;
    const labels: Record<string, Key> = { grab: 'ab.grab', sprint: 'ab.sprint', fart: 'ab.fart', wallow: 'ab.wallow', stand: 'ab.stand' };
    for (const k in this.ab) {
      this.ab[k].lbl.textContent = t(labels[k]);
      const kk = this.ab[k].el.querySelector('.key') as HTMLElement; kk.textContent = t(kk.dataset.k!);
    }
  }

  toast(text: string, secs = 1.4, sub = '') {
    this.toastEl.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); this.toastEl.style.opacity = '1';
    this.toastUntil = performance.now() / 1000 + secs;
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

  /** Bob's activity chip + the ? / ! marker over his head (clamped to the screen edge when he's off-screen). */
  updateFarmer(bob: Farmer, pig: Pig, cam: THREE.Camera) {
    if (!ADMIN.bob) { this.bob.textContent = t('bob.off'); this.bob.className = 'txt'; this.mark.style.opacity = '0'; return; }
    const s = bob.sus.get(pig) ?? 0;
    const onMe = bob.target === pig && bob.chasing;
    let txt = t('bob.doing', { what: t(bob.activity) }), cls = '';
    const st = bob.state;
    if (bob.activity.startsWith('bob.')) txt = t(bob.activity);
    if (st === 'carry') { txt = bob.carrying === pig ? t('bob.carryYou') : t('bob.carryPig'); cls = 'red'; }
    else if (st === 'slapWind' || st === 'slap' || st === 'taunt') { txt = t('bob.slap'); cls = 'red'; }
    else if (bob.chasing) { txt = onMe ? t('bob.chaseYou') : t('bob.chasePig'); cls = 'red'; if (st === 'pant') txt = t('bob.pant'); }
    else if (st === 'suspect') { txt = t('bob.suspect'); cls = 'yellow'; }
    else if (st === 'investigate' || st === 'search') { txt = t('bob.heard'); cls = 'yellow'; }
    else if (st === 'down') { txt = t('bob.down'); cls = 'green'; }
    else if (st === 'stagger') { txt = t('bob.stagger'); cls = 'green'; }
    else if (st === 'cough') { txt = t('bob.cough'); cls = 'green'; }
    else if (st === 'fist') { txt = t('bob.fist'); cls = 'yellow'; }
    else if (st === 'dance') { txt = t('bob.dance'); cls = 'green'; }
    else if (st === 'sleep') { txt = t('bob.sleep'); cls = 'blue'; }
    else if (st === 'shoo') { txt = t('bob.shoo'); cls = 'yellow'; }
    this.bob.textContent = txt; this.bob.className = 'txt ' + cls;
    // marker
    let sym = '', col = '#ffd166', fill = 0;
    if (st === 'sleep') { this.mark.style.opacity = '0'; return; }
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

  update(pig: Pig, fps: number) {
    this.ring('sprint', pig.readiness('sprint'), pig.sprinting);
    this.ring('fart', pig.readiness('fart'));
    this.ring('wallow', 1, pig.mode === 'wallow');
    this.ring('stand', 1, pig.standing);
    this.ring('grab', 1, !!pig.held);
    this.updateClock();
    const K = (k: string) => `<b>${k}</b>`;
    const keys = { space: K(t('key.space')), lmb: K(t('key.lmb')), q: K('Q') };
    // prompt
    let p = '';
    if (pig.out) p = pig.outReason === 'wolf' ? t('p.dragged', { n: Math.ceil(pig.outUntil - pig.now) })
      : `<b style="color:#ff7a4a;font-size:30px">${t('p.grilled')}</b><br>${t('p.backIn', { n: Math.ceil(pig.outUntil - pig.now) })}`;
    else if (pig.mode === 'held' && pig.heldBy?.kind === 'farmer') p = t('p.bobGotYou', { ...keys, n: Math.floor(pig.escape), need: pig.escapeNeed() });
    else if (pig.mode === 'held' && pig.heldBy?.kind === 'wolf') p = t('p.wolfGotYou', { ...keys, n: Math.floor(pig.escape), need: pig.escapeNeed() });
    else if (pig.mode === 'ragdoll') p = t('p.ragdoll', keys);
    else if (pig.mode === 'held') p = t('p.held', keys);
    else if (pig.cage) p = t('p.caged', keys);
    else if (pig.held) p = t('p.holding', { ...keys, what: `<b>${t(pig.held.label ?? '')}</b>` });
    else {
      const tg = pig.findGrabTarget();
      if (tg) p = t('p.grabThing', { ...keys, verb: t(tg.mass > pig.liftMax ? 'p.verbDrag' : 'p.verbGrab'), what: t(tg.label ?? '') });
      else if (pig.standing && pig.wobble > 0.55) p = `<span style="color:#ffb38a">${t('p.wobbly')}</span>`;
      else if (pig.standing) p = `<span style="opacity:.75">${t('p.punch', keys)}</span>`;
    }
    let c = pig.charge();
    const cage = pig.cage ?? G.cage;
    if (cage && !cage.open && cage.progress > 0 && pig.pos.distanceTo(cage.latch) < 2) {
      c = cage.progress;
      if (!pig.cage) p = t('p.opening');
    }
    this.prompt.innerHTML = p;
    this.charge.style.opacity = c > 0 ? '1' : '0';
    this.chargeBar.style.width = `${c * 100}%`;
    const w = pig.standing ? clamp(pig.wobble, 0, 1) : 0;
    this.wob.style.opacity = w > 0.25 ? '1' : '0';
    this.wobBar.style.width = `${w * 100}%`;
    const st: string[] = [];
    if (pig.muddy > 0) st.push(`<span style="color:#d9a066">${t('s.muddy', { n: Math.ceil(pig.muddyUntil - pig.now) })}</span>`);
    if (pig.mode === 'wallow') st.push(t('s.playDead'));
    if (pig.cage) st.push(`<span class="${pig.grillAt - pig.now < 20 ? 'flash' : ''}" style="color:#ff7a4a;font-size:24px">${t('s.caged', { n: Math.max(0, Math.ceil(pig.grillAt - pig.now)) })}</span>`);
    if (G.grills) st.push(`<span style="color:#ffb38a">${t('s.grills', { n: G.grills })}</span>`);
    if (pig.mode === 'held' && pig.heldBy?.kind === 'farmer') st.push(`<span style="color:#ff7a4a">${t('s.caught')}</span>`);
    this.status.innerHTML = st.join('<br>');
    if (this.toastUntil && performance.now() / 1000 > this.toastUntil) { this.toastEl.style.opacity = '0'; this.toastUntil = 0; }
    this.fps.textContent = fps ? `${fps | 0} fps` : '';
  }
}
