'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { createServer } = require('../server');
const { createHub } = require('../server/hub');

function bounded(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超过 3 秒仍未完成`)), 3000);
  })]).finally(() => clearTimeout(timer));
}
function trackedHub() {
  const timers = new Set(), intervals = new Set();
  const hub = createHub({ random: () => 0.1,
    setTimeout(fn, delay) {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay);
      timers.add(timer); return timer;
    },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    setInterval(fn, delay) { const timer = setInterval(fn, delay); intervals.add(timer); return timer; },
    clearInterval(timer) { intervals.delete(timer); clearInterval(timer); },
  });
  return { hub, timers, intervals };
}

function clockHub() {
  let time = 1000000, next = 0;
  const timers = new Map(), intervals = new Map();
  const hub = createHub({ now: () => time, random: () => 0.3,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = ++next; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  return { hub, timers, intervals, now: () => time, tick(ms) { time += ms; }, runNext() {
    const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
    if (!task) return false;
    timers.delete(id); time = Math.max(time, task.at); task.fn(); return true;
  } };
}
function spectatorSnapshot(game, n) {
  assert.equal(game.mode, 'spectator'); assert.equal(game.you, -1); assert.equal(game.deadlineIn, null);
  assert.equal(game.snap.players.length, n); assert(game.snap.players.every(p => p.ai));
  const d = game.snap.pending;
  if (d) {
    assert(!Object.hasOwn(d, 'answers'));
    if (d.simul) assert.deepEqual(d.optionsBySeat, {});
    else assert.deepEqual(d.options, []);
  }
}

(async () => {
  const hub = createHub({ random: () => 0.1 }), server = createServer({ hub });
  const sockets = [];
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (pathname, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, res => {
      const buffers = [];
      res.on('data', b => buffers.push(b));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(buffers).toString() }));
    });
    req.on('error', reject); req.end();
  });
  const open = async (targetPort = port) => {
    const ws = new WebSocket(`ws://127.0.0.1:${targetPort}/ws`);
    sockets.push(ws);
    ws.messages = [];
    ws.on('message', raw => { ws.messages.push(JSON.parse(raw)); ws.onMessage?.(); });
    ws.on('error', () => {});
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return ws;
  };
  const wait = (ws, predicate) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.onMessage = null; reject(new Error(`消息等待超时：${JSON.stringify(ws.messages)}`)); }, 5000);
    const check = () => {
      const index = ws.messages.findIndex(predicate);
      if (index < 0) return;
      const [message] = ws.messages.splice(index, 1);
      clearTimeout(timer); ws.onMessage = null; resolve(message);
    };
    ws.onMessage = check; check();
  });
  const command = (ws, type, payload = {}) => ws.send(JSON.stringify({ type, ...payload }));
  let checks = 0;
  try {
    for (const pathname of ['/', '/app.js', '/style.css', '/racers-data.js', '/healthz', '/room-preview']) {
      const response = await request(pathname);
      assert.equal(response.status, 200, pathname);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert(response.body.length > 0); checks++;
    }
    {
      // /racers-data.js：原有全局保持一代内容（前端默认模式不变），二代/混合数据走新增全局
      const vm = require('node:vm');
      const ctx = { window: {} };
      vm.runInNewContext((await request('/racers-data.js')).body, ctx);
      const w = ctx.window;
      assert.equal(w.RACERS.length, 36); assert(w.RACERS.every(r => r.edition === 1));
      assert.deepEqual(Object.keys(w.TRACKS), ['mild', 'wild']);
      assert.deepEqual(Array.from(w.SCHEDULE), ['mild', 'wild', 'mild', 'wild']);
      assert.equal(w.TRACKS.wild.spaces[16].n, -4);
      assert.equal(w.RACERS_ALL.length, 72); assert.equal(w.TWISTS.length, 13);
      assert.deepEqual(Object.keys(w.TRACKS_ALL), ['mild', 'wild', 'twisty', 'whirly']);
      assert.deepEqual(Object.keys(w.EDITIONS), ['v1', 'v2', 'mix']); assert.equal(w.DEFAULT_EDITION, 'v1');
      assert.equal(w.TRACKS_ALL.twisty.twistAt, 14); assert.equal(w.TRACKS_ALL.whirly.whirls.length, 6);
      checks++;
    }
    const head = await request('/app.js', 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body, ''); assert(Number(head.headers['content-length']) > 0); checks++;
    const post = await request('/healthz', 'POST');
    assert.equal(post.status, 405); assert.equal(post.headers.allow, 'GET, HEAD'); checks++;
    for (const [pathname, status] of [['/%E0%A4%A', 400], ['/%00', 400], ['/../server.js', 403], ['/%2e%2e/server.js', 403], ['/%5c..%5cserver.js', 403], ['/missing.js', 404]]) {
      assert.equal((await request(pathname)).status, status, pathname); checks++;
    }
    const ws = await open();
    command(ws, 'create'); assert.equal((await wait(ws, m => m.type === 'error')).for, 'create'); checks++;
    command(ws, 'hello', { name: '协议测试' });
    const identity = await wait(ws, m => m.type === 'hello');
    assert.equal(identity.room, null);
    for (const raw of ['not json', 'null', '[]', '{"type":"auto","on":"true"}', '{"type":"quick","ai":2.5}', '{"type":"removeAI","seat":-1}']) {
      ws.send(raw); const error = await wait(ws, m => m.type === 'error');
      assert.equal(error.deadlineIn, null); checks++;
    }
    command(ws, 'quick', { ai: 2 });
    const game = await wait(ws, m => m.type === 'game');
    assert.equal(game.snap.phase, 'draft'); assert.equal(game.full, true);
    assert.match(game.gameId, /^[a-f0-9-]{36}$/);
    assert.equal(game.snap.pending.seat, game.you);
    const value = game.snap.pending.options[0].v;
    for (const gameId of [undefined, null, '', 1, {}, 'x'.repeat(65), `${game.gameId}x`]) {
      command(ws, 'act', { gameId, id: game.snap.pending.id, value });
      const recovered = await wait(ws, m => m.type === 'game' && m.full);
      const error = await wait(ws, m => m.type === 'error' && m.for === 'act');
      assert.equal(recovered.gameId, game.gameId);
      assert.equal(error.gameId, game.gameId);
      assert.equal(error.decisionId, game.snap.pending.id);
      assert.deepEqual(recovered.snap, game.snap, '缺失/非法/旧 gameId 不能修改对局');
      assert(!ws.messages.some(m => m.type === 'ack')); checks++;
    }
    command(ws, 'act', { gameId: game.gameId, id: 0, value });
    const recovered = await wait(ws, m => m.type === 'game' && m.full);
    const error = await wait(ws, m => m.type === 'error' && m.for === 'act');
    assert.equal(recovered.snap.pending.id, game.snap.pending.id);
    assert.equal(error.gameId, game.gameId);
    assert.equal(error.decisionId, recovered.snap.pending.id); checks++;
    const oldAct = { gameId: game.gameId, id: game.snap.pending.id, value };
    command(ws, 'act', oldAct);
    assert.deepEqual(await wait(ws, m => m.type === 'ack'), { type: 'ack', for: 'act', ...oldAct }); checks++;
    const tab = await open();
    command(tab, 'hello', { token: identity.token });
    await wait(tab, m => m.type === 'hello' && m.id === identity.id);
    await wait(tab, m => m.type === 'game' && m.full && m.gameId === game.gameId);
    command(ws, 'quick', { ai: 2 });
    const newGame = await wait(ws, m => m.type === 'game' && m.full && m.gameId !== oldAct.gameId);
    await wait(tab, m => m.type === 'game' && m.full && m.gameId === newGame.gameId);
    assert.equal(newGame.snap.pending.id, oldAct.id, '明确复用局内决策 id');
    assert(newGame.snap.pending.options.some(o => o.v === oldAct.value));
    command(tab, 'act', oldAct);
    const newRecovered = await wait(tab, m => m.type === 'game' && m.full && m.gameId === newGame.gameId);
    const staleError = await wait(tab, m => m.type === 'error' && m.for === 'act');
    assert.deepEqual(newRecovered.snap, newGame.snap);
    assert.equal(staleError.gameId, newGame.gameId);
    assert.equal(staleError.decisionId, newGame.snap.pending.id);
    assert(!tab.messages.some(m => m.type === 'ack')); checks++;
    const currentAct = { gameId: newGame.gameId, id: newGame.snap.pending.id, value: newGame.snap.pending.options[0].v };
    command(tab, 'act', currentAct);
    assert.deepEqual(await wait(tab, m => m.type === 'ack'), { type: 'ack', for: 'act', ...currentAct }); checks++;
    const second = await open();
    command(second, 'hello', { name: '另一个身份' });
    const other = await wait(second, m => m.type === 'hello');
    command(ws, 'hello', { token: other.token });
    const switched = await wait(ws, m => m.type === 'hello' && m.id === other.id);
    assert.equal(switched.room, null); checks++;
    ws.send(Buffer.from('binary'));
    assert.match((await wait(ws, m => m.type === 'error')).msg, /文本/); checks++;
    const large = await open();
    const closed = new Promise(resolve => large.once('close', resolve));
    large.send('x'.repeat(17 * 1024));
    await closed;
    assert.equal((await request('/healthz')).status, 200, '超长帧不能终止服务'); checks++;
    console.log(`HTTP/WebSocket 回归通过：${checks} 项`);
  } finally {
    for (const ws of sockets) ws.terminate();
    await new Promise(resolve => server.close(resolve));
    hub.dispose();
  }
  // 真正通过本地临时端口的 WebSocket 请求观战；仅 AI 的 schedule 使用可推进时钟。
  const clock = clockHub(), watchingServer = createServer({ hub: clock.hub });
  const watchers = [];
  let spectatorChecks = 0;
  try {
    await new Promise(resolve => watchingServer.listen(0, '127.0.0.1', resolve));
    const watchingPort = watchingServer.address().port;
    const A = await open(watchingPort); watchers.push(A);
    command(A, 'hello', { name: '观战房主' });
    const identity = await wait(A, m => m.type === 'hello');
    for (const ai of [null, 2, 7, 3.5, '4', false, [], {}]) {
      command(A, 'watch', { ai });
      const error = await wait(A, m => m.type === 'error' && m.for === 'watch');
      assert.equal(error.gameId, null); assert.equal(error.deadlineIn, null);
      assert.equal(clock.hub.rooms.size, 0); spectatorChecks++;
    }
    let room, game;
    for (const n of [3, 6, 4]) {
      command(A, 'watch', n === 4 ? {} : { ai: n });
      game = await wait(A, m => m.type === 'game' && m.full);
      spectatorSnapshot(game, n);
      const summary = (await wait(A, m => m.type === 'room' && m.room.status === 'playing')).room;
      assert.equal(summary.mode, 'spectator'); assert.equal(summary.host, identity.id);
      assert.deepEqual(summary.spectators, [{ id: identity.id, name: '观战房主', online: true }]);
      assert(summary.seats.every(s => s.ai && s.pid === null));
      assert(!JSON.stringify(summary).includes(identity.token));
      room = clock.hub.rooms.get(summary.code);
      assert.equal(clock.hub.rooms.size, 1);
      A.messages.length = 0; spectatorChecks++;
    }
    const sameGame = game.gameId, beforeInvalid = JSON.stringify(room.game.snapshot(-1));
    const oldTouched = room.touched, oldPlayerTouched = [...watchingServer.wss.clients][0].player.touched;
    clock.tick(100);
    for (const ai of [2, 7, null, '6']) {
      command(A, 'watch', { ai });
      const error = await wait(A, m => m.type === 'error' && m.for === 'watch');
      assert.equal(error.gameId, sameGame);
      assert.equal(room.touched, oldTouched);
      assert.equal([...watchingServer.wss.clients][0].player.touched, oldPlayerTouched);
      assert.equal(clock.hub.rooms.size, 1);
      assert.equal(JSON.stringify(room.game.snapshot(-1)), beforeInvalid); spectatorChecks++;
    }
    // 房主也是观众；合法决策字段不能借 act/auto/emote 接管任何 AI。
    const d = room.game.pending, before = JSON.stringify(room.game.snapshot(-1)), seats = structuredClone(room.seats);
    for (const [type, payload] of [
      ['act', { gameId: room.gameId, id: d.id, value: d.options[0].v }],
      ['auto', { on: true }], ['auto', { on: false }], ['emote', { key: '好耶' }],
      ['addAI', {}], ['removeAI', { seat: 0 }], ['start', {}], ['lobby', {}],
    ]) {
      command(A, type, payload);
      const error = await wait(A, m => m.type === 'error' && m.for === type);
      assert.match(error.msg, /观众|观战/);
      assert.equal(error.gameId, sameGame); assert.equal(error.deadlineIn, null);
      if (type === 'act') spectatorSnapshot(await wait(A, m => m.type === 'game' && m.full), 4);
      assert.equal(JSON.stringify(room.game.snapshot(-1)), before);
      assert.deepEqual(room.seats, seats);
      assert(!A.messages.some(m => m.type === 'ack')); spectatorChecks++;
    }
    const B = await open(watchingPort); watchers.push(B);
    command(B, 'hello', { name: '第二名观众' });
    const secondIdentity = await wait(B, m => m.type === 'hello');
    command(B, 'join', { code: room.code });
    spectatorSnapshot(await wait(B, m => m.type === 'game' && m.full), 4);
    const joined = (await wait(B, m => m.type === 'room' && m.room.spectators.length === 2)).room;
    assert.deepEqual(joined.spectators.map(p => p.id), [identity.id, secondIdentity.id]);
    assert.equal(room.seats.length, 4); assert(room.seats.every(s => s.ai)); spectatorChecks++;
    for (const type of ['speed', 'replay']) {
      command(B, type);
      assert.match((await wait(B, m => m.type === 'error' && m.for === type)).msg, /只有房主/);
      spectatorChecks++;
    }
    command(B, 'setName', { name: '改名后的观众' });
    const renamed = (await wait(A, m => m.type === 'room' && m.room.spectators.some(p => p.name === '改名后的观众'))).room;
    assert(!JSON.stringify(renamed).includes(secondIdentity.token));
    await wait(B, m => m.type === 'hello' && m.name === '改名后的观众'); spectatorChecks++;
    const tab = await open(watchingPort); watchers.push(tab);
    command(tab, 'hello', { token: identity.token });
    assert.equal((await wait(tab, m => m.type === 'hello')).room, room.code);
    spectatorSnapshot(await wait(tab, m => m.type === 'game' && m.full), 4);
    assert.equal(room.spectators.size, 2); spectatorChecks++;
    command(A, 'speed');
    assert.equal((await wait(tab, m => m.type === 'speed')).speed, 1.5);
    assert.equal((await wait(B, m => m.type === 'speed')).deadlineIn, null);
    await wait(A, m => m.type === 'speed'); spectatorChecks++;
    // 关闭一个同身份标签不移交房主；全部关闭才移交其他在线观众。
    let serverSocket = [...watchingServer.wss.clients].find(ws => ws.player?.id === identity.id);
    let closedOnServer = once(serverSocket, 'close'); A.terminate(); await closedOnServer;
    assert.equal(room.host, identity.id); assert.equal(clock.timers.size, 1);
    serverSocket = [...watchingServer.wss.clients].find(ws => ws.player?.id === identity.id);
    closedOnServer = once(serverSocket, 'close'); tab.terminate(); await closedOnServer;
    await wait(B, m => m.type === 'room' && m.room.host === secondIdentity.id && !m.room.spectators.find(p => p.id === identity.id).online);
    assert.equal(room.spectators.size, 2); spectatorChecks++;
    command(B, 'speed'); await wait(B, m => m.type === 'speed' && m.speed === 2.2);
    serverSocket = [...watchingServer.wss.clients].find(ws => ws.player?.id === secondIdentity.id);
    closedOnServer = once(serverSocket, 'close'); B.terminate(); await closedOnServer;
    const paused = JSON.stringify(room.game.snapshot(-1));
    assert.equal(room.clients.size, 0); assert.equal(clock.timers.size, 0);
    clock.tick(60000); assert.equal(clock.runNext(), false);
    assert.equal(JSON.stringify(room.game.snapshot(-1)), paused); spectatorChecks++;
    const reconnect = await open(watchingPort); watchers.push(reconnect);
    command(reconnect, 'hello', { token: identity.token });
    assert.equal((await wait(reconnect, m => m.type === 'hello')).room, room.code);
    const restored = await wait(reconnect, m => m.type === 'game' && m.full);
    assert.equal(restored.gameId, sameGame); spectatorSnapshot(restored, 4);
    assert.equal(room.host, identity.id); assert.equal(clock.timers.size, 1); spectatorChecks++;
    reconnect.messages.length = 0;
    let steps = 0;
    while (room.game.pending && steps++ < 3000) {
      assert(clock.runNext(), '只有服务端计时调度推进全 AI 对局');
      const update = await wait(reconnect, m => m.type === 'game');
      spectatorSnapshot(update, 4);
      assert.equal(update.gameId, sameGame);
      assert(!reconnect.messages.some(m => m.type === 'ack'));
    }
    assert.equal(room.status, 'over'); assert.equal(room.game.results.length, 4);
    assert(room.game.snapshot(-1).players.some(p => p.score > 0)); spectatorChecks++;
    command(reconnect, 'replay');
    const gate = await wait(reconnect, m => m.type === 'error' && m.for === 'replay');
    assert.match(gate.msg, /动画/);
    assert.equal(gate.retryIn, Math.ceil(room.busyUntil - clock.now()));
    assert(gate.retryIn > 0); assert.equal(gate.gameId, sameGame); assert.equal(gate.deadlineIn, null); spectatorChecks++;
    clock.tick(room.busyUntil - clock.now());
    command(reconnect, 'replay');
    const nextGame = await wait(reconnect, m => m.type === 'game' && m.full && m.gameId !== sameGame);
    spectatorSnapshot(nextGame, 4);
    assert.equal(nextGame.snap.phase, 'draft'); assert.equal(nextGame.snap.results.length, 0);
    assert(nextGame.snap.players.every(p => p.score === 0 && p.chips.length === 0 && p.used.length === 0));
    assert.deepEqual(room.seats, seats); assert.equal(clock.hub.rooms.get(room.code), room);
    assert(clock.runNext());
    assert((await wait(reconnect, m => m.type === 'game')).snap.players.some(p => p.hand.length > 0)); spectatorChecks++;
    const secondTab = await open(watchingPort); watchers.push(secondTab);
    command(secondTab, 'hello', { token: identity.token });
    await wait(secondTab, m => m.type === 'hello');
    spectatorSnapshot(await wait(secondTab, m => m.type === 'game' && m.full), 4);
    command(reconnect, 'leave');
    assert.equal((await wait(reconnect, m => m.type === 'left')).reason, 'leave');
    assert.equal((await wait(secondTab, m => m.type === 'left')).reason, 'leave');
    assert(!room.spectators.has(identity.id));
    assert.equal(room.clients.size, 0); assert.equal(clock.timers.size, 0);
    assert.equal(room.host, secondIdentity.id, '剩余离线成员保留房间和房主'); spectatorChecks++;
    const returningB = await open(watchingPort); watchers.push(returningB);
    command(returningB, 'hello', { token: secondIdentity.token });
    assert.equal((await wait(returningB, m => m.type === 'hello')).room, room.code);
    spectatorSnapshot(await wait(returningB, m => m.type === 'game' && m.full), 4);
    command(returningB, 'leave'); await wait(returningB, m => m.type === 'left');
    assert(!clock.hub.rooms.has(room.code)); assert.equal(room.spectators.size, 0);
    assert.equal(clock.timers.size, 0); spectatorChecks++;
    command(returningB, 'watch', { ai: 3 });
    const expiringGame = await wait(returningB, m => m.type === 'game' && m.full);
    spectatorSnapshot(expiringGame, 3);
    const expiring = [...clock.hub.rooms.values()][0];
    const player = [...watchingServer.wss.clients].find(ws => ws.player?.id === secondIdentity.id).player;
    serverSocket = [...watchingServer.wss.clients].find(ws => ws.player === player);
    closedOnServer = once(serverSocket, 'close'); returningB.terminate(); await closedOnServer;
    clock.tick(30 * 60 * 1000); clock.hub.cleanup();
    assert.equal(clock.hub.rooms.size, 0); assert.equal(player.room, null);
    assert.equal(expiring.spectators.size, 0); assert.equal(clock.timers.size, 0);
    const expired = await open(watchingPort); watchers.push(expired);
    command(expired, 'hello', { token: secondIdentity.token });
    assert.equal((await wait(expired, m => m.type === 'hello')).room, null);
    command(expired, 'speed');
    const noRoom = await wait(expired, m => m.type === 'error' && m.for === 'speed');
    assert.equal(noRoom.gameId, null); assert.equal(noRoom.deadlineIn, null); spectatorChecks++;
    console.log(`AI 观战 WebSocket 回归通过：${spectatorChecks} 项；实际 ${steps} 次计时调度完成四场，观众 ack 0；replay/多标签/断线暂停/过期均通过`);
  } finally {
    for (const ws of watchers) ws.terminate();
    await bounded(new Promise(resolve => watchingServer.close(resolve)), '关闭隔离观战服务器');
    clock.hub.dispose();
    assert.equal(clock.timers.size, 0); assert.equal(clock.intervals.size, 0);
  }
  // 公开目录走真实 WebSocket：只在房间摘要变化时推送，不通过轮询或游戏广播取目录。
  const directoryClock = clockHub(), directoryServer = createServer({ hub: directoryClock.hub });
  const directorySockets = [];
  let directoryChecks = 0;
  const directoryKeys = ['code', 'mode', 'status', 'edition', 'hostName', 'playerCount', 'aiCount', 'humanCount', 'onlineCount', 'maxPlayers', 'spectatorCount', 'onlineSpectatorCount', 'canJoin', 'isMember'].sort();
  const list = (ws, predicate = () => true) => wait(ws, m => m.type === 'roomList' && predicate(m.rooms));
  const refreshList = ws => {
    // 丢弃本轮请求前缓存的目录推送；直接断言之后的第一条目录，不能用内容过滤掩盖错误响应。
    ws.messages = ws.messages.filter(m => m.type !== 'roomList');
    command(ws, 'listRooms');
    return list(ws);
  };
  const listRoom = (ws, code, predicate = () => true) => list(ws, rooms => rooms.some(r => r.code === code && predicate(r)));
  const summary = (message, code) => message.rooms.find(r => r.code === code);
  const directoryOpen = async () => {
    const ws = await open(directoryServer.address().port); directorySockets.push(ws); return ws;
  };
  const directoryClose = async ws => {
    const serverSocket = [...directoryServer.wss.clients].find(s => s.player?.id === ws.identity?.id && s.player.sockets.has(s) && s.readyState === WebSocket.OPEN);
    // 同身份标签用客户端本地端口与服务端远端端口一一对应。
    const exactSocket = [...directoryServer.wss.clients].find(s => s._socket?.remotePort === ws._socket?.localPort) || serverSocket;
    assert(exactSocket, '关闭的是当前标签对应的服务端连接');
    const closed = once(exactSocket, 'close'); ws.terminate(); await bounded(closed, '目录标签关闭');
  };
  try {
    await new Promise(resolve => directoryServer.listen(0, '127.0.0.1', resolve));
    const home = await directoryOpen();
    command(home, 'listRooms');
    assert.match((await wait(home, m => m.type === 'error' && m.for === 'listRooms')).msg, /先连接/);
    assert.equal(directoryClock.hub.rooms.size, 0); directoryChecks++;
    command(home, 'hello', { name: '目录首页' });
    home.identity = await wait(home, m => m.type === 'hello');
    assert.deepEqual(await refreshList(home), { type: 'roomList', rooms: [] }); directoryChecks++;
    const homeServerSocket = [...directoryServer.wss.clients][0];
    const homeTouched = homeServerSocket.player.touched;
    directoryClock.tick(1000);
    for (const payload of [{ code: 'ABCD' }, { payload: null }, { rooms: [] }]) {
      command(home, 'listRooms', payload);
      assert.match((await wait(home, m => m.type === 'error' && m.for === 'listRooms')).msg, /参数/);
      assert.equal(homeServerSocket.player.touched, homeTouched);
      assert.equal(homeServerSocket.player.room, null); directoryChecks++;
    }
    const homeTab = await directoryOpen();
    command(homeTab, 'hello', { token: home.identity.token });
    homeTab.identity = await wait(homeTab, m => m.type === 'hello');
    const host = await directoryOpen();
    command(host, 'hello', { name: '目录房主' });
    host.identity = await wait(host, m => m.type === 'hello');
    command(host, 'create');
    const room = (await wait(host, m => m.type === 'room')).room;
    const created = summary(await listRoom(home, room.code), room.code);
    assert.deepEqual(created, { code: room.code, mode: 'play', status: 'lobby', edition: 'v1', hostName: '目录房主',
      playerCount: 1, aiCount: 0, humanCount: 1, onlineCount: 1, maxPlayers: 6,
      spectatorCount: 0, onlineSpectatorCount: 0, canJoin: true, isMember: false });
    assert(!homeTab.messages.some(m => m.type === 'roomList'), '请求目录不扩散到同身份其他标签'); directoryChecks++;
    command(host, 'setName', { name: '公开房间新名字' });
    assert.equal(summary(await listRoom(home, room.code, r => r.hostName === '公开房间新名字'), room.code).hostName, '公开房间新名字');
    await wait(host, m => m.type === 'hello' && m.name === '公开房间新名字'); directoryChecks++;
    for (let i = 1; i <= 5; i++) {
      command(host, 'addAI');
      const withAI = summary(await listRoom(home, room.code, r => r.aiCount === i), room.code);
      assert.equal(withAI.playerCount, i + 1); assert.equal(withAI.canJoin, true); directoryChecks++;
    }
    const members = [];
    for (let i = 0; i < 5; i++) {
      const member = await directoryOpen(); members.push(member);
      command(member, 'hello', { name: `目录真人${i + 1}` });
      member.identity = await wait(member, m => m.type === 'hello');
      command(member, 'join', { code: room.code });
      await wait(member, m => m.type === 'room' && m.room.code === room.code);
      const joined = summary(await listRoom(home, room.code, r => r.humanCount === i + 2), room.code);
      assert.equal(joined.playerCount, 6); assert.equal(joined.aiCount, 4 - i);
      assert.equal(joined.canJoin, i < 4, '最后一名 AI 被替换后新成员不能加入'); directoryChecks++;
    }
    command(home, 'join', { code: room.code });
    assert.match((await wait(home, m => m.type === 'error' && m.for === 'join')).msg, /房间已满/);
    assert.equal(homeServerSocket.player.room, null);
    const ownFull = summary(await refreshList(host), room.code);
    assert.equal(ownFull.isMember, true); assert.equal(ownFull.canJoin, true); directoryChecks++;
    assert(summary(await refreshList(homeTab), room.code));
    command(host, 'start');
    const started = await wait(host, m => m.type === 'game' && m.full);
    const active = directoryClock.hub.rooms.get(room.code);
    assert.equal(summary(await listRoom(home, room.code, r => r.status === 'playing'), room.code).canJoin, false);
    assert.equal(summary(await listRoom(homeTab, room.code, r => r.status === 'playing'), room.code).canJoin, false);
    assert.equal(summary(await listRoom(host, room.code, r => r.status === 'playing'), room.code).canJoin, true);
    command(home, 'join', { code: room.code });
    assert.match((await wait(home, m => m.type === 'error' && m.for === 'join')).msg, /已经开始/); directoryChecks++;
    const serverHost = [...directoryServer.wss.clients].find(s => s.player?.id === host.identity.id);
    const beforeRead = { touched: active.touched, playerTouched: serverHost.player.touched,
      timer: active.timer, version: active.scheduleVersion, deadline: active.deadline,
      timing: active.timing, due: JSON.stringify([...active.timing.due]),
      game: JSON.stringify(active.game), pending: active.game.pending, gameId: active.gameId,
      clients: [...active.clients], seats: structuredClone(active.seats), room: serverHost.room,
      busyUntil: active.busyUntil, timers: [...directoryClock.timers] };
    directoryClock.tick(2500);
    const read = await refreshList(host);
    assert.equal(summary(read, room.code).status, 'playing');
    assert.equal(summary(read, room.code).isMember, true);
    assert.equal(active.touched, beforeRead.touched); assert.equal(serverHost.player.touched, beforeRead.playerTouched);
    assert.equal(active.timer, beforeRead.timer); assert.equal(active.scheduleVersion, beforeRead.version);
    assert.equal(active.deadline, beforeRead.deadline); assert.equal(active.timing, beforeRead.timing);
    assert.equal(JSON.stringify([...active.timing.due]), beforeRead.due);
    assert.equal(JSON.stringify(active.game), beforeRead.game); assert.equal(active.game.pending, beforeRead.pending);
    assert.equal(active.gameId, started.gameId); assert.equal(active.gameId, beforeRead.gameId);
    assert.deepEqual([...active.clients], beforeRead.clients); assert.deepEqual(active.seats, beforeRead.seats);
    assert.equal(serverHost.room, beforeRead.room); assert.equal(active.busyUntil, beforeRead.busyUntil);
    assert.deepEqual([...directoryClock.timers], beforeRead.timers); directoryChecks++;
    command(members[0], 'leave'); await wait(members[0], m => m.type === 'left');
    await listRoom(home, room.code, r => r.onlineCount === 5);
    const returning = summary(await refreshList(members[0]), room.code);
    assert.equal(returning.isMember, true); assert.equal(returning.canJoin, true);
    command(members[0], 'join', { code: room.code });
    const restoredMember = await wait(members[0], m => m.type === 'game' && m.full);
    assert.equal(restoredMember.gameId, started.gameId); assert.equal(restoredMember.you, 1);
    await listRoom(home, room.code, r => r.onlineCount === 6); directoryChecks++;
    // 断线只降低唯一身份在线数；无人在线则隐藏，成员/参赛席仍保留以便重连。
    await directoryClose(host);
    assert.equal(summary(await listRoom(home, room.code, r => r.onlineCount === 5), room.code).hostName, '目录真人1'); directoryChecks++;
    for (const member of members) await directoryClose(member);
    await list(home, rooms => rooms.length === 0);
    assert.equal(active.seats.length, 6); assert.equal(active.clients.size, 0);
    assert.equal(directoryClock.timers.size, 0); directoryChecks++;
    const pausedTouched = active.touched, pausedGame = JSON.stringify(active.game);
    directoryClock.tick(30 * 60 * 1000);
    assert.deepEqual(await refreshList(home), { type: 'roomList', rooms: [] });
    assert.equal(active.touched, pausedTouched); assert.equal(JSON.stringify(active.game), pausedGame);
    directoryClock.hub.cleanup();
    await list(home, rooms => rooms.length === 0);
    assert(!directoryClock.hub.rooms.has(room.code));
    command(home, 'join', { code: room.code });
    assert.match((await wait(home, m => m.type === 'error' && m.for === 'join')).msg, /不存在/); directoryChecks++;
    home.messages.length = 0; homeTab.messages.length = 0;
    const watcher = await directoryOpen();
    command(watcher, 'hello', { name: '目录观战房主' });
    watcher.identity = await wait(watcher, m => m.type === 'hello');
    command(watcher, 'watch', { ai: 3 });
    spectatorSnapshot(await wait(watcher, m => m.type === 'game' && m.full), 3);
    const watched = [...directoryClock.hub.rooms.values()][0];
    const watching = summary(await listRoom(home, watched.code, r => r.status === 'playing'), watched.code);
    assert.equal(watching.mode, 'spectator'); assert.equal(watching.canJoin, true);
    assert.equal(watching.playerCount, 3); assert.equal(watching.humanCount, 0);
    assert.equal(watching.spectatorCount, 1); assert.equal(watching.onlineSpectatorCount, 1); directoryChecks++;
    const guest = await directoryOpen();
    command(guest, 'hello', { name: '目录一键观战' }); guest.identity = await wait(guest, m => m.type === 'hello');
    command(guest, 'join', { code: watched.code });
    spectatorSnapshot(await wait(guest, m => m.type === 'game' && m.full), 3);
    const watchedSeats = structuredClone(watched.seats);
    assert.equal(summary(await listRoom(home, watched.code, r => r.spectatorCount === 2), watched.code).onlineSpectatorCount, 2);
    assert(watched.seats.every(s => s.ai)); directoryChecks++;
    const guestTab = await directoryOpen(); command(guestTab, 'hello', { token: guest.identity.token });
    guestTab.identity = await wait(guestTab, m => m.type === 'hello');
    spectatorSnapshot(await wait(guestTab, m => m.type === 'game' && m.full), 3);
    const samePerson = summary(await listRoom(home, watched.code, r => r.spectatorCount === 2), watched.code);
    assert.equal(samePerson.onlineCount, 2); assert.equal(samePerson.onlineSpectatorCount, 2);
    assert.deepEqual(watched.seats, watchedSeats);
    assert(!guestTab.messages.some(m => m.type === 'roomList')); directoryChecks++;
    command(watcher, 'setName', { name: '公开观战新房主名' });
    await wait(watcher, m => m.type === 'hello' && m.name === '公开观战新房主名');
    await listRoom(home, watched.code, r => r.hostName === '公开观战新房主名'); directoryChecks++;
    home.messages.length = 0; homeTab.messages.length = 0;
    let steps = 0;
    while (watched.game.pending && steps++ < 3000) assert(directoryClock.runNext());
    assert.equal(watched.status, 'over');
    const finished = summary(await listRoom(home, watched.code, r => r.status === 'over'), watched.code);
    assert.equal(finished.canJoin, true); assert.equal(watched.game.results.length, 4);
    assert(!home.messages.some(m => m.type === 'roomList'), '中间 AI 动作不重复发送目录，仅最终状态变化发送一次'); directoryChecks++;
    command(home, 'join', { code: watched.code });
    spectatorSnapshot(await wait(home, m => m.type === 'game' && m.full), 3);
    const overJoined = summary(await listRoom(home, watched.code, r => r.spectatorCount === 3), watched.code);
    assert.equal(overJoined.isMember, true); assert.deepEqual(watched.seats, watchedSeats); directoryChecks++;
    const oldGame = watched.gameId; directoryClock.tick(watched.busyUntil - directoryClock.now());
    command(watcher, 'replay');
    const replay = await wait(watcher, m => m.type === 'game' && m.full && m.gameId !== oldGame);
    spectatorSnapshot(replay, 3);
    assert.equal(summary(await listRoom(home, watched.code, r => r.status === 'playing'), watched.code).canJoin, true); directoryChecks++;
    const privacy = await refreshList(home);
    assert(summary(privacy, watched.code));
    for (const item of privacy.rooms) {
      assert.deepEqual(Object.keys(item).sort(), directoryKeys);
      assert.equal(item.playerCount, item.aiCount + item.humanCount);
      for (const value of Object.values(item)) assert(['string', 'number', 'boolean'].includes(typeof value));
      for (const client of directorySockets.filter(s => s.identity)) {
        assert(!JSON.stringify(item).includes(client.identity.token)); assert(!JSON.stringify(item).includes(client.identity.id));
      }
      assert(!JSON.stringify(item).includes(watched.gameId));
    }
    assert.deepEqual(Object.keys(privacy).sort(), ['rooms', 'type']); directoryChecks++;
    command(home, 'leave'); await wait(home, m => m.type === 'left');
    await wait(homeTab, m => m.type === 'left');
    await listRoom(homeTab, watched.code, r => r.spectatorCount === 2);
    await directoryClose(guest);
    assert.equal(summary(await listRoom(homeTab, watched.code, r => r.spectatorCount === 2), watched.code).onlineSpectatorCount, 2);
    await directoryClose(guestTab);
    const oneOnline = summary(await listRoom(homeTab, watched.code, r => r.onlineSpectatorCount === 1), watched.code);
    assert.equal(oneOnline.spectatorCount, 2); assert.equal(oneOnline.onlineCount, 1); directoryChecks++;
    await directoryClose(homeTab);
    command(watcher, 'leave'); await wait(watcher, m => m.type === 'left');
    await list(home, rooms => rooms.length === 0);
    directoryClock.tick(30 * 60 * 1000); directoryClock.hub.cleanup();
    await list(home, rooms => rooms.length === 0);
    assert.equal(directoryClock.hub.rooms.size, 0); assert.equal(watched.spectators.size, 0);
    assert.equal(directoryClock.timers.size, 0); directoryChecks++;
    console.log(`公开房间目录 WebSocket 回归通过：${directoryChecks} 项；全 AI ${steps} 次真实调度，目录隐私/权限/多标签/无触碰副作用/离线隐藏/过期清理通过`);
  } finally {
    for (const ws of directorySockets) ws.terminate();
    await bounded(new Promise(resolve => directoryServer.close(resolve)), '关闭隔离目录服务器');
    directoryClock.hub.dispose();
    assert.equal(directoryClock.timers.size, 0); assert.equal(directoryClock.intervals.size, 0);
  }
  // 软链接越界使用独立空目录，不改实际 public 资源。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunao-static-'));
  const linkHub = createHub();
  let linkServer;
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>test');
    fs.symlinkSync(path.join(__dirname, '..', 'server.js'), path.join(dir, 'outside.js'));
    linkServer = createServer({ hub: linkHub, publicDir: dir });
    await new Promise(resolve => linkServer.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${linkServer.address().port}/outside.js`);
    assert.equal(response.status, 403);
    console.log('✓ 静态根目录外软链接不可读取');
  } finally {
    if (linkServer) await new Promise(resolve => linkServer.close(resolve));
    linkHub.dispose(); fs.rmSync(dir, { recursive: true });
  }

  // 独立短测试：保持一个 HTTP 响应未结束，确认 close 不能只等 HTTP 或只等 WebSocket。
  const tracked = trackedHub();
  const closingServer = createServer({ hub: tracked.hub });
  let heldResponse, heldRequest;
  try {
    await new Promise(resolve => closingServer.listen(0, '127.0.0.1', resolve));
    const closingPort = closingServer.address().port;
    const A = await open(closingPort), tab = await open(closingPort);
    command(A, 'hello', { name: '关闭测试' });
    const identity = await wait(A, m => m.type === 'hello');
    command(A, 'quick', { ai: 2 });
    await wait(A, m => m.type === 'game');
    command(tab, 'hello', { token: identity.token });
    await wait(tab, m => m.type === 'game' && m.full);
    const serverSockets = [...closingServer.wss.clients];
    const player = serverSockets[0].player;
    const room = tracked.hub.rooms.get(player.room);
    assert.equal(serverSockets.length, 2);
    assert.equal(player.sockets.size, 2);
    assert(tracked.timers.size > 0);
    assert.equal(tracked.intervals.size, 1);
    const heldReady = new Promise(resolve => {
      closingServer.removeAllListeners('request');
      closingServer.on('request', (_req, res) => { heldResponse = res; resolve(); });
    });
    const httpDone = new Promise((resolve, reject) => {
      heldRequest = http.get({ host: '127.0.0.1', port: closingPort, path: '/held', agent: false }, res => {
        res.resume(); res.once('end', resolve);
      });
      heldRequest.once('error', reject);
    });
    await bounded(heldReady, '隔离 HTTP 请求');
    let httpClosed = false, wsClosed = false, httpCloseEvents = 0, wsCloseEvents = 0;
    closingServer.on('close', () => { httpClosed = true; httpCloseEvents++; });
    closingServer.wss.on('close', () => { wsClosed = true; wsCloseEvents++; });
    const socketsDone = Promise.all(serverSockets.map(ws => once(ws, 'close')));
    const wsDone = once(closingServer.wss, 'close');
    const callbacks = [];
    const closeOnce = () => new Promise(resolve => {
      assert.equal(closingServer.close(function (err) {
        callbacks.push({ err, owner: this, httpClosed, wsClosed, clients: closingServer.wss.clients.size,
          timers: tracked.timers.size, unbound: serverSockets.every(ws => ws.player === null && ws.room === null) });
        resolve();
      }), closingServer);
    });
    const firstClose = closeOnce(), concurrentClose = closeOnce();
    // 不等事件循环：解绑身份和释放房间超时必须在 close() 返回时已经完成。
    assert.equal(room.clients.size, 0);
    assert.equal(room.timer, null);
    assert.equal(room.deadline, 0);
    assert.notEqual(room.timing.pausedAt, null);
    assert.equal(player.sockets.size, 0);
    assert(serverSockets.every(ws => ws.player === null && ws.room === null));
    assert.equal(tracked.timers.size, 0);
    assert.equal(tracked.intervals.size, 1, '调用方注入 hub 仍拥有清理 interval');
    assert.equal(callbacks.length, 0);
    await bounded(Promise.all([wsDone, socketsDone]), '所有 WebSocket 关闭');
    assert.equal(wsClosed, true);
    assert.equal(httpClosed, false);
    assert.equal(callbacks.length, 0, 'HTTP 请求未结束时不能提前回调');
    heldResponse.end('ok');
    await bounded(Promise.all([httpDone, firstClose, concurrentClose]), 'HTTP 与 WebSocket 双阶段关闭');
    assert.equal(httpCloseEvents, 1);
    assert.equal(wsCloseEvents, 1);
    assert.equal(callbacks.length, 2);
    for (const callback of callbacks) {
      assert.equal(callback.err, undefined);
      assert.equal(callback.owner, closingServer);
      assert(callback.httpClosed && callback.wsClosed && callback.unbound);
      assert.equal(callback.clients, 0);
      assert.equal(callback.timers, 0);
    }
    await bounded(closeOnce(), '已关闭服务重复 close');
    assert.equal(callbacks.length, 3);
    assert.equal(httpCloseEvents, 1);
    assert.equal(wsCloseEvents, 1);
    const fresh = { readyState: 1, send() {} };
    assert.equal(tracked.hub.handle(fresh, { type: 'hello', name: '调用方仍可复用' }), null);
    assert.equal(tracked.hub.handle(fresh, { type: 'quick', ai: 2 }), null);
    assert(tracked.timers.size > 0, '注入 hub 不能被 server.close 强制 dispose');
    console.log('✓ close 同步解绑，等待 HTTP 与全部 WebSocket，重复调用共享结果且不销毁注入 hub');
  } finally {
    heldResponse?.end(); heldRequest?.destroy();
    await bounded(new Promise(resolve => closingServer.close(resolve)), '关闭隔离服务器');
    tracked.hub.dispose();
    assert.equal(tracked.timers.size, 0);
    assert.equal(tracked.intervals.size, 0);
  }

  const ownedServer = createServer();
  try {
    await new Promise(resolve => ownedServer.listen(0, '127.0.0.1', resolve));
    const ws = await open(ownedServer.address().port);
    command(ws, 'hello', { name: '内部 hub' });
    await wait(ws, m => m.type === 'hello');
    command(ws, 'quick', { ai: 2 });
    await wait(ws, m => m.type === 'game');
    const socket = [...ownedServer.wss.clients][0], player = socket.player;
    await bounded(new Promise(resolve => ownedServer.close(resolve)), '内部 hub 关闭');
    assert.equal(ownedServer.wss.clients.size, 0);
    assert.equal(player.sockets.size, 0);
    assert.equal(player.room, null, '内部创建的 hub 应 dispose，而不仅暂停对局');
    assert.equal(socket.player, null);
    assert.equal(socket.room, null);
    console.log('✓ 服务内部创建的 hub 关闭时同步 dispose');
  } finally {
    await bounded(new Promise(resolve => ownedServer.close(resolve)), '重复关闭内部 hub');
  }

  const blocker = net.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const failedTracked = trackedHub(), failedServer = createServer({ hub: failedTracked.hub });
  try {
    const listenError = new Promise(resolve => failedServer.once('error', resolve));
    failedServer.listen(blocker.address().port, '127.0.0.1');
    assert.equal((await bounded(listenError, '端口占用监听失败')).code, 'EADDRINUSE');
    const results = await bounded(Promise.all([1, 2].map(() => new Promise(resolve => failedServer.close(resolve)))), '监听失败后的重复 close');
    assert(results.every(err => err?.code === 'ERR_SERVER_NOT_RUNNING'));
    assert.equal(failedServer.wss.clients.size, 0);
    assert.equal(failedTracked.timers.size, 0);
    assert.equal(failedTracked.intervals.size, 1);
    assert.equal((await bounded(new Promise(resolve => failedServer.close(resolve)), '监听失败后再 close')).code, 'ERR_SERVER_NOT_RUNNING');
    console.log('✓ 监听失败后 close 仍结束 WebSocket 并稳定返回原生错误');
  } finally {
    await new Promise(resolve => blocker.close(resolve));
    await bounded(new Promise(resolve => failedServer.close(resolve)), '失败服务清理');
    failedTracked.hub.dispose();
  }
  const unstarted = createServer();
  const notRunning = await bounded(new Promise(resolve => unstarted.close(resolve)), '从未监听的服务 close');
  assert.equal(notRunning.code, 'ERR_SERVER_NOT_RUNNING');
  assert.equal(unstarted.wss.clients.size, 0);
  console.log('✓ 从未监听的服务 close 释放内部 hub 与 WebSocket 资源');
})().catch(error => { console.error(error); process.exitCode = 1; });
