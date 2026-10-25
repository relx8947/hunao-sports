'use strict';
// 二代 / 混合模式前端验收（真实 Chromium）：
//   A. 回放：服务端引擎全 AI 跑完若干局（种子覆盖全部二代事件与 13 张变数卡），逐批喂给页面，
//      每批都必须在时限内播完（不卡队列）；变数卡全部播完、不残留卡片；漩涡格 12 个、管道 6 条；
//      页面文字里没有 NaN / undefined；无页面错误、无「播放事件出错」。
//   B. 实战：真实服务端 + 真实点击，二代（手机竖屏）和混合（电脑）各打一整局到总结算。
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createHub } = require('../server/hub');
const { createServer } = require('../server');
const { Game } = require('../game/engine');
const { decide } = require('../game/ai');
const { TWISTS } = require('../game/racers');
const { launch, step, state, assertFinished, quickStart, clickTop } = require('./browser-helper');

// node /tmp 里按覆盖贪心挑出的种子：合起来覆盖全部二代事件、两种特殊格与 13 张变数卡
const REPLAY = (process.env.REPLAY_SEEDS || '3,41,13,23,32,6').split(',').map(Number);
const V2_KINDS = ['twist', 'coins', 'coin', 'monster', 'curse', 'fixedRoll', 'finale', 'cancel', 'voided', 'rolls', 'cheat', 'wolf', 'stack', 'hog', 'mate', 'control', 'whirl', 'bonkbug'];
const kindOf = (e) => (e.t === 'space' ? e.space : e.t);

function engineBatches(seed, edition) {
  const g = new Game({ players: [{ name: '本人', ai: false }, { name: '阿呆（AI）', ai: true }, { name: '小飞（AI）', ai: true }, { name: '豆豆（AI）', ai: true }], seed, edition });
  g.start();
  const batches = [{ events: g.drain(), snap: g.snapshot(0) }];
  for (let guard = 0; guard < 6000 && g.pending; guard++) {
    const d = g.pending;
    if (d.simul) {
      for (const s of d.seats) { if (g.pending !== d) break; g.answer(s, d.id, decide(g, { ...d, options: d.optionsBySeat[s] }, s)); }
    } else g.answer(d.seat, d.id, decide(g, d, d.seat));
    batches.push({ events: g.drain(), snap: g.snapshot(0) });
  }
  assert.equal(g.phase, 'over', `种子 ${seed} 必须跑完`);
  return batches;
}

async function replay(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    window.WebSocket = class extends EventTarget {
      static OPEN = 1;
      constructor() { super(); this.readyState = 0; window.__fakeSocket = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
      send() {}
      close() { this.readyState = 3; this.onclose?.(); }
      emit(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base, { waitUntil: 'load' });
  const emit = (message) => page.evaluate((m) => window.__fakeSocket.emit(m), message);
  await emit({ type: 'hello', token: 'b'.repeat(32), id: 'p0', name: '本人', room: null });
  const sent = {}, twistIds = new Set();
  const checked = { whirly: false, twisty: false };
  for (const seed of REPLAY) {
    const batches = engineBatches(seed, 'v2');
    const gameId = `replay-${seed}`;
    const before = (await page.evaluate(() => window.__hnV2().played));
    const mine = {};
    for (let i = 0; i < batches.length; i++) {
      const { events, snap } = batches[i];
      for (const e of events) { const k = kindOf(e); if (V2_KINDS.includes(k)) mine[k] = (mine[k] || 0) + 1; if (e.t === 'twist') twistIds.add(e.id); }
      await emit({ type: 'game', gameId, you: 0, snap, full: i === 0, events: i === 0 ? [] : events, auto: [false, false, false, false], speed: 8 });
      // 每批都必须播完：卡住就是动画没有正确结束或没被取消
      const t0 = Date.now();
      for (;;) {
        const v = await page.evaluate(() => { const h = window.__hn(); const nx = document.querySelector('#ovNext:not([disabled])'); if (nx && nx.offsetParent) nx.click(); return { playing: h.playing, queue: h.queue }; });
        if (!v.playing && !v.queue) break;
        assert(Date.now() - t0 < 25000, `种子 ${seed} 第 ${i} 批事件 25 秒内没播完：${events.map((e) => e.t).join(',')}`);
        await page.waitForTimeout(40);
      }
      const probe = await page.evaluate((track) => ({
        cards: document.querySelectorAll('.twist-card').length,
        bad: (document.body.innerText.match(/.{0,12}(NaN|undefined).{0,12}/) || [null])[0],
        marks: document.querySelectorAll('#trackSvg .twl-mark').length,
        pipes: document.querySelectorAll('#trackSvg .twl-pipe').length,
        sign: document.querySelectorAll('#trackSvg .twist-sign').length,
        board: !!track && !document.querySelector('.board-wrap').style.visibility,
      }), snap.track);
      assert.equal(probe.cards, 0, `种子 ${seed} 第 ${i} 批：变数卡播完后不能残留`);
      assert.equal(probe.bad, null, `种子 ${seed} 第 ${i} 批：页面出现 NaN/undefined：${probe.bad}`);
      if (snap.phase === 'race' && probe.board && snap.track === 'whirly') { assert.equal(probe.marks, 12, '漩涡乐园必须有 12 个漩涡角标'); assert.equal(probe.pipes, 6, '漩涡乐园必须有 6 条管道'); checked.whirly = true; }
      if (snap.phase === 'race' && probe.board && snap.track === 'twisty') { assert.equal(probe.sign, 1, '扭扭糖果必须有变数招牌'); assert.equal(probe.marks, 0); checked.twisty = true; }
      if (snap.phase === 'race' && snap.v2 && snap.v2.twistActive.length) {
        const chips = await page.evaluate(() => [...document.querySelectorAll('#v2Badges:not([hidden]) .v2-chip')].map((b) => b.dataset.tw));
        for (const id of snap.v2.twistActive) assert(chips.includes(id), `生效中的变数卡 ${id} 要有徽标`);
      }
    }
    const after = (await page.evaluate(() => window.__hnV2().played));
    for (const k of Object.keys(mine)) {
      assert.equal((after[k] || 0) - (before[k] || 0), mine[k], `种子 ${seed}：${k} 事件应全部由二代播放逻辑处理（收到 ${mine[k]}）`);
      sent[k] = (sent[k] || 0) + mine[k];
    }
  }
  for (const k of V2_KINDS) assert(sent[k] > 0, `回放种子应覆盖二代事件 ${k}`);
  assert.equal(twistIds.size, TWISTS.length, `回放应覆盖全部 ${TWISTS.length} 张变数卡`);
  assert(checked.whirly && checked.twisty, '两张二代赛道都必须检查到');
  // 徽标可点开说明
  assert.equal(errors.length, 0, `回放出现页面错误：\n${errors.join('\n')}`);
  await context.close();
  return sent;
}

async function realGame(app, label, viewport, edition) {
  const page = await app.page(label, viewport);
  await page.waitForTimeout(600);
  await quickStart(page, { ai: 3, edition });
  await clickTop(page, '#speedBtn');
  await clickTop(page, '#speedBtn');
  const started = Date.now(), limit = Number(process.env.MAX_MS || 600000);
  let final, n = 0, whirlChecked = false;
  while (Date.now() - started < limit) {
    const st = await state(page);
    if (st.final && st.visual.phase === 'over' && !st.visual.playing) { final = st; break; }
    if (n++ % 15 === 0) {
      // 以页面实际建好的棋盘为准（服务端快照可能已经领先于正在播放的画面）
      const p = await page.evaluate(() => ({ bad: (document.body.innerText.match(/.{0,12}(NaN|undefined).{0,12}/) || [null])[0], marks: document.querySelectorAll('#trackSvg .twl-mark').length, built: window.__hnV2().built }));
      assert.equal(p.bad, null, `${label}：页面出现 NaN/undefined：${p.bad}`);
      if (p.built && p.built.startsWith('whirly:')) { assert.equal(p.marks, 12, `${label}：漩涡格应为 12`); whirlChecked = true; }
    }
    if (!(await step(page))) await page.waitForTimeout(120);
  }
  assert(final, `${label}：${limit}ms 内必须打完四场`);
  assertFinished(final);
  assert.equal(final.game.snap.edition, edition);
  assert.equal(final.rejected.length, 0, `${label}：正常操作不应被拒绝`);
  const tw = await page.evaluate(() => ({ got: window.__testMessages.filter((m) => m.type === 'game').flatMap((m) => m.events || []).filter((e) => e.t === 'twist').length, played: window.__hnV2().played.twist || 0, cards: document.querySelectorAll('.twist-card').length }));
  assert(tw.got > 0, `${label}：整局应出现变数卡`);
  assert.equal(tw.played, tw.got, `${label}：收到的变数卡都要播放`);
  assert.equal(tw.cards, 0);
  assert(whirlChecked, `${label}：应检查到漩涡乐园`);
  console.log(`${label}：四场完赛，比分 ${final.game.snap.players.map((p) => p.score).join('/')}；变数卡 ${tw.got} 张；真人操作 ${final.accepted} 次`);
}

(async () => {
  // A. 回放
  const hub = createHub(), server = createServer({ hub });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    const sent = await replay(browser, `http://127.0.0.1:${server.address().port}/`);
    console.log(`回放通过：${REPLAY.length} 局，二代事件 ${Object.entries(sent).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    hub.dispose();
  }
  if (process.env.SKIP_REAL === '1') return;
  // B. 实战
  const app = await launch();
  try {
    await Promise.all([
      realGame(app, '二代手机', { width: 393, height: 852 }, 'v2'),
      realGame(app, '混合电脑', { width: 1440, height: 900 }, 'mix'),
    ]);
    assert.equal(app.errors.length, 0, `页面错误：\n${app.errors.join('\n')}`);
  } finally { await app.close(); }
  console.log('二代/混合前端验收通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
