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
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('播放事件出错')) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    assert.equal(await page.locator('#quickBtn').isDisabled(), true);
    assert.equal(await page.locator('#createBtn').isDisabled(), true);
    assert.equal(await page.locator('#joinBtn').isDisabled(), true);
    assert.equal(await page.locator('#watchBtn').isDisabled(), true);
    assert.equal(await page.locator('#refreshRooms').isDisabled(), true);
    assert.equal(await page.locator('#watchCount [data-v="4"]').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#spectatorStatus').isVisible(), false);
    // 「返回大厅」只在挂到桌游大厅的 /hunao/ 下出现（指向大厅首页）；根路径原入口不显示。
    assert.equal(await page.locator('#hallBack').isVisible(), false, '根路径不显示返回大厅');
    {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const mounted = /^http:\/\/127\.0\.0\.1:\d+\/hunao\//;
      await context.route(mounted, route => route.continue({ url: route.request().url().replace('/hunao/', '/') }));
      const hallPage = await context.newPage();
      hallPage.on('pageerror', error => errors.push(error.message));
      await hallPage.goto(`${origin}/hunao/`, { waitUntil: 'load' });
      const back = hallPage.locator('#hallBack');
      await back.waitFor({ state: 'visible' });
      assert.equal(await back.evaluate(a => a.href), `${origin}/`);
      assert.match(await back.textContent(), /返回大厅/);
      assert.equal(await back.locator('svg').count(), 1, '返回大厅用 SVG 图标');
      const box = await back.boundingBox();
      assert(box.height >= 44 && box.width >= 44, '返回大厅触控目标不小于 44px');
      assert.equal(await hallPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '返回大厅不造成横向溢出');
      await hallPage.close();
      await context.unroute(mounted);
    }
    const emit = message => page.evaluate(m => window.__fakeSocket.emit(m), message);
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: null });
    assert.equal(await page.locator('#quickBtn').isDisabled(), false);
    // 公开房间目录只订阅列表；首次 hello、返回首页及重连都请求一次，无常驻轮询。
    const listRequests = () => page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'listRooms').length);
    assert((await listRequests()) >= 1, '首页 ready 后应立即请求公开房间');
    assert.deepEqual(await page.evaluate(() => window.__fakeMessages.find(m => m.type === 'listRooms')), { type: 'listRooms' });
    assert.match(await page.locator('#roomListStatus').textContent(), /加载/);
    assert.equal(await page.locator('#roomListStatus').getAttribute('role'), 'status');
    await emit({ type: 'roomList', rooms: [] });
    assert.equal(await page.locator('#roomList button[data-room-code]').count(), 0);
    assert.match(await page.locator('#roomListStatus').textContent(), /暂无在线房间/);
    const beforeRefresh = await listRequests();
    await page.locator('#refreshRooms').click();
    assert.equal(await listRequests(), beforeRefresh + 1);
    assert.equal(await page.locator('#roomList').getAttribute('aria-busy'), 'true');
    const entry = (code, extra = {}) => ({ code, mode: 'play', status: 'lobby', edition: 'v1', hostName: '一起开赛', playerCount: 6, aiCount: 3, humanCount: 3, onlineCount: 3, maxPlayers: 6, spectatorCount: 0, onlineSpectatorCount: 0, canJoin: true, isMember: false, ...extra });
    const xssName = `<img src=x onerror="window.__roomXSS=1"> & " ' <script>window.__roomXSS=1</script>`;
    const directoryRows = [
      entry('WAIT', { hostName: '昵称很长也不会把手机屏幕挤到横向滚动的房主' }),
      entry('VIEW', { mode: 'spectator', status: 'playing', hostName: 'AI 观战房', playerCount: 4, aiCount: 4, humanCount: 0, onlineCount: 0, spectatorCount: 3, onlineSpectatorCount: 2 }),
      entry('BACK', { status: 'playing', isMember: true }),
      entry('BUSY', { status: 'playing', canJoin: false }),
      entry('DONE', { status: 'over', canJoin: false }),
      entry('FULL', { aiCount: 0, humanCount: 6, onlineCount: 6, canJoin: false }),
      entry('EVIL', { hostName: xssName }),
    ];
    const listButton = code => page.locator(`#roomList button[data-room-code="${code}"]`);
    // 首页一屏放不下全部房间时分页：先翻回第一页，再往后翻到目标房间所在页
    const showRoom = async code => {
      for (let i = 0; i < 30 && await page.locator('#roomPager [data-pg="-1"]:not([disabled])').count(); i++) await page.locator('#roomPager [data-pg="-1"]').click();
      for (let i = 0; i < 30 && !(await listButton(code).isVisible()) && await page.locator('#roomPager [data-pg="1"]:not([disabled])').count(); i++) await page.locator('#roomPager [data-pg="1"]').click();
      return listButton(code);
    };
    const publishDirectory = () => emit({ type: 'roomList', rooms: directoryRows });
    await emit({ type: 'roomList', rooms: [...directoryRows, entry('WAIT'), entry('BAD'), entry('TOOLONG'), entry('"<x>'), entry('bad!'), entry('BADM', { mode: '<img>' }), entry('BADS', { status: '<img>' }), null] });
    assert.equal(await page.locator('#roomList button[data-room-code]').count(), 7, '仅渲染合法且不重复的四位房间码');
    assert.match(await page.locator('#roomListStatus').textContent(), /当前 7 个公开房间/);
    assert.equal(await listButton('WAIT').textContent(), '加入');
    assert.equal(await listButton('VIEW').textContent(), '观看');
    assert.equal(await listButton('BACK').textContent(), '返回房间');
    assert.match(await listButton('WAIT').locator('..').textContent(), /替换 AI/);
    assert.match(await page.locator('#roomList .watch-room').textContent(), /真人 0 \/ AI 4[\s\S]*观众 3 人 · 2 人在线/);
    for (const code of ['BUSY', 'DONE', 'FULL']) assert.equal(await listButton(code).isDisabled(), true);
    assert.match(await listButton('BUSY').locator('..').textContent(), /比赛中，暂不可加入/);
    assert.match(await listButton('DONE').locator('..').textContent(), /已结束，暂不可加入/);
    assert.match(await listButton('FULL').locator('..').textContent(), /真人已满/);
    const xssHost = listButton('EVIL').locator('xpath=ancestor::li').locator('.room-list-host');
    assert.equal(await xssHost.textContent(), xssName);
    assert.equal(await xssHost.getAttribute('title'), xssName);
    assert.equal(await page.locator('#roomList img, #roomList script, #roomList [onerror]').count(), 0);
    assert.equal(await page.evaluate(() => window.__roomXSS), undefined);
    for (const [width, height] of [[320, 740], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, boxes: Array.from(document.querySelectorAll('.room-directory, #roomList, .room-list-item, .room-list-action, #roomList button, #refreshRooms')).map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, button: e.tagName === 'BUTTON' }; }) }));
      assert(geometry.scroll <= geometry.width + 1, `${width}x${height} 首页目录不得横向溢出：${JSON.stringify(geometry)}`);
      assert(geometry.boxes.every(r => r.left >= -1 && r.right <= geometry.width + 1), `${width}x${height} 目录控件越界`);
      assert(geometry.boxes.filter(r => r.button && r.height > 0).every(r => r.height >= 44), '房间与刷新按钮点击高度至少 44px');
      assert(geometry.scrollHeight <= geometry.viewportHeight + 1, `${width}x${height} 首页必须一屏放下，房间多了分页而不是纵向滚动`);
      assert(await page.locator('#roomPager').isVisible(), `${width}x${height} 房间放不下时必须显示分页`);
      assert.equal(await (await showRoom('EVIL')).isVisible(), true);
      if (process.env.HUNAO_FRONTEND_SCREENSHOTS) await page.screenshot({ path: `/tmp/hunao-room-directory-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const ordinaryAi = await page.locator('#aiCount .on').getAttribute('data-v');
    const watchAi = await page.locator('#watchCount .on').getAttribute('data-v');
    await page.locator('#nameInput').fill('大厅昵称');
    await (await showRoom('WAIT')).click();
    assert.deepEqual(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').at(-1)), { type: 'join', code: 'WAIT' });
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'setName').at(-1).name), '大厅昵称');
    assert.equal(await page.locator('#aiCount .on').getAttribute('data-v'), ordinaryAi);
    assert.equal(await page.locator('#watchCount .on').getAttribute('data-v'), watchAi);
    const beforeJoinError = await listRequests();
    await emit({ type: 'error', for: 'join', msg: '房间已开始比赛，请刷新大厅' });
    assert.equal(await page.locator('#home').isVisible(), true);
    assert.equal(await listRequests(), beforeJoinError + 1);
    assert.match(await page.locator('#roomListStatus').textContent(), /加载/);
    await publishDirectory();
    await (await showRoom('VIEW')).click();
    assert.deepEqual(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').at(-1)), { type: 'join', code: 'VIEW' });
    await (await showRoom('BACK')).click();
    assert.deepEqual(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').at(-1)), { type: 'join', code: 'BACK' });
    const beforeDisabledJoin = await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').length);
    await listButton('BUSY').evaluate(b => b.click());
    await listButton('WAIT').evaluate(b => { const code = b.dataset.roomCode; b.dataset.roomCode = '"<x>'; b.click(); b.dataset.roomCode = code; });
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').length), beforeDisabledJoin);
    const beforeReconnectList = await listRequests();
    await page.evaluate(() => window.__fakeSocket.close());
    assert.match(await page.locator('#roomListStatus').textContent(), /已离线.*上次列表/);
    assert.equal(await page.locator('#refreshRooms').isDisabled(), true);
    assert.equal(await page.locator('#roomList button[data-room-code]:not(:disabled)').count(), 0);
    assert.doesNotMatch(await page.locator('#roomList').textContent(), /人在线|实时更新/);
    await listButton('VIEW').evaluate(b => b.click());
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').length), beforeDisabledJoin);
    await page.waitForFunction(() => window.__fakeSocket.readyState === 1);
    assert.equal(await listButton('WAIT').isDisabled(), true, '新 socket 未 hello 时不可使用旧列表');
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: null });
    assert.equal(await listRequests(), beforeReconnectList + 1);
    assert.equal(await listButton('WAIT').isDisabled(), true, '重连后等待新的权威列表');
    await publishDirectory();
    assert.equal(await listButton('WAIT').isDisabled(), false);
    const beforeIdleList = await listRequests();
    await page.waitForTimeout(1200);
    assert.equal(await listRequests(), beforeIdleList, '无列表 interval 轮询');
    await page.locator('#nameInput').fill('本人');
    const room = { code: 'TEST', host: 'p0', status: 'playing', seats: [0, 1, 2].map(seat => ({ seat, pid: `p${seat}`, name: `玩家${seat}`, ai: false, online: true })) };
    await emit({ type: 'room', room });
    const lobbyBeforeDirectory = { ...room, status: 'lobby' };
    await emit({ type: 'room', room: lobbyBeforeDirectory });
    await publishDirectory();
    assert.equal(await page.locator('#lobby').isVisible(), true, 'roomList 不能将房间切回首页');
    assert.equal(new URL(page.url()).searchParams.get('room'), room.code);
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
    const activeBeforeList = await page.evaluate(() => window.__hn());
    const gameUrlBeforeList = page.url();
    const requestsBeforeGameList = await listRequests();
    await publishDirectory();
    assert.deepEqual(await page.evaluate(() => window.__hn()), activeBeforeList, '目录更新不能清当前 game、pending、队列或浮层');
    assert.equal(await page.locator('#game').isVisible(), true);
    assert.equal(await page.locator('#home').isVisible(), false);
    assert.equal(page.url(), gameUrlBeforeList);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1100);
    assert.equal(await listRequests(), requestsBeforeGameList, '隐藏页面不轮询房间列表');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
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

    // 独立观战入口：3–6 AI、默认 4、单独持久化，不改变真人的 AI 对手数。
    assert.equal(await page.locator('#watchBtn').isDisabled(), false);
    await page.locator('#watchBtn').click();
    assert.deepEqual(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'watch').at(-1)), { type: 'watch', ai: 4 });
    const aiBefore = await page.locator('#aiCount .on').getAttribute('data-v');
    for (const n of [3, 4, 5, 6]) {
      await page.locator(`#watchCount [data-v="${n}"]`).click();
      await page.locator('#watchBtn').click();
      assert.equal(await page.locator(`#watchCount [data-v="${n}"]`).getAttribute('aria-checked'), 'true');
      assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'watch').at(-1).ai), n);
      assert.equal(await page.locator('#aiCount .on').getAttribute('data-v'), aiBefore);
    }
    await page.locator('#watchCount [data-v="6"]').focus();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#watchCount .on').getAttribute('data-v'), '4');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hn_watch_ai'))), 4);
    const noOverflow = async (label, board = false) => {
      if (board) await page.waitForFunction(() => {
        const e = document.getElementById('board');
        return e.classList.contains('tall') === (innerHeight > innerWidth * 1.05 && innerWidth < 900) && e.getBoundingClientRect().width > 180;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, overflow: Array.from(document.querySelectorAll('#game .topbar, #game .top-actions, #game .races, #spectatorStatus, #spectatorLabel, #spectatorCode, #dock, .home-card')).filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, left: r.left, right: r.right }; }), board: document.getElementById('board').getBoundingClientRect().width }));
      assert(sizes.scroll <= sizes.width + 1, `${label} 页面溢出：${JSON.stringify(sizes)}`);
      assert(sizes.overflow.every(r => r.left >= -1 && r.right <= sizes.width + 1), `${label} 控件溢出：${JSON.stringify(sizes)}`);
      if (board) assert(sizes.board > 180, `${label} 赛道过小：${JSON.stringify(sizes)}`);
      if (await page.locator('#spectatorStatus').isVisible()) {
        const controls = await page.evaluate(() => [...document.querySelectorAll('#game .races, #spectatorLabel, #spectatorViewers, #spectatorCode, #game .top-actions')].filter(e => e.getClientRects().length).map(e => {
          const r = e.getBoundingClientRect(); return { id: e.id || e.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }));
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j];
          assert(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, `${label} 顶栏兄弟控件重叠：${JSON.stringify([a, b])}`);
        }
      }
    };
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height }); await noOverflow(`首页 ${width}x${height}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.HUNAO_FRONTEND_SCREENSHOTS) await page.screenshot({ path: '/tmp/hunao-spectator-home.png', fullPage: true });

    const spectatorRoom = { code: 'VIEW', mode: 'spectator', host: 'p0', status: 'playing', spectators: [{ id: 'p0', name: '本人', online: true }, { id: 'guest', name: '一起看', online: true }], seats: Array.from({ length: 4 }, (_, seat) => ({ seat, pid: `ai${seat}`, name: `AI选手${seat + 1}`, ai: true, online: true })) };
    const spectatorGame = new Game({ players: spectatorRoom.seats, seed: 20261023 });
    spectatorGame.start(); spectatorGame.drain();
    const spectatorId = 'spectator-frontend-game';
    const spectatorFull = (state, extra = {}) => full(state, { gameId: spectatorId, mode: 'spectator', you: -1, auto: [true, true, true, true], deadlineIn: null, ...extra });
    const playerActionCount = () => page.evaluate(() => window.__fakeMessages.filter(m => ['act', 'auto', 'emote'].includes(m.type)).length);
    const actionsBeforeWatch = await playerActionCount();
    let turnPings = 0;
    await page.exposeFunction('__spectatorTurnPing', () => { turnPings++; });
    await page.evaluate(() => { Sound.yourTurn = () => window.__spectatorTurnPing(); });
    await emit({ type: 'room', room: spectatorRoom });
    await spectatorFull(spectatorGame.snapshot(-1));
    assert.equal((await page.evaluate(() => window.__hn())).you, -1);
    assert.equal(await page.locator('#spectatorStatus').getAttribute('role'), 'status');
    assert.match(await page.locator('#spectatorStatus').textContent(), /正在观战 · 4名AI/);
    assert.match(await page.locator('#spectatorCode').textContent(), /VIEW/);
    assert.match(await page.locator('#spectatorViewers').textContent(), /2人观看/);
    assert.equal(await page.locator('#autoBtn').isVisible(), false);
    assert.equal(await page.locator('#emotes').isVisible(), false);
    assert.equal(await page.locator('#players .prow').count(), 4);
    assert.equal(await page.locator('#players .you, #players .me, #draftCards .pickable').count(), 0);
    assert.equal(await page.locator('#myTeam').textContent(), '');
    for (const width of [1001, 1024]) {
      await page.setViewportSize({ width, height: 900 }); await noOverflow(`窄桌面观战 ${width}x900`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.doesNotMatch(await page.locator('#draftSub').textContent(), /轮到你|点击选人/);
    await page.locator('#draftCards .rcard').first().click();
    assert.equal(await page.locator('#tip').isVisible(), true, '观众可以读卡但不能选人');
    await page.evaluate(() => { document.querySelector('#autoBtn').click(); document.querySelector('#emotes button').click(); });
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height }); await noOverflow(`观战选秀 ${width}x${height}`);
    }
    if (process.env.HUNAO_FRONTEND_SCREENSHOTS) await page.screenshot({ path: '/tmp/hunao-spectator-draft.png', fullPage: true });
    guard = 0;
    while (spectatorGame.phase === 'draft' && guard++ < 100) {
      const d = spectatorGame.pending; assert.equal(spectatorGame.answer(d.seat, d.id, decide(spectatorGame, d, d.seat)), null);
    }
    spectatorGame.drain();
    const spectatorPick = spectatorGame.snapshot(-1);
    assert.equal(spectatorPick.phase, 'pick');
    assert.deepEqual(spectatorPick.pending.optionsBySeat, {});
    await spectatorFull(spectatorPick);
    assert.equal(await page.locator('#pickCards, #overlay .pickable').count(), 0);
    assert.match(await page.locator('#dock').textContent(), /AI 正在暗选出战 · 0\/4/);
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height }); await noOverflow(`观战暗选 ${width}x${height}`, true);
    }
    const firstSeat = spectatorGame.pending.seats[0];
    assert.equal(spectatorGame.answer(firstSeat, spectatorGame.pending.id, decide(spectatorGame, spectatorGame.pending, firstSeat)), null);
    await spectatorFull(spectatorGame.snapshot(-1));
    assert.match(await page.locator('#dock').textContent(), /1\/4 已选好/);
    assert.equal(await page.locator('#players .think.ok').count(), 1);
    assert.equal(await page.locator('#tokens .token').count(), 0, '暗选不能提前展示出战 AI');
    if (process.env.HUNAO_FRONTEND_SCREENSHOTS) await page.screenshot({ path: '/tmp/hunao-spectator-pick.png', fullPage: true });
    for (const seat of spectatorGame.pending.seats.slice(1)) assert.equal(spectatorGame.answer(seat, spectatorGame.pending.id, decide(spectatorGame, spectatorGame.pending, seat)), null);
    const revealEvents = spectatorGame.drain(), spectatorRace = spectatorGame.snapshot(-1);
    assert(revealEvents.some(e => e.t === 'reveal'));
    // 权威快照已经进入 race，画面仍需先等待前一事件，再按 reveal 亮牌。
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await emit({ type: 'game', gameId: spectatorId, mode: 'spectator', you: -1, snap: spectatorRace, full: false, events: [{ t: 'info', text: '准备一起亮牌' }, ...revealEvents], auto: [], speed: 1, deadlineIn: null });
    assert.equal(await page.locator('#overlay .reveal-grid').count(), 0);
    await page.locator('#overlay .reveal-grid').waitFor();
    assert.equal(await page.locator('#overlay .reveal-grid .flip').count(), 4);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await spectatorFull(spectatorRace);
    for (const kind of ['roll', 'egg', 'twin', 'genius', 'thirdwheel']) {
      const state = structuredClone(spectatorRace);
      state.pending = { id: 900, seat: 0, kind, title: 'AI选手1正在决策', options: [] };
      await spectatorFull(state);
      assert.equal(await page.locator('#overlay .pickable, #dock [data-v], #trackSvg .cell.pick, #tokens .selectable').count(), 0);
      assert.equal(await page.locator('#overlay').isVisible(), false);
      assert.match(await page.locator('#dock').textContent(), /AI选手1/);
      await page.keyboard.press('Space'); await page.keyboard.press('Enter');
    }
    await spectatorFull(spectatorRace);
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => document.getElementById('board').getBoundingClientRect().width > 180);
      await noOverflow(`观战赛跑 ${width}x${height}`, true);
      assert.equal(await page.locator('#spectatorStatus').isVisible(), true);
      if (process.env.HUNAO_FRONTEND_SCREENSHOTS) await page.screenshot({ path: `/tmp/hunao-spectator-race-${width}.png`, fullPage: true });
    }
    // game.mode 独立标识观战也生效；6 AI 与长昵称不能挤爆顶栏。
    const sixRoom = { ...spectatorRoom, seats: Array.from({ length: 6 }, (_, seat) => ({ seat, pid: `ai${seat}`, name: `很响亮的AI选手名字${seat + 1}`, ai: true, online: true })) };
    const sixGame = new Game({ players: sixRoom.seats, seed: 99 }); sixGame.start();
    const modeOnlyRoom = structuredClone(sixRoom); delete modeOnlyRoom.mode;
    await emit({ type: 'room', room: modeOnlyRoom });
    await spectatorFull(sixGame.snapshot(-1));
    assert.equal((await page.evaluate(() => window.__hn())).you, -1);
    assert.match(await page.locator('#spectatorLabel').textContent(), /6名AI/);
    assert.equal(await page.locator('#players .prow').count(), 6);
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height }); await noOverflow(`6AI观战 ${width}x${height}`);
    }
    await emit({ type: 'room', room: spectatorRoom }); await spectatorFull(spectatorRace);
    // 房主离场移交后的权限即时生效；非房主不能改倍率。
    await emit({ type: 'room', room: { ...spectatorRoom, host: 'guest' } });
    assert.equal(await page.locator('#speedBtn').isDisabled(), true);
    const speedsBefore = await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'speed').length);
    await page.evaluate(() => document.querySelector('#speedBtn').click());
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'speed').length), speedsBefore);
    await emit({ type: 'room', room: spectatorRoom });
    await page.locator('#speedBtn').click();
    assert.equal(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'speed').length), speedsBefore + 1);

    assert.equal(await playerActionCount(), actionsBeforeWatch, '观战前后 act/auto/emote 数量不增加');
    // 同身份断线、页面刷新都从 -1 快照恢复，而非占用 AI 的席位。
    await page.evaluate(() => window.__fakeSocket.close());
    assert.equal(await page.locator('#watchBtn').isDisabled(), true);
    assert.match(await page.locator('#dock').textContent(), /观战连接已断开/);
    await page.waitForFunction(() => window.__fakeSocket.readyState === 1);
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: { code: 'VIEW' } });
    await emit({ type: 'room', room: spectatorRoom }); await spectatorFull(spectatorRace);
    assert.equal((await page.evaluate(() => window.__hn())).you, -1);
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.locator('#watchBtn').isDisabled(), true);
    assert.equal(await page.locator('#watchCount .on').getAttribute('data-v'), '4');
    await emit({ type: 'hello', token: 'a'.repeat(32), id: 'p0', name: '本人', room: { code: 'VIEW' } });
    await emit({ type: 'room', room: spectatorRoom }); await spectatorFull(spectatorRace);
    await page.evaluate(() => { Sound.yourTurn = () => window.__spectatorTurnPing(); });
    assert.equal(await page.locator('#pickCards').count(), 0);
    assert.equal(await page.locator('#spectatorStatus').isVisible(), true);
    // 把真实引擎四场流程逐批送入 fakeWS，所有 AI 决策、技能与结算走原动画链。
    let resultsSeen = 0;
    guard = 0;
    while (spectatorGame.pending && guard++ < 1200) {
      const d = spectatorGame.pending, seat = d.simul ? d.seats.find(s => d.answers[s] === undefined) : d.seat;
      assert.equal(spectatorGame.answer(seat, d.id, decide(spectatorGame, d, seat)), null);
      const events = spectatorGame.drain(); resultsSeen += events.filter(e => e.t === 'raceEnd').length;
      await emit({ type: 'game', gameId: spectatorId, mode: 'spectator', you: -1, snap: spectatorGame.snapshot(-1), full: false, events, auto: [], speed: 4, deadlineIn: null });
      await page.waitForFunction(() => !window.__hn().playing && !window.__hn().queue);
    }
    assert.equal(spectatorGame.phase, 'over'); assert.equal(resultsSeen, 4);
    // 最终动画 await 尚未收尾时移交房主：仅同步权限，不重建领奖台或重播庆祝。
    await emit({ type: 'room', room: { ...spectatorRoom, host: 'guest' } });
    await spectatorFull(spectatorRace);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { window.__oldFanfare = Sound.fanfare; window.__finalFanfares = 0; Sound.fanfare = () => { window.__finalFanfares++; }; });
    const finalState = spectatorGame.snapshot(-1);
    await emit({ type: 'game', gameId: spectatorId, mode: 'spectator', you: -1, snap: finalState, full: false, events: [{ t: 'gameOver', scores: finalState.players.map(p => ({ seat: p.seat, score: p.score })), champions: finalState.champions }], auto: [], speed: 1, deadlineIn: null });
    assert.equal((await page.evaluate(() => window.__hn())).playing, true);
    assert.match(await page.locator('#finalReplayControl').textContent(), /等房主/);
    await page.evaluate(() => { window.__finalPodium = document.querySelector('#overlay .podium'); });
    await emit({ type: 'room', room: { ...spectatorRoom, status: 'over' } });
    assert.equal(await page.locator('#again').textContent(), '再看一局');
    assert.equal(await page.evaluate(() => window.__finalPodium === document.querySelector('#overlay .podium')), true, '权限变化不能重建庆祝浮层');
    await page.waitForFunction(() => !window.__hn().playing && !window.__hn().queue);
    assert.equal(await page.locator('#dock [data-x="again"]').textContent(), '再看一局');
    assert.equal(await page.evaluate(() => window.__finalFanfares), 1, '房主移交不能重播庆祝音效');
    await page.evaluate(() => { Sound.fanfare = window.__oldFanfare; });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(turnPings, 0, '观众不能收到个人回合音效');
    assert.equal(await page.locator('#again').textContent(), '再看一局');
    assert.equal(await page.locator('#dock [data-x="again"]').textContent(), '再看一局');
    assert.equal(await page.locator('#players .prow').count(), 4);
    assert.equal(await page.locator('#myTeam').textContent(), '');
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height }); await noOverflow(`观战结算 ${width}x${height}`);
      assert(await page.locator('#again').isVisible());
    }
    await emit({ type: 'room', room: { ...spectatorRoom, status: 'over', host: 'guest' } });
    assert.equal(await page.locator('#again, #dock [data-x="again"]').count(), 0);
    assert.match(await page.locator('#dock').textContent(), /等房主/);
    await emit({ type: 'room', room: { ...spectatorRoom, status: 'over' } });
    await page.locator('#again').click();
    assert.deepEqual(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'replay').at(-1)), { type: 'replay' });
    assert.equal(await page.locator('#again').isDisabled(), true);
    await emit({ type: 'error', gameId: spectatorId, for: 'replay', msg: '最终动画还没结束，请稍后再试', retryIn: 500 });
    assert.equal(await page.locator('#again').isDisabled(), false);
    assert.equal(await page.locator('#dock [data-x="again"]').isDisabled(), false);
    await page.locator('#ovClose').click();
    await page.locator('#overlay').waitFor({ state: 'hidden' });
    await page.locator('#dock [data-x="again"]').click();
    assert.equal((await page.evaluate(() => window.__hn())).navigationPending, 'replay');
    const replayGame = new Game({ players: spectatorRoom.seats, seed: 120 }); replayGame.start();
    const replayId = 'spectator-replay-game';
    await emit({ type: 'room', room: spectatorRoom });
    await spectatorFull(replayGame.snapshot(-1), { gameId: replayId });
    assert.equal((await page.evaluate(() => window.__hn())).navigationPending, null);
    assert.equal((await page.evaluate(() => window.__hn())).gameId, replayId);
    assert.equal(await page.locator('#again').count(), 0);
    assert.equal(await page.locator('#players .prow').count(), 4);
    assert.match(await page.locator('#spectatorCode').textContent(), /VIEW/);
    // 重播之后，旧 gameId 的 full 不能把界面拉回旧局结算。
    await spectatorFull(spectatorGame.snapshot(-1));
    assert.equal((await page.evaluate(() => window.__hn())).gameId, replayId);
    assert.equal((await page.evaluate(() => window.__hn())).phase, 'draft');
    assert.equal(await playerActionCount(), 0, '刷新后观众未发送任何玩家动作');
    await emit({ type: 'left' });
    assert.equal(await page.locator('#spectatorStatus').isVisible(), false);
    assert.equal(await page.locator('#home').isVisible(), true);
    // 朋友通过既有 join 入口加入观战；身份过期会清理观战状态。
    await page.locator('#codeInput').fill('VIEW'); await page.locator('#joinBtn').click();
    assert.deepEqual(await page.evaluate(() => window.__fakeMessages.filter(m => m.type === 'join').at(-1)), { type: 'join', code: 'VIEW' });
    await emit({ type: 'room', room: { ...spectatorRoom, host: 'guest' } });
    await spectatorFull(spectatorPick, { gameId: 'spectator-join-game' });
    assert.equal(await page.locator('#pickCards').count(), 0);
    await emit({ type: 'error', for: 'join', msg: '房间不存在' });
    assert.equal(await page.locator('#spectatorStatus').isVisible(), false);
    assert.equal(await page.locator('#overlay').isVisible(), false);
    assert.equal((await page.evaluate(() => window.__hn())).mode, null);
    // 重新加入普通房间，个人操作、托管、选卡都仍然保留。
    await emit({ type: 'room', room }); await full(pick, { gameId: 'ordinary-after-spectator' });
    assert.equal(await page.locator('#spectatorStatus').isVisible(), false);
    assert.equal(await page.locator('#autoBtn').isVisible(), true);
    assert(await page.locator('#pickCards .pickable').count() > 0);
    assert.equal((await page.evaluate(() => window.__hn())).you, 0);
    await emit({ type: 'left' });
    assert(actionsBeforeWatch > 0);

    // 独立真实 WS 上下文：别人的建房/改名/加入/观战/离线，通过目录推送直接抵达首页。
    const liveContexts = [];
    try {
      // 不同角色独立存储 hn_me；同源多标签共享凭证仅用于刻意的同身份测试。
      for (let role = 0; role < 3; role++) liveContexts.push(await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }));
      const [ownerPage, directoryPage, watchOwnerPage] = await Promise.all(liveContexts.map(context => context.newPage()));
      for (const p of [ownerPage, directoryPage, watchOwnerPage]) p.on('pageerror', error => errors.push(error.message));
      const liveUrl = `http://127.0.0.1:${server.address().port}/`;
      await Promise.all([ownerPage.goto(liveUrl), directoryPage.goto(liveUrl), watchOwnerPage.goto(liveUrl)]);
      await Promise.all([ownerPage, directoryPage, watchOwnerPage].map(p => p.waitForFunction(() => document.body.dataset.connection === 'ready')));
      await directoryPage.locator('#roomListStatus').filter({ hasText: '暂无在线房间' }).waitFor();
      await ownerPage.locator('#nameInput').fill('公开大厅房主');
      await ownerPage.locator('#createBtn').click();
      await ownerPage.locator('#lobby').waitFor({ state: 'visible' });
      const publicCode = (await ownerPage.locator('#roomCode').textContent()).trim();
      const publicButton = directoryPage.locator(`#roomList button[data-room-code="${publicCode}"]`);
      await publicButton.waitFor();
      assert.equal(await publicButton.textContent(), '加入');
      assert.equal(await directoryPage.locator('#home').isVisible(), true);
      const publicRow = publicButton.locator('xpath=ancestor::li');
      assert.match(await publicRow.textContent(), /公开大厅房主/);
      // 同昵称输入保持首页，收到 setName 的 hello 也只能刷新目录。
      await directoryPage.locator('#nameInput').fill('目录来客'); await directoryPage.locator('#nameInput').blur();
      await publicButton.click();
      await directoryPage.locator('#lobby').waitFor({ state: 'visible' });
      assert.equal((await directoryPage.locator('#roomCode').textContent()).trim(), publicCode);
      assert.equal(await ownerPage.locator('#seats .seat:not(.empty)').count(), 2);
      await directoryPage.locator('#leaveLobby').click();
      await directoryPage.locator('#home').waitFor({ state: 'visible' });
      await publicButton.waitFor();
      // 无人在线的暂停房间不再展示，首页无需手动刷新。
      await ownerPage.close();
      await publicButton.waitFor({ state: 'detached' });
      await directoryPage.locator('#roomListStatus').filter({ hasText: '暂无在线房间' }).waitFor();
      await watchOwnerPage.locator('#watchBtn').click();
      await watchOwnerPage.locator('#game').waitFor({ state: 'visible' });
      const watchCode = (await watchOwnerPage.locator('#spectatorCode').textContent()).match(/[A-Z0-9]{4}/)[0];
      const watchDirectoryButton = directoryPage.locator(`#roomList button[data-room-code="${watchCode}"]`);
      await watchDirectoryButton.waitFor();
      assert.equal(await watchDirectoryButton.textContent(), '观看');
      const watchingBeforeList = await watchOwnerPage.evaluate(() => window.__hn());
      await directoryPage.locator('#refreshRooms').click();
      await directoryPage.locator('#roomList[aria-busy="false"]').waitFor();
      const watchingAfterList = await watchOwnerPage.evaluate(() => window.__hn());
      assert.equal(watchingAfterList.gameId, watchingBeforeList.gameId);
      assert.equal(watchingAfterList.mode, 'spectator');
      assert.equal(await watchOwnerPage.locator('#game').isVisible(), true);
      await watchDirectoryButton.click();
      await directoryPage.locator('#spectatorStatus').waitFor({ state: 'visible' });
      assert.equal((await directoryPage.evaluate(() => window.__hn())).you, -1);
      assert.equal((await directoryPage.evaluate(() => window.__hn())).mode, 'spectator');
      assert.match(await directoryPage.locator('#spectatorCode').textContent(), new RegExp(watchCode));
      assert.equal(await directoryPage.locator('#pickCards, #overlay .pickable, #draftCards .pickable').count(), 0);
    } finally { await Promise.all(liveContexts.map(context => context.close())); }

    // 损坏的本地凭证可自愈，不能无限拿同一非法 token 重连。
    await emit({ type: 'error', for: 'hello', msg: '身份凭证无效' });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hn_me')).token), undefined);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('前端回归通过：/hunao/ 下显示返回大厅且根路径隐藏/公开房间首次订阅/手动刷新/空与多房间/合法code/XSS字面显示/加入与观看与返回/满席与进行中禁用/失败刷新/断线旧列表禁用与重连刷新/隐藏无轮询/活动game隔离/真实WS建房加入离线推送与AI观战 + 普通模式原回归 + 观战3–6AI/独立人数/选秀暗选无个人操作/按序亮牌/真实四场技能与结算/房主移交/replay与retry/旧gameId隔离/断线刷新恢复/320、390、844x390、568x320无溢出');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    hub.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
