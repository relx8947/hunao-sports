'use strict';
// 双真人 + AI：手机/桌面同步、刷新重连、旋转、四场完赛及再次开局。
const assert = require('node:assert/strict');
const { launch, step, state, snapshot, assertFinished } = require('./browser-helper');

(async () => {
  const app = await launch();
  try {
    const A = await app.page('桌面房主', { width: 1280, height: 820 });
    const B = await app.page('手机朋友');
    await A.locator('#createBtn').click();
    await A.locator('#lobby').waitFor({ state: 'visible' });
    const code = (await A.locator('#roomCode').textContent()).trim();
    await B.locator('#codeInput').fill(code);
    await B.locator('#joinBtn').click();
    await B.locator('#lobby').waitFor({ state: 'visible' });
    await A.waitForFunction(() => window.__testRoom?.seats.length === 2);
    await A.locator('#addAI').click();
    await A.waitForFunction(() => window.__testRoom?.seats.length === 3);
    await snapshot(B, app.out, 'multi-lobby');
    await A.locator('#startBtn').click();
    for (const page of [A, B]) await page.locator('#game').waitFor({ state: 'visible' });
    await A.locator('#speedBtn').click();
    await A.locator('#speedBtn').click();
    const oldIdentity = (await state(B)).identity;
    const limit = Number(process.env.MAX_MS || 600000);
    const started = Date.now();
    let reloaded = false, rotated = false, emoted = false;
    const counts = [0, 0];
    let acceptedBeforeReload = 0, acceptedAtRotation = 0;
    while (Date.now() - started < limit) {
      const stA = await state(A), stB = await state(B);
      if (stA.final && stB.final && !stA.visual.playing && !stB.visual.playing) break;
      if (!emoted && stB.visual.phase === 'race' && !stB.visual.playing && !stB.visual.queue && !stB.visual.overlayKind) {
        await B.locator('#emotes [data-e="离谱！"]').click();
        await A.waitForFunction(() => [...document.querySelectorAll('.bubble, .floater')].some(element => element.textContent === '离谱！'));
        emoted = true;
      }
      if (!reloaded && stB.visual.phase === 'race' && counts[1] >= 5) {
        acceptedBeforeReload = stB.accepted;
        assert.equal(stB.rejected.length, 0, '刷新不能抹掉此前被拒的操作');
        await B.reload({ waitUntil: 'domcontentloaded' });
        await B.locator('#game').waitFor({ state: 'visible' });
        await B.waitForFunction(() => window.__testGame && document.querySelectorAll('#tokens .token').length === 3);
        const restored = await state(B);
        assert.equal(restored.identity.id, oldIdentity.id);
        assert.equal(restored.identity.room, code);
        assert.equal(restored.game.you, stB.game.you);
        await snapshot(B, app.out, 'multi-reconnected');
        reloaded = true;
      }
      if (!rotated && reloaded && stB.visual.phase === 'race' && !stB.visual.playing) {
        for (const [width, height] of [[844, 390], [740, 360], [320, 740], [390, 844]]) {
          await B.setViewportSize({ width, height });
          await B.waitForFunction(() => document.getElementById('board').getBoundingClientRect().width > 180);
          const layout = await snapshot(B, app.out, `multi-race-${width}`);
          assert(layout.scrollWidth <= layout.width + 1, `${width}px 对局不应横向溢出：${JSON.stringify(layout)}`);
          assert(layout.board.width >= 180 && layout.board.height >= 120, '赛道必须可见');
          assert(layout.dock.height > 0, '操作区必须可见');
          for (const [name, rect] of [['board', layout.board], ['dock', layout.dock]]) {
            assert(rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= layout.width + 1 && rect.y + rect.height <= layout.height + 1, `${width}px ${name} 必须在视口内：${JSON.stringify(layout)}`);
          }
        }
        acceptedAtRotation = (await state(B)).accepted;
        rotated = true;
      }
      for (const [index, page] of [A, B].entries()) if (await step(page)) counts[index]++;
      await A.waitForTimeout(120);
    }
    const finalA = await state(A), finalB = await state(B);
    assertFinished(finalA);
    assertFinished(finalB);
    assert.deepEqual(finalA.game.snap.players.map(p => p.score), finalB.game.snap.players.map(p => p.score), '两端比分必须一致');
    assert.deepEqual(finalA.game.snap.results, finalB.game.snap.results, '两端完整四场成绩必须一致');
    assert(reloaded && rotated && emoted, '必须实际验证刷新、旋转和表情');
    assert(finalA.accepted >= 8 && finalB.accepted + acceptedBeforeReload >= 8, '两名真人必须都有至少八次服务端确认的实际操作');
    assert.equal(finalA.rejected.length + finalB.rejected.length, 0, '正常用户操作不能被服务端拒绝');
    assert(finalB.accepted > acceptedAtRotation, '重连及旋转后仍必须完成至少一次正常按钮操作并收到 ack');
    await snapshot(A, app.out, 'multi-final-A');
    await snapshot(B, app.out, 'multi-final-B');
    await A.locator('#again').click();
    await A.locator('#lobby').waitFor({ state: 'visible' });
    await B.locator('#lobby').waitFor({ state: 'visible' });
    await A.locator('#startBtn').click();
    for (const page of [A, B]) await page.waitForFunction(() => window.__testGame?.snap.phase === 'draft' && !document.getElementById('draft').hidden);
    for (const page of [A, B]) {
      const fresh = await state(page);
      assert.notEqual(fresh.game.gameId, finalA.game.gameId, '重开必须有独立对局编号');
      assert.equal(fresh.game.snap.results.length, 0, '新局不能保留旧成绩');
      assert(fresh.game.snap.players.every(p => p.score === 0 && p.chips.length === 0 && p.used.length === 0), '新局分数、筹码、出场记录必须清零');
      assert.equal(fresh.game.snap.pending.kind, 'draft');
      assert.equal(fresh.game.snap.players.reduce((sum, p) => sum + p.hand.length, 0), 0);
      assert.equal(await page.locator('#draftCards .rcard').count(), 6);
    }
    const newStart = Date.now();
    let newAction = false;
    while (Date.now() - newStart < 30000) {
      for (const page of [A, B]) {
        if (await step(page)) {
          await page.waitForFunction(oldGame => window.__testAccepted.some(action => action.gameId !== oldGame), finalA.game.gameId);
          newAction = true; break;
        }
      }
      if (newAction) break;
      await A.waitForTimeout(100);
    }
    assert(newAction, '新局必须通过正常选秀点击并收到新局 ack');
    assert.equal(app.errors.length, 0, app.errors.join('\n'));
    console.log(`双端验收通过：四场比分一致；刷新/横竖屏/表情/重开通过；操作数 ${counts.join('/')}；错误 0`);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
