'use strict';
// 三个独立真人上下文 + 独立观战房主：公开目录的订阅、权限、真实点击和清理。
const assert = require('node:assert/strict');
const { launch, state, snapshot } = require('./browser-helper');

const fields = ['code', 'mode', 'status', 'edition', 'hostName', 'playerCount', 'aiCount', 'humanCount', 'onlineCount', 'maxPlayers', 'spectatorCount', 'onlineSpectatorCount', 'canJoin', 'isMember'].sort();
const button = (page, code) => page.locator(`#roomList button[data-room-code="${code}"]`);
const EDITION_NAME = { v1: '一代', v2: '二代', mix: '混合' };
// 目录条目上的模式徽标（加入不需要选模式）
async function badgeOf(page, code, edition) {
  const badge = button(page, code).locator('xpath=ancestor::li').locator('.room-list-title .ed-badge');
  await badge.filter({ hasText: EDITION_NAME[edition] }).waitFor();
  assert.match(await badge.getAttribute('class'), new RegExp(`ed-${edition}`));
}
async function directory(page) {
  const rooms = await page.evaluate(() => window.__testMessages.findLast(message => message.type === 'roomList')?.rooms);
  assert(Array.isArray(rooms), '必须收到真实 roomList 数组');
  assert.equal(new Set(rooms.map(room => room.code)).size, rooms.length, '目录不能重复房间');
  for (const room of rooms) {
    assert.deepEqual(Object.keys(room).sort(), fields, '公开摘要仅含契约字段，不能有 token/pid/gameId/手牌');
    assert.match(room.code, /^[A-Z0-9]{4}$/);
    assert(['play', 'spectator'].includes(room.mode));
    assert(['lobby', 'playing', 'over'].includes(room.status));
    assert(['v1', 'v2', 'mix'].includes(room.edition), '目录条目必须带合法模式');
    assert.equal(typeof room.hostName, 'string');
    assert.equal(typeof room.canJoin, 'boolean');
    assert.equal(typeof room.isMember, 'boolean');
    for (const key of ['playerCount', 'aiCount', 'humanCount', 'onlineCount', 'maxPlayers', 'spectatorCount', 'onlineSpectatorCount']) {
      assert(Number.isSafeInteger(room[key]) && room[key] >= 0, `${key} 必须为非负整数`);
    }
    assert.equal(room.maxPlayers, 6);
    assert.equal(room.playerCount, room.aiCount + room.humanCount);
    assert(room.playerCount <= room.maxPlayers && room.onlineCount > 0, '只展示有在线成员的活跃房间');
    if (room.mode === 'spectator') {
      assert.equal(room.humanCount, 0);
      assert.equal(room.onlineCount, room.onlineSpectatorCount);
      assert(room.onlineSpectatorCount <= room.spectatorCount);
    } else {
      assert(room.onlineCount <= room.humanCount);
      assert.equal(room.spectatorCount + room.onlineSpectatorCount, 0);
    }
  }
  return rooms;
}
async function waitRoom(page, code, expected) {
  await page.waitForFunction(({ code, expected }) => {
    const rooms = window.__testMessages.findLast(message => message.type === 'roomList')?.rooms;
    const room = rooms?.find(room => room.code === code);
    return room && Object.entries(expected).every(([key, value]) => room[key] === value) && document.getElementById('roomList').getAttribute('aria-busy') === 'false';
  }, { code, expected });
  const rooms = await directory(page);
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, rooms.find(room => room.code === code)[key]])), expected);
  return rooms.find(room => room.code === code);
}
async function waitAbsent(page, code) {
  await page.waitForFunction(code => {
    const rooms = window.__testMessages.findLast(message => message.type === 'roomList')?.rooms;
    return Array.isArray(rooms) && !rooms.some(room => room.code === code) && !document.querySelector(`#roomList button[data-room-code="${code}"]`);
  }, code);
  assert(!(await directory(page)).some(room => room.code === code));
  assert.equal(await button(page, code).count(), 0, '房间必须从页面和名单同时移除');
}
async function sent(page, type) {
  return page.evaluate(type => window.__testSent.filter(message => message.type === type), type);
}
async function refresh(page) {
  const before = await page.evaluate(() => ({ sent: window.__testSent.filter(message => message.type === 'listRooms').length, received: window.__testMessages.filter(message => message.type === 'roomList').length }));
  await page.locator('#refreshRooms').click();
  await page.waitForFunction(before => window.__testMessages.filter(message => message.type === 'roomList').length > before && document.getElementById('roomList').getAttribute('aria-busy') === 'false', before.received);
  const requests = await sent(page, 'listRooms');
  assert.equal(requests.length, before.sent + 1, '刷新只发一次查询');
  assert.deepEqual(requests.at(-1), { type: 'listRooms' }, 'listRooms 无 payload');
  return directory(page);
}
async function readyHome(page, name) {
  // app.page 仅填写昵称；先完成真实 change/setName/hello，再取人工刷新基线。
  await page.locator('#nameInput').blur();
  await page.waitForFunction(name => window.__testIdentity?.name === name && window.__testMessages.some(message => message.type === 'roomList') && document.getElementById('roomList').getAttribute('aria-busy') === 'false', name);
}
async function leaveGame(page) {
  await page.locator('#leaveGame').click();
  await page.locator('#leaveGame').click();
  await page.locator('#home').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('room') && document.body.dataset.connection === 'ready');
}

(async () => {
  assert(!process.env.BASE, '目录测试只允许自建随机 loopback 后端，禁止对已有服务创建或加入房间');
  assert(process.env.ALLOW_REMOTE !== '1', '目录验收禁止授权远端请求');
  const app = await launch();
  const pages = [];
  let checkpoints = 0;
  try {
    const url = new URL(app.base);
    assert.equal(url.hostname, '127.0.0.1');
    assert(!['18160', '18161'].includes(url.port));
    const A = await app.page('目录桌面房主', { width: 1280, height: 820 }); pages.push(A);
    const B = await app.page('目录手机来客'); pages.push(B);
    const C = await app.page('目录第三位来客'); pages.push(C);
    assert.equal(new Set(pages.map(page => page.context())).size, 3, '真人身份必须在独立 context 中');
    for (const [page, name] of [[A, '目录桌面房主'], [B, '目录手机来客'], [C, '目录第三位来客']]) await readyHome(page, name);
    const identities = await Promise.all(pages.map(page => page.evaluate(() => window.__testIdentity.id)));
    assert.equal(new Set(identities).size, 3, '独立 context 必须收到不同的真实服务端身份');
    assert.deepEqual(await directory(B), []);
    assert.deepEqual(await refresh(B), []);
    assert.match(await B.locator('#roomListStatus').textContent(), /暂无在线房间/);
    checkpoints++;

    const initialQueriesB = (await sent(B, 'listRooms')).length;
    await A.locator('#createBtn').click();
    await A.locator('#lobby').waitFor({ state: 'visible' });
    const code = (await A.locator('#roomCode').textContent()).trim();
    assert.match(code, /^[A-Z0-9]{4}$/);
    await waitRoom(B, code, { mode: 'play', status: 'lobby', edition: 'v1', hostName: '目录桌面房主', playerCount: 1, aiCount: 0, humanCount: 1, onlineCount: 1, canJoin: true, isMember: false });
    assert.deepEqual((await sent(A, 'create')).at(-1), { type: 'create', edition: 'v1' }, '首页默认一代建房');
    await badgeOf(B, code, 'v1');
    // 房主在大厅切到二代：目录推送更新模式徽标
    await A.locator('#lobbyEdition [data-ed="v2"]').click();
    await waitRoom(B, code, { edition: 'v2', status: 'lobby' });
    await badgeOf(B, code, 'v2');
    assert.deepEqual((await sent(A, 'edition')).at(-1), { type: 'edition', edition: 'v2' });
    assert.equal((await sent(B, 'listRooms')).length, initialQueriesB, '建房必须自动推送，不靠刷新或轮询发现');
    assert.equal(await B.locator('#codeInput').inputValue(), '', '目录加入无需输入房间码');
    assert.equal(await button(B, code).isEnabled(), true);
    const home = await snapshot(B, app.out, 'directory-home');
    assert(home.scrollWidth <= home.width + 1, '手机目录不应横向溢出');
    checkpoints++;

    await button(B, code).click();
    await B.locator('#lobby').waitFor({ state: 'visible' });
    await A.waitForFunction(() => window.__testRoom?.seats.length === 2 && window.__testRoom.seats.every(seat => seat.online));
    const joinedA = await state(A), joinedB = await state(B);
    assert.equal(joinedB.room.code, code);
    assert.equal(joinedB.room.mode || 'play', 'play');
    const humanIds = joinedA.room.seats.map(seat => seat.pid);
    assert.deepEqual(humanIds, [joinedA.identity.id, joinedB.identity.id]);
    assert.equal(new Set(humanIds).size, 2, '一次加入不能产生重复席位');
    assert.deepEqual(await sent(B, 'join'), [{ type: 'join', code }], '真实目录点击只发一次 join');
    assert.equal(joinedB.room.edition, 'v2', '加入者收到房主选的模式');
    assert.equal(await B.locator('#lobbyEdition .on').getAttribute('data-ed'), 'v2');
    assert.equal(await B.locator('#lobbyEdition').getAttribute('aria-disabled'), '', '非房主只读');
    assert.equal(await B.locator('#codeInput').inputValue(), '');
    await waitRoom(C, code, { playerCount: 2, humanCount: 2, onlineCount: 2, canJoin: true, isMember: false });
    checkpoints++;

    await A.locator('#addAI').click();
    await A.waitForFunction(() => window.__testRoom?.seats.length === 3);
    await waitRoom(C, code, { playerCount: 3, humanCount: 2, aiCount: 1, onlineCount: 2 });
    await A.locator('#startBtn').click();
    for (const page of [A, B]) await page.locator('#game').waitFor({ state: 'visible' });
    await waitRoom(C, code, { mode: 'play', status: 'playing', edition: 'v2', playerCount: 3, humanCount: 2, aiCount: 1, onlineCount: 2, canJoin: false, isMember: false });
    await badgeOf(C, code, 'v2');
    assert.equal(await button(C, code).isDisabled(), true);
    const row = button(C, code).locator('xpath=ancestor::li');
    assert.match(await row.textContent(), /进行中/);
    assert.match(await row.textContent(), /暂不可加入/);
    assert.equal((await sent(C, 'join')).length, 0);
    assert.equal((await state(C)).game, undefined, '陌生人仅看到摘要，不能收到普通比赛快照');
    const ordinaryBefore = await state(A);
    assert.equal(ordinaryBefore.game.you, 0);
    assert.equal((await state(B)).game.you, 1);
    assert.equal(ordinaryBefore.game.snap.players.length, 3);
    assert.equal(ordinaryBefore.game.snap.edition, 'v2', '开局使用房间模式');
    const ordinaryGameId = ordinaryBefore.game.gameId;
    await refresh(C);
    const ordinaryAfter = await state(A);
    assert.equal(ordinaryAfter.game.gameId, ordinaryGameId, '目录刷新不能重开比赛');
    assert.deepEqual(ordinaryAfter.room.seats.map(seat => ({ pid: seat.pid, ai: seat.ai })), ordinaryBefore.room.seats.map(seat => ({ pid: seat.pid, ai: seat.ai })), '查询不能改变参赛席位');
    assert.equal(await A.locator('#game').isVisible(), true, 'roomList 推送不能切走正在玩的比赛');
    await snapshot(C, app.out, 'directory-playing');
    checkpoints++;

    const D = await app.page('目录全AI房主', { width: 1280, height: 820 }); pages.push(D);
    await readyHome(D, '目录全AI房主');
    assert.equal(new Set(pages.map(page => page.context())).size, 4);
    const beforeWatchQueries = (await sent(C, 'listRooms')).length;
    await D.locator('#watchCount [data-v="4"]').click();
    await D.locator('#editionSeg [data-ed="mix"]').click();
    await D.locator('#watchBtn').click();
    await D.waitForFunction(() => window.__testGame?.mode === 'spectator' && window.__testGame?.you === -1);
    const watch = await state(D), watchCode = watch.room.code, watchId = watch.game.gameId;
    assert.notEqual(watchCode, code);
    assert.equal(watch.room.mode, 'spectator');
    assert.equal(watch.room.seats.length, 4);
    assert(watch.room.seats.every(seat => seat.ai && seat.pid === null));
    assert(watch.game.snap.players.every(player => player.ai));
    assert.equal(watch.game.snap.edition, 'mix');
    await waitRoom(C, watchCode, { mode: 'spectator', status: 'playing', edition: 'mix', hostName: '目录全AI房主', playerCount: 4, aiCount: 4, humanCount: 0, onlineCount: 1, spectatorCount: 1, onlineSpectatorCount: 1, canJoin: true, isMember: false });
    assert.equal((await sent(C, 'listRooms')).length, beforeWatchQueries, '观战房自动推送');
    await badgeOf(C, watchCode, 'mix');
    assert.equal(await button(C, watchCode).isEnabled(), true);
    assert.equal((await button(C, watchCode).textContent()).trim(), '观看');
    assert.equal(await C.locator('#codeInput').inputValue(), '');
    const watchHome = await snapshot(C, app.out, 'directory-watch-home');
    assert(watchHome.scrollWidth <= watchHome.width + 1);
    checkpoints++;

    await button(C, watchCode).click();
    await C.waitForFunction(() => window.__testGame?.mode === 'spectator' && window.__testGame?.you === -1 && !document.getElementById('game').hidden);
    await D.waitForFunction(() => window.__testRoom?.spectators.length === 2 && window.__testRoom.spectators.every(spectator => spectator.online));
    const spectator = await state(C), unchangedWatch = await state(D);
    assert.equal(spectator.room.code, watchCode);
    assert.equal(spectator.game.gameId, watchId);
    assert.equal(spectator.game.you, -1);
    assert.equal(spectator.room.spectators.filter(member => member.id === spectator.identity.id && member.online).length, 1, '目录加入只增加一个在线观众成员');
    assert.equal(spectator.room.seats.some(seat => seat.pid === spectator.identity.id), false, '观众永远不能占参赛席位');
    assert.equal(spectator.game.deadlineIn, null);
    assert.equal(spectator.game.snap.players.length, 4);
    assert(spectator.game.snap.players.every(player => player.ai));
    assert.deepEqual(unchangedWatch.room.seats, watch.room.seats, '目录观众加入不能新增、替换或修改 AI 席位');
    assert.equal(unchangedWatch.game.gameId, watchId, '加入只恢复已有比赛，不能开新局');
    assert.deepEqual(await sent(C, 'join'), [{ type: 'join', code: watchCode }]);
    assert.equal(await C.locator('#autoBtn').isVisible(), false);
    assert.equal(await C.locator('#myTeam').textContent(), '');
    for (const page of [C, D]) assert.equal((await sent(page, 'act')).length + (await sent(page, 'auto')).length, 0);
    assert.equal((await state(A)).game.gameId, ordinaryGameId, '另一观战房不能影响普通对局');
    checkpoints++;

    await leaveGame(C);
    await waitRoom(C, watchCode, { spectatorCount: 1, onlineSpectatorCount: 1, onlineCount: 1, isMember: false });
    const beforeRemovalQueries = (await sent(C, 'listRooms')).length;
    await leaveGame(D);
    await waitAbsent(C, watchCode);
    assert.equal((await sent(C, 'listRooms')).length, beforeRemovalQueries, '最后观众离场后目录自动移除');
    await waitRoom(C, code, { mode: 'play', status: 'playing', onlineCount: 2, canJoin: false, isMember: false });
    const healthAfterWatch = await (await fetch(new URL('healthz', app.base))).json();
    assert.equal(healthAfterWatch.rooms, 1, '仅清理观战房，不能删除仍在线的普通房');
    checkpoints++;

    await leaveGame(B);
    await waitRoom(C, code, { onlineCount: 1, humanCount: 2, playerCount: 3, canJoin: false });
    await leaveGame(A);
    await waitAbsent(C, code);
    await C.waitForFunction(() => window.__testMessages.findLast(message => message.type === 'roomList')?.rooms.length === 0);
    assert.deepEqual(await directory(C), []);
    assert.equal(await C.locator('#roomList button[data-room-code]').count(), 0);
    assert.match(await C.locator('#roomListStatus').textContent(), /暂无在线房间/);
    assert.equal((await (await fetch(new URL('healthz', app.base))).json()).rooms, 0, '所有成员主动离开后清理全部测试房间');
    await snapshot(C, app.out, 'directory-empty');
    checkpoints++;

    for (const page of pages) {
      assert.deepEqual(await page.evaluate(() => window.__testMessages.filter(message => message.type === 'error')), [], '真实目录流程不应出现协议错误');
      for (const request of await sent(page, 'listRooms')) assert.deepEqual(request, { type: 'listRooms' });
    }
    // 本测试无刷新断线操作；取消、断线或资源失败均非预期，不能过滤冒充零错误。
    assert.equal(app.errors.length, 0, app.errors.join('\n'));
    console.log(`目录真实浏览器验收通过：${checkpoints} 项；4 独立 context、首次订阅/手动刷新/自动推送、免输码单次加入、进行中禁加入、4 AI 原局观战、在线计数及退出清理、目录模式徽标与大厅切换推送；act/auto 0，页面/资源/协议错误 0；截图 ${app.out}`);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
