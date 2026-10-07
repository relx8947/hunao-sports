'use strict';
// 真实浏览器冒烟：首页 → 和 AI 开一局 → 选秀 → 出牌 → 比赛若干回合，截图并收集控制台错误
const path = require('path');
const PW_DIR = '/home/dev/project/playgroud/orca/node_modules/.pnpm/playwright@1.59.1/node_modules';
const { chromium } = require(path.join(PW_DIR, 'playwright'));

const BASE = process.env.BASE || 'http://localhost:18160';
const OUT = process.env.OUT || '/tmp/hunao';
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const MAX_MS = Number(process.env.MAX_MS || 150000);
const FULL = !!process.env.FULL;
const domClick = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; n.click(); return true; }, sel);

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/home/dev/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: W < 600, hasTouch: W < 600 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/01-home.png` });
  await page.fill('#nameInput', '测试选手');
  await page.click('#quickBtn');
  await page.waitForSelector('#game:not([hidden])');
  // 房主加速
  if (!process.env.SLOW) { await page.click('#speedBtn'); await page.click('#speedBtn'); }

  const t0 = Date.now();
  const shots = { draft: false, pick: false, race: false, results: false, final: false, prompt: false };
  let actions = 0;
  while (Date.now() - t0 < MAX_MS) {
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => ({
      draft: !document.querySelector('#draft').hidden,
      draftPick: !!document.querySelector('#draftCards .rcard.pickable'),
      ov: document.querySelector('#overlay').hidden ? null : (document.querySelector('#overlay .ov-box h2') || {}).textContent,
      pickCards: !!document.querySelector('#pickCards .rcard.pickable'),
      chooseCards: !!document.querySelector('#overlay .rcard.pickable') && !document.querySelector('#pickCards'),
      dockBtns: [...document.querySelectorAll('#dock .prompt.mine [data-v]')].filter((b) => !b.disabled).map((b) => b.dataset.v),
      final: !!document.querySelector('#toHome'),
      results: !!document.querySelector('#overlay .podium') && !document.querySelector('#toHome'),
      tokens: document.querySelectorAll('#tokens .token').length,
    }));
    if (!shots.wild && st.tokens && /第 2 场/.test(await page.textContent('#topTitle')) && st.dockBtns.length) { await page.screenshot({ path: `${OUT}/07-wild.png` }); shots.wild = true; if (process.env.STOP_AT_WILD) break; }
    if (st.draft && !shots.draft) { await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/02-draft.png` }); shots.draft = true; }
    if (st.draftPick) { await domClick(page, '#draftCards .rcard.pickable'); actions++; continue; }
    if (st.pickCards) {
      if (!shots.pick) { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/03-pick.png` }); shots.pick = true; }
      await domClick(page, '#pickCards .rcard.pickable'); actions++; continue;
    }
    if (st.chooseCards) { await domClick(page, '#overlay .rcard.pickable'); actions++; continue; }
    if (st.results && !shots.results) { await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/05-results.png` }); shots.results = true; if (process.env.STOP_AT_RESULTS) break; }
    if (st.final) {
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/06-final.png` }); shots.final = true; break;
    }
    if (st.dockBtns.length) {
      if (!shots.prompt && st.dockBtns.length > 1) { await page.screenshot({ path: `${OUT}/04b-prompt.png` }); shots.prompt = true; }
      if (!shots.race && st.tokens) { await page.screenshot({ path: `${OUT}/04-race.png` }); shots.race = true; }
      const v = st.dockBtns.includes('roll') ? 'roll' : st.dockBtns[0];
      await domClick(page, `#dock [data-v="${v}"]`);
      actions++;
      if (!FULL && shots.race && actions > 40) break;
    }
  }
  await page.screenshot({ path: `${OUT}/99-last.png` });
  console.log('动作数', actions, '截图', Object.entries(shots).filter(([, v]) => v).map(([k]) => k).join(','));
  console.log('控制台错误', errors.length ? errors : '无');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
