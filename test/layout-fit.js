'use strict';
// 一屏布局验收：每个界面在每个手机/电脑尺寸下都不能出现页面滚动，内容也不能被裁掉。
// 手机与电脑各跑一局（房间 → 选秀 → 暗选 → 比赛 → 单场结算 → 总结算），再看一局 AI 观战，
// 模式：手机打一代、看混合观战；电脑在大厅切到二代再开赛。首页模式选择器、大厅模式行、图鉴筛选、地图图鉴模式切换、规则书变数卡页都单独量。
// 在每个关键时刻把视口切到各个尺寸逐一量：
//   1. document.scrollingElement 的 scrollHeight/scrollWidth 不超过视口；
//   2. 标了 data-fit 的容器和浮层/弹窗内部没有纵向溢出（分页必须真的放得下）；
//   3. 可见的按钮/输入框/链接完整落在视口里。
// SHOTS=<目录> 时每个尺寸各截一张图，用于人工复核。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, step, state, quickStart } = require('./browser-helper');

const MOBILE = [[360, 740], [375, 667], [393, 852], [430, 932], [393, 700], [390, 664], [375, 560], [844, 390], [852, 393], [667, 375]];
const DESKTOP = [[1920, 1080], [1440, 900], [1366, 768], [1280, 720]];
// 二代赛道（扭扭糖果 / 漩涡乐园）比赛画面要量的尺寸
const V2_MOBILE = [[393, 852], [360, 740], [390, 664], [852, 393]];
const V2_DESKTOP = [[1440, 900], [1920, 1080], [1280, 720]];
const SHOTS = process.env.SHOTS;
const failures = [];
const seen = new Map();

async function measure(page, sizes, screen, home, expectOverlay) {
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
      const boxes = [...document.querySelectorAll('[data-fit], .ov-box, .modal-body, .home-inner, .room-directory, .lobby-inner, .draft')].filter(visible);
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
      return { sh: se.scrollHeight, sw: se.scrollWidth, ih: innerHeight, iw: innerWidth, overflow, culprits, outside: [...new Set(outside)].slice(0, 6), overlayKind: window.__hn ? window.__hn().overlayKind : null };
    });
    const tag = `${screen} @${width}×${height}`;
    const bad = [];
    if (m.sh > m.ih + 1) bad.push(`页面纵向滚动 ${m.sh}>${m.ih} ${m.culprits.join(' ')}`);
    if (m.sw > m.iw + 1) bad.push(`页面横向滚动 ${m.sw}>${m.iw}`);
    if (m.overflow.length) bad.push(`容器溢出 ${m.overflow.join('；')}`);
    if (m.outside.length) bad.push(`超出视口 ${m.outside.join('、')}`);
    // 量的必须真是要验收的那个浮层（倍速下单场结算曾被下一场暗选顶掉，量到的其实是暗选）
    if (expectOverlay && m.overlayKind !== expectOverlay) bad.push(`拍到的是 ${m.overlayKind || '无浮层'}，不是 ${expectOverlay}`);
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

async function openAndMeasure(page, sizes, home, opener, screen, extra = []) {
  const button = page.locator(opener).first();
  if (!(await button.count())) return;
  await button.click();
  await page.locator('#modal .modal-box').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await measure(page, sizes, screen, home);
  // 弹窗里的筛选/切换后再量一遍（图鉴筛选二代、地图图鉴混合四条、规则书末页变数卡）
  for (const [name, action] of extra) {
    await action();
    await page.waitForTimeout(400);
    await measure(page, sizes, `${screen}-${name}`, home);
  }
  await page.locator('#mClose').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
}

async function playThrough(app, label, sizes, edition) {
  const home = sizes[0];
  const page = await app.page(`${label}验收`, { width: home[0], height: home[1] });
  await page.waitForTimeout(900);
  await measure(page, sizes, `${label}-home`, home);
  // 首页模式选择器：说明文字最长的二代也要一屏放下
  await page.locator('#editionSeg [data-ed="v2"]').click();
  await measure(page, sizes, `${label}-home-v2`, home);
  await page.locator('#editionSeg [data-ed="v1"]').click();
  const lastPage = async () => { for (let i = 0; i < 20 && await page.locator('#mPager [data-pg="1"]:not([disabled])').count(); i++) await page.locator('#mPager [data-pg="1"]').click(); };
  await openAndMeasure(page, sizes, home, '#home [data-open="rules"]', `${label}-rules`, [['last', lastPage]]);
  await openAndMeasure(page, sizes, home, '#home [data-open="gallery"]', `${label}-gallery`, [['v2', () => page.locator('#modal button[data-gf="v2"]:visible').click()]]);
  await openAndMeasure(page, sizes, home, '#home [data-open="tracks"]', `${label}-tracks`, [['mix', () => page.locator('#tgEds [data-ed="mix"]').click()]]);

  await page.locator('#createBtn').click();
  await page.locator('#lobby').waitFor({ state: 'visible' });
  await page.locator('#addAI').click();
  await page.locator('#addAI').click();
  await page.waitForFunction(() => document.querySelectorAll('#seats .seat:not(.empty)').length >= 3);
  if (edition !== 'v1') {
    await page.locator(`#lobbyEdition [data-ed="${edition}"]`).click();
    await page.waitForFunction(ed => window.__testRoom && window.__testRoom.edition === ed, edition);
  }
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
      // 单场结算：用测试钩子让结果浮层停住（下一场出战排队），各尺寸量完再放行
      if (moment === 'results') await page.evaluate(() => { window.__hnHoldResults = true; });
      if (moment === 'results' || moment === 'final') await page.waitForTimeout(1200);
      await measure(page, sizes, `${label}-${moment}`, home, moment === 'results' || moment === 'final' ? moment : null);
      if (moment === 'results') await page.evaluate(() => { window.__hnHoldResults = false; });
    }
    if (st.final && v.phase === 'over' && !v.playing) break;
    if (!(await step(page))) await page.waitForTimeout(150);
  }
  for (const k of ['draft', 'pick', 'race', 'results', 'final']) if (!captured.has(k)) failures.push(`${label}：没有抓到 ${k} 界面`);

  const played = (await state(page)).game.snap.edition;
  if (played !== edition) failures.push(`${label}：对局模式 ${played}，应为 ${edition}`);
  await page.locator('#toHome').click();
  await page.locator('#home').waitFor({ state: 'visible' });
  if (label === 'mobile') await page.locator('#editionSeg [data-ed="mix"]').click();
  await page.locator('#watchBtn').click();
  await page.locator('#game').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.__hn().phase === 'race' && !document.getElementById('overlay').innerHTML, null, { timeout: 120000 }).catch(() => {});
  await measure(page, sizes, `${label}-spectator`, home);
}

// 二代快速局：扭扭糖果（第 1 场）与漩涡乐园（第 2 场）各在比赛中轮到本人时量一次
async function v2Through(app, label, sizes) {
  const home = sizes[0];
  const page = await app.page(`二代${label}验收`, { width: home[0], height: home[1] });
  await page.waitForTimeout(600);
  await quickStart(page, { ai: 3, edition: 'v2' });
  await page.locator('#speedBtn').click();
  await page.locator('#speedBtn').click();
  const captured = new Set();
  const started = Date.now();
  while (captured.size < 2 && Date.now() - started < Number(process.env.MAX_MS || 420000)) {
    const st = await state(page);
    const v = st.visual, snap = st.game && st.game.snap;
    const idle = !v.playing && !v.queue && !v.locked;
    const mine = await page.evaluate(() => !!document.querySelector('#dock .prompt.mine'));
    const track = snap && snap.track;
    // 跑过几轮再量：让变数徽标、漩涡、运动员分散在赛道上
    if (v.phase === 'race' && !v.overlayKind && idle && mine && ['twisty', 'whirly'].includes(track) && !captured.has(track)) {
      const turns = await page.evaluate(() => window.__testMessages.filter((m) => m.type === 'game').reduce((n, m) => n + (m.events || []).filter((e) => e.t === 'turn').length, 0));
      if (turns > 8 + snap.raceNo * 6) {
        captured.add(track);
        const marks = await page.evaluate(() => document.querySelectorAll('#trackSvg .twl-mark').length);
        if (track === 'whirly' && marks !== 12) failures.push(`二代${label}：漩涡格应为 12 个，实际 ${marks}`);
        await measure(page, sizes, `v2-${label}-${track}`, home);
      }
    }
    if (st.final) break;
    if (!(await step(page))) await page.waitForTimeout(150);
  }
  for (const k of ['twisty', 'whirly']) if (!captured.has(k)) failures.push(`二代${label}：没有抓到 ${k} 比赛界面`);
}

(async () => {
  const app = await launch();
  try {
    await Promise.all([
      playThrough(app, 'mobile', MOBILE, 'v1'),
      playThrough(app, 'desktop', DESKTOP, 'v2'),
      v2Through(app, 'mobile', V2_MOBILE),
      v2Through(app, 'desktop', V2_DESKTOP),
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
