import type { Pig } from '../pig/pig';
import { PIG } from '../pig/pig';
import { clamp } from '../core/util';

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
         <b>E</b> stand on 2 legs · <b>F</b> oink<br><b>H</b> hide help · <b>M</b> mute · <b>P</b> quality`
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
  update(pig: Pig, fps: number) {
    this.ring('sprint', pig.readiness('sprint'), pig.sprinting);
    this.ring('fart', pig.readiness('fart'));
    this.ring('wallow', 1, pig.mode === 'wallow');
    this.ring('stand', 1, pig.standing);
    this.ring('grab', 1, !!pig.held);
    // prompt
    let p = '';
    if (pig.mode === 'ragdoll') p = '<b style="color:#ffd166">SPACE</b> mash to get up';
    else if (pig.mode === 'held') p = '<b style="color:#ffd166">SPACE</b> mash to wriggle free';
    else if (pig.held) p = `Holding <b>${pig.held.label ?? ''}</b> · hold <b style="color:#ffd166">LMB</b> to throw`;
    else {
      const t = pig.findGrabTarget();
      if (t) p = `<b style="color:#ffd166">LMB</b> ${t.mass > PIG.liftMax ? 'drag' : 'grab'} ${t.label ?? ''}`;
    }
    this.prompt.innerHTML = p;
    const c = pig.charge();
    this.charge.style.opacity = c > 0 ? '1' : '0';
    this.chargeBar.style.width = `${c * 100}%`;
    const st: string[] = [];
    if (pig.muddy > 0) st.push(`<span style="color:#d9a066">Muddy ${Math.ceil(pig.muddyUntil - pig.now)}s</span>`);
    if (pig.mode === 'wallow') st.push('Playing dead…');
    this.status.innerHTML = st.join('<br>');
    if (this.toastUntil && performance.now() / 1000 > this.toastUntil) { this.toastEl.style.opacity = '0'; this.toastUntil = 0; }
    this.fps.textContent = fps ? `${fps | 0} fps` : '';
  }
}
