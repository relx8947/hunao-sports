'use strict';
// 真实 Chromium + 本地静态入口 + 假 WebSocket，确定性验证前端异常路径。
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createHub } = require('../server/hub');
const { createServer } = require('../server');
const { Game } = require('../game/engine');
const { decide } = require('../game/ai');

(async () => {
  const hub = createHub(), server = createServer({ hub });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      window.__fakeMessages = [];
      window.WebSocket = class extends EventTarget {
        static OPEN = 1;
        constructor() {
          super(); this.readyState = 0; window.__fakeSocket = this;
          setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
        }
        send(raw) { window.__fakeMessages.push(JSON.parse(raw)); }
        close() { this.readyState = 3; this.onclose?.(); }
        emit(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    assert.equal(await page.locator('#quickBtn').isDisabled(), true);
    assert.equal(await page.locator('#createBtn').isDisabled(), true);
    assert.equal(await page.locator('#joinBtn').isDisabled(), true);
    const emit = message => page.evaluate(m => window.__fakeSocket.emit(m), message);
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: null });
    assert.equal(await page.locator('#quickBtn').isDisabled(), false);
    const room = { code: 'TEST', host: 'p0', status: 'playing', seats: [0, 1, 2].map(seat => ({ seat, pid: `p${seat}`, name: `玩家${seat}`, ai: false, online: true })) };
    await emit({ type: 'room', room });
    const game = new Game({ players: room.seats, seed: 73 });
    game.start();
    let guard = 0;
    while (game.phase === 'draft' && guard++ < 100) {
      const d = game.pending;
      game.answer(d.seat, d.id, decide(game, d, d.seat));
    }
    const pick = game.snapshot(0);
    assert.equal(pick.phase, 'pick');
    const gameId = 'frontend-test-game';
    const full = (snap, extra = {}) => emit({ type: 'game', gameId, you: 0, snap, full: true, events: [], auto: [false, false, false], speed: 1, deadlineIn: 45000, ...extra });
    await full(pick);
    await page.locator('#pickCards .pickable').first().waitFor();
    // 非 OPEN 时动作不应发送、锁定或展示成功。
    await page.evaluate(() => { window.__fakeSocket.readyState = 3; });
    await page.locator('#pickCards .pickable').first().click();
    assert.equal((await page.evaluate(() => window.__hn())).locked, false);
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'act').length), 0);
    await page.evaluate(() => { window.__fakeSocket.readyState = 1; });
    await page.locator('#pickCards .pickable').first().click();
    assert.equal((await page.evaluate(() => window.__hn())).locked, true);
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'act').length), 1);
    // 同 ID 的 full 与别人 done 都不是本人的提交确认。
    await full(pick);
    assert.equal((await page.evaluate(() => window.__hn())).locked, true);
    const otherDone = structuredClone(pick); otherDone.pending.done = [1]; otherDone.seq++;
    await full(otherDone);
    assert.equal((await page.evaluate(() => window.__hn())).locked, true);
    const mineDone = structuredClone(otherDone); mineDone.pending.done = [0, 1]; mineDone.seq++;
    await full(mineDone);
    assert.equal((await page.evaluate(() => window.__hn())).locked, false);
    assert.equal(await page.locator('#pickCards .pickable').count(), 0);

    const race = structuredClone(pick);
    race.phase = 'race'; race.raceNo = 1; race.curSeat = 0;
    race.racers = ['thirdwheel', 'legs', 'hare'].map((rid, seat) => ({ rid, seat, pos: seat ? 10 : 5, power: rid, eff: rid, out: false, finished: 0, tripped: false }));
    race.pending = { id: 100, seat: 0, kind: 'thirdwheel', title: '选择两人格', options: [{ v: 's10', label: '第10格' }, { v: '_no', label: '不使用' }] };
    race.seq = 100;
    await full(race);
    await page.locator('#trackSvg .cell.pick[data-p="10"]').waitFor();
    const timer = await page.locator('#dock .timer').evaluate(element => ({ width: element.getBoundingClientRect().width, parent: element.parentElement.getBoundingClientRect().width, transform: getComputedStyle(element).transform, remaining: element.getAttribute('aria-valuenow') }));
    assert(timer.width > timer.parent * 0.9, '减少动态时计时条不能立即归零');
    assert(Number(timer.remaining) > 40);
    assert.notEqual(await page.locator('#speedLabel').evaluate(e => getComputedStyle(e).display), 'none');
    for (const [width, height] of [[844, 390], [740, 360], [320, 740], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => document.getElementById('board').getBoundingClientRect().width > 180);
      assert.equal(await page.locator('#trackSvg .cell.pick[data-p="10"]').count(), 1, '旋转后选择绑定保留');
      const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, board: document.getElementById('board').getBoundingClientRect().width, areas: Object.fromEntries(['#game', '.stage', '.board-wrap', '.dock', '.side', '.topbar'].map(s => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return [s, { width: r.width, height: r.height, top: r.top }]; })) }));
      if (sizes.board <= 180) await page.screenshot({ path: `/tmp/hunao-frontend-${width}.png`, fullPage: true });
      assert(sizes.scroll <= sizes.width + 1, `横屏不能溢出：${JSON.stringify(sizes)}`);
      assert(sizes.board > 180, `${width}x${height} 赛道过小：${JSON.stringify(sizes)}`);
    }
    await page.locator('#trackSvg .cell.pick[data-p="10"]').click();
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'act').at(-1).value), 's10');
    await full(race);
    await emit({ type: 'error', for: 'act', msg: '重新选择', deadlineIn: 42000 });
    assert.equal((await page.evaluate(() => window.__hn())).locked, false);
    assert.equal(await page.locator('#trackSvg .cell.pick[data-p="10"]').count(), 1);

    // 让真实动画 await 悬挂，再用 full/lobby/left 中断，旧事件不能回写。
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const roll = { t: 'roll', rid: 'thirdwheel', value: 6, seq: 101 };
    await emit({ type: 'game', gameId, you: 0, snap: { ...race, seq: 101 }, full: false, events: [roll], auto: [], speed: 1, deadlineIn: 40000 });
    assert.equal((await page.evaluate(() => window.__hn())).playing, true);
    const replacement = structuredClone(race); replacement.racers[0].pos = 17; replacement.pending.id = 102; replacement.seq = 102;
    await full(replacement);
    await page.waitForTimeout(1200);
    assert.equal((await page.evaluate(() => window.__hn())).pending.id, 102);
    assert.equal(await page.locator('#diceZone').textContent(), '');
    await emit({ type: 'game', gameId, you: 0, snap: { ...replacement, seq: 103 }, full: false, events: [roll], auto: [], speed: 1, deadlineIn: 40000 });
    await emit({ type: 'room', room: { ...room, status: 'lobby' } });
    await emit({ type: 'lobby' });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#lobby').isVisible(), true);
    assert.equal((await page.evaluate(() => window.__hn())).pending, null);
    await full(replacement);
    await emit({ type: 'game', gameId, you: 0, snap: { ...replacement, seq: 104 }, full: false, events: [roll], auto: [], speed: 1, deadlineIn: 40000 });
    await emit({ type: 'left' });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#home').isVisible(), true);
    assert.equal((await page.evaluate(() => window.__hn())).playing, false);
    assert.equal(await page.locator('#tokens .token').count(), 0);

    // 过期房间或服务重启后，旧选人浮层不能继续遮住首页。
    await emit({ type: 'room', room });
    await full(pick);
    assert.equal(await page.locator('#overlay').isVisible(), true);
    await emit({ type: 'error', for: 'join', msg: '房间不存在' });
    assert.equal(await page.locator('#home').isVisible(), true);
    assert.equal(await page.locator('#overlay').isVisible(), false);
    assert.equal((await page.evaluate(() => window.__hn())).pending, null);
    await emit({ type: 'room', room });
    await full(pick);
    await page.evaluate(() => { window.__fakeSocket.close(); });
    await page.waitForFunction(() => window.__fakeSocket.readyState === 1);
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: null });
    assert.equal(await page.locator('#home').isVisible(), true);
    assert.equal(await page.locator('#overlay').isVisible(), false);
    assert.equal((await page.evaluate(() => window.__hn())).pending, null);

    // 复制后的技能在行动卡和玩家栏一致，结算房主移交即刷新重开入口。
    await emit({ type: 'room', room: { ...room, host: 'p1' } });
    const copied = structuredClone(race);
    copied.racers[0].rid = 'copycat'; copied.racers[0].power = 'copycat'; copied.racers[0].eff = 'legs';
    copied.pending = { id: 110, seat: 0, kind: 'roll', title: '掷骰子', options: [{ v: 'roll', label: '掷骰子' }] };
    copied.seq = 110;
    await full(copied);
    assert.match(await page.locator('#players .prow[data-seat="0"] .pline').textContent(), /迈大步/);
    assert.match(await page.locator('#turnCard .tc-skill').textContent(), /迈大步/);
    const ended = structuredClone(copied);
    ended.phase = 'over'; ended.pending = null; ended.champions = [0]; ended.seq = 111;
    await full(ended);
    assert.equal(await page.locator('#again').count(), 0);
    await emit({ type: 'room', room: { ...room, status: 'over', host: 'p0' } });
    assert.equal(await page.locator('#again').count(), 1);
    assert.equal(await page.locator('#dock [data-x="again"]').count(), 1);

    // 超时代选后的增量消息必须关闭旧孵蛋/双胞胎浮层。
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await emit({ type: 'room', room });
    for (const kind of ['egg', 'twin']) {
      const choosing = structuredClone(race);
      choosing.pending = { id: 120, seat: 0, kind, title: '选择技能', options: [{ v: 'legs', label: '大长腿' }] };
      choosing.seq = 120;
      await full(choosing);
      assert.equal((await page.evaluate(() => window.__hn())).overlayKind, 'choose');
      const expired = structuredClone(choosing);
      expired.pending = { id: 121, seat: 1, kind: 'roll', title: '玩家1掷骰', options: [] };
      expired.seq = 121;
      await emit({ type: 'game', gameId, you: 0, snap: expired, events: [{ t: 'transform', rid: 'thirdwheel', power: 'legs', seq: 121 }], full: false, auto: [], speed: 1, deadlineIn: null });
      await page.waitForFunction(() => !window.__hn().playing && window.__hn().pending.id === 121);
      await page.locator('#overlay').waitFor({ state: 'hidden' });
      assert.equal((await page.evaluate(() => window.__hn())).overlayKind, null);
    }

    // 最短横屏点数选择：每个数字都用普通用户点击验证。
    await page.setViewportSize({ width: 568, height: 320 });
    for (let value = 1; value <= 6; value++) {
      const genius = structuredClone(race);
      genius.pending = { id: 130 + value, seat: 0, kind: 'genius', title: '选择预言点数', options: Array.from({ length: 6 }, (_, i) => ({ v: String(i + 1), label: String(i + 1) })) };
      genius.seq = 130 + value;
      await full(genius);
      await page.locator(`#dock [data-v="${value}"]`).click();
      assert.deepEqual(await page.evaluate(() => {
        const m = window.__fakeMessages.filter(m => m.type === 'act').at(-1);
        return { gameId: m.gameId, id: m.id, value: m.value };
      }), { gameId, id: genius.pending.id, value: String(value) });
      await emit({ type: 'error', gameId, for: 'act', msg: '下一测试', deadlineIn: 40000 });
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // 打开规则时 Enter 只能激活弹窗按钮，不能误掷骰。
    await full(copied);
    const beforeEnter = await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'act').length);
    await page.locator('#game [data-open="rules"]').click();
    await page.locator('#mClose').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#modal').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'act').length), beforeEnter);

    // 同 decision ID 的新局必须允许新提交，旧局 ack/error 均不能解锁它。
    await full(copied, { gameId: 'new-frontend-game' });
    await page.locator('#dock .roll-btn').click();
    assert.equal((await page.evaluate(() => window.__hn())).locked, true);
    await emit({ type: 'ack', gameId, for: 'act', id: copied.pending.id, value: 'roll' });
    await emit({ type: 'error', gameId, for: 'act', msg: '旧局错误', deadlineIn: null });
    assert.equal((await page.evaluate(() => window.__hn())).locked, true);
    await emit({ type: 'error', gameId: 'new-frontend-game', for: 'act', msg: '当前局错误', deadlineIn: 40000 });
    assert.equal((await page.evaluate(() => window.__hn())).locked, false);

    // 线上旧后端升级前仍可操作；它没有 gameId，不能让新前端把所有动作拒绝掉。
    await full(copied, { gameId: undefined });
    await page.locator('#dock .roll-btn').click();
    const legacyAction = await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'act').at(-1));
    assert.equal(legacyAction.id, copied.pending.id);
    assert.equal(legacyAction.value, 'roll');
    assert.equal(Object.prototype.hasOwnProperty.call(legacyAction, 'gameId'), false);
    assert.equal((await page.evaluate(() => window.__hn())).locked, true);
    const legacyNext = structuredClone(copied);
    legacyNext.pending.id++; legacyNext.seq++;
    await full(legacyNext, { gameId: undefined });
    assert.equal((await page.evaluate(() => window.__hn())).locked, false);

    // 自动加入确认前断线，邀请目标仍保留，重连后继续尝试。
    await emit({ type: 'left' });
    await page.evaluate(() => {
      const url = new URL(location.href); url.searchParams.set('room', 'TEST'); history.replaceState(null, '', url);
      window.__fakeSocket.close();
    });
    await page.waitForFunction(() => window.__fakeSocket.readyState === 1);
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: null });
    const joinsBefore = await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').length);
    assert(joinsBefore > 0);
    await page.evaluate(() => window.__fakeSocket.close());
    await page.waitForFunction(() => window.__fakeSocket.readyState === 1);
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: null });
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').length), joinsBefore + 1);
    assert.equal(new URL(page.url()).searchParams.get('room'), 'TEST');
    await emit({ type: 'error', for: 'join', msg: '房间不存在' });
    assert.equal(new URL(page.url()).searchParams.get('room'), null);

    // 损坏的本地凭证可自愈，不能无限拿同一非法 token 重连。
    await emit({ type: 'error', for: 'hello', msg: '身份凭证无效' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hn_me')).token), undefined);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('前端回归通过：握手/断线提交/同时选择确认/减少动态计时/倍率/旋转选点/full-lobby-left动画取消');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    hub.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
