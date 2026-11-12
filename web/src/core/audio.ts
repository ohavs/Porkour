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
