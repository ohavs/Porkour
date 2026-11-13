import * as THREE from 'three';
import { PigVisual } from '../pig/pigVisual';
import { ITEMS, SKINS, SLOTS, labelKey, randomOutfit, defaultOutfit, type Outfit, type Slot } from '../pig/cosmetics';
import { SETTINGS, saveSettings } from './settings';
import { t, onLang, type Key } from '../i18n';

const $ = (id: string) => document.getElementById(id)!;

/** Wardrobe overlay: live 3D preview (own small renderer, drag to turn) + item grid per slot. */
export class Wardrobe {
  private el = $('wardrobe');
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private pig?: PigVisual;
  private tab: Slot = 'hat';
  private raf = 0;
  private spin = 0.6; private dragX: number | null = null; private yaw = 0.5;
  outfit: Outfit;
  /** Item thumbnails: a small offscreen renderer draws the pig wearing just that item, close up (cached data URLs). */
  private thumbR?: THREE.WebGLRenderer; private thumbScene = new THREE.Scene(); private thumbCam = new THREE.PerspectiveCamera(26, 1, 0.05, 30);
  private thumbPig?: PigVisual; private thumbs = new Map<string, string>(); private queue: { key: string; slot: Slot; id: string }[] = [];
  onChange?: (o: Outfit) => void;
  onClose?: () => void;

  constructor(private color: number) {
    this.outfit = { ...defaultOutfit(), ...(SETTINGS.outfit ?? {}) };
    $('wDone').addEventListener('click', () => this.close());
    $('wRandom').addEventListener('click', () => { this.set(randomOutfit()); });
    onLang(() => { if (this.isOpen) this.render(); });
  }
  get isOpen() { return this.el.classList.contains('show'); }

  open() {
    document.exitPointerLock?.();
    this.el.classList.add('show');
    if (!this.renderer) this.setup();
    this.render();
    const loop = () => { this.frame(); this.raf = requestAnimationFrame(loop); };
    cancelAnimationFrame(this.raf); loop();
  }
  close() {
    this.el.classList.remove('show');
    cancelAnimationFrame(this.raf);
    // the thumbnail renderer is a WebGL context of its own: give it back (thumbnails stay cached)
    if (this.thumbR) {
      this.thumbR.dispose(); this.thumbR.forceContextLoss(); this.thumbR = undefined;
      if (this.thumbPig) this.thumbScene.remove(this.thumbPig.root);
      this.thumbScene.clear(); this.thumbPig = undefined; this.queue = [];
    }
    this.onClose?.();
  }

  private setup() {
    const box = $('wPreview');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    box.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x9a7a5a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2; this.scene.add(ground);
    this.pig = new PigVisual(this.color, this.outfit);
    this.pig.centerHeight = 0;
    this.scene.add(this.pig.root);
    this.camera.position.set(0, 1.05, 3.9); this.camera.lookAt(0, 0.5, 0);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.dragX = e.clientX; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => { if (this.dragX !== null) { this.yaw += (e.clientX - this.dragX) * 0.012; this.dragX = e.clientX; this.spin = 0; } });
    el.addEventListener('pointerup', () => { this.dragX = null; });
  }

  private frame() {
    const r = this.renderer!, box = $('wPreview');
    const w = box.clientWidth, h = box.clientHeight;
    if (r.domElement.width !== Math.floor(w * r.getPixelRatio())) { r.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    const now = performance.now() / 1000;
    for (let i = 0; i < 2 && this.queue.length; i++) this.makeThumb(this.queue.shift()!);
    this.yaw += this.spin * 0.016;
    if (this.pig) {
      this.pig.root.rotation.y = this.yaw;
      this.pig.update({ speed: 0, grounded: true, vy: 0, standing: false, mode: 'normal', sprinting: false, muddy: 0, holding: false, charging: 0, dt: 0.016, t: now });
    }
    r.render(this.scene, this.camera);
  }

  set(o: Outfit) {
    this.outfit = { ...o };
    this.pig?.setOutfit(this.outfit);
    SETTINGS.outfit = this.outfit; saveSettings();
    this.onChange?.(this.outfit);
    this.render();
  }

  private thumbKey(slot: Slot, id: string) { return `${slot}:${id}:${slot === 'skin' ? '' : this.outfit.skin}`; }

  /** Draw one item on a bare pig (current skin), framed on the item, into a data URL. */
  private makeThumb(q: { key: string; slot: Slot; id: string }) {
    if (!this.thumbR) {
      this.thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.thumbR.setPixelRatio(1); this.thumbR.setSize(150, 150, false);
      this.thumbR.outputColorSpace = THREE.SRGBColorSpace;
      this.thumbScene.add(new THREE.HemisphereLight(0xfff4e6, 0x9a7a5a, 1.7));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); this.thumbScene.add(sun);
      this.thumbPig = new PigVisual(this.color, defaultOutfit());
      this.thumbPig.centerHeight = 0;
      this.thumbScene.add(this.thumbPig.root);
    }
    const pig = this.thumbPig!;
    const o: Outfit = { skin: q.slot === 'skin' ? q.id : this.outfit.skin, hat: '', hair: '', face: '', eyes: '', neck: '', back: '' };
    if (q.slot !== 'skin') o[q.slot] = q.id;
    pig.setOutfit(o);
    pig.update({ speed: 0, grounded: true, vy: 0, standing: false, mode: 'normal', sprinting: false, muddy: 0, holding: false, charging: 0, dt: 1, t: 0 });
    pig.root.updateMatrixWorld(true);
    // frame: the item (plus a bit of the head around it), from the front three-quarters (from behind for capes)
    const box = new THREE.Box3();
    const item = q.slot === 'skin' || !q.id ? null : ITEMS[q.slot].find((i) => i.id === q.id);
    if (item) box.setFromObject(pig.rig.anchors[item.anchor]);
    const head = new THREE.Box3().setFromObject(pig.rig.head);
    if (!item || box.isEmpty()) box.copy(q.slot === 'skin' ? new THREE.Box3().setFromObject(pig.root) : head);
    else if (q.slot !== 'back') box.union(head.expandByScalar(-0.05));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const dir = q.slot === 'back' ? new THREE.Vector3(-0.55, 0.55, -1) : q.slot === 'skin' ? new THREE.Vector3(0.9, 0.45, 1.1) : new THREE.Vector3(0.6, 0.25, 1);
    const dist = (size * 0.5) / Math.tan((this.thumbCam.fov * Math.PI) / 360) * (q.slot === 'skin' ? 1.05 : 1.5);
    this.thumbCam.position.copy(c).addScaledVector(dir.normalize(), Math.max(dist, 0.5));
    this.thumbCam.lookAt(c);
    this.thumbR.render(this.thumbScene, this.thumbCam);
    const url = this.thumbR.domElement.toDataURL('image/png');
    this.thumbs.set(q.key, url);
    document.querySelectorAll<HTMLImageElement>(`#wItems img[data-k="${q.key}"]`).forEach((img) => (img.src = url));
  }

  private render() {
    const tabs = $('wTabs');
    tabs.innerHTML = SLOTS.map((s) => `<button data-t="${s}" class="${s === this.tab ? 'on' : ''}">${t(('w.cat.' + s) as Key)}</button>`).join('');
    tabs.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.t as Slot; this.render(); }));
    const items = $('wItems');
    const cur = this.outfit[this.tab];
    let html = '';
    this.queue = [];
    const thumb = (slot: Slot, id: string) => {
      const key = this.thumbKey(slot, id), src = this.thumbs.get(key);
      if (!src) this.queue.push({ key, slot, id });
      return `<span class="th"><img data-k="${key}" alt="" ${src ? `src="${src}"` : ''}></span>`;
    };
    if (this.tab === 'skin') {
      for (const id of Object.keys(SKINS))
        html += `<button data-i="${id}" class="${id === cur ? 'on' : ''}">${thumb('skin', id)}<span class="nm">${t(labelKey('skin', id))}</span></button>`;
    } else {
      html += `<button data-i="" class="${!cur ? 'on' : ''}">${thumb(this.tab, '')}<span class="nm">${t('w.none')}</span></button>`;
      for (const it of ITEMS[this.tab]) html += `<button data-i="${it.id}" class="${it.id === cur ? 'on' : ''}">${thumb(this.tab, it.id)}<span class="nm">${t(labelKey(this.tab, it.id))}</span></button>`;
    }
    items.innerHTML = html;
    items.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => {
      const o = { ...this.outfit, [this.tab]: b.dataset.i ?? '' };
      if (this.tab === 'hat' && o.hat && ITEMS.hat.find((h) => h.id === o.hat)?.hidesHair) { /* hair stays chosen, hidden under the hat */ }
      this.set(o);
    }));
  }
}
