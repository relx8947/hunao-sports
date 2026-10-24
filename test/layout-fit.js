'use strict';
// 一屏布局验收：每个界面在每个手机/电脑尺寸下都不能出现页面滚动，内容也不能被裁掉。
// 手机与电脑各跑一局（房间 → 选秀 → 暗选 → 比赛 → 单场结算 → 总结算），再看一局 AI 观战，
// 在每个关键时刻把视口切到各个尺寸逐一量：
//   1. document.scrollingElement 的 scrollHeight/scrollWidth 不超过视口；
//   2. 标了 data-fit 的容器和浮层/弹窗内部没有纵向溢出（分页必须真的放得下）；
//   3. 可见的按钮/输入框/链接完整落在视口里。
// SHOTS=<目录> 时每个尺寸各截一张图，用于人工复核。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, step, state } = require('./browser-helper');

const MOBILE = [[360, 740], [375, 667], [393, 852], [430, 932], [393, 700], [375, 560], [844, 390], [667, 375]];
const DESKTOP = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720]];
const SHOTS = process.env.SHOTS;
const failures = [];
const seen = new Map();

async function measure(page, sizes, screen, home) {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(260);
    // 等入场/翻页这类一次性动画播完再量：动画中的位移会临时撑大 scrollHeight，但不是布局溢出
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || !Number.isFinite(a.effect?.getComputedTiming().endTime)), null, { timeout: 2500 }).catch(() => {});
    const m = await page.evaluate(() => {
      const se = document.scrollingElement;
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
      };
      const name = (el) => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
      const boxes = [...document.querySelectorAll('[data-fit], .ov-box, .modal-body, .home-inner, .lobby-inner, .draft')].filter(visible);
      const overflow = boxes.filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => `${name(el)} ${el.scrollHeight}>${el.clientHeight}`);
      const outside = [...document.querySelectorAll('button, input, a[href]')].filter(visible)
        .filter((el) => !el.closest('#tokens, .parade'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1;
        }).map((el) => `${name(el)}「${(el.textContent || el.placeholder || '').trim().slice(0, 10)}」`);
      // 页面滚动时找出把页面撑高/撑宽的元素，便于定位
      const culprits = se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1
        ? [...document.querySelectorAll('body *')].filter(visible).filter((el) => getComputedStyle(el).position !== 'fixed' && !el.closest('#overlay, #modal, #toasts, #tip'))
          .map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.bottom > innerHeight + 1 || r.right > innerWidth + 1)
          .slice(-3).map(({ el, r }) => `${name(el)}(${Math.round(r.right)}×${Math.round(r.bottom)})`) : [];
      return { sh: se.scrollHeight, sw: se.scrollWidth, ih: innerHeight, iw: innerWidth, overflow, culprits, outside: [...new Set(outside)].slice(0, 6) };
    });
    const tag = `${screen} @${width}×${height}`;
    const bad = [];
    if (m.sh > m.ih + 1) bad.push(`页面纵向滚动 ${m.sh}>${m.ih} ${m.culprits.join(' ')}`);
    if (m.sw > m.iw + 1) bad.push(`页面横向滚动 ${m.sw}>${m.iw}`);
    if (m.overflow.length) bad.push(`容器溢出 ${m.overflow.join('；')}`);
    if (m.outside.length) bad.push(`超出视口 ${m.outside.join('、')}`);
    if (bad.length) failures.push(`${tag}：${bad.join(' | ')}`);
    seen.set(tag, bad.length === 0);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${screen}-${width}x${height}.png`) });
    }
  }
  await page.setViewportSize({ width: home[0], height: home[1] });
  await page.waitForTimeout(200);
}

async function openAndMeasure(page, sizes, home, opener, screen) {
  const button = page.locator(opener).first();
  if (!(await button.count())) return;
  await button.click();
  await page.locator('#modal .modal-box').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await measure(page, sizes, screen, home);
  await page.locator('#mClose').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
}

async function playThrough(app, label, sizes) {
  const home = sizes[0];
  const page = await app.page(`${label}验收`, { width: home[0], height: home[1] });
  await page.waitForTimeout(900);
  await measure(page, sizes, `${label}-home`, home);
  await openAndMeasure(page, sizes, home, '#home [data-open="rules"]', `${label}-rules`);
  await openAndMeasure(page, sizes, home, '#home [data-open="gallery"]', `${label}-gallery`);
  await openAndMeasure(page, sizes, home, '#home [data-open="tracks"]', `${label}-tracks`);

  await page.locator('#createBtn').click();
  await page.locator('#lobby').waitFor({ state: 'visible' });
  await page.locator('#addAI').click();
  await page.locator('#addAI').click();
  await page.waitForFunction(() => document.querySelectorAll('#seats .seat:not(.empty)').length >= 3);
  await page.waitForTimeout(400);
  await measure(page, sizes, `${label}-lobby`, home);
  await page.locator('#startBtn').click();
  await page.locator('#game').waitFor({ state: 'visible' });
  await page.locator('#speedBtn').click();
  await page.locator('#speedBtn').click();

  const captured = new Set();
  const started = Date.now();
  while (Date.now() - started < Number(process.env.MAX_MS || 420000)) {
    const st = await state(page);
    const v = st.visual;
    const idle = !v.playing && !v.queue && !v.locked;
    const mine = await page.evaluate(() => !!document.querySelector('#dock .prompt.mine') || !!document.querySelector('.rcard.pickable'));
    let moment = null;
    if (v.phase === 'draft' && idle && mine) moment = 'draft';
    else if (v.overlayKind === 'pick' && idle && mine) moment = 'pick';
    else if (v.phase === 'race' && !v.overlayKind && idle && mine) moment = 'race';
    else if (v.overlayKind === 'results') moment = 'results';
    else if (st.final) moment = 'final';
    if (moment && !captured.has(moment)) {
      captured.add(moment);
      if (moment === 'results' || moment === 'final') await page.waitForTimeout(1200);
      await measure(page, sizes, `${label}-${moment}`, home);
    }
    if (st.final && v.phase === 'over' && !v.playing) break;
    if (!(await step(page))) await page.waitForTimeout(150);
  }
  for (const k of ['draft', 'pick', 'race', 'results', 'final']) if (!captured.has(k)) failures.push(`${label}：没有抓到 ${k} 界面`);

  await page.locator('#toHome').click();
  await page.locator('#home').waitFor({ state: 'visible' });
  await page.locator('#watchBtn').click();
  await page.locator('#game').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__hn().phase === 'race' && !document.getElementById('overlay').innerHTML, null, { timeout: 120000 }).catch(() => {});
  await measure(page, sizes, `${label}-spectator`, home);
}

(async () => {
  const app = await launch();
  try {
    await Promise.all([
      playThrough(app, 'mobile', MOBILE),
      playThrough(app, 'desktop', DESKTOP),
    ]);
  } finally {
    await app.close();
  }
  const total = seen.size, ok = [...seen.values()].filter(Boolean).length;
  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(`一屏布局：${ok}/${total} 个界面×尺寸通过`);
  }
  assert.equal(app.errors.length, 0, `页面错误：\n${app.errors.join('\n')}`);
  assert.equal(failures.length, 0, '存在纵向滚动、溢出或超出视口的界面');
  console.log(`一屏布局验收通过：${total} 个界面×尺寸，无页面滚动、无溢出`);
})().catch((error) => { console.error(error.message); process.exit(1); });
