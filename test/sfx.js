'use strict';
// 动效音效验收：离线渲染每个新音效，量峰值 / 100ms 短时响度 / 时长 / 节点数与断开，并和现有音效对比；
// tick 连发 20 次、hit 连发 10 次不削波且节流生效；真实页面里未解锁、三档声音模式、后台挂起时的行为。
// WAV=1 时把每个新音效和连发片段导出到 OUT_SFX（默认 /tmp/hunao-sfx）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./browser-helper');

const NEW_FNS = ['callout', 'hit', 'diceLand', 'swish', 'cardLand', 'tick', 'syncChime', 'rankUp', 'rankDown', 'pillar', 'boost', 'deny'];
// [导出名, 函数, 参数]
const NEW = [
  ['callout', 'callout'], ['hit', 'hit'], ['diceLand-1', 'diceLand', 1], ['diceLand-3', 'diceLand', 3], ['diceLand-6', 'diceLand', 6],
  ['swish', 'swish'], ['cardLand', 'cardLand'], ['tick-0', 'tick', 0], ['tick-7', 'tick', 7], ['syncChime', 'syncChime'],
  ['rankUp', 'rankUp'], ['rankDown', 'rankDown'], ['pillar-3', 'pillar', 3], ['pillar-2', 'pillar', 2], ['pillar-1', 'pillar', 1],
  ['boost', 'boost'], ['deny', 'deny'],
];
// 现有音效（diceLand 已换成新版，不计入基线；fanfare 在仅音效模式下走合成版本）
const OLD = ['click', 'hover', 'dice', 'hop', 'back', 'warp', 'trip', 'power', 'chip', 'lose', 'chomp', 'duel', 'finish', 'turn', 'yourTurn', 'card', 'reveal', 'blocked', 'pop', 'fanfare'];
const QUIET = new Set(['hit', 'tick-0', 'tick-7']);

// 页面里跑：离线渲染一组调用 [[秒, 函数名, ...参数]]，统计峰值、发声区间 100ms 短时响度最大值、时长、节点数
async function renderInPage({ src, calls, seconds, wav }) {
  const rate = 44100;
  const oac = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const counts = { created: 0, sources: 0, disconnected: 0, freqs: [] };
  for (const m of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource']) {
    const orig = oac[m].bind(oac);
    oac[m] = (...a) => {
      const n = orig(...a);
      counts.created++;
      if (m === 'createOscillator' || m === 'createBufferSource') counts.sources++;
      if (m === 'createOscillator') {
        const set = n.frequency.setValueAtTime.bind(n.frequency);
        n.frequency.setValueAtTime = (v, t) => { counts.freqs.push(v); return set(v, t); };
      }
      const d = n.disconnect.bind(n);
      n.disconnect = (...x) => { counts.disconnected++; return d(...x); };
      return n;
    };
  }
  window.AudioContext = function () { return oac; };
  delete window.Music;
  localStorage.setItem('hn_sound', 'sfx');
  new Function(src)();
  const errors = [];
  const byTime = new Map();
  for (const [at, ...call] of calls) byTime.set(at, [...(byTime.get(at) || []), call]);
  const run = (list) => { for (const [name, ...args] of list) { try { Sound[name](...args); } catch (e) { errors.push(e.message); } } };
  for (const [at, list] of byTime) {
    if (at <= 0) run(list);
    else oac.suspend(at).then(() => { run(list); oac.resume().catch(() => {}); });
  }
  const buf = await oac.startRendering();
  await new Promise((r) => setTimeout(r, 100)); // 等 onended 回调把节点断开
  const d0 = buf.getChannelData(0);
  let peak = 0; for (const v of d0) peak = Math.max(peak, Math.abs(v));
  let first = 0, last = d0.length - 1;
  while (first < d0.length && Math.abs(d0[first]) < peak / 100) first++;
  while (last > first && Math.abs(d0[last]) < peak / 100) last--;
  const res = window.__analyze(buf, first, last + 1, 0.1);
  Object.assign(res, { dur: (last + 1 - first) / rate, created: counts.created, sources: counts.sources, disconnected: counts.disconnected, freqs: counts.freqs, errors });
  if (wav) {
    const len = buf.length, ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const bytes = new Uint8Array(44 + len * 4), dv = new DataView(bytes.buffer);
    const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); dv.setUint32(4, 36 + len * 4, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 4, true);
    dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, len * 4, true);
    for (let i = 0; i < len; i++) for (let c = 0; c < 2; c++) dv.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    res.wav = btoa(bin);
  }
  return res;
}

// 与 test/music.js 相同的分析：峰值、整体响度、短时响度（winSec 窗口）
function analyze(buffer, from = 0, to = buffer.length, winSec = 0.4) {
  const chans = [...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c));
  let peak = 0, sum = 0, n = 0;
  const win = Math.floor(buffer.sampleRate * winSec), wins = [];
  let ws = 0, wn = 0;
  for (let i = from; i < to; i++) {
    let s2 = 0;
    for (const d of chans) { const v = d[i]; if (Math.abs(v) > peak) peak = Math.abs(v); s2 += v * v; }
    sum += s2; n += chans.length; ws += s2; wn += chans.length;
    if (wn >= win * chans.length) { wins.push(Math.sqrt(ws / wn)); ws = 0; wn = 0; }
  }
  if (wn && (!wins.length || wn >= (win * chans.length) / 2)) wins.push(Math.sqrt(ws / wn));
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  wins.sort((a, b) => a - b);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), shortMaxDb: db(wins[wins.length - 1] || 0) };
}

const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);

(async () => {
  const app = await launch();
  const wav = process.env.WAV === '1';
  const outDir = process.env.OUT_SFX || '/tmp/hunao-sfx';
  if (wav) fs.mkdirSync(outDir, { recursive: true });
  const report = { old: {}, new: {}, bursts: {} };
  // 离线部分先收集全部不达标项，打印量化表后再统一断言，方便一次看全
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  const checkEq = (a, b, msg) => check(a === b, `${msg}（实际 ${a}，期望 ${b}）`);
  try {
    /* ---------- 离线渲染 ---------- */
    const page = await app.page('音效离线渲染', { width: 393, height: 852 });
    await page.locator('#quickBtn').waitFor({ state: 'visible' });
    await page.mouse.click(5, 5);
    await page.evaluate(`window.__analyze = ${analyze.toString()}; window.__render = ${renderInPage.toString()}`);
    const src = await page.evaluate(async () => (await fetch('sound.js')).text());
    const render = async (name, calls, seconds) => {
      const r = await page.evaluate((o) => window.__render(o), { src, calls, seconds, wav });
      if (r.wav) { fs.writeFileSync(path.join(outDir, `${name}.wav`), Buffer.from(r.wav, 'base64')); delete r.wav; }
      assert.deepEqual(r.errors, [], `${name} 不应抛异常`);
      return r;
    };
    for (const name of OLD) {
      const r = await page.evaluate((o) => window.__render(o), { src, calls: [[0, name, 3]], seconds: 2.5, wav: false });
      report.old[name] = r;
    }
    const oldLoud = OLD.map((k) => report.old[k].shortMaxDb).sort((a, b) => a - b);
    const median = oldLoud[Math.floor(oldLoud.length / 2)];
    report.oldMedianDb = median;

    for (const [name, fn, ...args] of NEW) {
      const r = await render(name, [[0, fn, ...args]], 1.5);
      report.new[name] = r;
      check(r.peakDb < -6, `${name} 峰值 ${r.peakDb.toFixed(1)} dBFS 应低于 -6`);
      check(r.sources > 0, `${name} 应发声`);
      check(r.created <= 12, `${name} 每次触发建了 ${r.created} 个节点，太多`);
      checkEq(r.disconnected, r.created - 1, `${name} 结束后除总增益外的节点都应断开`);
      const diff = r.shortMaxDb - median;
      if (QUIET.has(name)) check(diff <= -6 && diff >= -10, `${name} 应比现有音效中位数低 6–10 dB（差 ${diff.toFixed(1)}）`);
      else check(Math.abs(diff) <= 3, `${name} 短时响度应与现有音效中位数持平 ±3 dB（差 ${diff.toFixed(1)}）`);
    }
    const callout = report.new.callout.dur;
    check(callout >= 0.2 && callout <= 0.35, `callout 时长 ${callout.toFixed(3)}s 应在 0.2–0.35s`);
    // diceLand 点数越大越高；tick 逐格升高；pillar 3→2→1 为 C5-E5-G5 大三和弦上行
    const f0 = (k) => Math.min(...report.new[k].freqs);
    check(f0('diceLand-1') < f0('diceLand-3') && f0('diceLand-3') < f0('diceLand-6'), 'diceLand 音高随点数升高');
    check(f0('tick-0') < f0('tick-7'), 'tick 音高随格序升高');
    const top = (k) => report.new[k].freqs[1]; // 第二个振荡器是柱顶的主音
    const [p3, p2, p1] = ['pillar-3', 'pillar-2', 'pillar-1'].map(top);
    check(Math.abs(p2 / p3 - 1.26) < 0.01 && Math.abs(p1 / p3 - 1.5) < 0.01, `pillar 3→2→1 应为大三和弦（${p3}/${p2}/${p1}）`);

    /* ---------- 连发：不削波、节流生效 ---------- */
    const at = (n, gap, fn) => [...Array(n)].map((_, i) => [i * gap, fn, i]);
    report.bursts['tick-20x30ms'] = await render('burst-tick-20x30ms', at(20, 0.03, 'tick'), 1.5);
    report.bursts['tick-20x80ms'] = await render('burst-tick-20x80ms', at(20, 0.08, 'tick'), 2.2);
    report.bursts['tick-20x0ms'] = await render('burst-tick-20x0ms', at(20, 0, 'tick'), 0.5);
    report.bursts['hit-10x60ms'] = await render('burst-hit-10x60ms', at(10, 0.06, 'hit'), 1.2);
    report.bursts['hit-10x0ms'] = await render('burst-hit-10x0ms', at(10, 0, 'hit'), 0.6);
    report.bursts['mix-all'] = await render('burst-mix-all', NEW.map(([, fn, ...args], i) => [i * 0.05, fn, ...args]), 2);
    const B = report.bursts;
    for (const [k, r] of Object.entries(B)) check(r.peakDb < -6, `${k} 峰值 ${r.peakDb.toFixed(1)} dBFS 不应削波`);
    check(B['tick-20x30ms'].sources <= 11 && B['tick-20x30ms'].sources >= 9, `30ms 间隔连发 20 次 tick，60ms 节流后应约 10 次（实际 ${B['tick-20x30ms'].sources}）`);
    checkEq(B['tick-20x80ms'].sources, 20, '80ms 间隔的 tick 每次都响');
    checkEq(B['tick-20x0ms'].sources, 1, '同一时刻连发 tick 只响一次');
    checkEq(B['hit-10x60ms'].sources, 20, '60ms 间隔的 hit 每次都响（每次 2 个声源）');
    checkEq(B['hit-10x0ms'].sources, 2, '同一时刻多枚棋子被击中只响一次');
    for (const [k, r] of Object.entries(B)) checkEq(r.disconnected, r.created - 1, `${k} 结束后节点都应断开`);
    await page.close();
    /* ---------- 量化表 ---------- */
    const row = (k, r) => `${k.padEnd(16)} 峰值 ${r1(r.peakDb).toString().padStart(6)} dBFS  短时 ${r1(r.shortMaxDb).toString().padStart(6)} dBFS  时长 ${r.dur.toFixed(3)}s  节点 ${r.created - 1}`;
    console.log(`现有音效 100ms 短时响度中位数：${r1(median)} dBFS`);
    for (const k of OLD) console.log(row(k, report.old[k]));
    console.log('--- 新音效 ---');
    for (const [k] of NEW) console.log(`${row(k, report.new[k])}  差 ${r1(report.new[k].shortMaxDb - median)} dB`);
    console.log('--- 连发 ---');
    for (const [k, r] of Object.entries(B)) console.log(`${row(k, r)}  声源 ${r.sources}`);
    assert.deepEqual(fails, [], `离线渲染不达标：\n${fails.join('\n')}`);

    /* ---------- 真实页面：未解锁、三档模式、闪避、后台挂起 ---------- */
    const live = await app.page('音效真实页面', { width: 393, height: 852 });
    const errors = [];
    live.on('pageerror', (e) => errors.push(e.message));
    live.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await live.locator('#quickBtn').waitFor({ state: 'visible' });
    await live.evaluate((fns) => {
      window.__fns = fns;
      window.__n = 0;
      const P = (window.BaseAudioContext || window.AudioContext).prototype;
      for (const m of ['createOscillator', 'createBufferSource']) {
        const orig = P[m];
        P[m] = function (...a) { window.__ac = this; window.__n++; return orig.apply(this, a); };
      }
      window.__fire = () => {
        const per = {};
        for (const fn of window.__fns) { const n0 = window.__n; Sound[fn](3); per[fn] = window.__n - n0; }
        return per;
      };
    }, NEW_FNS);
    await live.mouse.click(5, 5);
    await live.evaluate(() => Sound.unlock());
    await live.waitForTimeout(300);
    report.page = {};
    for (const m of ['all', 'sfx', 'off']) {
      const r = await live.evaluate(async (m) => {
        Sound.setMode(m);
        await new Promise((res) => setTimeout(res, 800)); // 等上一轮的声音放完、节流窗口过去
        let ducks = 0;
        const orig = Music.duck;
        Music.duck = () => { ducks++; return orig.call(Music); };
        const per = window.__fire();
        Music.duck = orig;
        return { per, ducks, state: window.__ac && window.__ac.state, musicEnabled: Music.enabled };
      }, m);
      report.page[m] = { ducks: r.ducks, state: r.state, musicEnabled: r.musicEnabled };
      for (const fn of NEW_FNS) {
        if (m === 'off') assert.equal(r.per[fn], 0, `全部静音时 ${fn} 不出声`);
        else assert(r.per[fn] > 0, `${m} 模式下 ${fn} 应出声`);
      }
      assert.equal(r.ducks > 0, m === 'all', `${m} 模式下音乐闪避${m === 'all' ? '应' : '不应'}触发`);
    }
    // 连按 20 次 tick（同一帧）只建 1 个声源
    const burst = await live.evaluate(async () => {
      Sound.setMode('sfx');
      await new Promise((res) => setTimeout(res, 100));
      const n0 = window.__n;
      for (let i = 0; i < 20; i++) Sound.tick(i);
      return window.__n - n0;
    });
    assert.equal(burst, 1, `真实页面同一帧连发 20 次 tick 应只响 1 次（实际 ${burst}）`);
    // 上下文挂起（如切到后台）时静默跳过，恢复后照常出声
    const suspended = await live.evaluate(async () => {
      await window.__ac.suspend();
      await new Promise((res) => setTimeout(res, 100));
      const per = window.__fire();
      await window.__ac.resume();
      await new Promise((res) => setTimeout(res, 100));
      const after = window.__fire();
      Sound.setMode('all');
      return { per, after };
    });
    for (const fn of NEW_FNS) {
      assert.equal(suspended.per[fn], 0, `上下文挂起时 ${fn} 静默跳过`);
      assert(suspended.after[fn] > 0, `恢复后 ${fn} 照常出声`);
    }
    // 还没有用户手势（AudioContext 未解锁）：另起一个 Sound 实例并把 userActivation 伪装成未激活，
    // 新函数都应静默跳过、不创建 AudioContext、不抛异常。放在最后做，做完即关页面。
    const locked = await live.evaluate((src) => {
      const real = { Sound: window.Sound, AC: window.AudioContext };
      let made = 0;
      window.AudioContext = function (...a) { made++; return new real.AC(...a); };
      Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ hasBeenActive: false, isActive: false }) });
      const n0 = window.__n, thrown = [];
      try {
        new Function(src)();
        for (const fn of window.__fns) { try { Sound[fn](2); } catch (e) { thrown.push(`${fn}: ${e.message}`); } }
        return { made, nodes: window.__n - n0, thrown };
      } finally {
        delete navigator.userActivation;
        window.AudioContext = real.AC;
        window.Sound = real.Sound;
      }
    }, src);
    assert.deepEqual(locked, { made: 0, nodes: 0, thrown: [] }, '未解锁时新音效静默跳过，不建 AudioContext、不抛异常');
    assert.deepEqual(errors, [], `控制台没有报错：${errors.join(' | ')}`);
    await live.close();

    console.log(`真实页面：${JSON.stringify(report.page)}`);
    if (wav) console.log(`WAV 已导出到 ${outDir}`);
    console.log('动效音效验收通过');
  } catch (e) {
    throw e;
  } finally {
    await app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
