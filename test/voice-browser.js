'use strict';
// 语音开麦真实浏览器回归：两个 Chromium 页面用假麦克风，大厅里开麦 → WebRTC 连通 → 对方检测到说话 → 闭麦后断开。
// 本机回环直连，不经过 TURN；TURN 中继要在部署环境用真实网络验证。
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createHub } = require('../server/hub');
const { createServer } = require('../server');

(async () => {
  const hub = createHub();
  const server = createServer({ hub });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}/`;
  // 假设备会持续发出提示音，正好用来测「正在说话」
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const open = async (name) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, permissions: ['microphone'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(base);
    await page.locator('#nameInput').fill(name);
    await page.waitForFunction(() => !document.querySelector('#createBtn').disabled);
    return page;
  };
  const voice = (page) => page.evaluate(() => window.Voice.state());
  try {
    const A = await open('甲'), B = await open('乙');
    await A.locator('#createBtn').click();
    await A.locator('#lobby').waitFor({ state: 'visible' });
    const code = (await A.locator('#roomCode').textContent()).trim();
    await B.locator('#codeInput').fill(code);
    await B.locator('#joinBtn').click();
    await B.locator('#lobby').waitFor({ state: 'visible' });
    await A.locator('#lobbyMic').waitFor({ state: 'visible' });
    assert.equal((await voice(A)).conns.length, 0, '都没开麦时不建立连接');

    await A.locator('#lobbyMic').click();
    await A.waitForFunction(() => window.Voice.state().micOnline);
    for (const page of [A, B]) await page.waitForFunction(() => window.Voice.state().conns.some((c) => c.state === 'connected'), null, { timeout: 15000 });
    console.log('✓ 一方开麦即建立连接并连通');
    await B.waitForFunction(() => window.Voice.state().talking.length > 0, null, { timeout: 10000 });
    await B.waitForFunction(() => document.querySelector('#seats .seat[data-seat="0"]').classList.contains('talking'));
    assert.ok(await A.locator('#seats .seat[data-seat="0"]').evaluate((el) => el.classList.contains('mic-on')), '自己的座位显示开麦');
    console.log('✓ 对方听到声音，座位显示正在说话');

    await B.locator('#lobbyMic').click();
    await A.waitForFunction(() => window.Voice.state().peers.every((p) => p.mic));
    await A.waitForFunction(() => window.Voice.state().talking.length >= 2, null, { timeout: 10000 });
    console.log('✓ 双方开麦，各自检测到对方说话');

    // 断线重连：服务端掐断乙的连接，新连接自动补发开麦并重新连通
    const oldYou = (await voice(B)).you;
    for (const ws of server.wss.clients) if (ws.player?.name === '乙') ws.terminate();
    await B.waitForFunction((old) => { const st = window.Voice.state(); return st.you && st.you !== old && st.micOnline && st.conns.some((c) => c.state === 'connected'); }, oldYou, { timeout: 20000 });
    await A.waitForFunction((old) => { const st = window.Voice.state(); return !st.peers.some((p) => p.id === old) && st.conns.length === 1 && st.conns[0].state === 'connected'; }, oldYou, { timeout: 20000 });
    console.log('✓ 断线重连后自动恢复开麦并重新连通，旧连接被清掉');

    for (const page of [A, B]) {
      const mic = page.locator('#lobbyMic');
      if (await mic.evaluate((el) => el.classList.contains('on'))) await mic.click();
    }
    await A.waitForFunction(() => window.Voice.state().peers.every((p) => !p.mic));
    assert.ok((await voice(A)).talking.length === 0, '闭麦后不再显示说话');
    console.log('✓ 闭麦后名单同步、说话状态清除');

    await A.locator('#leaveLobby').click();
    await A.locator('#home').waitFor({ state: 'visible' });
    const left = await voice(A);
    assert.equal(left.you, null);
    assert.equal(left.conns.length, 0, '离开房间后连接全部关闭');
    assert.ok(await A.locator('#lobbyMic').evaluate((el) => el.hidden));
    console.log('✓ 离开房间关闭全部语音连接');
    assert.deepEqual(errors, []);
    console.log('语音浏览器回归通过');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => { console.error(e); process.exit(1); });
