'use strict';
// 技能语义单测：手工摆盘，直接驱动引擎内部生成器
const assert = require('assert');
const { Game } = require('../game/engine');

function setup(list, track = 'mild') {
  const g = new Game({ players: list.map((_, i) => ({ name: `P${i}` })), seed: 42 });
  g.phase = 'race'; g.raceNo = 1; g.trackKey = track; g.curSeat = 0;
  g.finishCount = 0; g.outOrder = []; g.turns = 0; g.skipperNext = null; g.extraTurn = false;
  g.resetTurnCounters();
  g.racers = list.map(([rid, pos], i) => ({ rid, seat: i, pos, power: rid, tripped: false, finished: 0, out: false }));
  return g;
}
function run(g, gen, answers = {}) {
  let r;
  try {
    r = gen.next();
    while (!r.done) {
      const d = r.value;
      const a = answers[d.kind];
      r = gen.next(a !== undefined ? (typeof a === 'function' ? a(d) : a) : d.options[0].v);
    }
  } catch (e) { if (e.constructor.name !== 'RaceEnd') throw e; }
  return g;
}
const R = (g, rid) => g.racers.find((r) => r.rid === rid);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('规则书示例：浪漫鳄走 5 格超过蹭蹭狗和香蕉', () => {
  const g = setup([['romantic', 0], ['scoocher', 2], ['banana', 3]]);
  run(g, g.move(R(g, 'romantic'), 5, 'main'));
  assert.strictEqual(R(g, 'romantic').tripped, true);
  assert.strictEqual(R(g, 'romantic').pos, 7);
  assert.strictEqual(R(g, 'scoocher').pos, 4);
  assert.strictEqual(R(g, 'banana').pos, 3);
});
test('半人马超车后蹄踢：被超者后退 2，最多到起点', () => {
  const g = setup([['centaur', 0], ['legs', 1], ['hare', 4]]);
  run(g, g.move(R(g, 'centaur'), 6, 'main'));
  assert.strictEqual(R(g, 'centaur').pos, 6);
  assert.strictEqual(R(g, 'legs').pos, 0);
  assert.strictEqual(R(g, 'hare').pos, 2);
});
test('巨婴：落到巨婴格改停身后一格', () => {
  const g = setup([['legs', 2], ['hugebaby', 6]]);
  run(g, g.move(R(g, 'legs'), 4, 'main'));
  assert.strictEqual(R(g, 'legs').pos, 5);
});
test('巨婴落到有人的格子，把人挤到身后', () => {
  const g = setup([['hugebaby', 2], ['legs', 6], ['hare', 6]]);
  run(g, g.move(R(g, 'hugebaby'), 4, 'main'));
  assert.strictEqual(R(g, 'hugebaby').pos, 6);
  assert.strictEqual(R(g, 'legs').pos, 5);
  assert.strictEqual(R(g, 'hare').pos, 5);
});
test('蹭蹭狗撞巨婴的无限循环会终止', () => {
  const g = setup([['legs', 0], ['scoocher', 4], ['hugebaby', 5], ['banana', 1]]);
  run(g, g.move(R(g, 'legs'), 3, 'main')); // 超过香蕉 → 绊倒 → 蹭蹭狗想走到巨婴格
  assert.strictEqual(R(g, 'scoocher').pos, 4);
  assert.ok(g.drain().some((e) => e.t === 'info' && /循环/.test(e.text)));
});
test('较真怪：冲线步数不对就不动', () => {
  const g = setup([['legs', 27], ['stickler', 3]]);
  run(g, g.move(R(g, 'legs'), 5, 'main'));
  assert.strictEqual(R(g, 'legs').pos, 27);
  run(g, g.move(R(g, 'legs'), 3, 'main'));
  assert.strictEqual(R(g, 'legs').finished, 1);
});
test('跳跳蛙跳过有人的格子', () => {
  const g = setup([['leaptoad', 0], ['legs', 1], ['hare', 2]]);
  run(g, g.move(R(g, 'leaptoad'), 2, 'main'));
  assert.strictEqual(R(g, 'leaptoad').pos, 4);
});
test('大嘴怪吃掉格子上唯一的对手', () => {
  const g = setup([['mouth', 0], ['legs', 3]]);
  run(g, g.move(R(g, 'mouth'), 3, 'main'));
  assert.strictEqual(R(g, 'legs').out, true);
});
test('大嘴怪遇到两人不吃', () => {
  const g = setup([['mouth', 0], ['legs', 3], ['hare', 3]]);
  run(g, g.move(R(g, 'mouth'), 3, 'main'));
  assert.ok(!R(g, 'legs').out && !R(g, 'hare').out);
});
test('吸盘鱼跟着同格的人移动', () => {
  const g = setup([['legs', 4], ['suckerfish', 4]]);
  run(g, g.move(R(g, 'legs'), 5, 'main'), { suckerfish: 'yes' });
  assert.strictEqual(R(g, 'suckerfish').pos, 9);
});
test('吸盘鱼可以跟着冲线', () => {
  const g = setup([['legs', 27], ['suckerfish', 27], ['hare', 0]]);
  run(g, g.move(R(g, 'legs'), 5, 'main'), { suckerfish: 'yes' });
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert.strictEqual(R(g, 'suckerfish').finished, 2);
});
test('主谋预言成真：比赛结束，主谋第 2', () => {
  const g = setup([['legs', 28], ['mastermind', 3], ['hare', 5]]);
  R(g, 'mastermind').mmPredict = 'legs';
  run(g, g.move(R(g, 'legs'), 2, 'main'));
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert.strictEqual(R(g, 'mastermind').finished, 2);
  assert.deepStrictEqual(g.players[1].chips.map((c) => c.kind), ['silver']);
});
test('芭芭雅嘎：停到她的格子被绊倒', () => {
  const g = setup([['legs', 0], ['babayaga', 4]]);
  run(g, g.move(R(g, 'legs'), 4, 'main'));
  assert.strictEqual(R(g, 'legs').tripped, true);
});
test('香蕉：只有超过才绊倒，停在同格不算', () => {
  const g = setup([['legs', 0], ['banana', 4]]);
  run(g, g.move(R(g, 'legs'), 4, 'main'));
  assert.strictEqual(R(g, 'legs').tripped, false);
});
test('狂野荒原：箭头、石头、星星', () => {
  const g = setup([['legs', 0], ['hare', 0], ['coach', 0]], 'wild');
  run(g, g.move(R(g, 'legs'), 4, 'main')); // 4 → 箭头 +2 → 6
  assert.strictEqual(R(g, 'legs').pos, 6);
  run(g, g.move(R(g, 'hare'), 9, 'main'));
  assert.strictEqual(R(g, 'hare').tripped, true);
  run(g, g.move(R(g, 'coach'), 7, 'main'));
  assert.strictEqual(g.score(2), 1);
});
test('模仿猫拿到领跑者技能', () => {
  const g = setup([['copycat', 0], ['legs', 10], ['hare', 3]]);
  assert.strictEqual(g.power(R(g, 'copycat')), 'legs');
});
test('派对熊：所有人靠近 1 格', () => {
  const g = setup([['partyanimal', 5], ['legs', 0], ['hare', 9], ['coach', 4]]);
  const gen = g.mainMove(R(g, 'partyanimal'), 5);
  let r = gen.next(); // 应停在掷骰决策
  assert.strictEqual(r.value.kind, 'roll');
  assert.strictEqual(R(g, 'legs').pos, 1);
  assert.strictEqual(R(g, 'hare').pos, 8);
  assert.strictEqual(R(g, 'coach').pos, 5);
});
test('整局流程：3 人 AI 能跑完 4 场', () => {
  const { decide } = require('../game/ai');
  const g = new Game({ players: [{ name: 'A', ai: true }, { name: 'B', ai: true }, { name: 'C', ai: true }], seed: 9 });
  g.start();
  while (g.pending) {
    const d = g.pending;
    if (d.simul) for (const s of d.seats) g.answer(s, d.id, decide(g, d, s));
    else g.answer(d.seat, d.id, decide(g, d, d.seat));
  }
  assert.strictEqual(g.phase, 'over');
  assert.strictEqual(g.results.length, 4);
});

let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); }
}
console.log(fail ? `${fail} 项失败` : `全部 ${tests.length} 项通过`);
process.exit(fail ? 1 : 0);
