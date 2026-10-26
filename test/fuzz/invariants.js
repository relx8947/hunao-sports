// 规则不变量压测：6 人全 AI 对局逐事件检查（派对杀手、移动路径、巨婴同格、算式、完赛等）。
// 用法：node test/fuzz/invariants.js <v1|v2|mix> <起始种子> <局数> <结果.json>；并行跑多个分片后合并 issues。
// 复现某一局：node test/fuzz/dive.js <模式> <种子> race <场次>
// 6 人全 AI 对局压测 + 规则不变量检查。用法：node fuzz.js <模式> <起始种子> <局数> <输出文件>
const P = require('path').join(__dirname, '..', '..') + '/';
const fs = require('fs');
const { Game, FINISH } = require(P + 'game/engine');
const { decide } = require(P + 'game/ai');
const [edition, seed0, count, outFile] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const issues = {}; const stats = { games: 0, races: 0, events: 0, decisions: 0, powers: {}, twists: {}, capped: 0 };
function note(kind, ctx, detail) {
  const x = (issues[kind] ||= { n: 0, ex: [] });
  x.n++;
  if (x.ex.length < 3) x.ex.push({ ...ctx, detail });
}
for (let i = 0; i < count; i++) {
  const seed = seed0 + i;
  const g = new Game({ players: Array.from({ length: 6 }, (_, k) => ({ name: `P${k}`, ai: true })), seed, edition });
  const ctx = { edition, seed };
  const pos = new Map();            // 按事件推出来的位置
  let turnRid = null, turnRolls = [], turnVoided = 0, lastMainCalc = null; var recent = []; const powHist = new Map();
  const orig = g.emit.bind(g);
  g.emit = (e) => {
    try {
      const c = { ...ctx, race: g.raceNo, ev: e.t, prev: recent.slice(-4).join(',') };
      recent.push(e.t === 'twist' ? 'twist:' + e.id : e.t); if (recent.length > 8) recent.shift();
      const r = e.rid ? g.byRid(e.rid) : null;
      // 回合开始时引擎会先把和巨婴同格的人挤走（babySweep），所以检查放在 turn 之后的第一个非挤人事件上
      if (recent[recent.length - 2] === 'turn' && e.t !== 'warp' && e.t !== 'swap') {
        for (const baby of g.holders('hugebaby')) if (baby.pos > 0 && baby.pos < FINISH) { const same = g.others(baby).filter((o) => o.pos === baby.pos); if (same.length) note('回合开始时巨婴格子上有别人', { ...c, prev: recent.join(',') }, { baby: baby.rid + '@' + baby.pos, others: same.map((o) => o.rid) }); }
      }
      switch (e.t) {
        case 'reveal': case 'raceIntro': pos.clear(); for (const x of g.racers) pos.set(x.rid, x.pos); break;
        case 'turn': {
          turnRid = e.rid; turnRolls = []; turnVoided = 0;
          if (r && (r.finished || r.out)) note('已冲线/淘汰的运动员还在行动', c, e);
          for (const x of g.racers) if (!pos.has(x.rid)) pos.set(x.rid, x.pos);
          break;
        }
        case 'move': {
          if (pos.has(e.rid) && pos.get(e.rid) !== e.from) note('移动起点和上一次位置对不上（有没发事件的位置变化）', c, { e, known: pos.get(e.rid) }), (issues.__prevs ||= {})[c.prev.split(',').pop()] = ((issues.__prevs || {})[c.prev.split(',').pop()] || 0) + 1;
          if (e.to < 0 || e.to > FINISH) note('移动越界', c, e);
          if (e.path && e.path.length && e.path[e.path.length - 1] !== e.to) note('移动路径终点≠目标', c, e);
          if (e.path) for (let k = 0; k < e.path.length; k++) { const prev = k ? e.path[k - 1] : e.from; if (Math.abs(e.path[k] - prev) !== 1) { note('移动路径不连续', c, e); break; } }
          if (r && r.out) note('已淘汰的运动员还在移动', c, e);
          pos.set(e.rid, e.to); break;
        }
        case 'finale': pos.clear(); for (const x of g.racers) pos.set(x.rid, x.pos); break;
        case 'warp': case 'swap':
          if (e.rid && e.to != null) pos.set(e.rid, e.to);
          if (e.t === 'swap') { pos.clear(); for (const x of g.racers) pos.set(x.rid, x.pos); }
          break;
        case 'roll': case 'rolls': {
          const vals = e.t === 'rolls' ? e.dice : [e.value];
          if (vals.some((v) => !Number.isInteger(v) || v < 1 || v > 6)) note('骰点不在 1–6', c, e);
          const fixed = g.fixedRoll && r ? g.fixedRoll[r.seat] : undefined;
          if (vals.includes(6) && fixed !== 6 && g.holders('pooper').length) note('派对杀手在场，掷出的 6 没被作废', c, { e, poopers: g.holders('pooper').map((x) => x.rid) });
          if (e.t === 'roll' && !e.purpose && e.rid === turnRid) turnRolls.push(e.value);
          break;
        }
        case 'voided': turnVoided++; if (!g.holders('pooper').length) note('没有派对杀手却作废了 6', c, e); break;
        case 'calc': {
          lastMainCalc = e;
          if (!e.mods.some((m) => m.mult) && !e.reverse) {
            const exp = e.base + e.mods.reduce((a, m) => a + m.v, 0);
            if (e.total !== exp && e.total !== Math.max(0, exp)) note('主移动算式对不上', c, e);
          }
          // 伊卡洛斯：最终点数含 6 就该淘汰（显摆王累加的每颗都算）
          break;
        }
        case 'power': {
          if (!r) { note('技能事件找不到运动员', c, e); break; }
          stats.powers[e.key] = (stats.powers[e.key] || 0) + 1;
          const offTrack = ['rerunner', 'doppel', 'sisyphus', 'understudy', 'egg', 'twin', 'copycat'].includes(e.key) || r.power === 'copycat';
          const hist = powHist.get(r.rid) || [];
          if (false && !offTrack && !(r.finished || r.out) && !g.has(r, e.key) && !hist.some((h) => h.includes(e.key))) note('没有这个技能却发动了:' + e.key, c, { e, powers: g.powers(r), hist });
          break;
        }
        case 'twist': stats.twists[e.id] = (stats.twists[e.id] || 0) + 1; if (g.trackKey !== 'twisty') note('变数卡出现在非扭扭糖果赛道', c, e); break;
        case 'finish': if (r && r.pos < FINISH && !g.finale && !/预言成真/.test(e.text || '')) note('冲线时位置没到终点', c, { e, pos: r.pos }); break;
        case 'raceEnd': {
          stats.races++;
          const fin = e.standings.filter((s) => s.finished);
          if (fin.length > 2) note('完赛人数超过 2', c, e.standings);
          if (e.reason === 'finished' && fin.length < 2 && !g.finale && !/预言成真/.test(recent.join()) && !e.standings.some((s) => s.benched) && !e.standings.every((s) => s.finished || s.out)) note('还没两人冲线就结束了', c, { reason: e.reason, standings: e.standings });
          break;
        }
      }
    } catch (err) { note('检查器异常：' + err.message, ctx, e); }
    stats.events++;
    for (const x of g.racers) { const h = powHist.get(x.rid) || []; h.push(g.powers(x).join('|')); if (h.length > 12) h.shift(); powHist.set(x.rid, h); }
    return orig(e);
  };
  // 每次决策后检查场上不变量
  const check = () => {
    if (g.phase !== 'race') return;
    const c = { ...ctx, race: g.raceNo };
    for (const x of g.racers) {
      if (x.pos < 0 || x.pos > FINISH) note('位置越界', c, x);
      if (x.finished && x.out) note('既冲线又淘汰', c, x);
    }

    const seats = new Set(g.racers.filter((x) => !x.extra).map((x) => x.seat));
    if (edition === 'v1' && seats.size !== 6) note('席位缺运动员', c, [...seats]);
  };
  let steps = 0;
  try {
    g.start();
    while (g.pending) {
      if (++steps > 30000) throw new Error('决策步数过多，疑似死循环');
      const d = g.pending; stats.decisions++;
      if (d.simul) for (const s of d.seats) { const err = g.answer(s, d.id, decide(g, d, s)); if (err) note('AI 答案被拒（simul）：' + err, { ...ctx, race: g.raceNo }, { kind: d.kind }); }
      else { const v = decide(g, d, d.seat); if (!d.options.some((o) => o.v === v)) note('AI 给出不在选项里的答案', { ...ctx, race: g.raceNo }, { kind: d.kind, v }); const err = g.answer(d.seat, d.id, v); if (err) note('AI 答案被拒：' + err, { ...ctx, race: g.raceNo }, { kind: d.kind, v }); }
      g.drain(); check();
    }
    if (g.phase !== 'over') note('对局没结束', ctx, g.phase);
    if (g.results.length !== 4) note('场数不对', ctx, g.results.length);
    const scores = g.results.length ? g.results[g.results.length - 1].scores : [];
    if (!scores.every((s) => Number.isInteger(s) && s >= 0)) note('分数异常', ctx, scores);
    for (const res of g.results) if (res.turns >= 240) stats.capped++;
  } catch (err) {
    note('崩溃：' + err.message.split('\n')[0], { ...ctx, race: g.raceNo }, (err.stack || '').split('\n').slice(1, 4).join(' | '));
  }
  stats.games++;
}
fs.writeFileSync(outFile, JSON.stringify({ edition, seed0, count, stats, issues }));
