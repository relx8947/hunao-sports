'use strict';
// 引擎压力测试：大量全 AI 对局，检查崩溃、死循环、状态不变量
const { Game, FINISH } = require('../game/engine');
const { decide } = require('../game/ai');

const N = Number(process.argv[2]) || 2000;
let races = 0, turns = 0, decisions = 0, capped = 0, cappedRaces = 0;
const kinds = {};
const powerSeen = {};
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const n = 2 + (i % 5);
  const seed = 1000 + i;
  const g = new Game({ players: Array.from({ length: n }, (_, k) => ({ name: `P${k}`, ai: true })), seed });
  g.start();
  let steps = 0;
  try {
    while (g.pending) {
      if (++steps > 20000) throw new Error('决策步数过多，疑似死循环');
      const d = g.pending;
      kinds[d.kind] = (kinds[d.kind] || 0) + 1;
      decisions++;
      if (d.simul) {
        for (const s of d.seats) {
          const err = g.answer(s, d.id, decide(g, d, s));
          if (err) throw new Error(`simul answer: ${err}`);
        }
      } else {
        const err = g.answer(d.seat, d.id, decide(g, d, d.seat));
        if (err) throw new Error(`answer ${d.kind}: ${err} opts=${JSON.stringify(d.options)}`);
      }
      for (const e of g.drain()) {
        if (e.t === 'power') powerSeen[e.key] = (powerSeen[e.key] || 0) + 1;
        if (e.t === 'move' && (e.to < 0 || e.to > FINISH)) throw new Error('越界移动 ' + JSON.stringify(e));
      }
      for (const r of g.racers) if (r.pos < 0 || r.pos > FINISH) throw new Error('位置越界');
    }
    if (g.phase !== 'over') throw new Error('对局未结束 phase=' + g.phase);
    if (g.results.length !== 4) throw new Error('比赛场数不对');
    races += 4;
    for (const r of g.results) {
      const fin = r.standings.filter((s) => s.finished);
      if (fin.length > 2) throw new Error('完赛人数 >2');
    }
    turns += g.results.reduce((sum, r) => sum + r.turns, 0);
    const limited = g.results.filter(r => r.reason === 'turn-limit' || r.reason === 'loop-limit').length;
    cappedRaces += limited;
    if (limited) capped++;
  } catch (e) {
    console.error(`对局 #${i} (n=${n}, seed=${seed}) 失败:`, e.stack);
    console.error('最近日志:', g.log.slice(-15).map((l) => l.text).join('\n  '));
    process.exit(1);
  }
}
console.log(`完成 ${N} 局 / ${races} 场比赛，用时 ${Date.now() - t0}ms`);
console.log(`平均决策 ${(decisions / N).toFixed(1)} 次/局，保护上限 ${capped} 局 / ${cappedRaces} 场；平均回合 ${(turns / races).toFixed(1)} 次/场`);
console.log('决策类型:', kinds);
const missing = require('../game/racers').RACER_IDS.filter((id) => !powerSeen[id] && !['copycat'].includes(id));
console.log('从未生效的技能:', missing.length ? missing : '无');
