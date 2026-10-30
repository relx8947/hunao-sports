'use strict';
// 界面打磨验收：行动卡名次差距、赛事纪录弹窗（含窄屏用场次胶囊打开）、玩家卡色条、总冠军烟花不报错。
const assert = require('node:assert/strict');
const { launch, step, state, clickTop } = require('./browser-helper');

(async () => {
  const app = await launch();
  try {
    const page = await app.page('打磨测试选手', { width: 1280, height: 720 });
    await page.locator('#aiCount [data-v="2"]').click();
    await page.locator('#quickBtn').click();
    await page.locator('#game').waitFor({ state: 'visible' });
    await clickTop(page, '#speedBtn');
    await clickTop(page, '#speedBtn');
    const started = Date.now();
    let sawGap = false, sawRecords = false, narrowOk = false, results = 0, final;
    while (Date.now() - started < 540000) {
      const st = await state(page);
      const v = st.visual;
      if (st.final && v.phase === 'over' && !v.playing) { final = st; break; }
      if (v.overlayKind === 'results') results++;
      if (!sawGap && v.phase === 'race' && !v.playing && !v.queue) {
        const gap = await page.evaluate(() => { const g = document.querySelector('#turnCard:not([hidden]) .tc-gap'); return g ? g.textContent : ''; });
        if (gap) { assert(/第\d+名/.test(gap), `名次差距文案：${gap}`); sawGap = true; }
        const strip = await page.evaluate(() => { const r = document.querySelector('.prow'); return r ? getComputedStyle(r).borderLeftWidth : ''; });
        assert.equal(strip, '7px', '玩家卡左侧色条宽度');
      }
      if (!sawRecords && results >= 1 && v.phase === 'race' && !v.playing && !v.queue) {
        await clickTop(page, '#recordsBtn');
        await page.locator('#modal .modal-records').waitFor({ state: 'visible' });
        const rows = await page.locator('#modal .rec-row').count();
        assert.equal(rows, 4, '赛事纪录要列出四场');
        assert(await page.locator('#modal .rec-row:not(.pending) .rec-med').count() >= 1, '已结束的场次要有奖牌选手');
        const fit = await page.evaluate(() => { const b = document.querySelector('.modal-records .modal-body'); return b.scrollHeight <= b.clientHeight + 1; });
        assert(fit, '赛事纪录在 1280×720 内不能出现内部滚动');
        await page.locator('#mClose').click();
        await page.locator('#modal').waitFor({ state: 'hidden' });
        // 窄屏竖屏：顶栏隐藏纪录按钮，点场次胶囊也能打开
        await page.setViewportSize({ width: 393, height: 852 });
        await page.waitForTimeout(300);
        assert(!(await page.locator('#recordsBtn').isVisible()), '窄屏顶栏不放纪录按钮，避免折行');
        // 「更多」弹层：触控目标 ≥40px、落在视口内；点外部 / Esc 关闭；纪录按钮能打开赛事纪录并顺手收起
        await page.locator('#moreBtn').click();
        await page.locator('#topActions.open').waitFor();
        await page.waitForTimeout(450); // 等弹出动画播完再量尺寸
        assert.equal(await page.locator('#moreBtn').getAttribute('aria-expanded'), 'true');
        const items = await page.evaluate(() => [...document.querySelectorAll('#topActions .icon-btn')].filter(e => e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.dataset.open, h: r.height, w: r.width, left: r.left, right: r.right, bottom: r.bottom, name: e.getAttribute('aria-label') }; }));
        assert.deepEqual(items.map(i => i.id).sort(), ['autoBtn', 'earBtn', 'recordsBtn', 'rules', 'soundBtn', 'speedBtn'], `更多弹层的项目：${JSON.stringify(items)}`);
        assert(items.every(i => i.h >= 40 && i.w >= 40 && i.left >= 0 && i.right <= 393 && i.bottom <= 852 && i.name), `更多弹层触控目标/视口/aria-label：${JSON.stringify(items)}`);
        await page.mouse.click(3, 420); // 弹层之外的空白处
        assert.equal(await page.locator('#topActions.open').count(), 0, '点外部关闭更多弹层');
        await page.locator('#moreBtn').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#topActions.open').count(), 0, 'Esc 关闭更多弹层');
        assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'moreBtn', '关闭后焦点回到更多按钮');
        // 快捷聊天弹层：点一个发出并关闭
        const emotesBefore = await page.evaluate(() => window.__testSent.filter(m => m.type === 'emote').length);
        await page.locator('#chatBtn').click();
        await page.locator('#emotes.open').waitFor();
        await page.waitForTimeout(450);
        const chips = await page.evaluate(() => [...document.querySelectorAll('#emotes button')].map(e => { const r = e.getBoundingClientRect(); return { h: r.height, left: r.left, right: r.right }; }));
        assert(chips.length >= 4 && chips.every(c => c.h >= 40 && c.left >= 0 && c.right <= 393), `聊天弹层按钮：${JSON.stringify(chips)}`);
        await page.locator('#emotes button').first().click();
        assert.equal(await page.locator('#emotes.open').count(), 0, '发出快捷聊天后弹层关闭');
        assert.equal(await page.evaluate(() => window.__testSent.filter(m => m.type === 'emote').length), emotesBefore + 1);
        await page.locator('#moreBtn').click();
        await page.locator('#recordsBtn').click();
        await page.locator('#modal .modal-records').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#topActions.open').count(), 0, '打开赛事纪录后收起更多弹层');
        await page.locator('#mClose').click();
        await page.locator('#modal').waitFor({ state: 'hidden' });
        await page.locator('#races .race-pill').first().click();
        await page.locator('#modal .modal-records').waitFor({ state: 'visible' });
        narrowOk = true;
        await page.locator('#mClose').click();
        await page.setViewportSize({ width: 1280, height: 720 });
        sawRecords = true;
      }
      if (!(await step(page))) await page.waitForTimeout(120);
    }
    assert(final, '必须跑完四场');
    assert(sawGap, '行动卡必须出现名次差距');
    assert(sawRecords && narrowOk, '必须测到赛事纪录弹窗');
    await page.waitForTimeout(1500);
    assert.equal(app.errors.length, 0, app.errors.join('\n'));
    console.log('界面打磨验收通过：行动卡名次差距、玩家卡色条、赛事纪录（桌面/窄屏）、总冠军烟花无错误');
  } finally { await app.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
