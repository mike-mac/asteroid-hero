/* ============================================================
   ASTEROID HERO
   2D asteroids-meets-osmos planetary defense.
   Twin-stick touch controls / WASD + mouse on desktop.
   ============================================================ */
(() => {
'use strict';

const TAU = Math.PI * 2;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------- sizing ----------
let W = 0, H = 0, DPR = 1, UNIT = 1; // UNIT scales physics to screen size
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  UNIT = Math.min(W, H) / 700; // tuned for ~700px reference viewport
}
window.addEventListener('resize', resize);
resize();

// ---------- utils ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

// ---------- audio (tiny synth, created on first gesture) ----------
const AudioFX = {
  ctx: null,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
  },
  env(gainNode, t, peak, dur) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + 0.01);
    g.exponentialRampToValueAtTime(0.0001, t + dur);
  },
  laser() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    this.env(g, t, 0.05, 0.09);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + 0.1);
  },
  boom(size = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const dur = 0.25 + size * 0.2;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900 - size * 200, t);
    const g = this.ctx.createGain();
    this.env(g, t, 0.14 + size * 0.1, dur);
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t);
  },
  thud() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    this.env(g, t, 0.25, 0.3);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + 0.32);
  }
};

// ---------- levels ----------
const LEVELS = [
  { name: 'THE MOON', color: '#c9ced9', glow: '#9aa6c0', planetR: 30, gravity: 1.6e6,
    shield: 100, count: 8,  interval: 3.2, speed: [40, 70],  bigChance: 0.15,
    desc: 'Low gravity. A light shower of debris.\nBlast the small rocks before they land.' },
  { name: 'EARTH', color: '#4da6ff', glow: '#2e7fd4', planetR: 40, gravity: 3.2e6,
    shield: 100, count: 12, interval: 2.7, speed: [50, 90],  bigChance: 0.25,
    desc: 'Home. Stronger gravity pulls rocks in fast.\nBig asteroids must be pushed off course.' },
  { name: 'MARS', color: '#ff7a4d', glow: '#d45a2e', planetR: 34, gravity: 2.6e6,
    shield: 90,  count: 15, interval: 2.3, speed: [60, 105], bigChance: 0.3,
    desc: 'The asteroid belt is close.\nExpect heavy, fast-moving rocks.' },
  { name: 'NEPTUNE', color: '#5a6cff', glow: '#3947d4', planetR: 46, gravity: 4.2e6,
    shield: 90,  count: 18, interval: 2.0, speed: [65, 115], bigChance: 0.35,
    desc: 'Deep space giant. Its pull bends every\ntrajectory — including yours.' },
  { name: 'JUPITER', color: '#e8b06a', glow: '#c78d43', planetR: 56, gravity: 5.5e6,
    shield: 80,  count: 22, interval: 1.8, speed: [70, 125], bigChance: 0.4,
    desc: 'The king of planets drags everything\ntoward it. Good luck, hero.' },
];

// ---------- game state ----------
const S = {
  mode: 'menu',        // menu | intro | play | clear | over | paused
  hardMode: false,     // hard: game over restarts campaign; normal: retry sector
  sectorStartScore: 0,
  levelIndex: 0,
  loop: 0,             // how many times we've cycled all levels
  score: 0,
  lives: 3,
  shield: 100,
  shieldMax: 100,
  time: 0,
  shake: 0,
  flash: 0,
  spawned: 0,
  destroyed: 0,
  deflected: 0,
  spawnTimer: 0,
  fireTimer: 0,
  respawnTimer: 0,
};

let ship = null;
let asteroids = [];
let bolts = [];
let particles = [];
let stars = [];

function level() { return LEVELS[S.levelIndex]; }
function diffMult() { return 1 + S.loop * 0.35; }

function makeStars() {
  stars = [];
  const n = Math.round((W * H) / 9000);
  for (let i = 0; i < n; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * H,
      r: rand(0.4, 1.6), tw: rand(0, TAU), sp: rand(0.5, 2) });
  }
}
makeStars();
window.addEventListener('resize', makeStars);

// ---------- input: twin-stick touch + keyboard/mouse ----------
const input = {
  move: { x: 0, y: 0 },      // -1..1
  aim: { x: 0, y: 0 },       // direction, may be zero
  firing: false,
  moveTouch: null, aimTouch: null,
  moveAnchor: null, aimAnchor: null,
  keys: {},
  mouse: { x: 0, y: 0, down: false },
  usingTouch: false,
};

const STICK_R = 60;

function onTouchStart(e) {
  e.preventDefault();
  AudioFX.init();
  input.usingTouch = true;
  for (const t of e.changedTouches) {
    if (t.clientX < W / 2 && input.moveTouch === null) {
      input.moveTouch = t.identifier;
      input.moveAnchor = { x: t.clientX, y: t.clientY };
    } else if (t.clientX >= W / 2 && input.aimTouch === null) {
      input.aimTouch = t.identifier;
      input.aimAnchor = { x: t.clientX, y: t.clientY };
      input.firing = true;
    }
  }
}
function onTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === input.moveTouch) {
      const dx = t.clientX - input.moveAnchor.x, dy = t.clientY - input.moveAnchor.y;
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(d, STICK_R) / STICK_R;
      input.move.x = (dx / d) * m;
      input.move.y = (dy / d) * m;
    } else if (t.identifier === input.aimTouch) {
      const dx = t.clientX - input.aimAnchor.x, dy = t.clientY - input.aimAnchor.y;
      const d = Math.hypot(dx, dy);
      if (d > 12) { input.aim.x = dx / d; input.aim.y = dy / d; }
    }
  }
}
function onTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === input.moveTouch) {
      input.moveTouch = null;
      input.move.x = 0; input.move.y = 0;
    } else if (t.identifier === input.aimTouch) {
      input.aimTouch = null;
      input.firing = false;
    }
  }
}
canvas.addEventListener('touchstart', onTouchStart, { passive: false });
canvas.addEventListener('touchmove', onTouchMove, { passive: false });
canvas.addEventListener('touchend', onTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

window.addEventListener('keydown', e => {
  input.keys[e.code] = true;
  if (e.code === 'Space') { input.firing = true; e.preventDefault(); }
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', e => {
  input.keys[e.code] = false;
  if (e.code === 'Space') input.firing = false;
});
canvas.addEventListener('mousemove', e => {
  input.mouse.x = e.clientX; input.mouse.y = e.clientY;
});
canvas.addEventListener('mousedown', e => {
  AudioFX.init();
  input.mouse.down = true; input.firing = true;
});
window.addEventListener('mouseup', () => {
  input.mouse.down = false;
  if (!input.keys['Space']) input.firing = false;
});

function readKeyboardMove() {
  let x = 0, y = 0;
  if (input.keys['KeyA'] || input.keys['ArrowLeft']) x -= 1;
  if (input.keys['KeyD'] || input.keys['ArrowRight']) x += 1;
  if (input.keys['KeyW'] || input.keys['ArrowUp']) y -= 1;
  if (input.keys['KeyS'] || input.keys['ArrowDown']) y += 1;
  const d = Math.hypot(x, y);
  return d ? { x: x / d, y: y / d } : { x: 0, y: 0 };
}

// ---------- entities ----------
function makeShip() {
  return {
    x: W / 2, y: H / 2 - (level().planetR + 120) * UNIT,
    vx: 0, vy: 0, angle: -Math.PI / 2,
    r: 10 * UNIT, invuln: 3, dead: false, throttle: 0,
  };
}

function makeAsteroid(opts = {}) {
  const L = level();
  const cx = W / 2, cy = H / 2;
  const spawnR = Math.hypot(W, H) * 0.55;
  const a = opts.angle ?? Math.random() * TAU;
  const big = opts.big ?? (Math.random() < L.bigChance);
  const r = opts.r ?? (big ? rand(32, 46) : rand(9, 24)) * UNIT;
  const x = opts.x ?? cx + Math.cos(a) * spawnR;
  const y = opts.y ?? cy + Math.sin(a) * spawnR;
  let vx, vy;
  if (opts.vx !== undefined) { vx = opts.vx; vy = opts.vy; }
  else {
    // aim at planet with tangential jitter so some arrive on curved paths
    const sp = rand(L.speed[0], L.speed[1]) * diffMult() * UNIT;
    const toC = Math.atan2(cy - y, cx - x) + rand(-0.45, 0.45);
    vx = Math.cos(toC) * sp;
    vy = Math.sin(toC) * sp;
  }
  // irregular outline (osmos-style soft blob with a rocky rim)
  const verts = [];
  const n = 10 + Math.floor(r / (4 * UNIT));
  for (let i = 0; i < n; i++) verts.push(rand(0.82, 1.12));
  return {
    x, y, vx, vy, r, verts,
    rot: rand(0, TAU), rotSp: rand(-0.8, 0.8),
    massive: r >= 30 * UNIT,
    hp: r >= 30 * UNIT ? Math.ceil(r / UNIT * 0.75) : Math.ceil(r / (9 * UNIT)),
    age: 0,
    hue: rand(-14, 14),
    hitFlash: 0,
  };
}

function explode(x, y, r, colorBase) {
  const n = Math.min(26, Math.round(6 + r / UNIT));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(20, 160) * UNIT;
    particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rand(0.35, 0.9), t: 0, r: rand(1.5, 4.5) * UNIT,
      c: colorBase || `hsl(${rand(18, 45)}, 100%, ${rand(55, 75)}%)`,
    });
  }
}

function shatter(ast) {
  // big rocks split into fragments; small ones just vaporize
  explode(ast.x, ast.y, ast.r);
  AudioFX.boom(ast.r / (30 * UNIT));
  if (ast.r > 20 * UNIT) {
    const pieces = ast.r > 34 * UNIT ? 3 : 2;
    for (let i = 0; i < pieces; i++) {
      const a = Math.random() * TAU;
      asteroids.push(makeAsteroid({
        x: ast.x + Math.cos(a) * ast.r * 0.5,
        y: ast.y + Math.sin(a) * ast.r * 0.5,
        vx: ast.vx + Math.cos(a) * rand(30, 70) * UNIT,
        vy: ast.vy + Math.sin(a) * rand(30, 70) * UNIT,
        r: ast.r * rand(0.42, 0.55),
      }));
    }
  }
}

// ---------- flow ----------
const $ = id => document.getElementById(id);
const overlay = $('overlay');
const panels = { menu: $('menu'), intro: $('level-intro'), clear: $('level-clear'), over: $('game-over'), paused: $('paused') };

function showPanel(name) {
  overlay.classList.remove('hidden');
  for (const k in panels) panels[k].classList.toggle('hidden', k !== name);
}
function hidePanels() { overlay.classList.add('hidden'); }

function startGame(hard) {
  S.hardMode = !!hard;
  S.levelIndex = 0; S.loop = 0; S.score = 0; S.lives = 3;
  showIntro();
}

function retrySector() {
  S.lives = 3;
  S.score = S.sectorStartScore;
  showIntro();
}

function showIntro() {
  const L = level();
  S.mode = 'intro';
  S.sectorStartScore = S.score;
  $('li-title').textContent = `SECTOR ${S.loop * LEVELS.length + S.levelIndex + 1} — ${L.name}`;
  $('li-desc').textContent = L.desc;
  const dot = $('li-planet-dot');
  dot.style.background = `radial-gradient(circle at 35% 35%, ${L.color}, ${L.glow} 70%, #0a1428)`;
  dot.style.boxShadow = `0 0 40px ${L.glow}`;
  showPanel('intro');
  prepLevel();
}

function prepLevel() {
  const L = level();
  S.shieldMax = L.shield;
  S.shield = L.shield;
  S.spawned = 0; S.destroyed = 0; S.deflected = 0;
  S.spawnTimer = 1.2; S.respawnTimer = 0;
  asteroids = []; bolts = []; particles = [];
  ship = makeShip();
  updateHUD();
  $('planet-name').textContent = L.name;
}

function beginPlay() {
  S.mode = 'play';
  hidePanels();
  document.getElementById('hud').classList.remove('hidden');
  if (AudioFX.ctx && AudioFX.ctx.state === 'suspended') AudioFX.ctx.resume();
}

function levelCleared() {
  S.mode = 'clear';
  const bonus = 250 + Math.round(S.shield / S.shieldMax * 250);
  S.score += bonus;
  $('lc-stats').textContent =
    `Destroyed: ${S.destroyed}   Deflected: ${S.deflected}\n` +
    `Shield remaining: ${Math.round(S.shield / S.shieldMax * 100)}%\n` +
    `Sector bonus: +${bonus}`;
  updateHUD();
  showPanel('clear');
}

function nextLevel() {
  S.levelIndex++;
  if (S.levelIndex >= LEVELS.length) { S.levelIndex = 0; S.loop++; }
  showIntro();
}

function gameOver(reason) {
  S.mode = 'over';
  $('go-title').textContent = reason === 'planet' ? 'PLANET LOST' : 'SHIP DESTROYED';
  const sector = S.loop * LEVELS.length + S.levelIndex + 1;
  $('go-stats').textContent = S.hardMode
    ? `Final score: ${S.score}\nSectors survived: ${sector - 1}\nHard mode: back to Sector 1.`
    : `Score: ${S.sectorStartScore}\nRegroup and retry Sector ${sector}.`;
  $('btn-retry').textContent = S.hardMode ? 'RESTART CAMPAIGN' : 'RETRY SECTOR';
  showPanel('over');
}

function togglePause() {
  if (S.mode === 'play') { S.mode = 'paused'; showPanel('paused'); }
  else if (S.mode === 'paused') { S.mode = 'play'; hidePanels(); }
}

$('btn-start').addEventListener('click', () => { AudioFX.init(); startGame(false); });
$('btn-start-hard').addEventListener('click', () => { AudioFX.init(); startGame(true); });
$('btn-go').addEventListener('click', () => { AudioFX.init(); beginPlay(); });
$('btn-next').addEventListener('click', nextLevel);
$('btn-retry').addEventListener('click', () => S.hardMode ? startGame(true) : retrySector());
$('btn-go-menu').addEventListener('click', () => { S.mode = 'menu'; document.getElementById('hud').classList.add('hidden'); showPanel('menu'); });
$('btn-pause').addEventListener('click', togglePause);
$('btn-resume').addEventListener('click', togglePause);
$('btn-quit').addEventListener('click', () => { S.mode = 'menu'; document.getElementById('hud').classList.add('hidden'); showPanel('menu'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.mode === 'play') togglePause();
});

function updateHUD() {
  $('score').textContent = S.score;
  $('shield-fill').style.width = `${clamp(S.shield / S.shieldMax * 100, 0, 100)}%`;
  $('shield-fill').style.background = S.shield / S.shieldMax > 0.35
    ? 'linear-gradient(90deg,#35d0ff,#7af0c9)' : 'linear-gradient(90deg,#ff5a5a,#ffb35a)';
  $('lives').textContent = '▲ '.repeat(Math.max(0, S.lives)).trim();
}

// ---------- physics ----------
function applyGravity(o, dt, factor = 1) {
  const cx = W / 2, cy = H / 2;
  const dx = cx - o.x, dy = cy - o.y;
  const d2 = dx * dx + dy * dy;
  const d = Math.sqrt(d2) || 1;
  const a = (level().gravity * UNIT * factor) / Math.max(d2, 900);
  o.vx += (dx / d) * a * dt;
  o.vy += (dy / d) * a * dt;
}

function update(dt) {
  S.time += dt;
  const L = level();
  const cx = W / 2, cy = H / 2;
  const planetR = L.planetR * UNIT;
  const spawnR = Math.hypot(W, H) * 0.55;

  // --- spawn wave ---
  if (S.spawned < Math.round(L.count * (1 + S.loop * 0.25))) {
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      asteroids.push(makeAsteroid());
      S.spawned++;
      S.spawnTimer = L.interval * rand(0.7, 1.3) / diffMult();
    }
  } else if (asteroids.length === 0 && S.mode === 'play') {
    levelCleared();
    return;
  }

  // --- ship ---
  if (ship.dead) {
    S.respawnTimer -= dt;
    if (S.respawnTimer <= 0) {
      ship = makeShip();
      updateHUD();
    }
  } else {
    let mv = input.usingTouch ? input.move : readKeyboardMove();
    const mvMag = Math.hypot(mv.x, mv.y);
    // throttle builds the longer you hold thrust — speed grows with acceleration time
    if (mvMag > 0.05) ship.throttle = Math.min(1, ship.throttle + dt / 0.9);
    else ship.throttle = Math.max(0, ship.throttle - dt / 0.35);
    const MAXV = 320 * UNIT;
    const targetSpd = MAXV * (0.45 + 0.55 * ship.throttle);
    // firm easing while steering; loose when released so the ship drifts a while
    const ease = 1 - Math.exp(-(mvMag > 0.05 ? 6 : 1.3) * dt);
    ship.vx += (mv.x * targetSpd - ship.vx) * ease;
    ship.vy += (mv.y * targetSpd - ship.vy) * ease;
    // a whisper of gravity — park the ship and it slowly falls inward
    applyGravity(ship, dt, 0.08);
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    // keep on screen
    ship.x = clamp(ship.x, 10, W - 10);
    ship.y = clamp(ship.y, 10, H - 10);

    // facing: aim stick > mouse > movement
    if (input.usingTouch) {
      if (input.aimTouch !== null && (input.aim.x || input.aim.y)) {
        ship.angle = Math.atan2(input.aim.y, input.aim.x);
      } else if (mv.x || mv.y) {
        ship.angle = Math.atan2(mv.y, mv.x);
      }
    } else {
      ship.angle = Math.atan2(input.mouse.y - ship.y, input.mouse.x - ship.x);
    }
    if (ship.invuln > 0) ship.invuln -= dt;

    // thrust particles
    if ((mv.x || mv.y) && Math.random() < 0.6) {
      const a = Math.atan2(mv.y, mv.x) + Math.PI + rand(-0.4, 0.4);
      particles.push({
        x: ship.x, y: ship.y,
        vx: Math.cos(a) * 90 * UNIT, vy: Math.sin(a) * 90 * UNIT,
        life: 0.35, t: 0, r: 2.2 * UNIT, c: 'rgba(120,220,255,0.9)',
      });
    }

    // firing
    S.fireTimer -= dt;
    if (input.firing && S.fireTimer <= 0) {
      S.fireTimer = 0.14;
      let a = ship.angle;
      // aim assist: snap to the leading intercept of the best target within ~20°
      const BOLT_SPD = 760 * UNIT;
      let bestDiff = 0.35, bestAng = null;
      for (const ast of asteroids) {
        const t = Math.hypot(ast.x - ship.x, ast.y - ship.y) / BOLT_SPD;
        const ang = Math.atan2(ast.y + ast.vy * t - ship.y, ast.x + ast.vx * t - ship.x);
        let diff = Math.abs(ang - a);
        if (diff > Math.PI) diff = TAU - diff;
        if (diff < bestDiff) { bestDiff = diff; bestAng = ang; }
      }
      if (bestAng !== null) a = bestAng;
      bolts.push({
        x: ship.x + Math.cos(a) * ship.r * 1.4,
        y: ship.y + Math.sin(a) * ship.r * 1.4,
        vx: Math.cos(a) * BOLT_SPD,
        vy: Math.sin(a) * BOLT_SPD,
        life: 1.4,
      });
      // muzzle flash instead of recoil
      particles.push({
        x: ship.x + Math.cos(a) * ship.r * 1.6,
        y: ship.y + Math.sin(a) * ship.r * 1.6,
        vx: Math.cos(a) * 60 * UNIT, vy: Math.sin(a) * 60 * UNIT,
        life: 0.12, t: 0, r: 3.5 * UNIT, c: 'rgba(190,245,255,0.95)',
      });
      AudioFX.laser();
    }

    // ship vs planet: the shield repels — bounce, don't die
    {
      const dp = Math.hypot(ship.x - cx, ship.y - cy) || 1;
      const minD = planetR + ship.r + 6 * UNIT;
      if (dp < minD) {
        const nx = (ship.x - cx) / dp, ny = (ship.y - cy) / dp;
        ship.x = cx + nx * minD;
        ship.y = cy + ny * minD;
        const vn = ship.vx * nx + ship.vy * ny;
        if (vn < 0) {
          ship.vx -= 1.8 * vn * nx;
          ship.vy -= 1.8 * vn * ny;
          S.shake = Math.min(1, S.shake + 0.12);
          for (let i = 0; i < 6; i++) {
            const pa = Math.atan2(ny, nx) + rand(-1, 1);
            particles.push({
              x: ship.x, y: ship.y,
              vx: Math.cos(pa) * 80 * UNIT, vy: Math.sin(pa) * 80 * UNIT,
              life: 0.3, t: 0, r: 2 * UNIT, c: 'rgba(90,230,255,0.9)',
            });
          }
        }
      }
    }
  }

  // --- bolts ---
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
      bolts.splice(i, 1); continue;
    }
    // bolt vs planet — absorbed
    if (dist2(b.x, b.y, cx, cy) < planetR * planetR) { bolts.splice(i, 1); continue; }
    // bolt vs asteroids
    for (let j = asteroids.length - 1; j >= 0; j--) {
      const a = asteroids[j];
      if (dist2(b.x, b.y, a.x, a.y) < (a.r + 4 * UNIT) ** 2) {
        const bd = Math.hypot(b.vx, b.vy) || 1;
        // KEY MECHANIC: lasers shove big rocks, shatter small ones
        const rLogical = a.r / UNIT;
        const impulse = (14000 / (rLogical * rLogical)) * UNIT;
        a.vx += (b.vx / bd) * impulse;
        a.vy += (b.vy / bd) * impulse;
        a.hp -= 1;
        a.hitFlash = 0.12;
        particles.push({
          x: b.x, y: b.y, vx: -b.vx * 0.08, vy: -b.vy * 0.08,
          life: 0.25, t: 0, r: 2.5 * UNIT, c: '#aef2ff',
        });
        if (a.hp <= 0) {
          S.score += a.massive ? 150 : Math.round(30 + a.r / UNIT);
          S.destroyed++;
          shatter(a);
          asteroids.splice(j, 1);
          updateHUD();
        }
        bolts.splice(i, 1);
        break;
      }
    }
  }

  // --- asteroids ---
  for (let i = asteroids.length - 1; i >= 0; i--) {
    const a = asteroids[i];
    a.age += dt;
    applyGravity(a, dt);
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rot += a.rotSp * dt;
    if (a.hitFlash > 0) a.hitFlash -= dt;

    // impact on planet
    const dPlanet2 = dist2(a.x, a.y, cx, cy);
    if (dPlanet2 < (planetR + a.r * 0.7) ** 2) {
      const dmg = Math.min(40, 6 + (a.r / UNIT) * 0.7);
      S.shield -= dmg;
      S.shake = Math.min(1, S.shake + dmg / 30);
      S.flash = 0.35;
      explode(a.x, a.y, a.r, `hsl(200, 90%, 70%)`);
      AudioFX.thud();
      asteroids.splice(i, 1);
      updateHUD();
      if (S.shield <= 0) { gameOver('planet'); return; }
      continue;
    }

    // escaped the gravity well — counts as a save
    const dPlanet = Math.sqrt(dPlanet2);
    const outward = (a.x - cx) * a.vx + (a.y - cy) * a.vy > 0;
    if (a.age > 1 && outward && dPlanet > spawnR + 60) {
      S.score += Math.round(a.r / UNIT * 2.5);
      S.deflected++;
      asteroids.splice(i, 1);
      updateHUD();
      continue;
    }

    // asteroid vs ship
    if (!ship.dead && ship.invuln <= 0 &&
        dist2(a.x, a.y, ship.x, ship.y) < (a.r + ship.r * 0.8) ** 2) {
      killShip();
    }
  }

  // --- asteroid vs asteroid: bounce or shatter ---
  for (let i = 0; i < asteroids.length; i++) {
    for (let j = i + 1; j < asteroids.length; j++) {
      const a = asteroids[i], b = asteroids[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, ny = dy / d;
      // separate
      const overlap = rr - d;
      const ma = a.r * a.r, mb = b.r * b.r, mt = ma + mb;
      a.x -= nx * overlap * (mb / mt);
      a.y -= ny * overlap * (mb / mt);
      b.x += nx * overlap * (ma / mt);
      b.y += ny * overlap * (ma / mt);
      // relative velocity along normal
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn > 0) continue;
      const impactSpeed = -vn;
      // elastic-ish bounce
      const e = 0.85;
      const jimp = -(1 + e) * vn / (1 / ma + 1 / mb);
      a.vx -= (jimp / ma) * nx; a.vy -= (jimp / ma) * ny;
      b.vx += (jimp / mb) * nx; b.vy += (jimp / mb) * ny;
      // violent impacts crack rocks apart
      if (impactSpeed > 170 * UNIT) {
        const small = a.r < b.r ? a : b;
        const big = a.r < b.r ? b : a;
        big.hp -= Math.ceil(impactSpeed / (60 * UNIT));
        S.score += 20;
        S.destroyed++;
        shatter(small);
        asteroids.splice(asteroids.indexOf(small), 1);
        if (big.hp <= 0) {
          S.destroyed++;
          S.score += 40;
          shatter(big);
          const bi = asteroids.indexOf(big);
          if (bi >= 0) asteroids.splice(bi, 1);
        }
        updateHUD();
        i = -1; // restart pair scan after mutation
        break;
      }
    }
  }

  // --- particles ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98; p.vy *= 0.98;
  }

  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 2.2);
  if (S.flash > 0) S.flash = Math.max(0, S.flash - dt);
}

function killShip() {
  if (ship.dead || ship.invuln > 0) return;
  explode(ship.x, ship.y, 22 * UNIT, 'rgba(140,220,255,0.95)');
  AudioFX.boom(1.2);
  ship.dead = true;
  S.lives--;
  S.respawnTimer = 1.6;
  S.shake = Math.min(1, S.shake + 0.5);
  updateHUD();
  if (S.lives < 0) gameOver('ship');
}

// ---------- rendering ----------
function drawBackground() {
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#0b1530');
  g.addColorStop(0.55, '#070d20');
  g.addColorStop(1, '#03060f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // stars
  ctx.save();
  for (const s of stars) {
    const a = 0.35 + 0.4 * Math.sin(s.tw + S.time * s.sp);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#cfe0ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlanet() {
  const L = level();
  const cx = W / 2, cy = H / 2, r = L.planetR * UNIT;
  // gravity-well rings (osmos vibe)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i <= 3; i++) {
    const rr = r + i * 34 * UNIT + Math.sin(S.time * 1.4 + i) * 3 * UNIT;
    ctx.globalAlpha = 0.05 / i + 0.02;
    ctx.strokeStyle = L.glow;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.stroke();
  }
  // atmosphere glow
  const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.4);
  glow.addColorStop(0, L.glow + '55');
  glow.addColorStop(1, 'transparent');
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.4, 0, TAU);
  ctx.fill();
  ctx.restore();
  // body
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  body.addColorStop(0, L.color);
  body.addColorStop(0.75, L.glow);
  body.addColorStop(1, '#0a1226');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  // shield ring
  const pct = clamp(S.shield / S.shieldMax, 0, 1);
  if (pct > 0 && S.mode !== 'menu') {
    ctx.save();
    ctx.strokeStyle = pct > 0.35 ? 'rgba(90,230,255,0.8)' : 'rgba(255,120,90,0.9)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8 * UNIT, -Math.PI / 2, -Math.PI / 2 + TAU * pct);
    ctx.stroke();
    ctx.restore();
  }
}

function drawAsteroid(a) {
  ctx.save();
  ctx.translate(a.x, a.y);
  // soft glow
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, a.r * 0.3, 0, 0, a.r * 1.9);
  const hue = (a.massive ? 16 : 32) + a.hue;
  glow.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.28)`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, a.r * 1.9, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // rocky body
  ctx.rotate(a.rot);
  ctx.beginPath();
  const n = a.verts.length;
  for (let i = 0; i <= n; i++) {
    const ang = (i % n) / n * TAU;
    const rr = a.r * a.verts[i % n];
    if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
  }
  ctx.closePath();
  const body = ctx.createRadialGradient(-a.r * 0.3, -a.r * 0.3, a.r * 0.1, 0, 0, a.r * 1.1);
  const l = a.hitFlash > 0 ? 80 : 50;
  body.addColorStop(0, `hsl(${hue}, ${a.massive ? 45 : 30}%, ${l}%)`);
  body.addColorStop(1, `hsl(${hue + 10}, 35%, ${a.hitFlash > 0 ? 45 : 16}%)`);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = `hsla(${hue}, 70%, 70%, 0.35)`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawShip() {
  if (ship.dead) return;
  if (ship.invuln > 0 && Math.floor(S.time * 10) % 2 === 0) return; // blink
  ctx.save();
  ctx.translate(ship.x, ship.y);
  // glow
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, ship.r * 3);
  glow.addColorStop(0, 'rgba(110,210,255,0.5)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, ship.r * 3, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.rotate(ship.angle);
  const r = ship.r;
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(-r * 0.9, r * 0.85);
  ctx.lineTo(-r * 0.4, 0);
  ctx.lineTo(-r * 0.9, -r * 0.85);
  ctx.closePath();
  const g = ctx.createLinearGradient(-r, 0, r * 1.5, 0);
  g.addColorStop(0, '#1d4e89');
  g.addColorStop(1, '#9fe8ff');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(190,240,255,0.9)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawBolts() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of bolts) {
    const d = Math.hypot(b.vx, b.vy) || 1;
    const tx = b.vx / d, ty = b.vy / d;
    const len = 16 * UNIT;
    ctx.strokeStyle = 'rgba(120,235,255,0.9)';
    ctx.lineWidth = 3.5 * UNIT;
    ctx.beginPath();
    ctx.moveTo(b.x - tx * len, b.y - ty * len);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.4 * UNIT;
    ctx.beginPath();
    ctx.moveTo(b.x - tx * len * 0.6, b.y - ty * len * 0.6);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = k;
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * k, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSticks() {
  if (!input.usingTouch || S.mode !== 'play') return;
  ctx.save();
  ctx.strokeStyle = 'rgba(150,200,255,0.25)';
  ctx.fillStyle = 'rgba(150,200,255,0.18)';
  if (input.moveTouch !== null && input.moveAnchor) {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(input.moveAnchor.x, input.moveAnchor.y, STICK_R, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(input.moveAnchor.x + input.move.x * STICK_R, input.moveAnchor.y + input.move.y * STICK_R, 18, 0, TAU);
    ctx.fill();
  }
  if (input.aimTouch !== null && input.aimAnchor) {
    ctx.beginPath();
    ctx.arc(input.aimAnchor.x, input.aimAnchor.y, 26, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  ctx.save();
  if (S.shake > 0) {
    ctx.translate(rand(-1, 1) * S.shake * 9, rand(-1, 1) * S.shake * 9);
  }
  drawBackground();
  drawPlanet();
  drawParticles();
  for (const a of asteroids) drawAsteroid(a);
  drawBolts();
  if (ship && S.mode !== 'menu') drawShip();
  drawSticks();
  ctx.restore();
  if (S.flash > 0) {
    ctx.fillStyle = `rgba(255,90,80,${S.flash * 0.5})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (S.mode === 'play') update(dt);
  else S.time += dt; // keep ambient animation alive
  render();
  requestAnimationFrame(frame);
}

// menu ambience: a few drifting rocks behind the title
function menuAmbience() {
  S.levelIndex = Math.floor(Math.random() * LEVELS.length);
  S.shield = 0;
  for (let i = 0; i < 5; i++) {
    const a = makeAsteroid();
    a.vx *= 0.3; a.vy *= 0.3;
    asteroids.push(a);
  }
  // slow orbital drift, no gameplay
  setInterval(() => {
    if (S.mode !== 'menu') return;
    for (let i = asteroids.length - 1; i >= 0; i--) {
      const a = asteroids[i];
      applyGravity(a, 0.016, 0.4);
      a.x += a.vx * 0.016; a.y += a.vy * 0.016; a.rot += a.rotSp * 0.016;
      if (dist2(a.x, a.y, W / 2, H / 2) < (level().planetR * UNIT * 1.2) ** 2) asteroids.splice(i, 1);
    }
    if (asteroids.length < 5) asteroids.push(makeAsteroid());
  }, 16);
}

// debug/testing handle (not part of the public UI)
window.__ah = { S, gameOver, startGame, nextLevel, levelCleared };

menuAmbience();
showPanel('menu');
requestAnimationFrame(frame);
})();
