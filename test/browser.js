'use strict';
// 单人整局验收：隔离后端、实际按钮操作、四场成绩和总冠军强断言。
const assert = require('node:assert/strict');
const { launch, step, state, snapshot, assertFinished } = require('./browser-helper');

(async () => {
  const app = await launch();
  try {
    const width = Number(process.env.W || 390), height = Number(process.env.H || 844);
    const page = await app.page('浏览器测试选手', { width, height });
    const home = await snapshot(page, app.out, '01-home');
    assert(home.scrollWidth <= home.width + 1, '首页不能横向溢出');
    await page.locator('#aiCount [data-v="2"]').click();
    await page.locator('#quickBtn').click();
    await page.locator('#game').waitFor({ state: 'visible' });
    await page.locator('#speedBtn').click();
    await page.locator('#speedBtn').click();
    const started = Date.now();
    const limit = Number(process.env.MAX_MS || 600000);
    const shots = new Set();
    let actions = 0, final;
    while (Date.now() - started < limit) {
      const st = await state(page);
      if (st.final && st.visual.phase === 'over' && !st.visual.playing) { final = st; break; }
      const phase = st.visual.phase;
      if (phase && !shots.has(phase) && !st.visual.playing && !st.visual.queue) {
        await snapshot(page, app.out, `phase-${phase}`);
        shots.add(phase);
      }
      if (await step(page)) actions++;
      else await page.waitForTimeout(150);
    }
    assert(final, `在 ${limit}ms 内必须完成四场，最后状态 ${JSON.stringify(await state(page))}`);
    assertFinished(final);
    assert(final.accepted >= 8, '必须有至少八次服务端确认的真人操作');
    assert.equal(final.rejected.length, 0, '正常操作不应被服务器拒绝');
    await snapshot(page, app.out, '06-final');
    assert.equal(app.errors.length, 0, app.errors.join('\n'));
    console.log(`单人四场验收通过：${actions} 次操作；比分 ${final.game.snap.players.map(p => p.score).join('/')}；页面/资源错误 0`);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
