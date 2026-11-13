import { initPhysics } from './core/physics';
import { preload } from './core/assets';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { Gfx } from './render/gfx';
import { Game, PLAYER_COLORS } from './game/game';
import { Wardrobe } from './game/wardrobe';
import { PigVisual } from './pig/pigVisual';
import * as THREE from 'three';
import { loadSettings, SETTINGS } from './game/settings';
import { initLang, applyDom, setLang, LANGS, lang, t, onLang, type Lang } from './i18n';
import { Lobby } from './net/lobby';
import { online } from './net/online';
import { G } from './game/ctx';
import { GLB_MODELS } from './world/animalGlb';

const MODELS = [
  ...['Barn', 'BigBarn', 'SmallBarn', 'OpenBarn', 'ChickenCoop', 'Silo', 'Silo_House', 'TowerWindmill', 'Windmill', 'WaterTower', 'Well'].map((n) => 'farm/' + n),
  ...['fence_simple', 'fence_planks', 'crops_dirtRow', 'crops_leafsStageB', 'crops_cornStageB', 'crops_cornStageD', 'crop_carrot', 'crop_turnip',
    'crops_wheatStageB', 'crop_pumpkin', 'crop_melon', 'tractor', 'truckFlat', 'cart', 'log', 'log_stackLarge', 'stall', 'sign', 'campfire_logs',
    'stump_round', 'barrel', 'pot_large', 'wheel'].map((n) => 'kenney/' + n),
  'kit/Prop_Crate', 'kit/Prop_Wagon',
  ...['crate_carrots', 'crate_potatoes', 'crate_tomatoes', 'crate_cheese', 'food_ingredient_ham', 'mug_full', 'sword_1handed',
    'post_lantern', 'pumpkin_orange', 'pumpkin_orange_jackolantern'].map((n) => 'kaykit/' + n),
  ...['wizard_hat', 'viking_helmet', 'knight_helmet', 'skull_helmet', 'dark_wizard_hat', 'hood', 'cape_knight', 'cape_mage', 'cape_barbarian', 'cape_rogue'].map((n) => 'cosm/' + n),
  ...['Flower_3_Group', 'Flower_4_Group', 'Mushroom_Common'].map((n) => 'nature/' + n), 'kenney/rock_largeA', 'kenney/rock_smallA',
  ...GLB_MODELS,
];

loadSettings();
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
    preload(MODELS, (f) => { pModels = f; prog(); }),
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
  (window as any).__game = game;
  requestAnimationFrame(game.frame);

  // wardrobe (title screen + menu)
  const wardrobe = new Wardrobe(PLAYER_COLORS[0]);
  wardrobe.onChange = (o) => { game.local.visual.setOutfit(o); if (online.connected) online.setOutfit(JSON.stringify(o)); };
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
    game.hud.flashHelp(16);
  };
  // online lobby (title "Play online", invite links ?room=CODE, back from a game ?lobby=1)
  const lobby = new Lobby(game, {
    start: () => { started = false; start(); },
    wardrobe: () => wardrobe.open(),
    outfit: () => JSON.stringify(game.local.visual.outfit),
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
  void G;
  const btns = document.getElementById('titleBtns')!; btns.classList.add('show');
  document.getElementById('tWardrobe')!.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); wardrobe.open(); });
  const sel = document.getElementById('tLang') as HTMLSelectElement;
  sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang() ? 'selected' : ''}>🌐 ${v}</option>`).join('');
  sel.addEventListener('click', (e) => e.stopPropagation());
  sel.addEventListener('change', () => setLang(sel.value as Lang));
  onLang(() => { sel.value = lang(); });
  // leaving pointer lock (Esc) opens the menu; clicking the game re-locks
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && game.running && !game.menu.blocking && !lobby.isOpen) game.menu.open();
  });
  gfx.renderer.domElement.addEventListener('click', () => { if (game.running && !game.menu.blocking) input.lock(); });
}

boot().catch((e) => { go.textContent = t('title.error', { msg: e.message }); console.error(e); });
