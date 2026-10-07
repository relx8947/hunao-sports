'use strict';
// 双人联机：A 建房、B 输码加入、加 AI 开赛；两边都能操作；B 中途刷新能恢复；表情互通
const path = require('path');
const PW_DIR = '/home/dev/project/playgroud/orca/node_modules/.pnpm/playwright@1.59.1/node_modules';
const { chromium } = require(path.join(PW_DIR, 'playwright'));
const BASE = process.env.BASE || 'http://localhost:18160';
const OUT = '/tmp/hunao-multi';

const click = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; n.click(); return true; }, sel);

async function step(page) {
  if (await click(page, '#draftCards .rcard.pickable')) return 'draft';
  if (await click(page, '#pickCards .rcard.pickable')) return 'pick';
  if (await click(page, '#overlay .rcard.pickable')) return 'choose';
  const v = await page.evaluate(() => { const b = [...document.querySelectorAll('#dock .prompt.mine [data-v]')].find((x) => !x.disabled); return b ? b.dataset.v : null; });
  if (v) { await click(page, `#dock [data-v="${v}"]`); return v; }
  return null;
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: '/home/dev/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell' });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  const errs = [];
  for (const [n, p] of [['A', A], ['B', B]]) {
    p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`${n}: ${m.text()}`); });
  }
  await A.goto(BASE, { waitUntil: 'networkidle' });
  await A.fill('#nameInput', '房主小A');
  await A.click('#createBtn');
  await A.waitForSelector('#lobby:not([hidden])');
  const code = (await A.textContent('#roomCode')).trim();
  console.log('房间码', code);

  await B.goto(BASE, { waitUntil: 'networkidle' });
  await B.fill('#nameInput', '客人小B');
  await B.fill('#codeInput', code);
  await B.click('#joinBtn');
  await B.waitForSelector('#lobby:not([hidden])');
  await A.waitForTimeout(400);
  console.log('A 看到座位数', await A.$$eval('#seats .seat:not(.empty)', (e) => e.length));
  await A.click('#addAI');
  await A.waitForTimeout(300);
  await A.screenshot({ path: `${OUT}/lobby-A.png` });
  await B.screenshot({ path: `${OUT}/lobby-B.png` });
  await A.click('#startBtn');
  await A.waitForSelector('#game:not([hidden])');
  await B.waitForSelector('#game:not([hidden])');
  await click(A, '#speedBtn'); await click(A, '#speedBtn');

  const counts = { A: 0, B: 0 };
  let reloaded = false, emoted = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await A.waitForTimeout(300);
    if (await step(A)) counts.A++;
    if (await step(B)) counts.B++;
    const phase = await A.evaluate(() => window.__hn().phase);
    if (!emoted && phase === 'race') {
      await click(B, '#emotes [data-e="离谱！"]');
      await A.waitForTimeout(200);
      const seen = await A.evaluate(() => [...document.querySelectorAll('.bubble')].map((b) => b.textContent));
      console.log('A 看到 B 的表情', seen);
      emoted = true;
    }
    if (!reloaded && counts.B > 8 && phase === 'race') {
      await B.reload({ waitUntil: 'networkidle' });
      await B.waitForSelector('#game:not([hidden])', { timeout: 8000 });
      await B.waitForTimeout(600);
      const tok = await B.$$eval('#tokens .token', (e) => e.length);
      console.log('B 刷新后回到对局，棋子数', tok);
      await B.screenshot({ path: `${OUT}/B-after-reload.png` });
      reloaded = true;
    }
    if (phase === 'over') break;
  }
  await A.waitForTimeout(1500);
  await A.screenshot({ path: `${OUT}/end-A.png` });
  await B.screenshot({ path: `${OUT}/end-B.png` });
  const sa = await A.evaluate(() => [...document.querySelectorAll('[data-score]')].map((e) => e.textContent).join(','));
  const sb = await B.evaluate(() => [...document.querySelectorAll('[data-score]')].map((e) => e.textContent).join(','));
  console.log('两端比分一致', sa === sb, sa, sb, '最终阶段', await A.evaluate(() => window.__hn().phase));
  console.log('操作次数', counts, '错误', errs.length ? errs : '无');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
