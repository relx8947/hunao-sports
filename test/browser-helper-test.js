'use strict';
// 定点真实浏览器回归：只走 hello、快速开局和一次真人操作，不跑完整对局。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { launch, clickTop } = require('./browser-helper');

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

async function closeServer(server, wss) {
  if (!server) return;
  if (wss) {
    const closed = new Promise(resolve => wss.close(resolve));
    for (const socket of wss.clients) socket.terminate();
    await closed;
  }
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
}

function refused(base) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port) });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('关闭后端验证超时')); });
    socket.once('connect', () => { socket.destroy(); reject(new Error('close 后端端口仍在监听')); });
    socket.once('error', error => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}

(async () => {
  const started = Date.now();
  const keys = ['BASE', 'ALLOW_REMOTE', 'OUT', 'SEED'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hunao-helper-test-'));
  for (const key of keys) delete process.env[key];
  process.env.OUT = out;
  let app, allowed, denied, allowedWS, deniedWS;
  const forbidden = { http: 0, upgrade: 0, join: 0 };
  let localRedirects = 0;
  try {
    app = await launch();
    const ownedBase = app.base;
    assert.equal(new URL(ownedBase).hostname, '127.0.0.1');
    assert.notEqual(new URL(ownedBase).port, '18161', '只使用 factory 的随机端口');
    const page = await app.page('握手短测选手');
    assert.deepEqual(await page.evaluate(() => ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].map(key => WebSocket[key])), [0, 1, 2, 3]);
    assert.equal(await page.evaluate(() => document.body.dataset.connection), 'ready');
    const hello = await page.evaluate(() => ({ identity: window.__testIdentity, sent: window.__testSent }));
    assert(hello.identity.id && hello.identity.token, '必须收到真实后端 hello');
    assert.equal(hello.sent.filter(message => message.type === 'hello').length, 1, 'hello 必须通过 wrapper 发出并被转发');
    await page.locator('#aiCount [data-v="2"]').click();
    await page.locator('#quickBtn').click();
    await page.waitForFunction(() => window.__testGame?.gameId, null, { timeout: 5000 });
    await clickTop(page, '#speedBtn');
    await clickTop(page, '#speedBtn');
    await page.waitForFunction(() => {
      const visual = window.__hn();
      return !visual.playing && !visual.queue && !visual.locked && document.querySelector('#draftCards .rcard.pickable');
    }, null, { timeout: 10000 });
    await page.locator('#draftCards .rcard.pickable').first().click({ timeout: 3000 });
    await page.waitForFunction(() => window.__testAccepted.length === 1, null, { timeout: 5000 });
    const action = await page.evaluate(() => ({
      accepted: window.__testAccepted[0],
      ack: window.__testMessages.find(message => message.type === 'ack' && message.for === 'act'),
      gameId: window.__testGame.gameId,
      quick: window.__testSent.find(message => message.type === 'quick'),
    }));
    assert.equal(action.quick.ai, 2);
    assert.equal(action.accepted.gameId, action.gameId, '真人操作必须携带当前 gameId');
    assert.deepEqual([action.ack.gameId, action.ack.id, action.ack.value], [action.accepted.gameId, action.accepted.id, action.accepted.value]);
    assert.equal(app.errors.length, 0, app.errors.join('\n'));
    const close = app.close();
    assert.strictEqual(app.close(), close, 'close 必须可重复调用');
    await close;
    assert.equal(page.isClosed(), true);
    assert.equal(app.browser.isConnected(), false);
    assert.equal(app.browser.contexts().length, 0);
    await refused(ownedBase);
    app = null;
    console.log('通过：默认 launch/page hello、WebSocket 静态常量、quick、带 gameId 的 act/ack、重复 close 与端口释放');

    // 127.0.0.2 有意不在 helper 白名单内；只监听并计数，不主动请求该目标。
    denied = http.createServer((req, res) => {
      forbidden.http++;
      res.setHeader('Content-Type', 'text/html');
      res.end(`<input id="nameInput"><script>
        const socket = new WebSocket('ws://127.0.0.2:${denied.address().port}/ws');
        socket.onopen = () => socket.send(JSON.stringify({type:'join',code:'ABCD'}));
      </script>`);
    });
    denied.on('upgrade', () => forbidden.upgrade++);
    deniedWS = new WebSocketServer({ server: denied, path: '/ws' });
    deniedWS.on('connection', socket => socket.on('message', raw => {
      if (JSON.parse(String(raw)).type === 'join') forbidden.join++;
    }));
    const deniedPort = await listen(denied, '127.0.0.2');
    const deniedHTTP = `http://127.0.0.2:${deniedPort}/?room=ABCD`;
    const deniedSocket = `ws://127.0.0.2:${deniedPort}/ws`;
    allowed = http.createServer((req, res) => {
      if (req.url === '/local') {
        res.writeHead(302, { Location: '/socket' });
        res.end();
        return;
      }
      if (req.url === '/asset.js' || req.url === '/asset-next') {
        res.writeHead(302, { Location: req.url === '/asset.js' ? '/asset-next' : deniedHTTP });
        res.end();
        return;
      }
      if (req.url === '/redirect' || req.url === '/redirect-next') {
        localRedirects++;
        res.writeHead(302, { Location: req.url === '/redirect' ? '/redirect-next' : deniedHTTP });
        res.end();
        return;
      }
      const localSocket = `ws://127.0.0.1:${allowed.address().port}/ws`;
      res.setHeader('Content-Type', 'text/html');
      res.end(`<input id="nameInput"><script src="/asset.js"></script><script>
        const local = new WebSocket(${JSON.stringify(localSocket)});
        local.onopen = () => local.send(JSON.stringify({type:'hello'}));
        const denied = new WebSocket(${JSON.stringify(deniedSocket)});
        denied.onopen = () => denied.send(JSON.stringify({type:'join',code:'ABCD'}));
        denied.onclose = event => { window.__deniedClose = event.code; };
      </script>`);
    });
    allowedWS = new WebSocketServer({ server: allowed, path: '/ws' });
    allowedWS.on('connection', socket => socket.on('message', raw => {
      if (JSON.parse(String(raw)).type === 'hello') socket.send(JSON.stringify({ type: 'hello', id: 'local-fixture', token: 'local-fixture' }));
    }));
    const allowedPort = await listen(allowed, '127.0.0.1');
    process.env.BASE = `http://127.0.0.1:${allowedPort}/redirect`;
    app = await launch();
    await assert.rejects(app.page('跳转安全短测'), /ERR_BLOCKED_BY_CLIENT|禁止远端重定向/);
    assert.equal(localRedirects, 2, '允许的跳转逐跳校验，最后的未授权跳转必须前置拦截');
    assert(app.errors.some(error => error.includes('禁止远端重定向')), JSON.stringify({ errors: app.errors, forbidden }));
    assert.equal(app.browser.contexts().length, 0, '失败的 page 自动回收上下文');
    assert.deepEqual(forbidden, { http: 0, upgrade: 0, join: 0 }, '未授权页面不得被加载，更不得 WebSocket join');
    await app.close();
    app = null;
    console.log('通过：本地 302 链到未授权 127.0.0.2 被前置拦截，HTTP/WS upgrade/join 均为 0');

    process.env.BASE = `http://127.0.0.1:${allowedPort}/local`;
    app = await launch();
    const guarded = await app.page('WebSocket 安全短测');
    assert.equal(new URL(guarded.url()).pathname, '/socket', '允许的文档跳转保持最终 URL');
    await guarded.waitForFunction(() => window.__deniedClose === 1008, null, { timeout: 3000 });
    assert(app.errors.some(error => error.includes('禁止远端重定向')), '资源的多跳重定向也逐跳拦截');
    assert.equal(await guarded.evaluate(() => window.__testIdentity.id), 'local-fixture');
    assert(app.errors.some(error => error.includes('禁止远端 WebSocket')));
    assert.deepEqual(forbidden, { http: 0, upgrade: 0, join: 0 }, '直接远端 WebSocket 也必须在建立连接前拒绝');
    await app.close();
    app = null;
    console.log('通过：本地 WS 双向转发正常，直接未授权 WS 关闭 1008，upgrade/join 均为 0');
  } finally {
    try { await app?.close(); }
    finally {
      try { await closeServer(allowed, allowedWS); }
      finally {
        try { await closeServer(denied, deniedWS); }
        finally {
          fs.rmSync(out, { recursive: true, force: true });
          for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    }
  }
  console.log(`浏览器 helper 定点回归全部通过，资源已清理（${Date.now() - started}ms）`);
})().catch(error => { console.error(error); process.exitCode = 1; });
