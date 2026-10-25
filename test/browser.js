'use strict';
// 单人整局验收：隔离后端、实际按钮操作、四场成绩和总冠军强断言。
// 一代（默认）、二代、混合三种模式各从首页选模式开一局快速局，并行跑完四场；EDITIONS=v1,v2 可只跑部分模式。
const assert = require('node:assert/strict');
const { launch, step, state, snapshot, assertFinished } = require('./browser-helper');

const EDITION_NAME = { v1: '一代', v2: '二代', mix: '混合' };

async function playOne(app, edition) {
  const width = Number(process.env.W || 390), height = Number(process.env.H || 844);
  const page = await app.page(`浏览器测试${EDITION_NAME[edition]}`, { width, height });
  const tag = edition === 'v1' ? '' : `${edition}-`;
  const home = await snapshot(page, app.out, `${tag}01-home`);
  assert(home.scrollWidth <= home.width + 1, '首页不能横向溢出');
  // 默认一代；其他模式在首页的分段选择器里切换
  assert.equal(await page.locator('#editionSeg [data-ed="v1"]').getAttribute('aria-checked'), 'true', '首页默认一代');
  if (edition !== 'v1') await page.locator(`#editionSeg [data-ed="${edition}"]`).click();
  await page.locator('#aiCount [data-v="2"]').click();
  await page.locator('#quickBtn').click();
  await page.locator('#game').waitFor({ state: 'visible' });
  const sent = await page.evaluate(() => window.__testSent.filter(message => message.type === 'quick').at(-1));
  assert.deepEqual(sent, { type: 'quick', ai: 2, edition }, 'quick 必须携带所选模式');
  await page.locator('#speedBtn').click();
  await page.locator('#speedBtn').click();
  const started = Date.now();
  const limit = Number(process.env.MAX_MS || 600000);
  const shots = new Set();
  const kinds = new Set();
  let actions = 0, final, idleSince = Date.now(), lastSeq = -1;
  while (Date.now() - started < limit) {
    const st = await state(page);
    if (st.final && st.visual.phase === 'over' && !st.visual.playing) { final = st; break; }
    const phase = st.visual.phase;
    if (st.visual.pending && st.visual.pending.kind) kinds.add(st.visual.pending.kind);
    if (phase && !shots.has(phase) && !st.visual.playing && !st.visual.queue) {
      await snapshot(page, app.out, `${tag}phase-${phase}`);
      shots.add(phase);
    }
    // 卡死检测：快照序号长时间不前进且轮到自己却没有可点的选项，说明有未覆盖的决策
    const seq = st.game && st.game.snap.seq;
    if (seq !== lastSeq) { lastSeq = seq; idleSince = Date.now(); }
    if (Date.now() - idleSince > 60000) {
      const pending = st.game && st.game.snap.pending;
      throw new Error(`${EDITION_NAME[edition]}快速局卡住：pending=${JSON.stringify(pending && { kind: pending.kind, seat: pending.seat })}`);
    }
    if (await step(page)) actions++;
    else await page.waitForTimeout(150);
  }
  assert(final, `${EDITION_NAME[edition]}：在 ${limit}ms 内必须完成四场，最后状态 ${JSON.stringify((await state(page)).visual)}`);
  assertFinished(final);
  assert.equal(final.game.snap.edition, edition, '对局模式与所选一致');
  assert.equal(final.visual.edition, edition, '前端识别到本局模式');
  const badge = await page.evaluate(() => [...document.querySelectorAll('#races .race-ed, #topTitle .tt-ed')].filter(e => e.getClientRects().length).map(e => e.textContent));
  assert.deepEqual(badge, [EDITION_NAME[edition]], '游戏页显示且只显示一枚本局模式标签');
  assert(final.accepted >= 8, '必须有至少八次服务端确认的真人操作');
  assert.equal(final.rejected.length, 0, '正常操作不应被服务器拒绝');
  await snapshot(page, app.out, `${tag}06-final`);
  return { edition, actions, scores: final.game.snap.players.map(p => p.score).join('/'), kinds: [...kinds] };
}

(async () => {
  const app = await launch();
  try {
    const editions = (process.env.EDITIONS || 'v1,v2,mix').split(',').filter(Boolean);
    const results = await Promise.all(editions.map(edition => playOne(app, edition)));
    assert.equal(app.errors.length, 0, app.errors.join('\n'));
    for (const r of results) console.log(`${EDITION_NAME[r.edition]}四场验收通过：${r.actions} 次操作；比分 ${r.scores}；决策 ${r.kinds.join(',')}`);
    console.log('单人四场验收通过（含模式）：页面/资源错误 0');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
