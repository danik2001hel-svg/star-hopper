// Star Hopper playtest: boots the game, plays it with real keyboard/mouse input,
// checks the core mechanics, and takes screenshots along the way.
module.exports = async ({ url, newPage, shot, assert, sleep, log }) => {
  const page = await newPage({ mobile: false });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url);
  await sleep(1200);
  assert(await page.evaluate(() => !!window.__game), 'game booted (window.__game exists)');
  assert(await page.evaluate(() => __game.state === 'menu'), 'starts on the menu');
  await shot(page, '1-menu');

  // --- start the game with SPACE ---
  await page.keyboard.press('Space');
  await sleep(300);
  await page.evaluate(() => { __game.peaceful(true); __game.clearRocks(); });
  assert(await page.evaluate(() => __game.state === 'play'), 'SPACE starts the game');
  assert(await page.evaluate(() => __game.lives === 3), 'start with 3 lives');

  // --- keyboard movement ---
  const x0 = await page.evaluate(() => __game.player.x);
  await page.keyboard.down('ArrowRight');
  await sleep(450);
  await page.keyboard.up('ArrowRight');
  const x1 = await page.evaluate(() => __game.player.x);
  log('moved right: ' + Math.round(x0) + ' -> ' + Math.round(x1));
  assert(x1 > x0 + 40, 'ArrowRight moves the ship right');

  // --- collecting a star scores + starts a combo ---
  const s0 = await page.evaluate(() => __game.score);
  await page.evaluate(() => __game.dropStar(0, 0, false));
  await sleep(200);
  const s1 = await page.evaluate(() => __game.score);
  assert(s1 > s0, 'collecting a star increases the score (' + s0 + ' -> ' + s1 + ')');
  assert(await page.evaluate(() => __game.combo >= 1), 'collecting a star starts a combo');

  // --- dash smashes a rock without losing a life ---
  await page.evaluate(() => __game.dropRock(85, 0));
  await sleep(50);
  await page.keyboard.press('Space');
  await sleep(350);
  assert(await page.evaluate(() => __game.kills === 1), 'dashing through a rock smashes it');
  assert(await page.evaluate(() => __game.lives === 3), 'smashing a rock costs no life');

  // --- getting hit costs a life ---
  await page.evaluate(() => { __game.clearInvuln(); __game.dropRock(0, 0); });
  await sleep(150);
  assert(await page.evaluate(() => __game.lives === 2), 'a rock hit costs a life');
  assert(await page.evaluate(() => __game.combo === 0), 'a hit resets the combo');
  await shot(page, '2-ouch');

  // --- shield absorbs a hit ---
  await page.evaluate(() => { __game.clearInvuln(); __game.givePower('shield'); });
  assert(await page.evaluate(() => __game.shield === true), 'shield power-up works');
  await page.evaluate(() => __game.dropRock(0, 0));
  await sleep(150);
  assert(await page.evaluate(() => __game.lives === 2 && __game.shield === false), 'shield absorbs one hit');

  // --- real play: spawning on, mouse steering, grabbing stars ---
  await page.evaluate(() => { __game.clearInvuln(); __game.setLives(3); __game.peaceful(false); __game.givePower('magnet'); __game.givePower('shield'); });
  const size = await page.evaluate(() => __game.size);
  const cx = size.w / 2, cy = size.h / 2, rad = Math.min(size.w, size.h) * 0.28;
  for (let i = 0; i < 26; i++) {
    const a = i * 0.45;
    await page.mouse.move(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    if (i % 3 === 0) await page.evaluate(([dx, dy]) => __game.dropStar(dx, dy, false), [Math.cos(a + 0.6) * 70, Math.sin(a + 0.6) * 70]);
    await sleep(230);
  }
  const mid = await page.evaluate(() => ({ state: __game.state, score: __game.score, combo: __game.combo, rocks: __game.rocks }));
  log('midgame: ' + JSON.stringify(mid));
  assert(mid.score > 0, 'score grows during real play');
  await shot(page, '3-midgame');

  // --- game over + retry ---
  await page.evaluate(() => { __game.setLives(1); __game.clearInvuln(); __game.dropRock(0, 0); });
  await sleep(350);
  assert(await page.evaluate(() => __game.state === 'over'), 'losing the last life ends the game');
  await shot(page, '4-gameover');
  await sleep(1000);
  await page.keyboard.press('Space');
  await sleep(300);
  assert(await page.evaluate(() => __game.state === 'play' && __game.score === 0 && __game.lives === 3), 'SPACE restarts with a fresh game');

  // --- phone layout ---
  const m = await newPage({ mobile: true });
  await m.goto(url);
  await sleep(1000);
  await shot(m, '5-mobile-menu');
  await m.evaluate(() => { __game.start(); __game.peaceful(true); });
  await sleep(400);
  await m.evaluate(() => { __game.dropStar(0, -120, true); __game.dropStar(60, -90, false); __game.dropRock(-110, -160); });
  await sleep(500);
  await shot(m, '6-mobile-play');
  assert(await m.evaluate(() => __game.state === 'play'), 'game runs on a phone-sized screen');

  assert(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
};
