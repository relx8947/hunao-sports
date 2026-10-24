'use strict';
// 背景音乐验收：离线渲染量化（峰值 / 响度 / 循环接缝 / 与音效的音量差）+ 真实页面整局场景切换与声音三档。
// WAV=1 时把各场景 60 秒和两段号角导出到 OUT_BGM（默认 /tmp/hunao-bgm）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, step, state } = require('./browser-helper');
const Music = require('../public/music.js');

const { SCENES, parseBar } = Music._test;
for (const [key, def] of Object.entries(SCENES)) {
  def.melody.forEach((bar, i) => assert.equal(parseBar(bar).total, 16, `${key} 第 ${i + 1} 小节时值不足一小节`));
  assert.equal(def.chords.length, def.melody.length, `${key} 和弦与旋律小节数一致`);
  assert(def.bars >= 16 && def.bars <= 32, `${key} 循环 ${def.bars} 小节`);
}
assert.equal(Music._test.sceneKey('over'), 'home');
assert.equal(Music._test.sceneKey('nope'), 'home');

// 页面里跑的分析函数：峰值、整体响度、400ms 短时响度中位数、最大采样跳变
function analyze(buffer, from = 0, to = buffer.length, winSec = 0.4) {
  const chans = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
  let peak = 0, sum = 0, n = 0, jump = 0;
  const win = Math.floor(buffer.sampleRate * winSec), wins = [];
  let ws = 0, wn = 0;
  for (let i = from; i < to; i++) {
    let s2 = 0;
    for (const d of chans) {
      const v = d[i];
      if (Math.abs(v) > peak) peak = Math.abs(v);
      if (i > from) jump = Math.max(jump, Math.abs(v - d[i - 1]));
      s2 += v * v;
    }
    sum += s2; n += chans.length; ws += s2; wn += chans.length;
    if (wn >= win * chans.length) { wins.push(Math.sqrt(ws / wn)); ws = 0; wn = 0; }
  }
  // 不足一个窗口的尾巴：整段比窗口还短（短音效）或至少半个窗口时也算一个窗口
  if (wn && (!wins.length || wn >= (win * chans.length) / 2)) wins.push(Math.sqrt(ws / wn));
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  wins.sort((a, b) => a - b);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), shortMedianDb: db(wins[Math.floor(wins.length / 2)] || 0), shortMinDb: db(wins[0] || 0), shortMaxDb: db(wins[wins.length - 1] || 0), jump };
}

(async () => {
  const app = await launch();
  const outDir = process.env.OUT_BGM || '/tmp/hunao-bgm';
  const report = {};
  try {
    const page = await app.page('音乐测试', { width: 393, height: 852 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.locator('#quickBtn').waitFor({ state: 'visible' });
    await page.evaluate(`window.__analyze = ${analyze.toString()}`);

    /* ---------- 离线渲染 ---------- */
    const renders = [
      ['home', 60, {}], ['draft', 60, {}],
      ['race', 60, { heat: [[0, 0], [20, 0.7], [40, 0.9]] }],
      ['stinger-race', 5, {}], ['stinger-final', 7, {}],
    ];
    if (process.env.WAV === '1') fs.mkdirSync(outDir, { recursive: true });
    for (const [name, seconds, opts] of renders) {
      const r = await page.evaluate(async ({ name, seconds, opts, wav }) => {
        const heat = opts.heat;
        const buf = await Music.render(name, seconds, { heatAt: heat ? (t) => heat.filter(([s]) => t >= s).pop()[1] : undefined });
        const res = window.__analyze(buf);
        if (wav) {
          const len = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(1)];
          const bytes = new Uint8Array(44 + len * 4), dv = new DataView(bytes.buffer);
          const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
          str(0, 'RIFF'); dv.setUint32(4, 36 + len * 4, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
          dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * 4, true);
          dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, len * 4, true);
          for (let i = 0; i < len; i++) for (let c = 0; c < 2; c++) dv.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          res.wav = btoa(bin);
        }
        return res;
      }, { name, seconds, opts, wav: process.env.WAV === '1' });
      if (r.wav) { fs.writeFileSync(path.join(outDir, `${name}.wav`), Buffer.from(r.wav, 'base64')); delete r.wav; }
      report[name] = r;
      assert(r.peakDb < -1, `${name} 峰值 ${r.peakDb.toFixed(1)} dBFS 不能削波`);
      assert(r.rmsDb > -45, `${name} 不能几乎无声`);
    }
    const loops = ['home', 'draft', 'race'].map((k) => report[k].shortMedianDb);
    assert(Math.max(...loops) - Math.min(...loops) < 4, `各场景短时响度差 ${(Math.max(...loops) - Math.min(...loops)).toFixed(1)} dB 应小于 4 dB`);

    // 循环接缝：从倒数第 2 小节开始渲染，比较接缝前后 ±60ms 的最大采样跳变和短时响度
    report.seams = {};
    for (const key of ['home', 'draft', 'race']) {
      const r = await page.evaluate(async (key) => {
        const def = Music._test.SCENES[key], barSec = 16 * 60 / def.bpm / 4;
        const seam = 0.05 + 2 * barSec, total = seam + 2 * barSec;
        const buf = await Music.render(key, total, { startBar: def.bars - 2 });
        const at = Math.floor(seam * buf.sampleRate), w = Math.floor(0.06 * buf.sampleRate);
        const around = window.__analyze(buf, at - w, at + w), whole = window.__analyze(buf);
        const before = window.__analyze(buf, at - Math.floor(barSec * buf.sampleRate), at);
        const after = window.__analyze(buf, at, at + Math.floor(barSec * buf.sampleRate));
        return { seamJump: around.jump, maxJump: whole.jump, beforeDb: before.rmsDb, afterDb: after.rmsDb };
      }, key);
      report.seams[key] = r;
      assert(r.seamJump <= r.maxJump * 1.0001, `${key} 接缝处不应出现全曲最大的采样跳变`);
      assert(Math.abs(r.beforeDb - r.afterDb) < 6, `${key} 接缝前后响度差 ${(r.beforeDb - r.afterDb).toFixed(1)} dB`);
    }

    /* ---------- 与音效的音量对比（同一页面里离线渲染 sound.js 的音效） ---------- */
    const sfxPage = await app.page('音效测量', { width: 393, height: 852 });
    await sfxPage.locator('#quickBtn').waitFor({ state: 'visible' });
    await sfxPage.mouse.click(5, 5);
    await sfxPage.evaluate(`window.__analyze = ${analyze.toString()}`);
    report.sfx = await sfxPage.evaluate(async () => {
      const src = await (await fetch('sound.js')).text();
      const out = {};
      for (const name of ['click', 'dice', 'diceLand', 'hop', 'card', 'turn', 'yourTurn', 'power', 'finish', 'reveal']) {
        const oac = new OfflineAudioContext(2, 44100 * 2, 44100);
        window.AudioContext = function () { return oac; };
        delete window.Music;
        localStorage.setItem('hn_sound', 'sfx');
        new Function(src)();
        Sound[name](3);
        const buf = await oac.startRendering();
        // 只统计发声部分（高于峰值 -40 dB 的采样所在区间），取 100ms 短时响度的最大值代表听感
        const d = buf.getChannelData(0);
        let peak = 0; for (const v of d) peak = Math.max(peak, Math.abs(v));
        let first = 0, last = d.length - 1;
        while (first < d.length && Math.abs(d[first]) < peak / 100) first++;
        while (last > first && Math.abs(d[last]) < peak / 100) last--;
        out[name] = window.__analyze(buf, first, last + 1, 0.1);
      }
      return out;
    });
    await sfxPage.close();
    const sfxLoud = Object.values(report.sfx).map((r) => r.shortMaxDb).sort((a, b) => a - b);
    report.sfxMedianDb = sfxLoud[Math.floor(sfxLoud.length / 2)];
    for (const k of ['home', 'draft', 'race']) {
      assert(report.sfxMedianDb - report[k].shortMedianDb >= 6, `${k} 音乐应比音效短时响度中位数低至少 6 dB（差 ${(report.sfxMedianDb - report[k].shortMedianDb).toFixed(1)} dB）`);
    }

    /* ---------- 真实页面：声音三档、刷新保持、旧设置兼容 ---------- */
    await page.evaluate(() => { localStorage.removeItem('hn_sound'); localStorage.setItem('hn_mute', '1'); });
    await page.reload();
    await page.locator('#quickBtn').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => Sound.mode), 'off', '旧版 hn_mute=1 兼容为全部静音');
    await page.evaluate(() => { localStorage.removeItem('hn_sound'); localStorage.removeItem('hn_mute'); });
    await page.reload();
    await page.locator('#quickBtn').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => Sound.mode), 'all', '默认开启音乐');
    await page.locator('#aiCount [data-v="2"]').click();
    await page.locator('#quickBtn').click();
    await page.locator('#game').waitFor({ state: 'visible' });
    const btn = page.locator('#soundBtn');
    const seen = [];
    for (const expected of ['sfx', 'off', 'all']) {
      await btn.click();
      const s = await page.evaluate(() => ({ mode: Sound.mode, enabled: Music.enabled, title: document.querySelector('#soundBtn').title, svg: document.querySelector('#soundBtn svg').innerHTML }));
      assert.equal(s.mode, expected);
      assert.equal(s.enabled, expected === 'all');
      seen.push(s);
    }
    assert.equal(new Set(seen.map((s) => s.svg)).size, 3, '三档图标各不相同');
    assert.equal(new Set(seen.map((s) => s.title)).size, 3, '三档提示各不相同');
    await btn.click(); // → sfx，刷新后保持
    await page.reload();
    await page.locator('#game, #home, #lobby').first().waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => Sound.mode), 'sfx', '刷新后保持仅音效');
    await page.evaluate(() => Sound.setMode('all'));

    /* ---------- 真实页面整局：场景按阶段切换，号角替代音效 ---------- */
    await page.locator('#game').waitFor({ state: 'visible' });
    await page.locator('#topTitle').click();
    await page.locator('#speedBtn').click();
    await page.locator('#speedBtn').click();
    const scenes = new Set(), wants = [];
    let stingers = 0, levels = new Set(), final;
    await page.evaluate(() => {
      const orig = Music.stinger;
      window.__stingers = 0;
      Music.stinger = (k) => { const r = orig(k); if (r) window.__stingers++; return r; };
    });
    const started = Date.now();
    while (Date.now() - started < Number(process.env.MAX_MS || 600000)) {
      const st = await state(page);
      const m = await page.evaluate(() => ({ ...Music.state(), stingers: window.__stingers }));
      if (m.playing) scenes.add(m.playing);
      if (wants[wants.length - 1] !== m.want) wants.push(m.want);
      levels.add(m.level);
      stingers = m.stingers;
      if (st.final && st.visual.phase === 'over' && !st.visual.playing && !st.visual.queue) { final = st; break; }
      if (!(await step(page))) await page.waitForTimeout(120);
    }
    assert(final, '整局应在时限内完成');
    await page.waitForTimeout(6000);
    const end = await page.evaluate(() => Music.state());
    report.game = { scenes: [...scenes], wants, stingers, levels: [...levels], end };
    assert(scenes.has('draft') && scenes.has('race'), `整局应播放过选秀与比赛音乐：${[...scenes]}`);
    assert(wants.includes('over'), '总结算进入 over 场景');
    assert(stingers >= 4, `四场冲线 + 总冠军应至少触发 4 次号角，实际 ${stingers}`);
    assert.equal(end.playing, 'home', '总冠军号角之后回到首页音乐');
    assert(levels.has(1) || levels.has(2), '有人接近终点时比赛音乐应加强');
    assert.deepEqual(errors, [], `控制台没有报错：${errors.join(' | ')}`);
    console.log(JSON.stringify(report, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1));
    console.log('背景音乐验收通过');
  } catch (e) {
    console.error(JSON.stringify(report, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 1));
    throw e;
  } finally {
    await app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
