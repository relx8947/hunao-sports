'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { FINISH, SCHEDULE } = require('../game/tracks');
const { RACER_IDS } = require('../game/racers');
const localUrl = value => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);

async function launch() {
  const out = process.env.OUT || path.join(require('node:os').tmpdir(), 'hunao-browser');
  fs.mkdirSync(out, { recursive: true });
  const allowRemote = process.env.ALLOW_REMOTE === '1';
  let server, hub, browser;
  let base = process.env.BASE;
  try {
    if (base) {
      assert(localUrl(base) || allowRemote, '浏览器测试会创建房间；远端测试须显式设置 ALLOW_REMOTE=1');
    } else {
      const { createHub } = require('../server/hub');
      const { createServer } = require('../server');
      const seed = Number(process.env.SEED ?? 9);
      assert(Number.isSafeInteger(seed) && seed >= 0 && seed < 2 ** 31, 'SEED 必须为非负31位整数');
      hub = createHub({ random: () => seed / 2 ** 31 });
      server = createServer({ hub });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      base = `http://127.0.0.1:${server.address().port}/`;
    }
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  } catch (error) {
    if (server) await new Promise(resolve => server.close(resolve));
    hub?.dispose();
    throw error;
  }
  const errors = [];
  const closingContexts = new WeakSet();
  let closing;
  return {
    browser, base, out, errors,
    async page(name, viewport = { width: 390, height: 844 }) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000, serviceWorkers: 'block' });
      let rejectNavigation;
      const navigationBlocked = new Promise((_, reject) => { rejectNavigation = reject; });
      navigationBlocked.catch(() => {});
      try {
        // route.fulfill 的文档在新版 Chromium 中可能触发本地网络访问检查。
        // 只授权已通过白名单的文档 origin，不关闭浏览器安全检查；HTTP/WS 仍逐个拦截。
        const permittedOrigins = new Set();
        const permitLocalNetwork = async url => {
          const origin = new URL(url).origin;
          if (permittedOrigins.has(origin)) return;
          await context.grantPermissions(['local-network-access'], { origin });
          permittedOrigins.add(origin);
        };
        await permitLocalNetwork(base);
        const navigationRedirects = new Map();
        await context.route('**/*', async route => {
          try {
            if (closingContexts.has(context)) return await route.abort('blockedbyclient');
            const request = route.request(), navigation = request.isNavigationRequest();
            let url = request.url();
            if (!localUrl(url) && !allowRemote) {
              if (navigation) rejectNavigation(new Error(`${name}: 禁止远端页面`));
              return await route.abort('blockedbyclient');
            }
            if (navigation) await permitLocalNetwork(url);
            // Playwright 只路由 HTTP 重定向链的首个请求，不能把 302 原样交给浏览器。
            // 资源在这里逐跳 fetch；文档改为独立导航，让下一跳重新过路由并保留正确的页面 URL。
            for (let redirects = 0; ; redirects++) {
              const response = await route.fetch({ url, maxRedirects: 0 });
              try {
                const location = response.headers().location;
                if (!location || response.status() < 300 || response.status() >= 400) {
                  if (navigation) navigationRedirects.delete(request.frame());
                  return await route.fulfill({ response });
                }
                const next = new URL(location, url);
                if (!['http:', 'https:'].includes(next.protocol) || (!allowRemote && !localUrl(next.href))) {
                  errors.push(`${name}: 禁止远端重定向`);
                  if (navigation) rejectNavigation(new Error(`${name}: 禁止远端重定向`));
                  return await route.abort('blockedbyclient');
                }
                const count = navigation ? (navigationRedirects.get(request.frame()) || 0) + 1 : redirects + 1;
                if (count > 20) {
                  errors.push(`${name}: 重定向次数过多`);
                  if (navigation) rejectNavigation(new Error(`${name}: 重定向次数过多`));
                  return await route.abort('blockedbyclient');
                }
                if (navigation) {
                  navigationRedirects.set(request.frame(), count);
                  const escaped = next.href.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
                  return await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><meta http-equiv="refresh" content="0;url=${escaped}">` });
                }
                url = next.href;
              } finally { await response.dispose(); }
            }
          } catch (error) {
            // 关闭时 fetch/fulfill/dispose 会一起被取消，不能产生未处理的回调异常。
            if (closingContexts.has(context)) return;
            errors.push(`${name}: HTTP 拦截失败 ${error.message}`);
            if (route.request().isNavigationRequest()) rejectNavigation(error);
            await route.abort('failed').catch(() => {});
          }
        });
        await context.routeWebSocket('**/*', socket => {
          if (closingContexts.has(context)) return socket.close();
          if (!localUrl(socket.url()) && !allowRemote) {
            errors.push(`${name}: 禁止远端 WebSocket`);
            return socket.close({ code: 1008, reason: '测试仅允许本地连接' });
          }
          // 不安装 onMessage：Playwright 默认双向转发。安装监听器会接管并吞掉该方向的消息。
          socket.connectToServer();
        });
        await context.addInitScript(() => {
          window.__testMessages = [];
          window.__testSent = [];
          window.__testAccepted = [];
          window.__testClickTimeouts = 0;
          const pendingActions = new Map();
          const actionKey = message => `${message.gameId}:${message.id}`;
          const Original = WebSocket;
          // 继承也保留 Playwright mock 的静态状态常量（OPEN 不一定是自身属性）。
          window.WebSocket = class extends Original {
            constructor(...args) {
              super(...args);
              this.addEventListener('message', event => {
                let message;
                try { message = JSON.parse(event.data); } catch { return; }
                if (!message || typeof message !== 'object') return;
                window.__testMessages.push(message);
                if (message.type === 'game') window.__testGame = message;
                if (message.type === 'room') window.__testRoom = message.room;
                if (message.type === 'hello') window.__testIdentity = message;
                if (message.type === 'error' && message.for === 'act') pendingActions.clear();
                if (message.type === 'ack' && message.for === 'act') {
                  const key = actionKey(message), action = pendingActions.get(key);
                  if (action && action.value === message.value) {
                    window.__testAccepted.push(action); pendingActions.delete(key);
                  }
                }
              });
            }
            send(raw) {
              const message = JSON.parse(raw);
              window.__testSent.push(message);
              if (message.type === 'act') pendingActions.set(actionKey(message), message);
              return super.send(raw);
            }
          };
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
        page.on('console', message => { if (message.type() === 'error') errors.push(`${name}: ${message.text()}`); });
        page.on('response', response => { if (response.status() >= 400) errors.push(`${name}: HTTP ${response.status()} ${response.url()}`); });
        page.on('requestfailed', request => errors.push(`${name}: ${request.failure()?.errorText || '请求失败'} ${request.url()}`));
        await Promise.race([
          (async () => {
            await page.goto(base, { waitUntil: 'domcontentloaded' });
            assert(localUrl(page.url()) || allowRemote, '测试入口重定向到远端，禁止创建房间');
            await page.waitForFunction(() => window.__testIdentity);
            await page.locator('#nameInput').fill(name);
          })(),
          navigationBlocked,
        ]);
        return page;
      } catch (error) {
        // 保留白名单直到上下文关闭；路由回调会捕获关闭导致的取消异常。
        closingContexts.add(context);
        await context.close().catch(() => {});
        throw error;
      }
    },
    close() {
      closing ||= (async () => {
        for (const context of browser.contexts()) closingContexts.add(context);
        try { await browser.close(); }
        finally {
          try { if (server) await new Promise(resolve => server.close(resolve)); }
          finally { hub?.dispose(); }
        }
      })();
      return closing;
    },
  };
}

async function step(page) {
  const selector = await page.evaluate(() => {
    const visual = window.__hn();
    if (visual.playing || visual.queue || visual.locked) return null;
    const live = selector => {
      const element = document.querySelector(selector);
      return element && !element.disabled && element.getBoundingClientRect().width > 0;
    };
    if (live('#draftCards .rcard.pickable')) return '#draftCards .rcard.pickable';
    if (live('#pickCards .rcard.pickable')) return '#pickCards .rcard.pickable';
    if (live('#overlay .rcard.pickable')) return '#overlay .rcard.pickable';
    const options = [...document.querySelectorAll('#dock .prompt.mine [data-v]')].filter(button => !button.disabled);
    const button = options.find(button => button.dataset.v === 'roll') || options[0];
    return button ? `#dock .prompt.mine [data-v="${CSS.escape(button.dataset.v)}"]` : null;
  });
  if (!selector) return false;
  const element = page.locator(selector).first();
  try {
    const before = await page.evaluate(() => window.__testSent.filter(message => message.type === 'act').length);
    await element.click({ timeout: 1500 });
    const after = await page.evaluate(() => window.__testSent.filter(message => message.type === 'act').length);
    return after > before;
  } catch (error) {
    if (/Timeout|detached/.test(error.message)) {
      await page.evaluate(() => window.__testClickTimeouts++);
      return false;
    }
    throw error;
  }
}

async function state(page) {
  return page.evaluate(() => ({
    game: window.__testGame,
    visual: window.__hn(),
    identity: window.__testIdentity,
    room: window.__testRoom,
    final: !!document.querySelector('#toHome') && !document.getElementById('overlay').hidden,
    visibleScores: [...document.querySelectorAll('[data-score]')].map(element => Number(element.textContent)),
    finalScores: [...document.querySelectorAll('#overlay .st-row .tot')].map(element => Number(element.textContent)),
    finalRows: [...document.querySelectorAll('#overlay .st-row')].map(element => ({ seat: Number(element.dataset.seat), name: element.querySelector('.st-name')?.textContent, score: Number(element.querySelector('.tot')?.textContent) })),
    finalTitle: document.querySelector('#overlay h2')?.textContent,
    tokens: [...document.querySelectorAll('#tokens .token')].map(element => ({ rid: element.dataset.rid, left: element.style.left, top: element.style.top })),
    text: document.body.innerText,
    accepted: window.__testAccepted?.length || 0,
    acceptedActions: window.__testAccepted,
    clickTimeouts: window.__testClickTimeouts,
    rejected: window.__testMessages.filter(message => message.type === 'error' && message.for === 'act'),
  }));
}

async function snapshot(page, out, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled', fullPage: true });
  const layout = await page.evaluate(() => {
    const rect = id => {
      const element = document.getElementById(id);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, board: rect('board'), dock: rect('dock'), speed: document.getElementById('speedLabel')?.textContent };
  });
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(layout, null, 2));
  return layout;
}

function assertResults(snap) {
  const n = snap.players.length;
  assert.equal(snap.results.length, 4, '必须有四场成绩');
  for (const [index, result] of snap.results.entries()) {
    assert.equal(result.race, index + 1, '场次顺序必须正确');
    assert.equal(result.track, SCHEDULE[index], '赛道顺序必须正确');
    assert.equal(result.scores.length, n);
    assert(result.scores.every(score => Number.isSafeInteger(score) && score >= 0), '每场累计比分必须有效');
    assert.equal(result.standings.length, n);
    assert.deepEqual(result.standings.map(r => r.seat).sort((a, b) => a - b), Array.from({ length: n }, (_, seat) => seat));
    assert.equal(new Set(result.standings.map(r => r.rid)).size, n);
    for (const racer of result.standings) {
      assert(RACER_IDS.includes(racer.rid));
      assert(Number.isInteger(racer.pos) && racer.pos >= 0 && racer.pos <= FINISH);
      assert(Number.isInteger(racer.finished) && racer.finished >= 0 && racer.finished <= 2);
      assert.equal(typeof racer.out, 'boolean');
    }
  }
}

function assertFinished(st) {
  assert.equal(st.game.snap.phase, 'over', '必须服务端四场完赛，不能以测试超时作为成功');
  assertResults(st.game.snap);
  assert.equal(st.visual.phase, 'over', '客户端必须完成结算动画');
  assert.equal(st.visual.playing, false);
  assert.equal(st.visual.queue, 0);
  assert.equal(st.final, true, '必须显示总冠军结算界面');
  const scores = st.game.snap.players.map(player => player.score);
  assert(scores.every(score => Number.isSafeInteger(score) && score >= 0), '最终比分必须有效');
  assert.deepEqual(st.game.snap.results[3].scores, scores, '最终比分与最后一场累计成绩一致');
  assert.deepEqual(st.visibleScores, scores, '客户端玩家栏必须展示权威比分');
  assert.deepEqual(st.finalScores, scores.slice().sort((a, b) => b - a), '总冠军成绩必须展示权威比分');
  assert.deepEqual(st.finalRows.slice().sort((a, b) => a.seat - b.seat), st.game.snap.players.map(player => ({ seat: player.seat, name: `${player.name}${player.seat === st.game.you ? '（你）' : ''}`, score: player.score })), '分数必须属于正确席位和姓名');
  const maximum = Math.max(...scores);
  assert.deepEqual(st.game.snap.champions, st.game.snap.players.filter(p => p.score === maximum).map(p => p.seat));
  assert.equal(st.finalTitle, `总冠军：${st.game.snap.champions.map(seat => st.game.snap.players[seat].name).join('、')}`, '冠军标题必须与权威胜者一致');
}

module.exports = { launch, step, state, snapshot, assertFinished, assertResults };
