import * as THREE from 'three';

/** WebAudio: pooled one-shots (2D or 3D), random pitch variants, looping music with crossfade. */
export class Audio {
  ctx: AudioContext;
  private master: GainNode; private sfx: GainNode; private musicGain: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  private music?: { src: AudioBufferSourceNode; gain: GainNode; name: string };
  muted = false;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.32; this.musicGain.connect(this.master);
  }
  unlock() { if (this.ctx.state !== 'running') this.ctx.resume(); }
  toggleMute() { this.muted = !this.muted; this.master.gain.value = this.muted ? 0 : 1; }

  async load(name: string, url: string) {
    try {
      const data = await (await fetch(url)).arrayBuffer();
      this.buffers.set(name, await this.ctx.decodeAudioData(data));
    } catch (e) { console.warn('sound missing', name, e); }
  }

  /** name may list variants: 'step1|step2|step3'. */
  play(name: string, opts: { pos?: THREE.Vector3; vol?: number; pitch?: number; rand?: number; minGap?: number } = {}) {
    if (this.ctx.state !== 'running') return;
    const names = name.split('|');
    const pick = names[Math.floor(Math.random() * names.length)];
    const buf = this.buffers.get(pick); if (!buf) return;
    const t = this.ctx.currentTime;
    const gap = opts.minGap ?? 0.05;
    if ((this.lastPlay.get(name) ?? -1) > t - gap) return;
    this.lastPlay.set(name, t);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (opts.rand ?? 0.08));
    const g = this.ctx.createGain(); g.gain.value = opts.vol ?? 1;
    src.connect(g);
    if (opts.pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 60; p.rolloffFactor = 1.3;
      p.positionX.value = opts.pos.x; p.positionY.value = opts.pos.y; p.positionZ.value = opts.pos.z;
      g.connect(p); p.connect(this.sfx);
    } else g.connect(this.sfx);
    src.start();
  }

  setListener(cam: THREE.Camera) {
    const l = this.ctx.listener; const p = cam.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z;
    }
  }

  /** Speed the music up / down (chase = faster, higher). */
  setMusicRate(rate: number) {
    if (!this.music) return;
    this.music.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.6);
  }

  /** Procedural one-shot buffers (no asset needed). */
  synth(name: string, secs: number, fn: (t: number, i: number) => number) {
    const sr = this.ctx.sampleRate, n = Math.floor(secs * sr);
    const b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = fn(i / sr, i);
    this.buffers.set(name, b);
  }

  private out(pos: THREE.Vector3 | undefined, vol: number) {
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 5; p.maxDistance = 70; p.rolloffFactor = 1.1;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); p.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  /**
   * Cartoon gibberish voice (Animal-Crossing style): saw-wave syllables through two vowel formant filters.
   * kind: huh (rising question) · hey (shout) · grr (growl) · oof (hit) · ha (laugh) · mutter (chatter) · yawn · snore.
   */
  voice(kind: string, pos?: THREE.Vector3, opts: { pitch?: number; vol?: number } = {}) {
    if (this.ctx.state !== 'running') return;
    const key = 'voice:' + kind, t0 = this.ctx.currentTime;
    if ((this.lastPlay.get(key) ?? -1) > t0 - 0.35) return;
    this.lastPlay.set(key, t0);
    const base = 118 * (opts.pitch ?? 1);
    const V: Record<string, [number, number]> = { a: [750, 1200], e: [520, 1800], i: [320, 2200], o: [520, 880], u: [340, 760], uh: [600, 1150] };
    type Syl = { v: string; d: number; f0: number; f1: number; g?: number; gap?: number; trem?: number };
    const seqs: Record<string, Syl[]> = {
      huh: [{ v: 'uh', d: 0.26, f0: 0.95, f1: 1.55, g: 0.9 }],
      hey: [{ v: 'e', d: 0.12, f0: 1.5, f1: 1.6, g: 1 }, { v: 'i', d: 0.3, f0: 1.6, f1: 1.15, g: 1 }],
      grr: [{ v: 'o', d: 0.55, f0: 0.62, f1: 0.55, g: 0.9, trem: 28 }],
      oof: [{ v: 'u', d: 0.2, f0: 1.25, f1: 0.75, g: 1 }],
      ha: [{ v: 'a', d: 0.12, f0: 1.0, f1: 0.95, g: 0.9, gap: 0.08 }, { v: 'a', d: 0.12, f0: 0.95, f1: 0.9, g: 0.9, gap: 0.08 }, { v: 'o', d: 0.2, f0: 0.9, f1: 0.8, g: 0.8 }],
      mutter: Array.from({ length: 5 }, () => ({ v: 'aeiou'[Math.floor(Math.random() * 5)], d: 0.07 + Math.random() * 0.06, f0: 0.8 + Math.random() * 0.3, f1: 0.8 + Math.random() * 0.3, g: 0.45, gap: 0.04 })),
      yawn: [{ v: 'a', d: 0.9, f0: 1.1, f1: 0.7, g: 0.5 }],
      snore: [{ v: 'o', d: 0.8, f0: 0.45, f1: 0.42, g: 0.35, trem: 22 }],
      wheee: [{ v: 'i', d: 0.5, f0: 1.4, f1: 2.1, g: 0.8 }],
    };
    const seq = seqs[kind] ?? seqs.mutter;
    const out = this.out(pos, (opts.vol ?? 1) * 0.55);
    let t = t0;
    for (const s of seq) {
      const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * s.f0, t);
      osc.frequency.linearRampToValueAtTime(base * s.f1, t + s.d);
      const vib = this.ctx.createOscillator(); vib.frequency.value = 6; const vg = this.ctx.createGain(); vg.gain.value = base * 0.03;
      vib.connect(vg); vg.connect(osc.frequency);
      const env = this.ctx.createGain(); env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(s.g ?? 0.8, t + 0.025); env.gain.setValueAtTime(s.g ?? 0.8, t + s.d * 0.7);
      env.gain.linearRampToValueAtTime(0, t + s.d);
      let src: AudioNode = osc;
      if (s.trem) {
        const am = this.ctx.createGain(); const lfo = this.ctx.createOscillator(); lfo.frequency.value = s.trem;
        const lg = this.ctx.createGain(); lg.gain.value = 0.5; am.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
        osc.connect(am); src = am; lfo.start(t); lfo.stop(t + s.d + 0.05);
      }
      const [f1, f2] = V[s.v] ?? V.a;
      for (const [f, q, g] of [[f1, 6, 1], [f2, 9, 0.6]] as const) {
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const fg = this.ctx.createGain(); fg.gain.value = g;
        src.connect(bp); bp.connect(fg); fg.connect(env);
      }
      env.connect(out);
      osc.start(t); osc.stop(t + s.d + 0.05); vib.start(t); vib.stop(t + s.d + 0.05);
      t += s.d + (s.gap ?? 0.02);
    }
  }

  playMusic(name: string, fade = 1.5) {
    if (this.music?.name === name) return;
    const buf = this.buffers.get(name); if (!buf) return;
    const t = this.ctx.currentTime;
    if (this.music) {
      const old = this.music; old.gain.gain.setTargetAtTime(0, t, fade / 3); old.src.stop(t + fade * 2);
    }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(1, t, fade / 3);
    src.connect(gain); gain.connect(this.musicGain); src.start();
    this.music = { src, gain, name };
  }
}
