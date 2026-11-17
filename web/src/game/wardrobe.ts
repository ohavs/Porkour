import * as THREE from 'three';
import { PigVisual } from '../pig/pigVisual';
import { ITEMS, SKINS, SLOTS, labelKey, defaultOutfit, type Outfit, type Slot } from '../pig/cosmetics';
import { SETTINGS, saveSettings } from './settings';
import { t, onLang, type Key } from '../i18n';
import { fitted, has } from '../core/assets';
import { makeHorseshoe } from '../world/gadgets';
import {
  GADGETS, buyGadget, buyItem, canBuy, canBuyGadget, gadget, gadgetCount, isOwned, level, levelFor, levelProgress, loadout,
  ownedIds, ownedOnly, priceOf, setLoadout, type BuyResult, type GadgetId,
} from './shop';

const $ = (id: string) => document.getElementById(id)!;
type Tab = Slot | 'gadget';
const LOCK = '<svg viewBox="0 0 16 16" class="lk"><rect x="2.5" y="7" width="11" height="8" rx="2" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
export const coinHtml = (n: number) => `<i class="coin"></i>${n.toLocaleString()}`;
/** Coins + level badge (wardrobe header, title screen). */
export function walletHtml() {
  return `<span class="lv" title="${t('shop.xp', { n: SETTINGS.xp })}">${t('shop.level', { n: level() })}<i><b style="width:${Math.round(levelProgress() * 100)}%"></b></i></span>` +
    `<span class="coins">${coinHtml(SETTINGS.coins)}</span>`;
}

/**
 * Wardrobe + shop overlay: live 3D preview (own small renderer, drag to turn) + item grid per slot. Items the player
 * doesn't own show their price (and the level they need); clicking one tries it on, the bar below buys it. The
 * Gadgets tab sells one-round gadgets and picks the one to bring (game/shop.ts).
 */
export class Wardrobe {
  private el = $('wardrobe');
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private pig?: PigVisual;
  private tab: Tab = 'hat';
  private raf = 0;
  private spin = 0.6; private dragX: number | null = null; private yaw = 0.5;
  outfit: Outfit;
  /** An item being tried on (not owned yet): shown on the preview pig only. */
  private trying: { slot: Slot; id: string } | null = null;
  private selGadget: GadgetId = 'cherryBomb';
  private flash = '';
  /** Item thumbnails: a small offscreen renderer draws the pig wearing just that item, close up (cached data URLs). */
  private thumbR?: THREE.WebGLRenderer; private thumbScene = new THREE.Scene(); private thumbCam = new THREE.PerspectiveCamera(26, 1, 0.05, 30);
  private thumbPig?: PigVisual; private thumbs = new Map<string, string>(); private queue: { key: string; slot: Tab; id: string }[] = [];
  onChange?: (o: Outfit) => void;
  onClose?: () => void;
  /** Coins / loadout changed (title wallet, online outfit message). */
  onShop?: () => void;

  constructor(private color: number) {
    this.outfit = ownedOnly({ ...defaultOutfit(), ...(SETTINGS.outfit ?? {}) });
    $('wDone').addEventListener('click', () => this.close());
    $('wRandom').addEventListener('click', () => { this.trying = null; this.set(this.randomOwned()); });
    onLang(() => { if (this.isOpen) this.render(); });
  }
  get isOpen() { return this.el.classList.contains('show'); }

  open(tab?: Tab) {
    document.exitPointerLock?.();
    if (tab) this.tab = tab;
    this.el.classList.add('show');
    if (!this.renderer) this.setup();
    this.render();
    const loop = () => { this.frame(); this.raf = requestAnimationFrame(loop); };
    cancelAnimationFrame(this.raf); loop();
  }
  close() {
    this.el.classList.remove('show');
    cancelAnimationFrame(this.raf);
    if (this.trying) { this.trying = null; this.pig?.setOutfit(this.outfit); }
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
    this.outfit = ownedOnly(o);
    this.pig?.setOutfit(this.preview());
    SETTINGS.outfit = this.outfit; saveSettings();
    this.onChange?.(this.outfit);
    this.render();
  }
  /** What the preview pig wears: my outfit + the item I'm trying on. */
  private preview(): Outfit { return this.trying ? { ...this.outfit, [this.trying.slot]: this.trying.id } : this.outfit; }

  private randomOwned(): Outfit {
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const o = defaultOutfit();
    o.skin = pick(ownedIds('skin'));
    for (const s of ['hat', 'hair', 'face', 'eyes', 'neck', 'back'] as const) {
      const ids = ownedIds(s);
      o[s] = ids.length && Math.random() < (s === 'hat' ? 0.85 : 0.45) ? pick(ids) : '';
    }
    if (o.hat && ITEMS.hat.find((h) => h.id === o.hat)?.hidesHair) o.hair = '';
    return o;
  }

  private thumbKey(slot: Tab, id: string) { return `${slot}:${id}:${slot === 'skin' || slot === 'gadget' ? '' : this.outfit.skin}`; }

  /** Draw one item on a bare pig (current skin), framed on the item, into a data URL (gadgets: the gadget alone). */
  private makeThumb(q: { key: string; slot: Tab; id: string }) {
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
    if (q.slot === 'gadget') { this.gadgetThumb(q); return; }
    pig.root.visible = true;
    const o: Outfit = { skin: q.slot === 'skin' ? q.id : this.outfit.skin, hat: '', hair: '', face: '', eyes: '', neck: '', back: '' };
    if (q.slot !== 'skin') o[q.slot] = q.id;
    pig.setOutfit(o);
    pig.update({ speed: 0, grounded: true, vy: 0, standing: false, mode: 'normal', sprinting: false, muddy: 0, holding: false, charging: 0, dt: 1, t: 0 });
    pig.root.updateMatrixWorld(true);
    // frame: the item (plus a bit of the head around it), from the front three-quarters (from behind for capes)
    const box = new THREE.Box3();
    const item = q.slot === 'skin' || !q.id ? null : ITEMS[q.slot].find((i) => i.id === q.id);
    if (item) box.setFromObject(pig.rig.anchors[item.anchor]);
    // the face (around the eyes anchor) as the base frame; the back slot frames the pig's back
    const base = new THREE.Box3().setFromCenterAndSize(
      (q.slot === 'back' ? pig.rig.anchors.back : pig.rig.anchors.eyes).getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.42, 0.42, 0.42));
    if (q.slot === 'skin') box.setFromObject(pig.root);
    else if (!item || box.isEmpty()) box.copy(base);
    else box.union(base);
    const dir = q.slot === 'back' ? new THREE.Vector3(-0.55, 0.55, -1) : q.slot === 'skin' ? new THREE.Vector3(0.9, 0.45, 1.1) : new THREE.Vector3(0.6, 0.25, 1);
    this.shoot(q.key, box, dir, q.slot === 'skin' ? 1.05 : 0.95);
  }
  private gadgetThumb(q: { key: string; id: string }) {
    const g = gadget(q.id); if (!g) return;
    this.thumbPig!.root.visible = false;
    const m = !g.model ? makeHorseshoe() : has(g.model) ? fitted(g.model, { height: q.id === 'bone' ? 0.12 : 0.3 }) : new THREE.Group();
    if (q.id === 'bone') m.rotation.set(0.3, 0.6, 0.2);
    if (q.id === 'key') m.rotation.set(0, 0, -0.7);
    this.thumbScene.add(m);
    m.updateMatrixWorld(true);
    this.shoot(q.key, new THREE.Box3().setFromObject(m), new THREE.Vector3(0.5, 0.45, 1), 0.85);
    this.thumbScene.remove(m);
  }
  private shoot(key: string, box: THREE.Box3, dir: THREE.Vector3, k: number) {
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const dist = (size * 0.5) / Math.tan((this.thumbCam.fov * Math.PI) / 360) * k;
    this.thumbCam.position.copy(c).addScaledVector(dir.normalize(), Math.max(dist, 0.3));
    this.thumbCam.lookAt(c);
    this.thumbR!.render(this.thumbScene, this.thumbCam);
    const url = this.thumbR!.domElement.toDataURL('image/png');
    this.thumbs.set(key, url);
    document.querySelectorAll<HTMLImageElement>(`#wItems img[data-k="${key}"]`).forEach((img) => (img.src = url));
  }

  private thumb(slot: Tab, id: string) {
    const key = this.thumbKey(slot, id), src = this.thumbs.get(key);
    if (!src && !this.queue.some((q) => q.key === key)) this.queue.push({ key, slot, id });
    return `<span class="th"><img data-k="${key}" alt="" ${src ? `src="${src}"` : ''}></span>`;
  }
  /** Price / level tag under an item the player doesn't own. */
  private tag(slot: Slot, id: string) {
    if (isOwned(slot, id)) return '';
    const lv = levelFor(slot, id);
    if (level() < lv) return `<span class="pr need">${LOCK}${t('shop.level', { n: lv })}</span>`;
    return `<span class="pr${SETTINGS.coins < priceOf(slot, id) ? ' poor' : ''}">${coinHtml(priceOf(slot, id))}</span>`;
  }

  private render() {
    $('wWallet').innerHTML = walletHtml();
    const tabs = $('wTabs');
    const all: Tab[] = [...SLOTS, 'gadget'];
    tabs.innerHTML = all.map((s) => `<button data-t="${s}" class="${s === this.tab ? 'on' : ''}${s === 'gadget' ? ' gt' : ''}">${t(('w.cat.' + s) as Key)}</button>`).join('');
    tabs.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.t as Tab; this.flash = '';
      if (this.trying) { this.trying = null; this.pig?.setOutfit(this.outfit); }
      this.render();
    }));
    const items = $('wItems');
    this.queue = [];
    items.classList.toggle('gadgets', this.tab === 'gadget');
    if (this.tab === 'gadget') { this.renderGadgets(items); return; }
    const tab = this.tab, cur = this.preview()[tab];
    let html = '';
    const card = (id: string, name: string) => {
      const own = isOwned(tab, id), tr = this.trying?.slot === tab && this.trying.id === id;
      return `<button data-i="${id}" class="${id === cur ? 'on' : ''}${own ? '' : ' locked'}${tr ? ' trying' : ''}">${this.thumb(tab, id)}<span class="nm">${name}</span>${this.tag(tab, id)}</button>`;
    };
    if (tab === 'skin') for (const id of Object.keys(SKINS)) html += card(id, t(labelKey('skin', id)));
    else {
      html += card('', t('w.none'));
      for (const it of ITEMS[tab]) html += card(it.id, t(labelKey(tab, it.id)));
    }
    items.innerHTML = html;
    items.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.i ?? '';
      this.flash = '';
      if (isOwned(tab, id)) { this.trying = null; this.set({ ...this.outfit, [tab]: id }); return; }
      this.trying = { slot: tab, id };   // try it on
      this.pig?.setOutfit(this.preview());
      this.render();
    }));
    this.renderBuyBar();
  }

  /** The bar under the grid: buy what I'm trying on (or why I can't yet). */
  private renderBuyBar() {
    const bar = $('wBuy');
    if (this.tab === 'gadget') {
      const g = gadget(this.selGadget)!, r = canBuyGadget(g.id);
      bar.innerHTML = `<span class="what">${t(('g.' + g.id) as Key)} · ${t('shop.have', { n: gadgetCount(g.id) })}</span>` +
        (r === 'level' ? `<span class="why">${LOCK}${t('shop.needLevel', { n: g.lvl })}</span>`
          : `<button class="chip buy${r === 'coins' ? ' off' : ''}" id="wBuyBtn">${t('shop.buyOne')} · ${coinHtml(g.price)}</button>`) + this.flashHtml();
      $('wBuyBtn')?.addEventListener('click', () => this.buyResult(buyGadget(g.id), () => { if (!loadout()) setLoadout(g.id); }));
      return;
    }
    const tr = this.trying;
    if (!tr) { bar.innerHTML = this.flashHtml() || `<span class="hint">${t('shop.hint')}</span>`; return; }
    const r = canBuy(tr.slot, tr.id), name = t(labelKey(tr.slot, tr.id));
    bar.innerHTML = `<span class="what">${t('shop.trying', { what: name })}</span>` +
      (r === 'level' ? `<span class="why">${LOCK}${t('shop.needLevel', { n: levelFor(tr.slot, tr.id) })}</span>`
        : `<button class="chip buy${r === 'coins' ? ' off' : ''}" id="wBuyBtn">${t('shop.buy')} · ${coinHtml(priceOf(tr.slot, tr.id))}</button>`) + this.flashHtml();
    $('wBuyBtn')?.addEventListener('click', () => this.buyResult(buyItem(tr.slot, tr.id), () => {
      this.trying = null;
      this.set({ ...this.outfit, [tr.slot]: tr.id });   // bought → wearing it
    }));
  }
  private flashHtml() { return this.flash ? `<span class="flash ${this.flash === 'ok' ? 'ok' : ''}">${t(('shop.r.' + this.flash) as Key)}</span>` : ''; }
  private buyResult(r: BuyResult, ok: () => void) {
    this.flash = r;
    if (r === 'ok') { ok(); this.onShop?.(); this.el.querySelector('#wWallet')?.classList.add('pop'); setTimeout(() => this.el.querySelector('#wWallet')?.classList.remove('pop'), 600); }
    this.render();
  }

  private renderGadgets(items: HTMLElement) {
    const lo = loadout();
    let html = `<div class="ghint">${t('shop.gHint')}</div>`;
    for (const g of GADGETS) {
      const n = gadgetCount(g.id), locked = level() < g.lvl;
      html += `<div class="gd${g.id === this.selGadget ? ' sel' : ''}${g.id === lo ? ' on' : ''}${locked ? ' locked' : ''}" data-g="${g.id}">` +
        `${this.thumb('gadget', g.id)}<div class="gi"><span class="nm">${t(('g.' + g.id) as Key)}</span>` +
        `<span class="ds">${t(('g.' + g.id + '.d') as Key)}</span>` +
        `<span class="ft">${locked ? `<span class="pr need">${LOCK}${t('shop.level', { n: g.lvl })}</span>` : `<span class="pr${SETTINGS.coins < g.price ? ' poor' : ''}">${coinHtml(g.price)}</span>`}` +
        `<span class="cnt${n ? '' : ' zero'}">×${n}</span>${g.id === lo ? `<span class="take">${t('shop.taking')}</span>` : ''}</span></div></div>`;
    }
    items.innerHTML = html;
    items.querySelectorAll<HTMLElement>('.gd').forEach((d) => d.addEventListener('click', () => {
      const id = d.dataset.g as GadgetId;
      this.selGadget = id; this.flash = '';
      if (gadgetCount(id) > 0) { setLoadout(loadout() === id ? '' : id); this.onShop?.(); }
      this.render();
    }));
    this.renderBuyBar();
  }
}
