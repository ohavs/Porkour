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

  private render() {
    const tabs = $('wTabs');
    tabs.innerHTML = SLOTS.map((s) => `<button data-t="${s}" class="${s === this.tab ? 'on' : ''}">${t(('w.cat.' + s) as Key)}</button>`).join('');
    tabs.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.t as Slot; this.render(); }));
    const items = $('wItems');
    const cur = this.outfit[this.tab];
    let html = '';
    if (this.tab === 'skin') {
      for (const [id, sk] of Object.entries(SKINS))
        html += `<button data-i="${id}" class="${id === cur ? 'on' : ''}"><span class="sw" style="background:#${sk.body.toString(16).padStart(6, '0')}"></span>${t(labelKey('skin', id))}</button>`;
    } else {
      html += `<button data-i="" class="${!cur ? 'on' : ''}">${t('w.none')}</button>`;
      for (const it of ITEMS[this.tab]) html += `<button data-i="${it.id}" class="${it.id === cur ? 'on' : ''}">${t(labelKey(this.tab, it.id))}</button>`;
    }
    items.innerHTML = html;
    items.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => {
      const o = { ...this.outfit, [this.tab]: b.dataset.i ?? '' };
      if (this.tab === 'hat' && o.hat && ITEMS.hat.find((h) => h.id === o.hat)?.hidesHair) { /* hair stays chosen, hidden under the hat */ }
      this.set(o);
    }));
  }
}
