import { initPhysics } from './core/physics';
import { preload } from './core/assets';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { Gfx } from './render/gfx';
import { Game, PLAYER_COLORS } from './game/game';
import { Wardrobe, walletHtml } from './game/wardrobe';
import { initShop, outfitMsg } from './game/shop';
import { PigVisual } from './pig/pigVisual';
import * as THREE from 'three';
import { loadSettings, saveSettings, SETTINGS } from './game/settings';
import { initLang, applyDom, setLang, LANGS, lang, t, onLang, type Lang, type Key } from './i18n';
import { Lobby } from './net/lobby';
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
import { farmId, FARM_IDS, reloadOnFarm, type FarmId } from './world/farms';

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
  ...COVER_MODELS, ...LANDMARK_MODELS,
];
/** + the models only the farm this page plays needs. */
const farmModels = () => (farmId() === 'farm2' ? FARM2_MODELS : farmId() === 'farm3' ? FARM3_MODELS : farmId() === 'farm4' ? FARM4_MODELS : farmId() === 'farm5' ? FARM5_MODELS : []);

/** Tiny flag icons (emoji flags don't show on Windows). */
const FLAGS: Record<string, string> = {
  en: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0l60 40M60 0 0 40" stroke="#fff" stroke-width="8"/><path d="M0 0l60 40M60 0 0 40" stroke="#c8102e" stroke-width="3"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="12"/><path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7"/></svg>',
  es: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#aa151b"/><rect y="10" width="60" height="20" fill="#f1bf00"/></svg>',
};

/** Little farm icons for the title's farm picker: a red barn, an apple, a cheese wedge, a die. */
const FARM_ICON: Record<string, string> = {
  farm1: '<svg viewBox="0 0 20 20"><path d="M2 9 10 3l8 6v9H2z" fill="#c8402e"/><path d="M7 18v-6h6v6" fill="#fff4e0"/><path d="M7 12l6 6M13 12l-6 6" stroke="#c8402e" stroke-width="1.4"/></svg>',
  farm2: '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="12" r="5.5" fill="#e0302c"/><circle cx="12.5" cy="12" r="5.5" fill="#e0302c"/><path d="M10 7c0-2 1-4 2-5" stroke="#5a3a1e" stroke-width="1.6" fill="none"/><ellipse cx="13.5" cy="4.5" rx="3" ry="1.4" fill="#4fa636" transform="rotate(-25 13.5 4.5)"/></svg>',
  farm3: '<svg viewBox="0 0 20 20"><path d="M2 15 17 6v9z" fill="#ffd34d"/><path d="M2 15 17 6l-3-2z" fill="#ffe98a"/><circle cx="8" cy="13" r="1.3" fill="#d9a62c"/><circle cx="13" cy="11.5" r="1.6" fill="#d9a62c"/><circle cx="14.5" cy="14" r="0.9" fill="#d9a62c"/></svg>',
  farm4: '<svg viewBox="0 0 20 20"><ellipse cx="10" cy="11.5" rx="8" ry="6.5" fill="#f08a24"/><path d="M10 5c0-2 1-3 2-3.5" stroke="#5a3a1e" stroke-width="1.6" fill="none"/><path d="M5.5 9.5l2 1.6-2.2.4zM14.5 9.5l-2 1.6 2.2.4zM5.5 13.5l2 1 1.2-1 1.3 1 1.3-1 1.2 1 2-1-1.3 2.5h-6.4z" fill="#ffd34d"/></svg>',
  farm5: '<svg viewBox="0 0 20 20"><circle cx="10" cy="14" r="5.2" fill="#f4f8ff"/><circle cx="10" cy="7" r="3.6" fill="#f4f8ff"/><path d="M6.6 4.6h6.8v-.9H11.7V1h-3.4v2.7H6.6z" fill="#26232a"/><path d="M10 7.2l3.2.8-3.2.6z" fill="#ff7a1f"/><circle cx="8.8" cy="6.2" r=".55" fill="#26232a"/><circle cx="11" cy="6.2" r=".55" fill="#26232a"/><path d="M6.8 10h6.4" stroke="#d8342c" stroke-width="1.6"/></svg>',
  random: '<svg viewBox="0 0 20 20"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="#fff4e0"/><g fill="#3b2412"><circle cx="6.5" cy="6.5" r="1.5"/><circle cx="13.5" cy="13.5" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="6.5" cy="13.5" r="1.5"/></g></svg>',
};

loadSettings();
initShop();
initLang();
applyDom();
const params = new URLSearchParams(location.search);
const bar = document.querySelector('#bar > div') as HTMLElement;
const go = document.getElementById('go')!;
const title = document.getElementById('title')!;

async function boot() {
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
  watchHealth(game, gfx);
  (window as any).__game = game;
  requestAnimationFrame(game.frame);

  // wardrobe (title screen + menu)
  const wardrobe = new Wardrobe(PLAYER_COLORS[0]);
  const sendOutfit = () => { if (online.connected) online.setOutfit(outfitMsg(wardrobe.outfit)); };
  const wallet = () => { document.getElementById('tWallet')!.innerHTML = walletHtml(); };
  wardrobe.onChange = (o) => { game.local.visual.setOutfit(o); sendOutfit(); };
  wardrobe.onShop = () => { wallet(); sendOutfit(); };
  game.onLoadout = sendOutfit;
  game.menu.onShop = () => { wardrobe.onShop?.(); if (SETTINGS.outfit) { game.local.visual.setOutfit(SETTINGS.outfit); wardrobe.set(SETTINGS.outfit); } };
  wardrobe.onClose = () => { if (game.running) input.lock(); };
  game.menu.onWardrobe = () => wardrobe.open();
  (window as any).__wardrobe = wardrobe;
  Object.assign(window as any, { __PigVisual: PigVisual, __THREE: THREE });   // test hooks (outfit grid renders)

  let started = false;
  const start = () => {
    if (started) return;
    if (lobby.isOpen) return;
    started = true;
    title.style.opacity = '0'; setTimeout(() => (title.style.display = 'none'), 400);
    audio.unlock(); audio.playMusic('music_level');
    input.lock();
    game.running = true;
    if (G.net !== 'client' && game.round.no === 0) game.round.start();
    // the controls card only pops up on your very first game (H shows it any time)
    let seen = false; try { seen = !!localStorage.getItem('porkour.helpSeen'); localStorage.setItem('porkour.helpSeen', '1'); } catch { /* private mode */ }
    if (!seen) game.hud.flashHelp(16);
  };
  // online lobby (title "Play online", invite links ?room=CODE, back from a game ?lobby=1)
  const lobby = new Lobby(game, {
    start: () => { started = false; start(); },
    wardrobe: () => wardrobe.open(),
    outfit: () => outfitMsg(wardrobe.outfit),
  });
  game.menu.onLeave = () => import('./net/lobby').then((m) => m.backToLobby());
  (window as any).__online = online; (window as any).__lobby = lobby;
  if (params.has('auto')) { start(); return; }
  document.getElementById('tOnline')!.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); lobby.open(); });
  const room = params.get('room');
  // after the first frames are drawn (the first frame compiles every shader and can block for a while)
  if (room || params.has('lobby')) requestAnimationFrame(() => requestAnimationFrame(() => lobby.open(room ?? '')));
  go.dataset.i18n = 'title.play'; go.textContent = t('title.play'); go.classList.add('ready');
  go.addEventListener('click', start);
  title.addEventListener('click', (e) => { if (e.target === title || (e.target as HTMLElement).tagName === 'H1') start(); });
  const btns = document.getElementById('titleBtns')!; btns.classList.add('show');
  wallet(); onLang(wallet);
  document.getElementById('tWardrobe')!.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); wardrobe.open(); });
  // language: two pill buttons with little flags (a native <select> looks like the operating system, not the game)
  const langBox = document.getElementById('tLang')!;
  const renderLangs = () => {
    langBox.innerHTML = Object.entries(LANGS).map(([k, v]) => `<button data-l="${k}" class="${k === lang() ? 'on' : ''}">${FLAGS[k] ?? ''}${v}</button>`).join('');
  };
  renderLangs();
  langBox.addEventListener('click', (e) => {
    e.stopPropagation();
    const l = (e.target as HTMLElement).closest<HTMLElement>('[data-l]')?.dataset.l;
    if (l && l !== lang()) setLang(l as Lang);
  });
  onLang(renderLangs);
  // farm: the one this page built is lit; another one (or "random") reloads the page on it
  const farmBox = document.getElementById('tFarm')!;
  const renderFarms = () => {
    farmBox.innerHTML = [...FARM_IDS, 'random' as const].map((k) =>
      `<button data-f="${k}" class="${k === farmId() || (k === 'random' && SETTINGS.farm === 'random') ? 'on' : ''}">${FARM_ICON[k]}${t(('farm.' + k) as Key)}</button>`).join('');
  };
  renderFarms(); onLang(renderFarms);
  document.getElementById('tFarmRow')!.classList.add('show');
  farmBox.addEventListener('click', (e) => {
    e.stopPropagation();
    const f = (e.target as HTMLElement).closest<HTMLElement>('[data-f]')?.dataset.f as FarmId | 'random' | undefined;
    if (!f) return;
    SETTINGS.farm = f; saveSettings();
    if (f === 'random') { const q = new URLSearchParams(location.search); q.delete('farm'); location.href = location.pathname + (q.size ? '?' + q : ''); }
    else if (f !== farmId()) reloadOnFarm(f);
    else renderFarms();
  });
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
  gfx.renderer.domElement.addEventListener('click', () => { if (game.running && !game.menu.blocking) input.lock(); });
  /** An overlay closed by Esc: the browser only gives the mouse back on a click, so say so if it didn't come back. */
  const resume = () => setTimeout(() => { if (game.running && !document.pointerLockElement && !game.menu.blocking && !lobby.isOpen) hint.classList.add('show'); }, 250);
  // Esc closes whatever is open (menu, admin panel, wardrobe, lobby, lock-pick, controls card)
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat || performance.now() < escUntil) return;
    if (game.lockpick.isOpen) game.lockpick.close();
    else if (wardrobe.isOpen) wardrobe.close();
    else if (ADMIN.open) { game.menu.toggleAdmin(); input.lock(); }
    else if (game.menu.menuOpen) game.menu.close();
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
