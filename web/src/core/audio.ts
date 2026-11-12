import * as THREE from 'three';
import { SOUND_SETS, OPTIONAL, allFiles } from './sounds';

export interface Loop { setVolume(v: number, fade?: number): void; setPos(p: THREE.Vector3): void; setRate(r: number): void; stop(fade?: number): void; name: string }

/**
 * WebAudio: real recorded one-shots (2D or 3D, random variant + pitch), ambience / engine loops, music with crossfade.
 * Buses: sfx, ambience, music → master (mute). Volumes come from the settings.
 */
export class Audio {
  ctx: AudioContext;
  private master: GainNode; private sfx: GainNode; private amb: GainNode; private musicGain: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  private music?: { src: AudioBufferSourceNode; gain: GainNode; name: string };
  muted = false;
  private vol = { sfx: 1, music: 0.6, ambience: 0.8 };

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.amb = this.ctx.createGain(); this.amb.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master);
    this.applyVolumes();
  }
  unlock() { if (this.ctx.state !== 'running') this.ctx.resume(); }
  setMuted(m: boolean) { this.muted = m; this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05); }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  setVolumes(v: Partial<{ sfx: number; music: number; ambience: number }>) { Object.assign(this.vol, v); this.applyVolumes(); }
  private applyVolumes() {
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.vol.ambience * 0.8, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.vol.music * 0.45, t, 0.05);
  }
  /** Music ducking (night = quieter). */
  musicDuck(k: number) { this.musicGain.gain.setTargetAtTime(this.vol.music * 0.45 * k, this.ctx.currentTime, 1.5); }

  async load(name: string, url: string, optional = false) {
    try {
      const r = await fetch(url);
      if (!r.ok) { if (!optional) console.warn('sound missing', name); return; }
      this.buffers.set(name, await this.ctx.decodeAudioData(await r.arrayBuffer()));
    } catch (e) { if (!optional) console.warn('sound missing', name, e); }
  }
  async loadAll(base: string, onProgress?: (f: number) => void) {
    const files = allFiles();
    let n = 0;
    await Promise.all([
      ...files.map(async (f) => { await this.load(f, `${base}${f}.ogg`); onProgress?.(++n / files.length); }),
      ...OPTIONAL.map((f) => this.load(f, `${base}${f}.ogg`, true)),
    ]);
  }
  has(name: string) { return this.variants(name).length > 0; }

  /** 'oink' (set) or 'oink|squeal' (any of several sets) or a file name. */
  private variants(name: string): AudioBuffer[] {
    const out: AudioBuffer[] = [];
    for (const k of name.split('|')) {
      const files = SOUND_SETS[k] ?? [k];
      for (const f of files) { const b = this.buffers.get(f); if (b) out.push(b); }
    }
    return out;
  }

  private panner(pos: THREE.Vector3, ref = 4, roll = 1.3) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = 80; p.rolloffFactor = roll;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }

  play(name: string, opts: { pos?: THREE.Vector3; vol?: number; pitch?: number; rand?: number; minGap?: number; bus?: 'sfx' | 'amb'; ref?: number } = {}) {
    if (this.ctx.state !== 'running') return;
    const v = this.variants(name); if (!v.length) return;
    const buf = v[Math.floor(Math.random() * v.length)];
    const t = this.ctx.currentTime;
    const gap = opts.minGap ?? 0.05;
    if ((this.lastPlay.get(name) ?? -1) > t - gap) return;
    this.lastPlay.set(name, t);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (opts.rand ?? 0.08));
    const g = this.ctx.createGain(); g.gain.value = opts.vol ?? 1;
    src.connect(g);
    const bus = opts.bus === 'amb' ? this.amb : this.sfx;
    if (opts.pos) { const p = this.panner(opts.pos, opts.ref); g.connect(p); p.connect(bus); } else g.connect(bus);
    src.start();
  }

  /** Looping sound (ambience, engine). Returns null when the sound isn't available. */
  loop(name: string, opts: { vol?: number; pos?: THREE.Vector3; bus?: 'sfx' | 'amb'; ref?: number; rate?: number } = {}): Loop | null {
    const v = this.variants(name); if (!v.length) return null;
    const src = this.ctx.createBufferSource(); src.buffer = v[0]; src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(g);
    let p: PannerNode | null = null;
    const bus = opts.bus === 'sfx' ? this.sfx : this.amb;
    if (opts.pos) { p = this.panner(opts.pos, opts.ref ?? 6, 1); g.connect(p); p.connect(bus); } else g.connect(bus);
    src.start(0, Math.random() * v[0].duration);
    const ctx = this.ctx;
    g.gain.setTargetAtTime(opts.vol ?? 1, ctx.currentTime, 0.5);
    return {
      name,
      setVolume: (vol, fade = 0.5) => g.gain.setTargetAtTime(vol, ctx.currentTime, fade),
      setPos: (pos) => { if (p) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } },
      setRate: (r) => src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.2),
      stop: (fade = 0.4) => { g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); src.stop(ctx.currentTime + fade * 2); },
    };
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

  playMusic(name: string, fade = 1.5) {
    if (this.music?.name === name) return;
    const buf = this.buffers.get(name); if (!buf) return;
    const t = this.ctx.currentTime;
    if (this.music) { const old = this.music; old.gain.gain.setTargetAtTime(0, t, fade / 3); old.src.stop(t + fade * 2); }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(1, t, fade / 3);
    src.connect(gain); gain.connect(this.musicGain); src.start();
    this.music = { src, gain, name };
  }
}
