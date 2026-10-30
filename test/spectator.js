'use strict';
// 全 AI 观战整局：观众不提交 act，验证自动完赛、刷新恢复及再次开局。
const assert = require('node:assert/strict');
const { launch, state, snapshot, assertFinished, clickTop } = require('./browser-helper');

(async () => {
  const app = await launch();
  try {
    const width = Number(process.env.W || 390), height = Number(process.env.H || 844);
    const page = await app.page('AI 对局观众', { width, height });
    await page.locator('#watchCount [data-v="4"]').click();
    const home = await snapshot(page, app.out, 'spectator-home');
    assert(home.scrollWidth <= home.width + 1, '手机观战入口不能横向溢出');
    await page.locator('#watchBtn').click();
    await page.locator('#game').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__testGame?.you === -1);
    const initial = await state(page);
    const identity = initial.identity.id;
    const code = initial.room.code;
    const gameId = initial.game.gameId;
    assert.equal(initial.room.mode, 'spectator');
    assert.equal(initial.game.mode, 'spectator');
    assert.equal(typeof gameId, 'string');
    assert(gameId.length > 0);
    assert(initial.game.snap.players.every(p => p.ai));
    assert.equal(initial.game.snap.players.length, 4);
    assert.equal(await page.locator('#autoBtn').isVisible(), false);
    assert.equal(await page.locator('#myTeam').textContent(), '');
    await snapshot(page, app.out, 'spectator-start');
    const guest = await app.page('第二位观众', { width: 1280, height: 820 });
    await guest.locator('#codeInput').fill(code);
    await guest.locator('#joinBtn').click();
    await guest.waitForFunction(() => window.__testGame?.you === -1 && !document.getElementById('game').hidden);
    const joined = await state(guest);
    assert.equal(joined.game.gameId, gameId);
    assert.equal(joined.game.snap.players.length, 4, '加入观众不能替换或新增参赛 AI');
    assert.equal(await guest.locator('#speedBtn').isDisabled(), true, '普通观众不能修改房主速度');
    assert.equal(await guest.locator('#autoBtn').isVisible(), false);
    await clickTop(page, '#speedBtn');
    await clickTop(page, '#speedBtn');
    const limit = Number(process.env.MAX_MS || 600000), started = Date.now();
    let refreshed = false, rotated = false, final;
    const photographed = new Set();
    while (Date.now() - started < limit) {
      const st = await state(page);
      assert.equal(st.game.you, -1);
      assert(st.game.snap.players.every(p => p.ai));
      assert.equal(st.game.deadlineIn, null, '观众不应有真人决策倒计时');
      assert.equal(await page.locator('#dock .prompt.mine [data-v]').count(), 0, '不能为观众显示选手操作按钮');
      assert.equal(await page.locator('#pickCards .pickable, #draftCards .pickable').count(), 0, '观众不能选择 AI 的出战或选秀卡');
      assert.equal(await page.evaluate(() => window.__testSent.filter(m => m.type === 'act' || m.type === 'auto').length), 0, '观众不能被要求选择或托管');
      if (st.visual.phase === 'race' && !st.visual.playing && !st.visual.queue && !refreshed) {
        assert.deepEqual(await page.evaluate(() => window.__testMessages.filter(m => m.type === 'error')), [], '刷新不能抹掉观战协议错误');
        await snapshot(page, app.out, 'spectator-before-reload');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__testGame?.you === -1 && !window.__hn().playing);
        const restored = await state(page);
        assert.equal(restored.identity.id, identity);
        assert.equal(restored.room.code, code);
        assert.equal(restored.game.gameId, gameId);
        assert.equal(restored.game.you, -1);
        assert.equal(restored.game.snap.phase, 'race');
        assert.equal(await page.locator('#autoBtn').isVisible(), false);
        assert.equal(await page.locator('#spectatorStatus').isVisible(), true);
        refreshed = true;
      }
      if (refreshed && !rotated && st.visual.phase === 'race' && !st.visual.playing && !st.visual.queue && !st.visual.overlayKind) {
        for (const [width, height] of [[844, 390], [568, 320], [320, 740], [390, 844]]) {
          await page.setViewportSize({ width, height });
          await page.waitForFunction(() => document.getElementById('board').getBoundingClientRect().width > 180);
          const layout = await snapshot(page, app.out, `spectator-race-${width}`);
          assert(layout.scrollWidth <= layout.width + 1, '观战对局不能横向溢出');
          for (const [name, rect] of [['board', layout.board], ['dock', layout.dock]]) {
            assert(rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= layout.width + 1 && rect.y + rect.height <= layout.height + 1, `观战 ${name} 必须位于视口内：${JSON.stringify(layout)}`);
          }
        }
        rotated = true;
      }
      if (st.visual.phase && !st.visual.playing && !st.visual.queue && !photographed.has(st.visual.phase)) {
        await snapshot(page, app.out, `spectator-${st.visual.phase}`);
        photographed.add(st.visual.phase);
      }
      if (st.final && st.visual.phase === 'over' && !st.visual.playing) { final = st; break; }
      await page.waitForTimeout(150);
    }
    if (!final) {
      const last = await state(page);
      assert.fail(`AI 必须自动完成四场，最后状态 ${JSON.stringify({ room: last.room?.code, mode: last.game?.mode, you: last.game?.you, phase: last.game?.snap.phase, results: last.game?.snap.results.length, visual: last.visual })}`);
    }
    assert(refreshed, '必须实际验证刷新恢复观战');
    assert(rotated, '必须实测手机横竖屏观战布局');
    assertFinished(final);
    await guest.waitForFunction(() => window.__hn().phase === 'over' && !window.__hn().playing && document.getElementById('toHome'));
    const otherFinal = await state(guest);
    assertFinished(otherFinal);
    assert.deepEqual(final.game.snap.results, otherFinal.game.snap.results, '两位观众四场成绩必须一致');
    assert.equal(otherFinal.accepted, 0);
    assert.equal(final.accepted, 0);
    assert.equal(await guest.evaluate(() => window.__testSent.filter(m => m.type === 'act' || m.type === 'auto').length), 0);
    await snapshot(page, app.out, 'spectator-final');
    const replayHost = final.room.host === final.identity.id ? page : guest;
    const remaining = replayHost === page ? guest : page;
    const controller = await state(replayHost);
    assert.equal(controller.room.host, controller.identity.id, '再看一局由当前房主操作');
    assert.equal(await remaining.locator('#again').count(), 0, '非房主不能显示重播按钮');
    await replayHost.locator('#again').click();
    // 观战模式的“再看一局”直接开局，不需要占真人席或手动补 AI。
    await page.waitForFunction(previous => window.__testGame?.gameId !== previous && window.__testGame?.snap.phase === 'draft', gameId);
    const restarted = await state(page);
    assert.equal(restarted.game.you, -1);
    assert(restarted.game.snap.players.every(p => p.ai && p.score === 0 && p.used.length === 0 && p.chips.length === 0));
    assert.equal(restarted.game.snap.results.length, 0);
    await guest.waitForFunction(previous => window.__testGame?.gameId !== previous && window.__testGame?.you === -1, gameId);
    const otherRestarted = await state(guest);
    assert.equal(otherRestarted.game.gameId, restarted.game.gameId);
    assert.equal(otherRestarted.game.you, -1);
    await page.waitForFunction(() => window.__testGame?.snap.players.some(p => p.hand.length > 0));
    assert.equal(await page.evaluate(() => window.__testSent.filter(m => m.type === 'act' || m.type === 'auto').length), 0);
    await replayHost.locator('#leaveGame').click();
    await replayHost.locator('#leaveGame').click();
    await replayHost.locator('#home').waitFor({ state: 'visible' });
    await remaining.waitForFunction(() => window.__testRoom?.host === window.__testIdentity?.id);
    assert.equal(await remaining.locator('#speedBtn').isDisabled(), false, '房主离开后剩余观众获得控制权');
    await remaining.locator('#leaveGame').click();
    await remaining.locator('#leaveGame').click();
    await remaining.locator('#home').waitFor({ state: 'visible' });
    if (!process.env.BASE) {
      const health = await (await fetch(new URL('healthz', app.base))).json();
      assert.equal(health.rooms, 0, '所有观众主动离开后必须清理隔离房间');
    }
    assert.deepEqual(await page.evaluate(() => window.__testMessages.filter(m => m.type === 'error')), [], '观战与重开不能有协议错误');
    assert.deepEqual(await guest.evaluate(() => window.__testMessages.filter(m => m.type === 'error')), [], '加入观战不能有协议错误');
    assert.equal(app.errors.length, 0, app.errors.join('\n'));
    console.log(`AI 观战验收通过：${initial.game.snap.players.length} 名 AI 自动完成四场；刷新后继续；比分 ${final.game.snap.players.map(p => p.score).join('/')}；再看一局通过；观众 act/auto 0，页面和资源错误 0`);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
