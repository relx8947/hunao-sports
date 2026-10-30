'use strict';
// 引擎压力测试：大量全 AI 对局，检查崩溃、死循环、状态不变量
// 用法：node test/sim.js [局数] [模式 v1|v2|mix|all]，模式缺省为 v1（一代）
const { Game, FINISH } = require('../game/engine');
const { decide } = require('../game/ai');
const { RACER_IDS, RACER_IDS_V2, TWISTS } = require('../game/racers');
const { EDITIONS } = require('../game/tracks');

const N = Number(process.argv[2]) || 2000;
const arg = process.argv[3] || 'v1';
const editions = arg === 'all' ? Object.keys(EDITIONS) : [arg];
if (!editions.every((e) => EDITIONS[e])) { console.error('未知模式', arg); process.exit(2); }

let failed = false;
for (const edition of editions) {
  let races = 0, turns = 0, decisions = 0, capped = 0, cappedRaces = 0;
  const kinds = {};
  const powerSeen = {};
  const twistSeen = {};
  const reasons = {};
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const n = 2 + (i % 5);
    const seed = 1000 + i;
    const g = new Game({ players: Array.from({ length: n }, (_, k) => ({ name: `P${k}`, ai: true })), seed, edition });
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
          if (e.t === 'twist') twistSeen[e.id] = (twistSeen[e.id] || 0) + 1;
          if ((e.t === 'move' || e.t === 'warp') && (e.to < 0 || e.to > FINISH)) throw new Error('越界移动 ' + JSON.stringify(e));
        }
        for (const r of g.racers) if (r.pos < 0 || r.pos > FINISH) throw new Error('位置越界');
        if (g.phase === 'race' && g.racers.some((r) => r.seat < 0 || r.seat >= n)) throw new Error('控制权越界');
      }
      if (g.phase !== 'over') throw new Error('对局未结束 phase=' + g.phase);
      if (g.results.length !== 4) throw new Error('比赛场数不对');
      races += 4;
      g.results.forEach((r, k) => {
        if (r.track !== EDITIONS[edition].schedule[k]) throw new Error('赛程不对');
        const fin = r.standings.filter((s) => s.finished);
        if (fin.length > 2) throw new Error('完赛人数 >2');
        reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      });
      turns += g.results.reduce((sum, r) => sum + r.turns, 0);
      const limited = g.results.filter(r => r.reason === 'turn-limit' || r.reason === 'loop-limit').length;
      cappedRaces += limited;
      if (limited) capped++;
      // 快照必须能序列化，不能把内部引用带出去
      JSON.stringify(g.snapshot(0));
    } catch (e) {
      console.error(`[${edition}] 对局 #${i} (n=${n}, seed=${seed}) 失败:`, e.stack);
      console.error('最近日志:', g.log.slice(-15).map((l) => l.text).join('\n  '));
      failed = true;
      break;
    }
  }
  if (failed) break;
  console.log(`[${edition}] 完成 ${N} 局 / ${races} 场比赛，用时 ${Date.now() - t0}ms`);
  console.log(`平均决策 ${(decisions / N).toFixed(1)} 次/局，保护上限 ${capped} 局 / ${cappedRaces} 场；平均回合 ${(turns / races).toFixed(1)} 次/场`);
  console.log('决策类型:', kinds);
  if (edition !== 'v1') console.log('结束原因:', reasons);
  const pool = edition === 'v1' ? RACER_IDS : edition === 'v2' ? RACER_IDS_V2 : RACER_IDS.concat(RACER_IDS_V2);
  // 模仿猫没有自己的生效事件；返场王是赛场外技能
  const missing = pool.filter((id) => !powerSeen[id] && !['copycat', 'rerunner'].includes(id));
  console.log('从未生效的技能:', missing.length ? missing : '无');
  if (EDITIONS[edition].twists) {
    const unseen = TWISTS.map((t) => t.id).filter((id) => !twistSeen[id]);
    console.log('变数卡抽取次数:', twistSeen, unseen.length ? `从未抽到: ${unseen}` : '');
  }
}
process.exit(failed ? 1 : 0);
