import { PadNav } from './game/padNav';
import { PADDEV } from './game/padGlyph';
import { initPhysics } from './core/physics';
import { preload } from './core/assets';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { Gfx } from './render/gfx';
import { Game, PLAYER_COLORS } from './game/game';
import { Wardrobe, walletHtml } from './game/wardrobe';
import { initShop, outfitMsg, ownerPerks } from './game/shop';
import { isOwner, onProfile } from './net/auth';
import { PigVisual } from './pig/pigVisual';
import * as THREE from 'three';
import { loadSettings, saveSettings, SETTINGS } from './game/settings';
import { initLang, applyDom, setLang, LANGS, lang, t, onLang, type Lang, type Key } from './i18n';
import { Lobby } from './net/lobby';
import { LobbyUI } from './game/lobbyUI';
import { online } from './net/online';
import { G, ADMIN } from './game/ctx';
import { GLB_MODELS } from './world/animalGlb';
import { LOOT_MODELS } from './world/props';
import { COVER_MODELS } from './world/hideouts';
import { LANDMARK_MODELS } from './world/landmarks';
import { FARM2_MODELS } from './world/farm2';
import { FARM3_MODELS } from './world/farm3';
import { FARM4_MODELS } from './world/farm4';
import { FARM5_MODELS } from './world/farm5';
import { INTERIOR_MODELS } from './world/interiors';
import { farmId, FARM_IDS, reloadOnFarm, type FarmId } from './world/farms';
import { FLAGS } from './game/flags';
import { gate } from './game/gate';

const MODELS = [
  ...['Barn', 'BigBarn', 'SmallBarn', 'OpenBarn', 'ChickenCoop', 'Silo', 'Silo_House', 'TowerWindmill', 'Windmill', 'WaterTower', 'Well'].map((n) => 'farm/' + n),
  ...['fence_simple', 'fence_planks', 'crops_dirtRow', 'crops_leafsStageB', 'crops_cornStageB', 'crops_cornStageD', 'crop_carrot', 'crop_turnip',
    'crops_wheatStageB', 'crop_pumpkin', 'crop_melon', 'tractor', 'truckFlat', 'cart', 'log', 'log_stackLarge', 'stall', 'sign', 'campfire_logs',
    'stump_round', 'barrel', 'pot_large', 'wheel'].map((n) => 'kenney/' + n),
  'kit/Prop_Crate', 'kit/Prop_Wagon',
  ...['crate_carrots', 'crate_potatoes', 'crate_tomatoes', 'crate_cheese', 'food_ingredient_ham', 'mug_full', 'sword_1handed', 'axe_1handed',
    'post_lantern', 'pumpkin_orange', 'pumpkin_orange_jackolantern', 'bone_A'].map((n) => 'kaykit/' + n),
  'loot/Shotgun_1', 'cover/BearTrap_Open', 'cover/BearTrap_Closed', 'kaykit/smokebomb', 'loot/Key2',
  ...['wizard_hat', 'viking_helmet', 'knight_helmet', 'skull_helmet', 'dark_wizard_hat', 'hood', 'cape_knight', 'cape_mage', 'cape_barbarian', 'cape_rogue'].map((n) => 'cosm/' + n),
  ...['Flower_3_Group', 'Flower_4_Group', 'Mushroom_Common'].map((n) => 'nature/' + n), 'kenney/rock_largeA', 'kenney/rock_smallA',
  ...GLB_MODELS, ...LOOT_MODELS, 'loot/Coin',
  ...['Carrot_4', 'Lettuce_4', 'Tomato_4', 'Beet_4', 'BushBerries_4', 'Watermelon_4'].map((n) => 'crops/' + n),
  ...COVER_MODELS, ...LANDMARK_MODELS, ...INTERIOR_MODELS,
];
/** + the models only the farm this page plays needs. */
/** The chain modes' shed kitchen + brewing bits (KayKit Restaurant, Quaternius; CC0). */
const CHAIN_MODELS = ['kaykit/fridge_A', 'kaykit/stove_single', 'kaykit/oven', 'kaykit/kitchencounter_straight_A', 'kaykit/shelf_papertowel_decorated', 'kaykit/pot_A',
  'kaykit/bowl', 'kaykit/kitchentable_A', 'kaykit/chair_stool', 'brew/Scythe', 'brew/Bag', 'brew/Bag_Open', 'brew/Barrel', 'brew/Bucket', 'village/Cauldron', 'kenney/campfire_logs'];
const farmModels = () => (farmId() === 'farm2' ? FARM2_MODELS : farmId() === 'farm3' ? FARM3_MODELS : farmId() === 'farm4' ? FARM4_MODELS : farmId() === 'farm5' ? FARM5_MODELS
  : farmId() === 'farm6' || farmId() === 'farm7' ? CHAIN_MODELS : []);

loadSettings();
initShop();
if (isOwner()) ownerPerks();   // the owner's account: all the coins, the top level
initLang();
applyDom();
const params = new URLSearchParams(location.search);
const bar = document.querySelector('#bar > div') as HTMLElement;
const go = document.getElementById('go')!;
const title = document.getElementById('title')!;

/**
 * Compile every material's shaders now, behind the loading screen, instead of mid-game the first time each kind of
 * thing comes into view (each one a hitch of 50–500 ms on Windows — "it got stuck for a moment"). The farm is far from
 * the lobby stage, so none of it is drawn before PLAY. Uses the GPU's parallel compile where it has one.
 */
async function precompile(gfx: Gfx) {
  const q = new URLSearchParams(location.search);
  if (q.get('draw') === '0' || q.get('pre') === '0') return;   // (tests: no drawing / compare without it)
  const t0 = performance.now(), n0 = gfx.renderer.info.programs?.length ?? 0;
  try { await Promise.race([gfx.renderer.compileAsync(gfx.scene, gfx.camera), new Promise((r) => setTimeout(r, 15000))]); } catch (e) { console.warn('precompile', e); }
  (window as any).__precompile = { ms: Math.round(performance.now() - t0), programs: (gfx.renderer.info.programs?.length ?? 0) - n0 };
}

async function boot() {
  await gate();   // early access: a tester code first (net/access.ts)
  const audio = new Audio();
  audio.setMuted(SETTINGS.muted);
  let pModels = 0, pSounds = 0;
  const prog = () => (bar.style.width = `${(pModels * 0.8 + pSounds * 0.2) * 100}%`);
  await Promise.all([
    initPhysics(),
    preload([...MODELS, ...farmModels()], (f) => { pModels = f; prog(); }),
    audio.loadAll('./assets/sfx/', (f) => { pSounds = f; prog(); }),
    audio.load('music_level', './assets/music/level_music.ogg'),
    audio.load('music_theme', './assets/music/theme_song.ogg'),
  ]);
  go.dataset.i18n = 'title.building'; go.textContent = t('title.building');
  await new Promise((r) => setTimeout(r, 30));
  const app = document.getElementById('app')!;
  const gfx = new Gfx(app, SETTINGS.gfx);
  const input = new Input(gfx.renderer.domElement);
  const game = new Game(gfx, audio, input);
  game.build();
  await precompile(gfx);
  watchHealth(game, gfx);
  (window as any).__game = game;
  requestAnimationFrame(game.frame);

  // wardrobe (title screen + menu)
  const wardrobe = new Wardrobe(PLAYER_COLORS[0]);
  const sendOutfit = () => { if (online.connected) online.setOutfit(outfitMsg(wardrobe.outfit)); };
  wardrobe.onChange = (o) => { game.local.visual.setOutfit(o); sendOutfit(); };
  game.onLoadout = sendOutfit;
  game.menu.onShop = () => { wardrobe.onShop?.(); game.menu.onShopChanged?.(); if (SETTINGS.outfit) { game.local.visual.setOutfit(SETTINGS.outfit); wardrobe.set(SETTINGS.outfit); } };
  wardrobe.onClose = () => { if (game.running && game.mode === 'play') input.lock(); };
  game.menu.onWardrobe = () => wardrobe.open();
  (window as any).__wardrobe = wardrobe;
  Object.assign(window as any, { __PigVisual: PigVisual, __THREE: THREE });   // test hooks (outfit grid renders)

  let started = false;
  /** PLAY: from the lobby stage to a fresh round on the farm. */
  const start = () => {
    if (started) return;
    if (lobby.isOpen) return;
    started = true;
    ui.hide();
    title.style.opacity = '0'; setTimeout(() => (title.style.display = 'none'), 400);
    audio.unlock(); audio.playMusic('music_level');
    game.startPlay();
    input.lock();
    // the controls card only pops up on your very first game (H shows it any time)
    let seen = false; try { seen = !!localStorage.getItem('porkour.helpSeen'); localStorage.setItem('porkour.helpSeen', '1'); } catch { /* private mode */ }
    if (!seen) game.hud.flashHelp(16);
  };
  // online lobby (top bar "Online", invite links ?room=CODE, back from a game ?lobby=1): rooms modal; in a room your
  // party plays on the stage with you, the host's PLAY starts the round for everyone
  const lobby = new Lobby(game, {
    // the host started: close whatever this player had open (wardrobe / shop, the rooms panel, the menu) — user s29:
    // a player in the shop stayed stuck on it when the round began
    start: () => { started = false; try { wardrobe.close(); } catch { /* */ } lobby.close(); try { if (game.menu.menuOpen) game.menu.close(false); } catch { /* */ } start(); },
    wardrobe: () => wardrobe.open(),
    outfit: () => outfitMsg(wardrobe.outfit),
    onRoom: () => ui.render(),
  });
  game.menu.onLeave = () => import('./net/lobby').then((m) => m.backToLobby());
  (window as any).__online = online; (window as any).__lobby = lobby;
  const ui = new LobbyUI({
    play: () => { audio.unlock(); if (lobby.inRoom) { if (online.isHost) lobby.action('start'); } else start(); },
    wardrobe: () => { audio.unlock(); wardrobe.open(); },
    shop: () => { audio.unlock(); wardrobe.open('gadget'); },
    online: () => { audio.unlock(); lobby.open(); },
    settings: () => game.menu.open(),
    sound: () => game.menu.toggleSound(),
    muted: () => audio.muted,
    party: () => (lobby.inRoom ? lobby.partyHtml() : null),
    wireParty: (el) => lobby.wireParty(el),
    playMode: () => (!lobby.inRoom ? 'play' : online.isHost ? 'start' : 'wait'),
  });
  (window as any).__lobbyUI = ui;
  import('./game/saves').then((m) => ((window as any).__saves = m));
  onProfile(() => { if (isOwner() && ownerPerks()) ui.render(); });
  wardrobe.onShop = () => { ui.render(); sendOutfit(); };
  game.menu.onShopChanged = () => ui.render();
  onLang(() => ui.render());
  // the lobby: the stage behind the menus (your pig can already run around, fart, throw things)
  game.enterLobby();
  title.classList.add('lobby');
  if (params.has('auto')) { start(); return; }
  ui.show();
  // music once the browser lets us (first click / key)
  const unlock = () => { audio.unlock(); if (!started) audio.playMusic('music_theme'); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  const room = params.get('room');
  // after the first frames are drawn (the first frame compiles every shader and can block for a while)
  if (room || params.has('lobby')) requestAnimationFrame(() => requestAnimationFrame(() => lobby.open(room ?? '')));
  // gamepad in the menus: the topmost open overlay gets the focus ring (B = Esc, Start = menu / PLAY)
  const shown = (id: string) => { const e = document.getElementById(id); return e?.classList.contains('show') ? e : null; };
  const nav = new PadNav(input, {
    root: () => {
      const lost = shown('gfxLost'); if (lost) return { el: lost };
      if (game.lockpick.isOpen || game.wheel.isOpen) return null;   // the game's own buttons drive these
      if (wardrobe.isOpen) return { el: document.getElementById('wardrobe')!, def: '#wItems .on, #wItems button, #wItems .gd' };
      if (ADMIN.open) return { el: document.getElementById('admin')! };
      if (game.menu.menuOpen) return { el: document.getElementById('menu')!, def: '[data-b=resume]' };
      const sv = shown('saves'); if (sv) return { el: sv, def: '.sslot.on .chip, .sslot .chip.go, .sslot .chip' };
      if (lobby.isOpen) return { el: document.getElementById('lobby')!, def: '[data-a=quick], [data-a=start], .chip.big, [data-a=retry], [data-a=back]' };
      const res = document.getElementById('results');
      if (res && res.style.display !== 'none' && res.childElementCount) return { el: res, def: '[data-r=next], [data-r=again]' };
      if (!started && game.mode === 'lobby' && ui.el.classList.contains('show')) return { el: ui.el, soft: true, def: '#lPlay' };
      return null;
    },
    start: () => {
      if (game.mode === 'lobby') { if (!started && ui.el.classList.contains('show')) document.getElementById('lPlay')!.click(); }
      else if (game.running && !game.menu.blocking) game.menu.open();
    },
  });
  (window as any).__nav = nav;
  // leaving pointer lock (Esc) opens the menu (or just stops the lock-pick); clicking the game re-locks
  let escUntil = 0, escClosed = 0;
  const hint = document.getElementById('clickHint')!;
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (locked) { hint.classList.remove('show'); return; }
    if (!game.running || game.menu.blocking || lobby.isOpen) return;
    // the same Esc press may also reach the page as a keydown (before or after this): one press = one action
    if (game.lockpick.isOpen || performance.now() - escClosed < 400) { game.lockpick.close(); hint.classList.add('show'); escUntil = performance.now() + 400; return; }
    escUntil = performance.now() + 400;
    game.menu.open();
  });
  gfx.renderer.domElement.addEventListener('click', () => { if (game.running && game.mode === 'play' && !game.menu.blocking) input.lock(); });
  /** An overlay closed by Esc: the browser only gives the mouse back on a click, so say so if it didn't come back. */
  const resume = () => setTimeout(() => { if (!PADDEV.on && game.running && game.mode === 'play' && !document.pointerLockElement && !game.menu.blocking && !lobby.isOpen) hint.classList.add('show'); }, 250);
  // Esc closes whatever is open (menu, admin panel, wardrobe, lobby, lock-pick, controls card)
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat || performance.now() < escUntil) return;
    if (game.lockpick.isOpen) game.lockpick.close();
    else if (wardrobe.isOpen) wardrobe.close();
    else if (ADMIN.open) { game.menu.toggleAdmin(); input.lock(); }
    else if (game.menu.menuOpen) game.menu.close();
    else if (ui.savesOpen) { ui.closeSaves(); return; }
    else if (lobby.isOpen) { lobby.escape(); return; }
    else if (game.hud.showHelp) { game.hud.toggleHelp(); return; }
    else if (game.running) { game.menu.open(); return; }
    else return;
    escClosed = performance.now();
    resume();
  });
}

/**
 * Crash diagnostics + graphics resets. Every 5 s a small heartbeat (memory, GPU objects, fps, settings) goes to
 * localStorage; a normal close marks it closed. If the last session ended without that (the tab / browser crashed),
 * the numbers are kept for the admin panel ("Last session ended unexpectedly"). A lost WebGL context shows a note and
 * a reload button if it doesn't come back by itself.
 */
function watchHealth(game: Game, gfx: Gfx) {
  const KEY = 'porkour.hb';
  try {
    const last = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (last && !last.closed && Date.now() - last.at < 15 * 60e3) { localStorage.setItem('porkour.crash', JSON.stringify(last)); console.warn('last session ended unexpectedly', last); }
  } catch { /* storage blocked */ }
  const t0 = performance.now();
  const beat = (closed = false) => {
    try {
      const m = (performance as any).memory, i = gfx.renderer.info;
      localStorage.setItem(KEY, JSON.stringify({
        at: Date.now(), closed, mins: Math.round((performance.now() - t0) / 6e3) / 10, heap: m ? Math.round(m.usedJSHeapSize / 1e6) : -1,
        geo: i.memory.geometries, tex: i.memory.textures, prog: i.programs?.length ?? 0, fps: Math.round(game.fps), dyn: gfx.dyn,
        preset: SETTINGS.preset, net: G.net, hour: Math.round(G.hour * 10) / 10, lost: gfx.lost,
      }));
    } catch { /* storage full / blocked */ }
  };
  setInterval(beat, 5000); beat();
  addEventListener('pagehide', () => beat(true));
  const note = document.createElement('div'); note.id = 'gfxLost'; note.className = 'overlay';
  document.body.appendChild(note);
  let timer = 0;
  gfx.onLost = () => {
    note.innerHTML = `<div class="panel txt"><h2>${t('gfx.lost')}</h2><p>${t('gfx.lost2')}</p></div>`;
    note.classList.add('show');
    timer = window.setTimeout(() => {
      note.innerHTML = `<div class="panel txt"><h2>${t('gfx.lost')}</h2><p>${t('gfx.lostTip')}</p><button class="chip big" id="gfxReload">${t('gfx.reload')}</button></div>`;
      document.getElementById('gfxReload')?.addEventListener('click', () => location.reload());
    }, 5000);
  };
  gfx.onRestored = () => { clearTimeout(timer); note.classList.remove('show'); };
}

boot().catch((e) => { go.textContent = t('title.error', { msg: e.message }); console.error(e); });
