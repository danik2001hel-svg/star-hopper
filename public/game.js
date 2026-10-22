/* Star Hopper - grab stars, chain combos, dash through asteroids. */
(() => {
'use strict';
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* ---------- audio ---------- */
let ac = null, muted = store.get('starhopper-muted') === '1';
function initAudio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (ac && ac.state === 'suspended') ac.resume();
}
function beep(freq, dur, type, vol, slide) {
  if (!ac || muted) return;
  try {
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
const sfx = {
  star(c) { beep(520 + Math.min(c, 20) * 35, 0.09, 'triangle', 0.09, 220); },
  gold() { beep(880, 0.12, 'triangle', 0.1, 400); setTimeout(() => beep(1320, 0.14, 'triangle', 0.08), 70); },
  hit() { beep(170, 0.4, 'sawtooth', 0.12, -110); },
  dash() { beep(260, 0.2, 'square', 0.05, 520); },
  smash() { beep(240, 0.22, 'square', 0.08, -140); beep(700, 0.1, 'triangle', 0.06); },
  power() { beep(440, 0.12, 'sine', 0.09, 440); setTimeout(() => beep(880, 0.16, 'sine', 0.08), 90); },
  over() { beep(320, 0.7, 'sawtooth', 0.1, -260); },
  start() { beep(330, 0.1, 'triangle', 0.08, 330); setTimeout(() => beep(660, 0.12, 'triangle', 0.08), 90); }
};

/* ---------- state ---------- */
let state = 'menu';           // menu | play | over
let paused = false;
let best = parseInt(store.get('starhopper-best') || '0', 10) || 0;
let overT = 0, menuT = 0, touchMode = false;
const debug = { noSpawn: false };

const G = {};
const P = { x: 0, y: 0, vx: 0, vy: 0, r: 13, dashT: 0, dashCd: 0, inv: 0, dx: 0, dy: -1, trail: [] };
const desired = { x: 0, y: 0 };
const keys = {};
const ptr = { x: 0, y: 0, active: false, touch: false, id: null };
const bgStars = [];

function resetGame() {
  Object.assign(G, {
    score: 0, lives: 3, time: 0, combo: 0, comboT: 0, mult: 1, level: 1,
    shake: 0, flash: 0, flashC: '255,80,90', slow: 0, magnet: 0, shield: false,
    spawnT: 1.4, starT: 0.2, powT: 9, patT: 5,
    stars: [], rocks: [], pows: [], parts: [], texts: [],
    kills: 0, collected: 0, maxCombo: 0, newBest: false
  });
  P.x = W / 2; P.y = H * 0.7; P.vx = P.vy = 0;
  P.dashT = 0; P.dashCd = 0; P.inv = 1; P.dx = 0; P.dy = -1; P.trail = [];
}
resetGame();

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bgStars.length = 0;
  for (let i = 0; i < 90; i++) bgStars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1) });
  if (state !== 'play') { P.x = W / 2; P.y = H * 0.62; }
}
window.addEventListener('resize', resize);
try { touchMode = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
resize();

/* ---------- spawners ---------- */
function spawnStar(x, y, gold) {
  G.stars.push({ x: clamp(x, 24, W - 24), y: clamp(y, 90, H - 24), r: gold ? 13 : 10, gold: !!gold, life: gold ? 5 : 8, age: 0, ph: rand(0, TAU) });
}
function spawnStarRandom() {
  if (G.stars.length >= 9) return;
  let x, y;
  for (let i = 0; i < 10; i++) {
    x = rand(40, W - 40); y = rand(110, H - 40);
    if (Math.hypot(x - P.x, y - P.y) > 90) break;
  }
  spawnStar(x, y, Math.random() < 0.12);
}
function spawnPattern() {
  const n = 6, ring = Math.random() < 0.5;
  const cx = rand(W * 0.28, W * 0.72), cy = rand(H * 0.38, H * 0.68);
  const rad = Math.min(W, H) * rand(0.1, 0.17);
  for (let i = 0; i < n; i++) {
    if (ring) { const a = i / n * TAU; spawnStar(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, false); }
    else spawnStar(cx + (i - (n - 1) / 2) * 42, cy, i === 2 || i === 3);
  }
  addText(cx, cy, ring ? 'STAR RING!' : 'STAR LINE!', '#ffe66d', 18);
}
function makeRock(x, y, vx, vy, r) {
  const n = Math.floor(rand(7, 11)), verts = [];
  for (let i = 0; i < n; i++) verts.push(rand(0.74, 1.1));
  return { x, y, vx, vy, r, rot: rand(0, TAU), vr: rand(-2, 2), verts };
}
function spawnRock() {
  const side = Math.floor(rand(0, 4));
  const r = rand(14, 36) * (Math.random() < 0.15 ? 1.4 : 1), m = r + 10;
  let x, y;
  if (side === 0) { x = rand(0, W); y = -m; }
  else if (side === 1) { x = W + m; y = rand(0, H); }
  else if (side === 2) { x = rand(0, W); y = H + m; }
  else { x = -m; y = rand(0, H); }
  const tx = P.x + rand(-150, 150), ty = P.y + rand(-150, 150);
  const a = Math.atan2(ty - y, tx - x);
  const sp = rand(70, 130) + Math.min(G.time * 1.8, 190);
  G.rocks.push(makeRock(x, y, Math.cos(a) * sp, Math.sin(a) * sp, r));
}
const POW = {
  shield: { c: '#7df9ff', g: 'S', name: 'SHIELD' },
  magnet: { c: '#ff7ad9', g: 'M', name: 'MAGNET' },
  slow:   { c: '#b69cff', g: 'T', name: 'SLOW-MO' }
};
function spawnPower(type) {
  const types = Object.keys(POW);
  type = type || types[Math.floor(Math.random() * types.length)];
  G.pows.push({ type, x: rand(60, W - 60), y: rand(120, H - 60), r: 15, age: 0, life: 9 });
}
function applyPower(type) {
  const p = POW[type];
  if (type === 'shield') G.shield = true;
  if (type === 'magnet') G.magnet = 8;
  if (type === 'slow') G.slow = 6;
  addText(P.x, P.y - 30, p.name + '!', p.c, 20);
  burst(P.x, P.y, p.c, 22, 280);
  sfx.power();
}

/* ---------- fx ---------- */
function burst(x, y, c, n, sp, life, size) {
  sp = sp || 220; life = life || 0.7; size = size || 3.5;
  for (let i = 0; i < n && G.parts.length < 500; i++) {
    const a = rand(0, TAU), s = rand(sp * 0.25, sp);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(life * 0.5, life), max: life, c, s: rand(size * 0.5, size) });
  }
}
function addText(x, y, t, c, size) { G.texts.push({ x, y, t, c: c || '#fff', size: size || 16, life: 1 }); }

/* ---------- gameplay ---------- */
function startGame() {
  if (state === 'play') return;
  resetGame();
  state = 'play'; paused = false;
  sfx.start();
}
function gameOver() {
  state = 'over'; overT = 0.8;
  if (G.score > best) { best = G.score; G.newBest = true; store.set('starhopper-best', String(best)); }
  burst(P.x, P.y, '#7df9ff', 40, 420, 1.1, 4);
  burst(P.x, P.y, '#ffe66d', 24, 300, 1.0, 3);
  G.shake = 0.8; sfx.over();
  G.stars.length = 0; G.pows.length = 0;
}
function bumpCombo() {
  G.combo++; G.comboT = 2.2;
  G.mult = Math.min(8, 1 + Math.floor(G.combo / 4));
  if (G.combo > G.maxCombo) G.maxCombo = G.combo;
}
function tryDash() {
  if (state !== 'play' || paused || P.dashCd > 0) return;
  let dx = desired.x, dy = desired.y, l = Math.hypot(dx, dy);
  if (l < 5) { dx = P.dx; dy = P.dy; l = Math.hypot(dx, dy) || 1; }
  dx /= l; dy /= l;
  P.vx = dx * 900; P.vy = dy * 900;
  P.dx = dx; P.dy = dy;
  P.dashT = 0.22; P.dashCd = 1.1; P.inv = Math.max(P.inv, 0.3);
  burst(P.x, P.y, '#ffffff', 10, 160, 0.4, 3);
  sfx.dash();
}
function hurt(rock) {
  burst(rock.x, rock.y, '#c9b8a0', 14, 220, 0.6, 3);
  if (G.shield) {
    G.shield = false; P.inv = 1.0;
    burst(P.x, P.y, '#7df9ff', 26, 340, 0.8);
    addText(P.x, P.y - 30, 'SHIELD BROKE!', '#7df9ff', 18);
    G.shake = 0.3; G.flash = 0.35; G.flashC = '125,249,255';
    sfx.hit();
    return;
  }
  G.lives--; G.combo = 0; G.mult = 1; G.comboT = 0;
  P.inv = 1.6; G.shake = 0.55; G.flash = 0.6; G.flashC = '255,80,90';
  burst(P.x, P.y, '#ff5a6e', 26, 320, 0.8);
  sfx.hit();
  if (G.lives <= 0) gameOver();
}
function smash(rock) {
  bumpCombo();
  const pts = Math.round(rock.r * 1.5) * G.mult;
  G.score += pts; G.kills++;
  addText(rock.x, rock.y, 'SMASH +' + pts, '#ffb347', 18);
  burst(rock.x, rock.y, '#ffb347', 20, 300, 0.7, 4);
  burst(rock.x, rock.y, '#ffffff', 8, 200, 0.4, 2.5);
  G.shake = Math.max(G.shake, 0.25);
  sfx.smash();
}

function playUpdate(dt) {
  G.time += dt; G.level = 1 + Math.floor(G.time / 18);
  G.shake = Math.max(0, G.shake - dt * 2); G.flash = Math.max(0, G.flash - dt * 2.5);
  G.slow = Math.max(0, G.slow - dt); G.magnet = Math.max(0, G.magnet - dt);
  P.inv = Math.max(0, P.inv - dt); P.dashCd = Math.max(0, P.dashCd - dt); P.dashT = Math.max(0, P.dashT - dt);
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) { G.combo = 0; G.mult = 1; } }

  // movement
  let mx = 0, my = 0;
  const sp = 390;
  if (ptr.active) {
    const tx = ptr.x, ty = ptr.y - (ptr.touch ? 56 : 0);
    const dx = tx - P.x, dy = ty - P.y, d = Math.hypot(dx, dy);
    if (d > 3) { const s = Math.min(d * 8, sp); mx = dx / d * s; my = dy / d * s; }
  } else {
    const kx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    const ky = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
    const l = Math.hypot(kx, ky);
    if (l) { mx = kx / l * sp; my = ky / l * sp; }
  }
  desired.x = mx; desired.y = my;
  if (P.dashT <= 0) { const k = Math.min(1, dt * 11); P.vx += (mx - P.vx) * k; P.vy += (my - P.vy) * k; }
  P.x = clamp(P.x + P.vx * dt, P.r, W - P.r);
  P.y = clamp(P.y + P.vy * dt, P.r + 50, H - P.r);
  const spd = Math.hypot(P.vx, P.vy);
  if (spd > 30) {
    P.dx += (P.vx / spd - P.dx) * Math.min(1, dt * 14); P.dy += (P.vy / spd - P.dy) * Math.min(1, dt * 14);
    const l = Math.hypot(P.dx, P.dy) || 1; P.dx /= l; P.dy /= l;
  }
  P.trail.push({ x: P.x, y: P.y }); if (P.trail.length > 16) P.trail.shift();
  if (P.dashT > 0 && Math.random() < 0.9) burst(P.x, P.y, '#7df9ff', 1, 60, 0.35, 4);

  // spawning
  if (!debug.noSpawn) {
    G.spawnT -= dt;
    if (G.spawnT <= 0) { spawnRock(); G.spawnT = Math.max(0.3, 1.0 - G.time * 0.009) * rand(0.7, 1.2); }
    G.starT -= dt;
    if (G.starT <= 0) { spawnStarRandom(); G.starT = rand(0.4, 0.8); }
    G.patT -= dt;
    if (G.patT <= 0) { spawnPattern(); G.patT = rand(9, 14); }
    G.powT -= dt;
    if (G.powT <= 0) { if (G.pows.length < 2) spawnPower(); G.powT = rand(11, 16); }
  }

  // stars
  for (let i = G.stars.length - 1; i >= 0; i--) {
    const s = G.stars[i];
    s.age += dt;
    if (s.age > s.life) { G.stars.splice(i, 1); continue; }
    let d = Math.hypot(s.x - P.x, s.y - P.y);
    if (G.magnet > 0 && d < 230 && d > 1) { const pull = 520 * dt; s.x += (P.x - s.x) / d * pull; s.y += (P.y - s.y) / d * pull; d = Math.hypot(s.x - P.x, s.y - P.y); }
    if (d < s.r + P.r + 4) {
      bumpCombo();
      const pts = (s.gold ? 50 : 10) * G.mult;
      G.score += pts; G.collected++;
      addText(s.x, s.y - 8, '+' + pts, s.gold ? '#ffe66d' : '#ffffff', s.gold ? 20 : 15);
      burst(s.x, s.y, s.gold ? '#ffe66d' : '#fff6a8', s.gold ? 18 : 10, 200, 0.6);
      if (s.gold) sfx.gold(); else sfx.star(G.combo);
      G.stars.splice(i, 1);
    }
  }
  // power-ups
  for (let i = G.pows.length - 1; i >= 0; i--) {
    const p = G.pows[i];
    p.age += dt;
    if (p.age > p.life) { G.pows.splice(i, 1); continue; }
    if (Math.hypot(p.x - P.x, p.y - P.y) < p.r + P.r + 4) { applyPower(p.type); G.pows.splice(i, 1); }
  }
  // rocks
  const wdt = dt * (G.slow > 0 ? 0.45 : 1);
  for (let i = G.rocks.length - 1; i >= 0; i--) {
    const k = G.rocks[i];
    k.x += k.vx * wdt; k.y += k.vy * wdt; k.rot += k.vr * wdt;
    if (k.x < -k.r - 140 || k.x > W + k.r + 140 || k.y < -k.r - 140 || k.y > H + k.r + 140) { G.rocks.splice(i, 1); continue; }
    if (Math.hypot(k.x - P.x, k.y - P.y) < k.r * 0.85 + P.r * 0.8) {
      if (P.dashT > 0) { smash(k); G.rocks.splice(i, 1); }
      else if (P.inv <= 0) { hurt(k); G.rocks.splice(i, 1); if (state !== 'play') break; }
    }
  }
}
function ambientUpdate(dt) {
  menuT += dt;
  if (state === 'over') overT = Math.max(0, overT - dt);
  G.shake = Math.max(0, G.shake - dt * 2); G.flash = Math.max(0, G.flash - dt * 2.5);
  if (state === 'menu') { P.x = W / 2; P.y = H * 0.55 + Math.sin(menuT * 2) * 8; P.dx = 0; P.dy = -1; P.trail.length = 0; }
  if (G.rocks.length < 7 && Math.random() < dt * 0.9) {
    const r = rand(14, 34), a = rand(0, TAU), sp = rand(40, 90);
    const edge = Math.floor(rand(0, 4)), m = r + 10;
    const x = edge === 0 ? rand(0, W) : edge === 1 ? W + m : edge === 2 ? rand(0, W) : -m;
    const y = edge === 0 ? -m : edge === 1 ? rand(0, H) : edge === 2 ? H + m : rand(0, H);
    const t = Math.atan2(H / 2 + rand(-200, 200) - y, W / 2 + rand(-200, 200) - x);
    G.rocks.push(makeRock(x, y, Math.cos(t) * sp, Math.sin(t) * sp, r));
  }
  for (let i = G.rocks.length - 1; i >= 0; i--) {
    const k = G.rocks[i];
    k.x += k.vx * dt; k.y += k.vy * dt; k.rot += k.vr * dt;
    if (k.x < -k.r - 160 || k.x > W + k.r + 160 || k.y < -k.r - 160 || k.y > H + k.r + 160) G.rocks.splice(i, 1);
  }
}
function update(dt) {
  const slowK = state === 'play' && G.slow > 0 ? 0.5 : 1;
  for (const s of bgStars) {
    s.y += (18 + 90 * s.z) * dt * slowK;
    if (state === 'play') s.x -= P.vx * 0.03 * s.z * dt * 10;
    if (s.y > H) { s.y = -2; s.x = rand(0, W); }
    if (s.x < 0) s.x += W; if (s.x > W) s.x -= W;
  }
  if (state === 'play') playUpdate(dt); else ambientUpdate(dt);
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.life -= dt; if (p.life <= 0) { G.parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 2.2; p.vy *= 1 - dt * 2.2;
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.life -= dt * 1.1; t.y -= 38 * dt;
    if (t.life <= 0) G.texts.splice(i, 1);
  }
}

/* ---------- drawing ---------- */
function starPath(x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
function drawBg(t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0a24'); g.addColorStop(1, '#150a2e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const R = Math.max(W, H);
  let n = ctx.createRadialGradient(W * 0.2, H * 0.25, 0, W * 0.2, H * 0.25, R * 0.5);
  n.addColorStop(0, 'rgba(90,60,200,0.22)'); n.addColorStop(1, 'rgba(90,60,200,0)');
  ctx.fillStyle = n; ctx.fillRect(0, 0, W, H);
  n = ctx.createRadialGradient(W * 0.85, H * 0.8, 0, W * 0.85, H * 0.8, R * 0.45);
  n.addColorStop(0, 'rgba(255,80,160,0.16)'); n.addColorStop(1, 'rgba(255,80,160,0)');
  ctx.fillStyle = n; ctx.fillRect(0, 0, W, H);
  for (const s of bgStars) {
    ctx.globalAlpha = 0.25 + s.z * 0.6 * (0.7 + 0.3 * Math.sin(t * 2 + s.x));
    ctx.fillStyle = '#fff';
    const z = 0.8 + s.z * 1.6; ctx.fillRect(s.x, s.y, z, z);
  }
  ctx.globalAlpha = 1;
}
function drawRock(k) {
  ctx.save(); ctx.translate(k.x, k.y); ctx.rotate(k.rot);
  ctx.beginPath();
  const n = k.verts.length;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, r = k.r * k.verts[i];
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(-k.r, -k.r, k.r, k.r);
  g.addColorStop(0, '#6a5a78'); g.addColorStop(1, '#2c2438');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#b9a7d6'; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.arc(k.r * 0.25, k.r * 0.15, k.r * 0.2, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(-k.r * 0.3, -k.r * 0.2, k.r * 0.12, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawShip(t, big) {
  const blink = P.inv > 0 && state === 'play' && P.dashT <= 0 && Math.floor(t * 14) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.35;
  // trail
  if (P.trail.length > 2) {
    for (let i = 1; i < P.trail.length; i++) {
      const a = i / P.trail.length;
      ctx.strokeStyle = P.dashT > 0 ? 'rgba(255,255,255,' + (a * 0.7) + ')' : 'rgba(125,249,255,' + (a * 0.35) + ')';
      ctx.lineWidth = a * (P.dashT > 0 ? 12 : 7); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(P.trail[i - 1].x, P.trail[i - 1].y); ctx.lineTo(P.trail[i].x, P.trail[i].y); ctx.stroke();
    }
  }
  ctx.save(); ctx.translate(P.x, P.y);
  const s = big ? 1.5 : 1;
  ctx.scale(s, s);
  ctx.rotate(Math.atan2(P.dy, P.dx) + Math.PI / 2);
  const flame = 8 + Math.sin(t * 40) * 3 + (P.dashT > 0 ? 14 : 0);
  ctx.fillStyle = P.dashT > 0 ? '#ffffff' : '#ffb347';
  ctx.beginPath(); ctx.moveTo(-5, 9); ctx.lineTo(0, 9 + flame); ctx.lineTo(5, 9); ctx.closePath(); ctx.fill();
  ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#7df9ff';
  ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(12, 13); ctx.lineTo(0, 7); ctx.lineTo(-12, 13); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0a0a24';
  ctx.beginPath(); ctx.arc(0, -2, 3.5, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  if (G.shield && state === 'play') {
    ctx.strokeStyle = 'rgba(125,249,255,' + (0.6 + 0.3 * Math.sin(t * 8)) + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 11, 0, TAU); ctx.stroke();
  }
  if (G.magnet > 0 && state === 'play') {
    ctx.strokeStyle = 'rgba(255,122,217,0.25)'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(P.x, P.y, 230, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  if (state === 'play' && P.dashCd > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(P.x, P.y, P.r + 20, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - P.dashCd / 1.1)); ctx.stroke();
  }
}
function fitFont(px) { return 'bold ' + Math.round(px) + 'px system-ui, -apple-system, "Segoe UI", sans-serif'; }
function text(t, x, y, size, color, align) {
  ctx.font = fitFont(size); ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
}
function muteBtn() { return { x: W - 28, y: 66, r: 18 }; }
function dashBtn() { return { x: W - 74, y: H - 84, r: 46 }; }
function drawHUD(t) {
  const fs = clamp(W / 28, 16, 26);
  text('SCORE', 16, 18, fs * 0.55, 'rgba(255,255,255,0.55)');
  text(String(G.score), 16, 42, fs * 1.4, '#ffffff');
  text('BEST ' + best, 16, 68, fs * 0.6, 'rgba(255,230,109,0.8)');
  text('LEVEL ' + G.level, W / 2, 20, fs * 0.7, 'rgba(255,255,255,0.6)', 'center');
  for (let i = 0; i < 3; i++) text('\u2665', W - 20 - i * (fs * 1.15), 22, fs * 1.2, i < G.lives ? '#ff5a6e' : 'rgba(255,255,255,0.18)', 'right');
  text(muted ? '\uD83D\uDD07' : '\uD83D\uDD0A', muteBtn().x, muteBtn().y, 18, '#fff', 'center');
  if (G.combo >= 2) {
    text('x' + G.mult, W / 2, 52, fs * 1.5, G.mult >= 4 ? '#ffe66d' : '#ffffff', 'center');
    text('COMBO ' + G.combo, W / 2, 80, fs * 0.6, 'rgba(255,255,255,0.7)', 'center');
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(W / 2 - 60, 94, 120, 5);
    ctx.fillStyle = '#ffe66d'; ctx.fillRect(W / 2 - 60, 94, 120 * clamp(G.comboT / 2.2, 0, 1), 5);
  }
  let y = H - 22;
  const tags = [];
  if (G.shield) tags.push(['SHIELD', '#7df9ff', 1]);
  if (G.magnet > 0) tags.push(['MAGNET ' + G.magnet.toFixed(0) + 's', '#ff7ad9', G.magnet / 8]);
  if (G.slow > 0) tags.push(['SLOW-MO ' + G.slow.toFixed(0) + 's', '#b69cff', G.slow / 6]);
  for (const tg of tags) { text(tg[0], 16, y, fs * 0.65, tg[1]); y -= 24; }
  if (touchMode) {
    const b = dashBtn(), ready = P.dashCd <= 0;
    ctx.fillStyle = ready ? 'rgba(125,249,255,0.22)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = ready ? '#7df9ff' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 3; ctx.stroke();
    text('DASH', b.x, b.y, 16, ready ? '#fff' : 'rgba(255,255,255,0.5)', 'center');
  }
}
function overlayBox(alpha) { ctx.fillStyle = 'rgba(5,5,20,' + alpha + ')'; ctx.fillRect(0, 0, W, H); }
function drawMenu(t) {
  overlayBox(0.35);
  const s = clamp(W / 11, 34, 84);
  ctx.save(); ctx.translate(W / 2, H * 0.24 + Math.sin(t * 2) * 5);
  ctx.font = fitFont(s); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff7ad9'; ctx.shadowBlur = 30;
  const g = ctx.createLinearGradient(-s * 2.5, 0, s * 2.5, 0);
  g.addColorStop(0, '#7df9ff'); g.addColorStop(0.5, '#ffe66d'); g.addColorStop(1, '#ff7ad9');
  ctx.fillStyle = g; ctx.fillText('STAR HOPPER', 0, 0); ctx.restore();
  const f = clamp(W / 34, 14, 20), y0 = H * 0.7;
  text(touchMode ? 'Drag to fly  \u2022  DASH button smashes rocks' : 'Mouse / WASD / arrows to fly  \u2022  Click / SPACE to dash', W / 2, y0, f, 'rgba(255,255,255,0.85)', 'center');
  text('Grab stars, chain combos, dash through asteroids!', W / 2, y0 + f * 1.7, f, 'rgba(255,255,255,0.6)', 'center');
  text('Best: ' + best, W / 2, y0 + f * 3.6, f * 1.1, '#ffe66d', 'center');
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
  text(touchMode ? 'TAP TO START' : 'PRESS SPACE OR CLICK TO START', W / 2, H * 0.9, f * 1.2, '#7df9ff', 'center');
  ctx.globalAlpha = 1;
}
function drawOver(t) {
  overlayBox(0.5);
  const f = clamp(W / 28, 16, 24);
  text('GAME OVER', W / 2, H * 0.27, clamp(W / 10, 32, 72), '#ff5a6e', 'center');
  text(String(G.score), W / 2, H * 0.42, clamp(W / 8, 40, 90), '#ffffff', 'center');
  if (G.newBest) text('NEW BEST!', W / 2, H * 0.52, f * 1.3, '#ffe66d', 'center');
  else text('Best ' + best, W / 2, H * 0.52, f, 'rgba(255,230,109,0.8)', 'center');
  text('Stars ' + G.collected + '   \u2022   Smashed ' + G.kills + '   \u2022   Best combo ' + G.maxCombo, W / 2, H * 0.62, f * 0.9, 'rgba(255,255,255,0.75)', 'center');
  if (overT <= 0) {
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
    text(touchMode ? 'TAP TO RETRY' : 'SPACE OR CLICK TO RETRY', W / 2, H * 0.78, f * 1.2, '#7df9ff', 'center');
    ctx.globalAlpha = 1;
  }
}
function draw(t) {
  drawBg(t);
  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-1, 1) * G.shake * 14, rand(-1, 1) * G.shake * 14);
  for (const p of G.pows) {
    const c = POW[p.type].c, pulse = 1 + Math.sin(p.age * 6) * 0.1;
    const fade = p.life - p.age < 2 ? (Math.floor(p.age * 8) % 2 ? 0.4 : 1) : 1;
    ctx.globalAlpha = fade;
    ctx.shadowColor = c; ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(10,10,36,0.9)'; ctx.strokeStyle = c; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * pulse, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    text(POW[p.type].g, p.x, p.y + 1, 16, c, 'center');
    ctx.globalAlpha = 1;
  }
  for (const s of G.stars) {
    const pop = Math.min(1, s.age * 6), pulse = 1 + Math.sin(s.age * 6 + s.ph) * 0.1;
    const fade = s.life - s.age < 2 ? (Math.floor(s.age * 8) % 2 ? 0.4 : 1) : 1;
    ctx.globalAlpha = fade;
    ctx.shadowColor = s.gold ? '#ffe66d' : '#fff6a8'; ctx.shadowBlur = s.gold ? 20 : 12;
    starPath(s.x, s.y, s.r * pop * pulse, s.age * (s.gold ? 2 : 1));
    ctx.fillStyle = s.gold ? '#ffd23f' : '#fff6a8'; ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  for (const k of G.rocks) drawRock(k);
  if (state !== 'over') drawShip(t, state === 'menu');
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.parts) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  for (const tx of G.texts) { ctx.globalAlpha = clamp(tx.life * 1.5, 0, 1); text(tx.t, tx.x, tx.y, tx.size, tx.c, 'center'); }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (G.flash > 0) { ctx.fillStyle = 'rgba(' + G.flashC + ',' + (G.flash * 0.35) + ')'; ctx.fillRect(0, 0, W, H); }
  if (state === 'play' && G.slow > 0) { ctx.fillStyle = 'rgba(120,90,255,0.1)'; ctx.fillRect(0, 0, W, H); }
  if (state === 'play') drawHUD(t);
  if (state === 'menu') drawMenu(t);
  if (state === 'over') { drawHUD(t); drawOver(t); }
  if (paused && state === 'play') { overlayBox(0.55); text('PAUSED', W / 2, H / 2 - 10, 48, '#fff', 'center'); text('tap / press P to resume', W / 2, H / 2 + 34, 18, 'rgba(255,255,255,0.7)', 'center'); }
}

/* ---------- input ---------- */
window.addEventListener('keydown', e => {
  initAudio();
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) >= 0) ptr.active = false;
  if (e.code === 'Space' || e.code === 'Enter') {
    if (state === 'menu' || (state === 'over' && overT <= 0)) startGame();
    else if (state === 'play') { if (paused) paused = false; else tryDash(); }
  }
  if (e.code === 'KeyM') { muted = !muted; store.set('starhopper-muted', muted ? '1' : '0'); }
  if ((e.code === 'KeyP' || e.code === 'Escape') && state === 'play') paused = !paused;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') paused = true; });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

function setPtr(e) { ptr.x = e.clientX; ptr.y = e.clientY; }
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); initAudio();
  const x = e.clientX, y = e.clientY, m = muteBtn();
  if (Math.hypot(x - m.x, y - m.y) < m.r + 8) { muted = !muted; store.set('starhopper-muted', muted ? '1' : '0'); return; }
  if (e.pointerType === 'touch') touchMode = true;
  const isTouch = e.pointerType === 'touch';
  if (state !== 'play') {
    if (state === 'over' && overT > 0) return;
    startGame();
    ptr.active = true; ptr.touch = isTouch; ptr.id = e.pointerId; setPtr(e);
    return;
  }
  if (paused) { paused = false; return; }
  if (isTouch) {
    const b = dashBtn();
    if (Math.hypot(x - b.x, y - b.y) < b.r + 16) { tryDash(); return; }
    ptr.id = e.pointerId; ptr.active = true; ptr.touch = true; setPtr(e);
  } else {
    ptr.active = true; ptr.touch = false; setPtr(e); tryDash();
  }
});
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') { if (e.pointerId === ptr.id) setPtr(e); }
  else { ptr.active = true; ptr.touch = false; setPtr(e); }
});
function endPtr(e) { if (e.pointerType === 'touch' && e.pointerId === ptr.id) { ptr.active = false; ptr.id = null; } }
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  if (!paused) update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- test hooks (also handy for tinkering in the console) ---------- */
window.__game = {
  get state() { return state; }, get score() { return G.score; }, get lives() { return G.lives; },
  get combo() { return G.combo; }, get mult() { return G.mult; }, get kills() { return G.kills; },
  get shield() { return G.shield; }, get dashCd() { return P.dashCd; }, get paused() { return paused; },
  get stars() { return G.stars.length; }, get rocks() { return G.rocks.length; },
  get player() { return { x: P.x, y: P.y }; }, get size() { return { w: W, h: H }; },
  get best() { return best; },
  start() { startGame(); },
  peaceful(v) { debug.noSpawn = !!v; },
  clearRocks() { G.rocks.length = 0; },
  dropStar(dx, dy, gold) { spawnStar(P.x + (dx || 0), P.y + (dy || 0), gold); },
  dropRock(dx, dy) { G.rocks.push(makeRock(P.x + (dx || 0), P.y + (dy || 0), 0, 0, 22)); },
  givePower(t) { applyPower(t); },
  setLives(n) { G.lives = n; },
  clearInvuln() { P.inv = 0; }
};
})();
