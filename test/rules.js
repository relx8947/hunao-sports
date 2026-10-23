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
test('巨婴触发连锁改变落点后，原移动超过香蕉仍须结算且不重复爱情', () => {
  const g = setup([['romantic', 0], ['banana', 3], ['scoocher', 4], ['hugebaby', 6]]);
  run(g, g.move(R(g, 'romantic'), 6, 'main'));
  assert.strictEqual(R(g, 'romantic').pos, 7);
  assert.strictEqual(R(g, 'romantic').tripped, true);
  assert.strictEqual(R(g, 'scoocher').pos, 5);
  assert.strictEqual(R(g, 'banana').pos, 3);
  assert.strictEqual(R(g, 'hugebaby').pos, 6);
  const events = g.drain();
  assert.deepStrictEqual(events.filter(e => e.t === 'move' && e.rid === 'romantic').map(e => [e.from, e.to]), [[0, 5], [5, 7]]);
  assert.strictEqual(events.filter(e => e.t === 'power' && e.key === 'romantic').length, 1);
  assert.strictEqual(events.filter(e => e.t === 'power' && e.key === 'banana').length, 1);
  const movedAgain = events.findIndex(e => e.t === 'move' && e.rid === 'romantic' && e.to === 7);
  const bananaTrip = events.findIndex(e => e.t === 'trip' && e.rid === 'romantic' && /香蕉/.test(e.text));
  assert(bananaTrip > movedAgain, '原移动的超车应在前置连锁结束后继续结算');
});
test('连锁改变落点后，原先同格的吸盘鱼仍能跟到实际新位置', () => {
  const g = setup([['romantic', 0], ['banana', 3], ['scoocher', 4], ['hugebaby', 6], ['suckerfish', 0]]);
  const targets = [];
  run(g, g.move(R(g, 'romantic'), 6, 'main'), { suckerfish: d => {
    targets.push(d.target);
    return targets.length === 1 ? 'yes' : 'no';
  }});
  assert.deepStrictEqual(targets, [7, 9]); // 第一次跟随又触发爱情；拒绝第二次，避免继续连锁。
  assert.strictEqual(R(g, 'suckerfish').pos, 7);
  assert.strictEqual(R(g, 'suckerfish').tripped, true);
  assert.strictEqual(R(g, 'romantic').pos, 9);
  assert.strictEqual(R(g, 'romantic').tripped, true);
});
test('原落点失效时跳过巨婴挤人、赛道格与同格技能，仍结算超车', () => {
  const g = setup([['hugebaby', 9], ['banana', 3], ['legs', 7], ['romantic', 0]], 'wild');
  const baby = R(g, 'hugebaby');
  // 原移动为 0 → 7，前置连锁已把巨婴移到 9；只剩历史超车需要结算。
  run(g, g.afterStop(baby, 0, 7, { passed: [R(g, 'banana')], moved: true, sharedBefore: [] }));
  assert.strictEqual(baby.pos, 9);
  assert.strictEqual(baby.tripped, true);
  assert.strictEqual(R(g, 'legs').pos, 7);
  assert.strictEqual(R(g, 'romantic').pos, 0);
  assert.strictEqual(g.score(0), 0);
  const events = g.drain();
  assert(!events.some(e => e.t === 'warp' || e.t === 'space'));
  assert.deepStrictEqual(events.filter(e => e.t === 'power').map(e => e.key), ['banana']);
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

test('模仿猫同回合并列领跑由玩家选，连锁中同组再现不重复询问', () => {
  const g = setup([['copycat', 0], ['legs', 10], ['hare', 10]]);
  const cat = R(g, 'copycat');
  assert.strictEqual(g.power(cat), null);
  const gen = g.refreshCopies();
  const question = gen.next();
  assert.strictEqual(question.value.kind, 'copycat');
  assert.deepStrictEqual(question.value.options.map(o => o.v).sort(), ['hare', 'legs']);
  assert.strictEqual(g.power(cat), null);
  assert.strictEqual(gen.next('hare').done, true);
  assert.strictEqual(g.power(cat), 'hare');
  assert.strictEqual(g.refreshCopies().next().done, true);
  R(g, 'legs').pos = 11;
  run(g, g.refreshCopies());
  assert.strictEqual(g.power(cat), 'legs');
  R(g, 'hare').pos = 11;
  assert.strictEqual(g.refreshCopies().next().done, true);
  assert.strictEqual(g.power(cat), 'hare');
  cat.pos = 12;
  run(g, g.refreshCopies());
  assert.strictEqual(g.power(cat), null);
  cat.pos = 0;
  assert.strictEqual(g.refreshCopies().next().done, true);
  assert.strictEqual(g.power(cat), 'hare');
  assert.strictEqual(g.drain().filter(e => e.t === 'copy' && e.power === 'hare').length, 3);
});
test('模仿猫跨回合同组领跑可重选，清缓存与待决策时不泄漏旧技能', () => {
  const g = setup([['copycat', 0], ['legs', 10], ['hare', 10]]);
  const cat = R(g, 'copycat');
  run(g, g.refreshCopies(), { copycat: 'hare' });
  assert.strictEqual(g.power(cat), 'hare');
  g.drain();
  g.resetTurnCounters();
  assert.strictEqual(g.power(cat), null);
  assert.strictEqual(g.has(cat, 'hare'), false);
  assert.deepStrictEqual(g.holders('hare').map(r => r.rid), ['hare']);
  assert.strictEqual(g.snapshot().racers.find(r => r.rid === 'copycat').eff, null);
  assert.strictEqual(g.drain().length, 0, '技能查询和快照不应自行选择或产生事件');
  const gen = g.refreshCopies();
  const question = gen.next();
  assert.strictEqual(question.done, false);
  assert.strictEqual(question.value.kind, 'copycat');
  assert.strictEqual(g.power(cat), null);
  assert.strictEqual(gen.next('legs').done, true);
  assert.strictEqual(g.power(cat), 'legs');
  assert.strictEqual(g.refreshCopies().next().done, true);
  assert.strictEqual(g.drain().filter(e => e.t === 'copy' && e.power === 'legs').length, 1);
});
test('真实回合开始会清除模仿猫上一回合选择，并先停在新的复制决策', () => {
  const g = setup([['copycat', 0], ['legs', 10], ['hare', 10]]);
  const cat = R(g, 'copycat');
  run(g, g.refreshCopies(), { copycat: 'hare' });
  const gen = g.takeTurn(cat);
  const question = gen.next();
  assert.strictEqual(g.turns, 1);
  assert.strictEqual(question.value.kind, 'copycat');
  assert.strictEqual(g.power(cat), null);
  const next = gen.next('legs');
  assert.strictEqual(next.value.kind, 'mode');
  assert(next.value.options.some(o => o.v === 'legs'));
  assert.strictEqual(g.power(cat), 'legs');
});
test('模仿猫排除赛前技能与已出局领跑者', () => {
  const g = setup([['copycat', 0], ['egg', 10], ['legs', 9]]);
  assert.strictEqual(g.power(R(g, 'copycat')), null);
  R(g, 'egg').out = true;
  assert.strictEqual(g.power(R(g, 'copycat')), 'legs');
});
test('snapshot 深拷贝，不共享手牌、筹码、决策和赛道分值', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 9 });
  g.start();
  const first = g.snapshot();
  first.faceUp.length = 0;
  first.pending.options.length = 0;
  first.players[0].chips.push({ kind: 'bronze', v: 999 });
  first.gold[0] = 999;
  const second = g.snapshot();
  assert(second.faceUp.length > 0 && second.pending.options.length > 0);
  assert.strictEqual(second.players[0].score, 0);
  assert.strictEqual(second.gold[0], 3);
});
test('按席快照仅暴露本人选择，暗选答案在亮牌前不外泄', () => {
  const { decide } = require('../game/ai');
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 9 });
  g.start();
  while (g.phase === 'draft') {
    const d = g.pending;
    g.answer(d.seat, d.id, decide(g, d, d.seat));
  }
  const d = g.pending;
  assert.deepStrictEqual(Object.keys(g.snapshot(0).pending.optionsBySeat), ['0']);
  assert.deepStrictEqual(g.snapshot(-1).pending.optionsBySeat, {});
  assert.strictEqual(g.answer(0, d.id, d.optionsBySeat[0][0].v), null);
  assert.deepStrictEqual(g.snapshot(1).pending.done, [0]);
  assert.strictEqual(g.snapshot(1).pending.answers, undefined);
  assert.strictEqual(g.snapshot(1).racers.length, 0);
  assert.strictEqual(g.answer(0, d.id, d.optionsBySeat[0][1].v), '你已经选好了');
});
test('事件冻结原始内容，不随调用者后续修改', () => {
  const g = setup([['legs', 0], ['hare', 0]]);
  const event = { t: 'test', nested: { values: [1] } };
  g.emit(event);
  event.nested.values[0] = 999;
  assert.strictEqual(g.drain()[0].nested.values[0], 1);
});
test('电灯泡选择两人起点格后确实瞬移到 0，且主移动尚未开始', () => {
  const g = setup([['thirdwheel', 5], ['legs', 0], ['hare', 0]]);
  const tw = R(g, 'thirdwheel');
  const gen = g.mainMove(tw, 5);
  const question = gen.next();
  assert.strictEqual(question.value.kind, 'thirdwheel');
  assert(question.value.options.some(o => o.v === 's0'));
  const next = gen.next('s0');
  assert.strictEqual(next.done, false);
  assert.strictEqual(next.value.kind, 'roll');
  assert.strictEqual(tw.pos, 0);
  const events = g.drain();
  assert.deepStrictEqual(events.filter(e => e.t === 'warp' && e.rid === 'thirdwheel').map(e => [e.from, e.to]), [[5, 0]]);
  assert(events.some(e => e.t === 'power' && e.key === 'thirdwheel'));
  assert(!events.some(e => e.t === 'roll' || e.t === 'move'), '停在掷骰决策时尚未进行主移动');
});
test('西西弗斯零分回起点不生成虚假的扣分事件', () => {
  const g = setup([['sisyphus', 5], ['legs', 10], ['hare', 2]]);
  g.d6 = () => 6;
  run(g, g.mainMove(R(g, 'sisyphus'), 5));
  assert.strictEqual(R(g, 'sisyphus').pos, 0);
  assert.strictEqual(g.score(0), 0);
  assert(!g.drain().some(e => e.t === 'chip' && e.kind === 'lose'));
});
test('西西弗斯扣分恰好1分并保留剩余奖牌值', () => {
  const g = setup([['sisyphus', 5], ['legs', 10], ['hare', 2]]);
  g.players[0].chips = [{ kind: 'gold', v: 3, race: 1 }];
  g.d6 = () => 6;
  run(g, g.mainMove(R(g, 'sisyphus'), 5));
  assert.strictEqual(g.score(0), 2);
  assert.strictEqual(g.drain().filter(e => e.kind === 'lose').length, 1);
});

test('冲线后刷新模仿猫，原吸盘鱼拒绝后猫仍可跟随成为第二名', () => {
  const g = setup([['legs', 28], ['copycat', 28], ['suckerfish', 28], ['hare', 28]]);
  // 本体鱼的回合中让大长腿移动，按回合顺序先询问本体鱼，再询问猫。
  g.curSeat = 2;
  const copies = [], follows = [];
  run(g, g.move(R(g, 'legs'), 2, 'power'), {
    copycat: d => {
      copies.push(d.options.map(o => o.v).sort());
      assert(copies.length <= 2, '新领跑局面只应询问一次');
      return copies.length === 1 ? 'legs' : 'suckerfish';
    },
    suckerfish: d => {
      follows.push(d.seat);
      return d.seat === 2 ? 'no' : 'yes';
    },
  });
  assert.strictEqual(R(g, 'copycat').finished, 2);
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert.strictEqual(R(g, 'suckerfish').finished, 0);
  assert.deepStrictEqual(copies, [['hare', 'legs', 'suckerfish'], ['hare', 'suckerfish']]);
  assert.deepStrictEqual(follows, [2, 1]);
});
test('骰子贩子自己重掷，复制贩子的猫也获得一格奖励且机会仍共享', () => {
  const g = setup([['dicemonger', 10], ['copycat', 5], ['legs', 0]]);
  let rolls = 0, offers = 0;
  g.d6 = () => { rolls++; return 2; };
  run(g, g.mainMove(R(g, 'dicemonger'), 10), { reroll: () => { offers++; return 'dice'; } });
  assert.strictEqual(R(g, 'copycat').pos, 6);
  assert.strictEqual(R(g, 'dicemonger').pos, 12, '掷骰者不获得自己的交易奖励');
  assert.strictEqual(offers, 1, '多个有效贩子不能增加重掷次数');
  assert.strictEqual(rolls, 2);
  assert.deepStrictEqual(g.drain().filter(e => e.t === 'power' && e.key === 'dicemonger').map(e => e.rid), ['dicemonger', 'copycat']);
});
test('第三人重掷时所有有效骰子贩子均按回合顺序奖励一格', () => {
  const g = setup([['dicemonger', 10], ['copycat', 5], ['legs', 0]]);
  g.curSeat = 2;
  let offers = 0;
  g.d6 = () => 2;
  run(g, g.mainMove(R(g, 'legs'), 0), { mode: 'roll', reroll: () => { offers++; return 'dice'; } });
  assert.strictEqual(R(g, 'copycat').pos, 6);
  assert.strictEqual(R(g, 'dicemonger').pos, 11);
  assert.strictEqual(R(g, 'legs').pos, 2);
  assert.strictEqual(offers, 1);
  assert.deepStrictEqual(g.drain().filter(e => e.t === 'move').map(e => [e.rid, e.from, e.to]), [
    ['dicemonger', 10, 11], ['copycat', 5, 6], ['legs', 0, 2],
  ]);
});
test('巨婴挤人落点仍受另一巨婴约束，不能停在猫的格子或误触星星', () => {
  for (const track of ['mild', 'wild']) {
    const g = setup([['hugebaby', 0], ['copycat', 14], ['legs', 15], ['hare', 1]], track);
    let copies = 0;
    run(g, g.move(R(g, 'hugebaby'), 15, 'main'), { copycat: () => {
      copies++;
      assert.strictEqual(copies, 1);
      return 'hugebaby';
    }});
    assert.strictEqual(R(g, 'legs').pos, 13);
    assert.strictEqual(R(g, 'hugebaby').pos, 15);
    assert.strictEqual(R(g, 'copycat').pos, 14);
    assert.strictEqual(g.power(R(g, 'copycat')), 'hugebaby');
    assert.strictEqual(g.score(2), 0, '校正后的落点不是第 14 格星星');
    const events = g.drain();
    assert.deepStrictEqual(events.filter(e => e.t === 'warp').map(e => [e.rid, e.from, e.to]), [['legs', 15, 13]]);
    assert(!events.some(e => e.t === 'space' && e.rid === 'legs'));
    assert.strictEqual(g.refreshCopies().next().done, true, '校正后不重复询问同一组领跑者');
  }
});
test('模仿猫切成巨婴时排斥已有同格对手，并执行实际落点的停格连锁', () => {
  for (const track of ['mild', 'wild']) {
    const g = setup([['copycat', 5], ['hare', 5], ['legs', 15], ['hugebaby', 10]], track);
    const cat = R(g, 'copycat');
    run(g, g.refreshCopies());
    assert.strictEqual(g.power(cat), 'legs');
    let copies = 0;
    run(g, g.move(R(g, 'hugebaby'), 5, 'main'), { copycat: () => {
      copies++;
      assert.strictEqual(copies, 1, '停格连锁不应无限重问复制选择');
      return 'hugebaby';
    }});
    assert.strictEqual(R(g, 'hare').pos, track === 'wild' ? 6 : 4);
    assert.strictEqual(cat.pos, 5);
    assert.strictEqual(g.power(cat), 'hugebaby');
    const events = g.drain();
    assert.deepStrictEqual(events.filter(e => e.t === 'warp' && e.rid === 'hare').map(e => [e.rid, e.from, e.to]), [['hare', 5, 4]]);
    assert.deepStrictEqual(events.filter(e => e.t === 'move' && e.rid === 'hare').map(e => [e.from, e.to]), track === 'wild' ? [[4, 6]] : []);
    assert.strictEqual(g.refreshCopies().next().done, true);
    const positions = g.racers.map(r => r.pos);
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(g.power(cat), 'hugebaby');
      g.holders('hugebaby');
      g.snapshot();
    }
    assert.deepStrictEqual(g.racers.map(r => r.pos), positions);
    assert.strictEqual(g.drain().length, 0, 'power、holders 与快照必须保持纯查询');
  }
});
test('真实回合移动一格夺冠后仍触发起哄怪，但淘汰或比赛终止不触发', () => {
  const g = setup([['legs', 29], ['heckler', 10], ['hare', 0]]);
  g.d6 = () => 1;
  run(g, g.takeTurn(R(g, 'legs')), { mode: 'roll' });
  assert.strictEqual(R(g, 'heckler').pos, 12);
  assert.strictEqual(R(g, 'legs').finished, 1);
  const events = g.drain();
  assert(events.some(e => e.t === 'turnEnd' && e.seat === 0));
  assert.strictEqual(events.filter(e => e.t === 'power' && e.key === 'heckler').length, 1);

  const movedTwo = setup([['legs', 28], ['heckler', 10], ['hare', 0]]);
  movedTwo.d6 = () => 2;
  run(movedTwo, movedTwo.takeTurn(R(movedTwo, 'legs')), { mode: 'roll' });
  assert.strictEqual(R(movedTwo, 'legs').finished, 1);
  assert.strictEqual(R(movedTwo, 'heckler').pos, 10);

  const ended = setup([['legs', 29], ['heckler', 10], ['mastermind', 0]]);
  R(ended, 'mastermind').mmPredict = 'legs';
  ended.d6 = () => 1;
  run(ended, ended.takeTurn(R(ended, 'legs')), { mode: 'roll' });
  assert.strictEqual(ended.finishCount, 2);
  assert.strictEqual(R(ended, 'heckler').pos, 10);
  assert(!ended.drain().some(e => e.t === 'turnEnd' || (e.t === 'power' && e.key === 'heckler')));

  const out = setup([['legs', 0], ['heckler', 10], ['mouth', 1]]);
  // 固定主移动阶段发生淘汰，单独覆盖回合末排除淘汰者的条件。
  out.mainMove = function* (r) { yield* this.eliminate(r, R(out, 'mouth')); };
  run(out, out.takeTurn(R(out, 'legs')));
  assert.strictEqual(R(out, 'legs').out, true);
  assert.strictEqual(R(out, 'heckler').pos, 10);
});

let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); }
}
console.log(fail ? `${fail} 项失败` : `全部 ${tests.length} 项通过`);
process.exit(fail ? 1 : 0);
