import * as THREE from 'three';
import type { Pig } from '../pig/pig';
import { PIG } from '../pig/pig';
import { clamp } from '../core/util';
import type { Farmer } from '../farmer/farmer';
import { BOB } from '../farmer/farmer';
import { G } from './ctx';

const v1 = new THREE.Vector3();

const ICONS: Record<string, string> = {
  sprint: '<svg viewBox="0 0 24 24" width="30" height="30"><path fill="#fff6e6" d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  fart: '<svg viewBox="0 0 24 24" width="32" height="32"><path fill="#b6e36a" d="M7 18a4 4 0 0 1-.6-8A5 5 0 0 1 16 8.5 3.8 3.8 0 0 1 17.5 18z"/><circle cx="4" cy="20" r="1.6" fill="#b6e36a"/><circle cx="2.4" cy="16.8" r="1" fill="#b6e36a"/></svg>',
  wallow: '<svg viewBox="0 0 24 24" width="32" height="32"><path fill="none" stroke="#c98a4b" stroke-width="2.6" stroke-linecap="round" d="M2 15c3-3 5 3 8 0s5 3 8 0 3-1 4-1M2 20c3-3 5 3 8 0s5 3 8 0 3-1 4-1"/><circle cx="12" cy="7" r="3.2" fill="#ffb3c7"/></svg>',
  stand: '<svg viewBox="0 0 24 24" width="30" height="30"><rect x="8" y="3" width="8" height="11" rx="2.5" fill="#ffb3c7"/><path stroke="#ffb3c7" stroke-width="2.6" stroke-linecap="round" d="M10 15v6M14 15v6M8 8 4 11M16 8l4 3"/></svg>',
  grab: '<svg viewBox="0 0 24 24" width="30" height="30"><path fill="#fff6e6" d="M7 11V6.5a1.5 1.5 0 0 1 3 0V10V4.5a1.5 1.5 0 0 1 3 0V10V5.5a1.5 1.5 0 0 1 3 0V12l1-2a1.5 1.5 0 0 1 2.7 1.3L17 18a5 5 0 0 1-4.6 3H11a5 5 0 0 1-5-5v-3.5a1.5 1.5 0 0 1 1-1.5z"/></svg>',
};

/** Minimal HTML HUD: ability ring buttons with cooldowns, grab prompt, throw charge, short toasts. */
export class Hud {
  private ab: Record<string, { el: HTMLElement; cd: HTMLElement; was: number }> = {};
  private prompt = document.getElementById('prompt')!;
  private status = document.getElementById('status')!;
  private toastEl = document.getElementById('toast')!;
  private charge = document.getElementById('charge')!;
  private chargeBar = this.charge.firstElementChild as HTMLElement;
  private help = document.getElementById('help')!;
  private fps = document.getElementById('fps')!;
  private toastUntil = 0;
  private bob = document.getElementById('bob')!;
  private mark = document.getElementById('bobmark')!;
  showHelp = true;

  constructor() {
    const box = document.getElementById('abilities')!;
    const defs: [string, string][] = [['grab', 'LMB'], ['sprint', 'SHIFT'], ['fart', 'Q'], ['wallow', 'C'], ['stand', 'E']];
    for (const [id, key] of defs) {
      const el = document.createElement('div'); el.className = 'ab';
      el.innerHTML = `<div class="cd"></div>${ICONS[id]}<div class="key">${key}</div>`;
      box.appendChild(el);
      this.ab[id] = { el, cd: el.querySelector('.cd') as HTMLElement, was: 1 };
    }
    this.renderHelp();
  }
  renderHelp() {
    this.help.innerHTML = this.showHelp
      ? `<b>WASD</b> move · <b>Mouse</b> look · <b>Space</b> jump<br><b>LMB</b> grab / hold to throw<br>
         <b>Shift</b> sprint (ram!) · <b>Q</b> fart · <b>C</b> wallow (hold = play dead)<br>
         <b>E</b> stand on 2 legs · <b>F</b> oink<br><b>H</b> hide help · <b>M</b> mute · <b>P</b> quality<br>
         <span style="color:#ffd9a8">Act like a pig: on 4 legs with an empty mouth,<br>Bob ignores you. Mud = camouflage.</span>`
      : '<b>H</b> help';
  }
  toast(text: string, secs = 1.4) {
    this.toastEl.textContent = text; this.toastEl.style.opacity = '1';
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
  /** Bob's activity chip + the ? / ! marker over his head (clamped to the screen edge when he's off-screen). */
  updateFarmer(bob: Farmer, pig: Pig, cam: THREE.Camera) {
    const s = bob.sus.get(pig) ?? 0;
    const onMe = bob.target === pig && bob.chasing;
    let txt = `Bob is ${bob.activity}`, cls = '';
    if (bob.state === 'carry') { txt = bob.carrying === pig ? 'Bob is taking YOU to the BBQ!' : 'Bob caught a pig!'; cls = 'red'; }
    else if (bob.chasing) { txt = onMe ? 'Bob is CHASING you!' : 'Bob is chasing a pig!'; cls = 'red'; if (bob.state === 'pant') txt = 'Bob is out of breath…'; }
    else if (bob.state === 'suspect') { txt = 'Bob is suspicious…'; cls = 'yellow'; }
    else if (bob.state === 'investigate' || bob.state === 'search') { txt = 'Bob heard something…'; cls = 'yellow'; }
    else if (bob.state === 'down') { txt = 'Bob is knocked out!'; cls = 'green'; }
    else if (bob.state === 'stagger') { txt = 'Bob is staggering!'; cls = 'green'; }
    else if (bob.state === 'cough') { txt = 'Bob is coughing!'; cls = 'green'; }
    else if (bob.state === 'fist') { txt = 'Bob can\'t reach you!'; cls = 'yellow'; }
    this.bob.textContent = txt; this.bob.className = 'txt ' + cls;
    // marker
    let sym = '', col = '#ffd166', fill = 0;
    if (bob.chasing || bob.state === 'carry') { sym = '!'; col = '#ff5a3c'; fill = 1; }
    else if (bob.state === 'down' || bob.state === 'stagger') { sym = '✦'; col = '#fff1a8'; fill = 1; }
    else if (bob.state === 'cough') { sym = '~'; col = '#b6e36a'; fill = 1; }
    else if (s > 0.04 || bob.state === 'suspect' || bob.state === 'investigate' || bob.state === 'search') { sym = '?'; fill = Math.max(s, 0.3); }
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
    // prompt
    let p = '';
    if (pig.out) p = `<b style="color:#ff7a4a;font-size:30px">GRILLED!</b><br>back in the sty in ${Math.ceil(pig.outUntil - pig.now)}…`;
    else if (pig.mode === 'held' && pig.heldBy?.kind === 'farmer')
      p = `Bob got you! Mash <b style="color:#ffd166">SPACE</b> (${Math.floor(pig.escape)}/${pig.escapeNeed()}) · <b style="color:#ffd166">Q</b> fart in his face`;
    else if (pig.mode === 'ragdoll') p = '<b style="color:#ffd166">SPACE</b> mash to get up';
    else if (pig.mode === 'held') p = '<b style="color:#ffd166">SPACE</b> mash to wriggle free';
    else if (pig.cage) p = `Hold <b style="color:#ffd166">LMB</b> at the red latch to pick the lock (slow) — or wait for a friend`;
    else if (pig.held) p = `Holding <b>${pig.held.label ?? ''}</b> · hold <b style="color:#ffd166">LMB</b> to throw`;
    else {
      const t = pig.findGrabTarget();
      if (t) p = `<b style="color:#ffd166">LMB</b> ${t.mass > PIG.liftMax ? 'drag' : 'grab'} ${t.label ?? ''}`;
    }
    this.prompt.innerHTML = p;
    let c = pig.charge();
    const cage = pig.cage ?? G.cage;
    if (cage && !cage.open && cage.progress > 0 && pig.pos.distanceTo(cage.latch) < 2) {
      c = cage.progress;
      if (!pig.cage) p = 'Opening the cage…';
      this.prompt.innerHTML = p;
    }
    this.charge.style.opacity = c > 0 ? '1' : '0';
    this.chargeBar.style.width = `${c * 100}%`;
    const st: string[] = [];
    if (pig.muddy > 0) st.push(`<span style="color:#d9a066">Muddy ${Math.ceil(pig.muddyUntil - pig.now)}s</span>`);
    if (pig.mode === 'wallow') st.push('Playing dead…');
    if (pig.cage) st.push(`<span class="${pig.grillAt - pig.now < 20 ? 'flash' : ''}" style="color:#ff7a4a;font-size:24px">CAGED! BBQ in ${Math.max(0, Math.ceil(pig.grillAt - pig.now))}s</span>`);
    if (G.grills) st.push(`<span style="color:#ffb38a">Grilled ${G.grills}/3</span>`);
    if (pig.mode === 'held' && pig.heldBy?.kind === 'farmer') st.push(`<span style="color:#ff7a4a">Caught! Muddy pigs slip out faster</span>`);
    void BOB;
    this.status.innerHTML = st.join('<br>');
    if (this.toastUntil && performance.now() / 1000 > this.toastUntil) { this.toastEl.style.opacity = '0'; this.toastUntil = 0; }
    this.fps.textContent = fps ? `${fps | 0} fps` : '';
  }
}
