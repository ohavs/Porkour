import { initPhysics } from './core/physics';
import { preload } from './core/assets';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { Gfx, type Quality } from './render/gfx';
import { Game } from './game/game';

const MODELS = [
  'pets/pig', 'pets/hog', 'pets/cow', 'pets/chick', 'pets/dog', 'pets/cat', 'pets/bunny',
  ...['Barn', 'BigBarn', 'SmallBarn', 'OpenBarn', 'ChickenCoop', 'Silo', 'Silo_House', 'TowerWindmill', 'Windmill', 'WaterTower', 'Well'].map((n) => 'farm/' + n),
  ...['fence_simple', 'fence_planks', 'crops_dirtRow', 'crops_leafsStageB', 'crops_cornStageB', 'crops_cornStageD', 'crop_carrot', 'crop_turnip',
    'crops_wheatStageB', 'crop_pumpkin', 'crop_melon', 'tractor', 'truckFlat', 'cart', 'log', 'log_stackLarge', 'stall', 'sign', 'campfire_logs',
    'stump_round', 'barrel', 'pot_large', 'wheel'].map((n) => 'kenney/' + n),
  'kit/Prop_Crate', 'kit/Prop_Wagon',
  ...['crate_carrots', 'crate_potatoes', 'crate_tomatoes', 'crate_cheese', 'food_ingredient_ham', 'mug_full', 'sword_1handed'].map((n) => 'kaykit/' + n),
  ...['Flower_3_Group', 'Flower_4_Group', 'Mushroom_Common'].map((n) => 'nature/' + n), 'kenney/rock_largeA', 'kenney/rock_smallA',
];
const SOUNDS = ['punch', 'punch2', 'thud', 'thud2', 'wood', 'wood2', 'plank', 'metal', 'step1', 'step2', 'step3', 'step4', 'cloth', 'grab',
  'mudstep', 'throw', 'pop', 'denied', 'fart_short', 'fart_deep', 'latch', 'click', 'chop',
  'jingle_alert', 'jingle_caught', 'jingle_grilled', 'jingle_free', 'jingle_knock'];

/** Sounds made from code: cough (3 throaty noise bursts), grill sizzle (hiss + crackles). */
function synthSounds(audio: Audio) {
  let lp = 0, hp = 0;
  audio.synth('cough', 0.8, (t) => {
    const k = t % 0.26, env = k < 0.2 ? Math.exp(-k * 16) * (1 - Math.exp(-k * 400)) * (1 - t / 1.2) : 0;
    lp += (Math.random() * 2 - 1 - lp) * 0.3;
    return lp * env * 1.6 + Math.sin(t * 2 * Math.PI * (130 - k * 120)) * env * 0.25;
  });
  audio.synth('sizzle', 1.2, (t) => {
    const n = Math.random() * 2 - 1, h = n - hp; hp = n;
    const env = Math.min(1, t * 8) * Math.min(1, (1.2 - t) * 4);
    const crackle = Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.9 : 0;
    return (h * 0.22 * (0.7 + 0.3 * Math.sin(t * 37)) + crackle) * env;
  });
}

const params = new URLSearchParams(location.search);
const quality: Quality = params.get('q') === 'low' ? 'low' : 'high';
const bar = document.querySelector('#bar > div') as HTMLElement;
const go = document.getElementById('go')!;
const title = document.getElementById('title')!;
const paused = document.getElementById('paused')!;

async function boot() {
  const audio = new Audio();
  let pModels = 0, pSounds = 0;
  const prog = () => (bar.style.width = `${(pModels * 0.85 + pSounds * 0.15) * 100}%`);
  await Promise.all([
    initPhysics(),
    preload(MODELS, (f) => { pModels = f; prog(); }),
    (async () => { let n = 0; await Promise.all(SOUNDS.map(async (s) => { await audio.load(s, `./assets/sfx/${s}.ogg`); pSounds = ++n / SOUNDS.length; prog(); })); })(),
    audio.load('music_level', './assets/music/level_music.ogg'),
    audio.load('music_theme', './assets/music/theme_song.ogg'),
  ]);
  synthSounds(audio);
  go.textContent = 'Building the farm…';
  await new Promise((r) => setTimeout(r, 30));
  const app = document.getElementById('app')!;
  const gfx = new Gfx(app, quality);
  const input = new Input(gfx.renderer.domElement);
  const game = new Game(gfx, audio, input);
  game.build();
  (window as any).__game = game;
  requestAnimationFrame(game.frame);

  const start = () => {
    title.style.opacity = '0'; setTimeout(() => (title.style.display = 'none'), 400);
    paused.style.display = 'none';
    audio.unlock(); audio.playMusic('music_level');
    input.lock();
    game.running = true;
  };
  if (params.has('auto')) { start(); return; }
  go.textContent = 'Click to play';
  title.addEventListener('click', start, { once: true });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && game.running && title.style.display === 'none') paused.style.display = 'flex';
  });
  paused.addEventListener('click', () => { paused.style.display = 'none'; input.lock(); });
}

boot().catch((e) => { go.textContent = 'Error: ' + e.message; console.error(e); });
