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
