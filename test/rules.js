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
// 回合顺序测试必须走 runRace / answer，不能只检查 takeTurn 设置的标志。
function answer(g, value) {
  const d = g.pending;
  assert(d && !d.simul, '应有单人待决策');
  assert.strictEqual(g.answer(d.seat, d.id, value), null);
}
function pickRace(g, ids) {
  const d = g.pending;
  assert(d && d.simul && d.kind === 'pickRacer', '应有同时暗选运动员的决策');
  for (const s of d.seats) {
    assert(d.optionsBySeat[s].some(o => o.v === ids[s]), '出场角色必须属于该席合法选项');
    assert.strictEqual(g.answer(s, d.id, ids[s]), null);
  }
}
function startRace(ids, dice, firstSeat = 0, prepare = () => {}) {
  const g = new Game({ players: ids.map((_, i) => ({ name: `P${i}` })), seed: 42 });
  ids.forEach((id, s) => { g.players[s].hand = [id]; });
  g.raceNo = 1; g.trackKey = 'mild'; g.firstSeat = firstSeat;
  g.d6 = dice;
  prepare(g);
  g.gen = g.runRace(0);
  g.start();
  pickRace(g, ids);
  return g;
}
function draftedTurnOrderRace(ids, seed, dice) {
  const g = new Game({ players: ids.map((_, i) => ({ name: `P${i}` })), seed });
  const draftDice = [6, 1, 1, 6, 1, 1];
  g.d6 = () => { assert(draftDice.length > 0); return draftDice.shift(); };
  g.start();
  while (g.phase === 'draft') {
    const d = g.pending;
    answer(g, d.options.some(o => o.v === ids[d.seat]) ? ids[d.seat] : d.options[0].v);
  }
  assert.strictEqual(draftDice.length, 0);
  assert.strictEqual(g.firstSeat, 0);
  g.d6 = dice;
  pickRace(g, ids);
  return g;
}
const R = (g, rid) => g.racers.find((r) => r.rid === rid);
// 骰序数组与骰点函数具有不同契约，使用明确独有的 helper 名称。
function draftedRollSequenceRace(seed, picks, rolls) {
  return draftedTurnOrderRace(picks, seed, () => {
    assert(rolls.length, '主移动骰点不得超出夹具');
    return rolls.shift();
  });
}
// 安全边界使用固定阵容；配置和探针必须在生成器首次推进前安装。
function fixedRace(picks, configure = () => {}) {
  return startRace(picks, () => 6, 0, configure);
}
const turnSeats = g => g.events.filter(e => e.t === 'turn').map(e => e.seat);
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
test('狂野荒原（实物布局）：箭头、石头、星星', () => {
  const g = setup([['legs', 0], ['hare', 0], ['coach', 0]], 'wild');
  run(g, g.move(R(g, 'legs'), 7, 'main')); // 7 → 箭头 +3 → 10
  assert.strictEqual(R(g, 'legs').pos, 10);
  run(g, g.move(R(g, 'hare'), 5, 'main')); // 5 石头
  assert.strictEqual(R(g, 'hare').tripped, true);
  run(g, g.move(R(g, 'coach'), 13, 'main')); // 13 星星
  assert.strictEqual(g.score(2), 1);
});
test('狂野荒原（实物布局）：逐格核对 10 个特殊格', () => {
  const { TRACKS } = require('../game/tracks');
  assert.deepStrictEqual(TRACKS.wild.spaces, {
    1: { type: 'star' }, 5: { type: 'rock' }, 7: { type: 'arrow', n: 3 }, 11: { type: 'arrow', n: 1 },
    13: { type: 'star' }, 16: { type: 'arrow', n: -4 }, 17: { type: 'rock' },
    23: { type: 'arrow', n: 2 }, 24: { type: 'arrow', n: -2 }, 26: { type: 'rock' },
  });
  // 1 号星星：第一步就能拿铜牌
  let g = setup([['legs', 0], ['hare', 20]], 'wild');
  run(g, g.move(R(g, 'legs'), 1, 'main'));
  assert.strictEqual(g.score(0), 1);
  // 11 → +1 → 12；16 → -4 → 12；23 → +2 → 25；24 → -2 → 22；17、26 石头
  const cases = [[11, 12, false], [16, 12, false], [23, 25, false], [24, 22, false], [17, 17, true], [26, 26, true]];
  for (const [to, end, trip] of cases) {
    g = setup([['legs', 0], ['hare', 29]], 'wild');
    run(g, g.move(R(g, 'legs'), to, 'main'));
    assert.strictEqual(R(g, 'legs').pos, end, `落在 ${to} 应停在 ${end}`);
    assert.strictEqual(R(g, 'legs').tripped, trip);
  }
  // 箭头是独立的一次移动：16 后退到 12 不会连锁到 11 的箭头
  g = setup([['legs', 10], ['hare', 29]], 'wild');
  run(g, g.move(R(g, 'legs'), 6, 'main'));
  assert.deepStrictEqual(g.drain().filter(e => e.t === 'move').map(e => [e.from, e.to, e.kind]), [[10, 16, 'main'], [16, 12, 'arrow']]);
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
    // 狂野荒原实物布局的星星在 13：猫站在星星格上，被挤的大长腿校正到 12，不能误触星星
    const g = setup([['hugebaby', 0], ['copycat', 13], ['legs', 14], ['hare', 2]], track);
    let copies = 0;
    run(g, g.move(R(g, 'hugebaby'), 14, 'main'), { copycat: () => {
      copies++;
      assert.strictEqual(copies, 1);
      return 'hugebaby';
    }});
    assert.strictEqual(R(g, 'legs').pos, 12);
    assert.strictEqual(R(g, 'hugebaby').pos, 14);
    assert.strictEqual(R(g, 'copycat').pos, 13);
    assert.strictEqual(g.power(R(g, 'copycat')), 'hugebaby');
    assert.strictEqual(g.score(2), 0, '校正后的落点不是第 13 格星星');
    const events = g.drain();
    assert.deepStrictEqual(events.filter(e => e.t === 'warp').map(e => [e.rid, e.from, e.to]), [['legs', 14, 12]]);
    assert(!events.some(e => e.t === 'space' && e.rid === 'legs'));
    assert.strictEqual(g.refreshCopies().next().done, true, '校正后不重复询问同一组领跑者');
  }
});
test('模仿猫切成巨婴时排斥已有同格对手，并执行实际落点的停格连锁', () => {
  for (const track of ['mild', 'wild']) {
    // 狂野荒原实物布局：兔子被挤到 7 号箭头，再前进 3 到 10
    const g = setup([['copycat', 8], ['hare', 8], ['legs', 15], ['hugebaby', 10]], track);
    const cat = R(g, 'copycat');
    run(g, g.refreshCopies());
    assert.strictEqual(g.power(cat), 'legs');
    let copies = 0;
    run(g, g.move(R(g, 'hugebaby'), 5, 'main'), { copycat: () => {
      copies++;
      assert.strictEqual(copies, 1, '停格连锁不应无限重问复制选择');
      return 'hugebaby';
    }});
    assert.strictEqual(R(g, 'hare').pos, track === 'wild' ? 10 : 7);
    assert.strictEqual(cat.pos, 8);
    assert.strictEqual(g.power(cat), 'hugebaby');
    const events = g.drain();
    assert.deepStrictEqual(events.filter(e => e.t === 'warp' && e.rid === 'hare').map(e => [e.rid, e.from, e.to]), [['hare', 8, 7]]);
    assert.deepStrictEqual(events.filter(e => e.t === 'move' && e.rid === 'hare').map(e => [e.from, e.to]), track === 'wild' ? [[7, 10]] : []);
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

// 原版英文说明书（第三方 CMYK 镜像）第23页：Genius 无连续次数上限；
// 猜中1时 Skipper 后触发，抢走下一回合。第21页只要求截真正无限循环。
test('可达 seed555：天才连续猜中四次得到第五个完整回合，再猜错才交下席', () => {
  const g = draftedTurnOrderRace(['genius', 'legs', 'blimp'], 555, () => 2);
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(g.pending.seat, 0);
    answer(g, 'roll');
    assert.strictEqual(g.pending.kind, 'genius');
    answer(g, '2');
  }
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 0, 0, 0, 0]);
  assert.strictEqual(g.pending.seat, 0);
  assert.strictEqual(R(g, 'genius').pos, 8);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 4);
  // 额外回合重新进入主移动、重新预言，不沿用上回合的猜测或技能预算。
  answer(g, 'roll');
  assert.strictEqual(g.pending.kind, 'genius');
  answer(g, '3');
  assert.strictEqual(g.pending.seat, 1);
  assert.strictEqual(R(g, 'genius').pos, 10);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 0, 0, 0, 0, 1]);
  assert.strictEqual(g.events.filter(e => e.t === 'power' && e.key === 'genius').length, 4);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'move' && e.rid === 'genius').map(e => [e.from, e.to]), [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]]);
  const boundaries = g.events.filter(e => ['turn', 'turnEnd', 'extraTurn'].includes(e.t)).map(e => e.t);
  assert.deepStrictEqual(boundaries, ['turn', ...Array(4).fill(['turnEnd', 'extraTurn', 'turn']).flat(), 'turnEnd', 'turn']);
});
test('可达 seed936：天才猜中1后下一真实回合属于船长，随后从船长下席继续', () => {
  const dice = [1, 2];
  const g = draftedTurnOrderRace(['genius', 'skipper', 'legs'], 936, () => { assert(dice.length); return dice.shift(); });
  answer(g, 'roll'); answer(g, '1');
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 1]);
  assert.strictEqual(g.pending.seat, 1);
  assert.strictEqual(g.pending.kind, 'roll');
  assert.strictEqual(R(g, 'genius').pos, 1);
  const geniusPower = g.events.findIndex(e => e.t === 'power' && e.key === 'genius');
  const skipperPower = g.events.findIndex(e => e.t === 'power' && e.key === 'skipper');
  assert(geniusPower >= 0 && skipperPower > geniusPower);
  assert(!g.events.some(e => e.t === 'extraTurn'));
  answer(g, 'roll');
  assert.strictEqual(g.pending.seat, 2);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 1, 2]);
  assert.strictEqual(R(g, 'skipper').pos, 2);
  assert.strictEqual(dice.length, 0);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'power').map(e => e.key), ['genius', 'skipper']);
});
test('有船长时天才猜中2仍由天才自己开始下一真实回合', () => {
  const g = startRace(['genius', 'skipper', 'legs'], () => 2);
  answer(g, 'roll'); answer(g, '2');
  assert.strictEqual(g.pending.seat, 0);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 0]);
  assert.strictEqual(R(g, 'genius').pos, 2);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 1);
  assert(!g.events.some(e => e.t === 'power' && e.key === 'skipper'));
});
test('船长自己掷1也开始自己的下一真实回合，掷2再交下席', () => {
  const dice = [1, 2];
  const g = startRace(['genius', 'skipper', 'legs'], () => { assert(dice.length); return dice.shift(); }, 1);
  answer(g, 'roll');
  assert.strictEqual(g.pending.seat, 1);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [1, 1]);
  assert.strictEqual(R(g, 'skipper').pos, 1);
  answer(g, 'roll');
  assert.strictEqual(g.pending.seat, 2);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [1, 1, 2]);
});
test('天才先连续猜中2，再在额外回合猜中1，船长立刻抢走下一真实回合', () => {
  const dice = [2, 2, 2, 1];
  const g = startRace(['genius', 'skipper', 'legs'], () => { assert(dice.length); return dice.shift(); });
  for (const prediction of ['2', '2', '2', '1']) { answer(g, 'roll'); answer(g, prediction); }
  assert.strictEqual(g.pending.seat, 1);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 0, 0, 0, 1]);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 3);
  assert.strictEqual(R(g, 'genius').pos, 7);
});
test('天才额外回合摔倒后下一完整回合爬起，不掷骰且交下席', () => {
  const g = startRace(['genius', 'babayaga', 'legs'], () => 2, 0, g => {
    g.beforeRace = function* () { R(this, 'babayaga').pos = 2; };
  });
  answer(g, 'roll'); answer(g, '2');
  assert.strictEqual(g.pending.seat, 1);
  assert.strictEqual(R(g, 'genius').tripped, false);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 0, 1]);
  assert.strictEqual(g.events.filter(e => e.t === 'roll' && e.rid === 'genius').length, 1);
  assert(g.events.some(e => e.t === 'recover' && e.rid === 'genius'));
});
test('连续额外回合遇真正技能循环仍执行每回合循环保护', () => {
  const g = startRace(['genius', 'scoocher', 'hugebaby'], () => 2, 0, g => {
    g.beforeRace = function* () { R(this, 'scoocher').pos = 4; R(this, 'hugebaby').pos = 5; };
  });
  answer(g, 'roll'); answer(g, '2');
  answer(g, 'roll'); answer(g, '2');
  assert.strictEqual(g.pending.seat, 0);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'turn').map(e => e.seat), [0, 0, 0]);
  assert.strictEqual(R(g, 'scoocher').pos, 4);
  assert.strictEqual(g.events.filter(e => e.t === 'info' && /无限循环/.test(e.text)).length, 2);
});
test('永远猜中的天才被较真怪卡住：连续回合在240回合有限结算，保留赛前分数', () => {
  let rolls = 0;
  const g = startRace(['genius', 'stickler', 'sisyphus'], () => { assert(++rolls <= 240); return 2; }, 0, g => {
    const before = g.beforeRace;
    g.beforeRace = function* () { yield* before.call(this); R(this, 'genius').pos = 29; };
  });
  for (let steps = 0; g.pending; steps++) {
    assert(steps < 500, '连续回合必须有限终止');
    assert.strictEqual(g.pending.seat, 0);
    answer(g, g.pending.kind === 'genius' ? '2' : 'roll');
  }
  assert.strictEqual(rolls, 240);
  assert.strictEqual(g.phase, 'between');
  assert.strictEqual(g.results.length, 1);
  assert.strictEqual(g.results[0].turns, 240);
  assert.strictEqual(g.results[0].reason, 'turn-limit');
  assert.deepStrictEqual(g.results[0].scores, [0, 0, 4]);
  assert.strictEqual(g.firstSeat, 1);
  assert.strictEqual(g.curSeat, null);
  assert.strictEqual(g.extraTurn, false);
  assert.strictEqual(g.skipperNext, null);
  assert.strictEqual(g.events.filter(e => e.t === 'turn').length, 240);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 239);
  assert.strictEqual(g.events.filter(e => e.t === 'raceEnd').length, 1);
  assert(!g.events.some(e => e.t === 'finish'));
  const eventScores = [0, 0, 0];
  for (const e of g.events) if (e.t === 'chip') eventScores[e.seat] += e.v;
  assert.deepStrictEqual(eventScores, g.results[0].scores);
  assert.deepStrictEqual(g.players.map(p => g.score(p.seat)), eventScores);
});
test('连续回合到达240立即结算，不能先多跑至242', () => {
  const g = startRace(['genius', 'stickler', 'legs'], () => 2, 0, g => {
    g.beforeRace = function* () { this.turns = 238; R(this, 'genius').pos = 29; };
  });
  for (let i = 0; i < 8 && g.pending; i++) answer(g, g.pending.kind === 'genius' ? '2' : 'roll');
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.results[0].turns, 240);
  assert.strictEqual(g.results[0].reason, 'turn-limit');
  assert.strictEqual(g.events.filter(e => e.t === 'turn').length, 2);
});
test('额外回合淘汰天才后不能恢复旧回合，最早淘汰者成为下一场先手', () => {
  const g = startRace(['genius', 'mouth', 'legs'], () => 2, 0, g => {
    const take = g.takeTurn;
    g.takeTurn = function* (r) {
      if (r.rid === 'genius' && this.turns === 1) {
        this.curSeat = r.seat; this.turns++;
        this.emit({ t: 'turn', seat: r.seat, rid: r.rid });
        // 固定额外回合内的淘汰，验证调度器不会把已淘汰运动员再次入队。
        yield* this.eliminate(r, R(this, 'mouth'));
        this.extraTurn = true;
        this.emit({ t: 'turnEnd', seat: r.seat });
      } else yield* take.call(this, r);
    };
  });
  answer(g, 'roll'); answer(g, '2');
  assert.strictEqual(g.pending.seat, 1);
  assert.strictEqual(R(g, 'genius').out, true);
  let steps = 0;
  while (g.pending) { assert(++steps < 80); answer(g, g.pending.kind === 'mode' ? 'legs' : 'roll'); }
  assert.strictEqual(g.results.length, 1);
  assert.strictEqual(g.firstSeat, 0);
  assert.strictEqual(g.events.filter(e => e.t === 'turn' && e.rid === 'genius').length, 2);
});
test('天才额外回合触发主谋终止比赛后进入下一场，不恢复旧场回合', () => {
  const g = draftedTurnOrderRace(['genius', 'legs', 'blimp'], 555, () => 2);
  R(g, 'legs').power = 'mastermind'; R(g, 'legs').mmPredict = 'genius';
  for (let i = 0; i < 15; i++) { answer(g, 'roll'); answer(g, '2'); }
  assert.strictEqual(g.raceNo, 2);
  assert.strictEqual(g.pending.kind, 'pickRacer');
  assert.strictEqual(g.results.length, 1);
  assert.strictEqual(g.results[0].reason, 'finished');
  assert.deepStrictEqual(g.results[0].scores, [3, 1, 0]);
  assert.strictEqual(g.firstSeat, 2);
  const picks = g.players.map(p => p.hand.find(id => !p.used.includes(id)));
  pickRace(g, picks);
  assert.strictEqual(g.results.length, 1);
  const end = g.events.findIndex(e => e.t === 'raceEnd');
  const nextTurns = g.events.slice(end + 1).filter(e => e.t === 'turn');
  assert.strictEqual(nextTurns.length, 1);
  assert.strictEqual(nextTurns[0].seat, 2);
  assert.strictEqual(nextTurns[0].rid, picks[2]);
});

// 英文规则书镜像第 23 页：Genius 没有连续次数上限；Skipper 后触发会抢走下一回合。
test('正常选秀 seed555：天才连续猜中4次获得第5个完整回合，猜错后才交给下席', () => {
  const rolls = [2, 2, 2, 2, 3];
  const g = draftedRollSequenceRace(555, ['genius', 'legs', 'blimp'], rolls);
  for (let i = 0; i < 4; i++) {
    assert.strictEqual(g.pending.seat, 0);
    assert.strictEqual(g.pending.kind, 'roll');
    answer(g, 'roll');
    assert.strictEqual(g.pending.kind, 'genius');
    answer(g, '2');
  }
  assert.deepStrictEqual(turnSeats(g), [0, 0, 0, 0, 0]);
  assert.strictEqual(g.pending.seat, 0);
  assert.strictEqual(g.pending.kind, 'roll');
  assert.strictEqual(R(g, 'genius').pos, 8);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 4);
  assert.strictEqual(g.events.filter(e => e.t === 'power' && e.key === 'genius').length, 4);
  assert.strictEqual(g.events.filter(e => e.t === 'turnEnd').length, 4);
  answer(g, 'roll'); answer(g, '2'); // 第 5 回合实际掷出 3，预言失败。
  assert.strictEqual(rolls.length, 0);
  assert.strictEqual(R(g, 'genius').pos, 11);
  assert.strictEqual(g.pending.seat, 1);
  assert.deepStrictEqual(turnSeats(g), [0, 0, 0, 0, 0, 1]);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 4);
});
test('正常选秀 seed936：天才猜中2仍得到自己的下一真实回合', () => {
  const g = draftedRollSequenceRace(936, ['genius', 'skipper', 'legs'], [2]);
  answer(g, 'roll'); answer(g, '2');
  assert.deepStrictEqual(turnSeats(g), [0, 0]);
  assert.strictEqual(g.pending.seat, 0);
  assert.strictEqual(g.pending.kind, 'roll');
  assert.strictEqual(R(g, 'genius').pos, 2);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 1);
  assert(!g.events.some(e => e.t === 'power' && e.key === 'skipper'));
});
test('船长自己连续掷1可重复获得完整回合，掷2后从自己的下席继续', () => {
  const rolls = [1, 1, 1, 2];
  const g = fixedRace(['skipper', 'legs', 'blimp'], game => {
    game.d6 = () => { assert(rolls.length); return rolls.shift(); };
  });
  for (let i = 0; i < 3; i++) {
    answer(g, 'roll');
    assert.deepStrictEqual(turnSeats(g), Array(i + 2).fill(0));
    assert.strictEqual(g.pending.seat, 0);
    assert.strictEqual(g.pending.kind, 'roll');
    assert.strictEqual(R(g, 'skipper').pos, i + 1);
  }
  answer(g, 'roll');
  assert.strictEqual(rolls.length, 0);
  assert.deepStrictEqual(turnSeats(g), [0, 0, 0, 0, 1]);
  assert.strictEqual(g.pending.seat, 1);
  assert.strictEqual(R(g, 'skipper').pos, 5);
  assert.strictEqual(g.events.filter(e => e.t === 'power' && e.key === 'skipper').length, 3);
});
test('连续天才回合内仍执行240回合安全上限，reason和已得分一致且不发剩余奖牌', () => {
  const g = fixedRace(['genius', 'gunk', 'sisyphus', 'legs'], game => { game.d6 = () => 1; });
  // Gunk 将 1 格降成 0；Genius 可以一直猜中，但不会有人冲线。
  let decisions = 0;
  while (g.pending) {
    assert(++decisions <= 1000, '连续额外回合必须有限终止');
    answer(g, g.pending.kind === 'genius' ? '1' : 'roll');
  }
  assert.strictEqual(g.phase, 'between');
  assert.strictEqual(g.results.length, 1);
  const result = g.results[0];
  assert.strictEqual(result.turns, 240);
  assert.strictEqual(result.reason, 'turn-limit');
  assert.deepStrictEqual(turnSeats(g), Array(240).fill(0));
  assert.deepStrictEqual(result.scores, [0, 0, 4, 0]);
  assert.deepStrictEqual(result.scores, g.players.map(p => g.score(p.seat)));
  const chipScores = Array(4).fill(0);
  for (const e of g.events.filter(e => e.t === 'chip')) chipScores[e.seat] += e.v;
  assert.deepStrictEqual(result.scores, chipScores);
  assert(!g.events.some(e => e.t === 'finish' || (e.t === 'chip' && e.kind !== 'bronze')));
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 239);
  assert.strictEqual(g.events.filter(e => e.t === 'raceEnd').length, 1);
  assert.strictEqual(g.extraTurn, false);
  assert.strictEqual(g.skipperNext, null);
});
test('天才连续猜中冲线即停止自身额外回合，单场计分一次并保持下一场先手', () => {
  const g = fixedRace(['genius', 'legs', 'blimp'], game => { game.d6 = () => 6; });
  for (let i = 0; i < 5; i++) { answer(g, 'roll'); answer(g, '6'); }
  assert.strictEqual(R(g, 'genius').finished, 1);
  assert.strictEqual(g.pending.seat, 1);
  assert.deepStrictEqual(turnSeats(g), [0, 0, 0, 0, 0, 1]);
  assert.strictEqual(g.score(0), 3);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 4);
  let decisions = 0;
  while (g.pending) {
    assert(++decisions < 100);
    answer(g, g.pending.kind === 'mode' ? 'legs' : 'roll');
  }
  assert.strictEqual(g.results.length, 1);
  assert.strictEqual(g.results[0].reason, 'finished');
  // 固定骰6：飞艇主移动为9、9、5、5、5，比每次走5的大长腿先拿银牌。
  assert.deepStrictEqual(g.events.filter(e => e.t === 'calc' && e.rid === 'blimp').map(e => [e.base, e.total]), [[6, 9], [6, 9], [6, 5], [6, 5], [6, 5]]);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'move' && e.rid === 'blimp').map(e => [e.from, e.to]), [[0, 9], [9, 18], [18, 23], [23, 28], [28, 30]]);
  assert.strictEqual(R(g, 'legs').pos, 25);
  assert.deepStrictEqual(turnSeats(g), [...Array(5).fill(0), ...Array(5).fill([1, 2]).flat()]);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'finish').map(e => [e.rid, e.place]), [['genius', 1], ['blimp', 2]]);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'chip').map(e => [e.seat, e.kind, e.v]), [[0, 'gold', 3], [2, 'silver', 1]]);
  assert.deepStrictEqual(g.results[0].scores, [3, 0, 1]);
  assert.strictEqual(g.firstSeat, 1, '未冲线且在25格的大长腿成为下场先手');
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.extraTurn, false);
  assert.strictEqual(g.skipperNext, null);
  assert.strictEqual(g.events.filter(e => e.t === 'finish' && e.rid === 'genius').length, 1);
  assert.strictEqual(g.events.filter(e => e.t === 'chip' && e.kind === 'gold').length, 1);
});
test('天才额外回合成为自然第二名时立即结束比赛，不发出后续回合或第三枚奖牌', () => {
  let geniusRolls = 0;
  const g = fixedRace(['legs', 'genius', 'blimp'], game => {
    game.d6 = () => game.curSeat === 1 ? (++geniusRolls <= 5 ? 2 : 6) : 1;
  });
  for (let i = 0; i < 5; i++) {
    answer(g, 'legs');
    answer(g, 'roll'); answer(g, '3'); // 前5轮猜错，保留正常席序。
    answer(g, 'roll');
  }
  assert.deepStrictEqual(g.racers.map(r => r.pos), [25, 10, 16]);
  answer(g, 'legs');
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert.strictEqual(g.pending.seat, 1);
  for (let i = 0; i < 4; i++) { answer(g, 'roll'); answer(g, '6'); }
  assert.strictEqual(geniusRolls, 9);
  assert.strictEqual(g.pending, null);
  assert.strictEqual(g.phase, 'between');
  assert.deepStrictEqual(turnSeats(g), [...Array(5).fill([0, 1, 2]).flat(), 0, 1, 1, 1, 1]);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 3);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'finish').map(e => [e.rid, e.place]), [['legs', 1], ['genius', 2]]);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'chip').map(e => [e.seat, e.kind, e.v]), [[0, 'gold', 3], [1, 'silver', 1]]);
  assert.strictEqual(g.results.length, 1);
  assert.strictEqual(g.results[0].reason, 'finished');
  assert.strictEqual(g.results[0].turns, 20);
  assert.deepStrictEqual(g.results[0].scores, [3, 1, 0]);
  assert.strictEqual(g.firstSeat, 2);
  assert.strictEqual(g.extraTurn, false);
  assert.strictEqual(g.skipperNext, null);
  const end = g.events.findIndex(e => e.t === 'raceEnd');
  assert(!g.events.slice(end + 1).some(e => ['turn', 'turnEnd', 'extraTurn', 'chip'].includes(e.t)));
});
test('额外回合中的比赛终止不会恢复旧回合：主谋触发后下一场只产生新阵容回合', () => {
  const first = ['genius', 'mastermind', 'legs'];
  const second = ['coach', 'skipper', 'blimp'];
  const g = new Game({ players: first.map((_, i) => ({ name: `P${i}` })), seed: 42 });
  g.players.forEach((p, i) => { p.hand = [first[i], second[i]]; });
  g.d6 = () => 6;
  g.gen = (function* () {
    g.raceNo = 1; g.trackKey = 'mild';
    yield* g.runRace(0);
    g.raceNo = 2;
    yield* g.runRace(1);
  })();
  g.start(); pickRace(g, first);
  R(g, 'mastermind').mmPredict = 'genius'; // 固定主谋已作出的预言，只隔离终止时点。
  for (let i = 0; i < 5; i++) { answer(g, 'roll'); answer(g, '6'); }
  assert.strictEqual(g.pending.kind, 'pickRacer');
  assert.strictEqual(g.raceNo, 2);
  assert.strictEqual(g.results.length, 1);
  assert.strictEqual(g.results[0].turns, 5);
  assert.deepStrictEqual(g.results[0].scores, [3, 1, 0]);
  assert.strictEqual(g.firstSeat, 2);
  const end = g.events.findIndex(e => e.t === 'raceEnd');
  assert(end >= 0);
  assert(!g.events.slice(end + 1).some(e => e.t === 'turnEnd' || e.t === 'extraTurn' || e.rid === 'genius'));
  pickRace(g, second);
  assert.strictEqual(g.pending.seat, 2);
  assert.strictEqual(g.pending.kind, 'roll');
  assert.strictEqual(g.turns, 1);
  assert.deepStrictEqual(g.events.slice(end + 1).filter(e => e.t === 'turn').map(e => [e.seat, e.rid]), [[2, 'blimp']]);
});
test('额外回合中天才被淘汰后不能再执行旧席回合，最先淘汰者仍为下场先手', () => {
  let geniusMoves = 0;
  const g = fixedRace(['genius', 'mouth', 'legs'], game => {
    game.d6 = () => 2;
    const originalMainMove = game.mainMove;
    // 首次 mainMove 在 pickRace 中已推进到 yield，必须提前安装计数探针。
    game.mainMove = function* (r, startPos) {
      yield* originalMainMove.call(this, r, startPos);
      if (r.rid === 'genius' && ++geniusMoves === 2) yield* this.eliminate(r, R(this, 'mouth'));
    };
  });
  answer(g, 'roll'); answer(g, '2');
  assert.strictEqual(geniusMoves, 1);
  assert.strictEqual(R(g, 'genius').out, false);
  assert.strictEqual(g.pending.seat, 0);
  assert.strictEqual(g.pending.kind, 'roll');
  answer(g, 'roll'); answer(g, '2');
  assert.strictEqual(geniusMoves, 2);
  assert.strictEqual(R(g, 'genius').out, true);
  assert.strictEqual(R(g, 'genius').pos, 4);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'move' && e.rid === 'genius').map(e => [e.from, e.to]), [[0, 2], [2, 4]]);
  assert.deepStrictEqual(g.events.filter(e => e.t === 'out').map(e => [e.rid, e.by]), [['genius', 'mouth']]);
  assert.deepStrictEqual(turnSeats(g), [0, 0, 1]);
  assert.strictEqual(g.pending.seat, 1);
  assert.strictEqual(g.events.filter(e => e.t === 'extraTurn').length, 1);
  let decisions = 0;
  while (g.pending) { assert(++decisions < 100); answer(g, g.pending.kind === 'mode' ? 'legs' : 'roll'); }
  assert.strictEqual(g.results.length, 1);
  assert.strictEqual(g.firstSeat, 0);
});

/* ---------- 此前没有专门用例的一代运动员 ---------- */
// 陪练选不带主移动加成的角色（起哄怪、黏液怪），避免和教练 +1 之类混在一起
const dice1 = (g, seq) => { g.d6 = () => { assert(seq.length, '骰点不得超出夹具'); return seq.shift(); }; };
const turn1 = (g, rid, answers) => run(g, g.takeTurn(R(g, rid)), { mode: 'roll', ...answers });
test('炼金术士：掷出 1/2 可以改走 4 格', () => {
  const g = setup([['alchemist', 0], ['heckler', 20]]);
  dice1(g, [2]);
  turn1(g, 'alchemist', { alchemist: 'yes' });
  assert.strictEqual(R(g, 'alchemist').pos, 4);
});
test('翻翻鱼：不掷骰，和另一名运动员交换位置', () => {
  const g = setup([['flipflop', 0], ['heckler', 20]]);
  turn1(g, 'flipflop', { mode: 'flip:heckler' });
  assert.deepStrictEqual([R(g, 'flipflop').pos, R(g, 'heckler').pos], [20, 0]);
  assert.strictEqual(g.events.filter(e => e.t === 'move').length, 0, '交换是瞬移');
});
test('啦啦队长：最后一名前进 2，自己前进 1，再主移动', () => {
  const g = setup([['cheerleader', 5], ['heckler', 2], ['gunk', 10]]);
  dice1(g, [3]);
  turn1(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'heckler').pos, 4);
  assert.strictEqual(R(g, 'cheerleader').pos, 5 + 1 + 3 - 1);
});
test('决斗家：停到别人格子可以决斗，平局算决斗家赢', () => {
  const g = setup([['duelist', 0], ['heckler', 4]]);
  dice1(g, [4, 4, 4]);
  turn1(g, 'duelist', { duel: 'heckler' });
  assert.strictEqual(R(g, 'duelist').pos, 6);
});
test('决斗家：别人停到我格子也能决斗，点大者前进 2', () => {
  const g = setup([['heckler', 0], ['duelist', 3]]);
  dice1(g, [3, 2, 5]);
  turn1(g, 'heckler', { duel: 'heckler' });
  assert.strictEqual(R(g, 'heckler').pos, 5);
  assert.strictEqual(R(g, 'duelist').pos, 3);
});
test('决斗家 AI：前进 2 格会踩箭头退回原格时不决斗，免得同一回合决斗几十次', () => {
  const { decide } = require('../game/ai');
  const g = setup([['duelist', 22], ['mouth', 22]], 'wild');
  const opts = [{ v: 'mouth', label: '和大嘴怪决斗' }, { v: '_no', label: '不决斗' }];
  assert.strictEqual(decide(g, { kind: 'duel', seat: 0, options: opts }, 0), '_no', '狂野荒原 24 号箭头后退 2');
  R(g, 'duelist').pos = 20; R(g, 'mouth').pos = 20;
  assert.strictEqual(decide(g, { kind: 'duel', seat: 0, options: opts }, 0), 'mouth');
});
test('催眠蛇：主移动前把一名运动员瞬移到自己格子', () => {
  const g = setup([['hypnotist', 5], ['heckler', 20]]);
  dice1(g, [2]);
  turn1(g, 'hypnotist', { hypnotist: 'heckler' });
  assert.strictEqual(R(g, 'heckler').pos, 5);
  assert.strictEqual(R(g, 'hypnotist').pos, 7);
});
test('尺蠖：别人主移动掷出 1 时这步作废，尺蠖前进 1', () => {
  const g = setup([['gunk', 0], ['inchworm', 10]]);
  dice1(g, [1]);
  turn1(g, 'gunk');
  assert.strictEqual(R(g, 'gunk').pos, 0);
  assert.strictEqual(R(g, 'inchworm').pos, 11);
});
test('跟班：别人主移动掷出 6 时抢先前进 2', () => {
  const g = setup([['heckler', 0], ['lackey', 10]]);
  dice1(g, [6]);
  turn1(g, 'heckler');
  assert.strictEqual(R(g, 'heckler').pos, 6);
  assert.strictEqual(R(g, 'lackey').pos, 12);
  const moves = g.events.filter(e => e.t === 'move').map(e => e.rid);
  assert.deepStrictEqual(moves, ['lackey', 'heckler'], '跟班先走');
});
test('可爱废柴：主移动前独自垫底拿 1 分，并列垫底不拿', () => {
  let g = setup([['loser', 0], ['heckler', 10]]);
  dice1(g, [2]);
  turn1(g, 'loser');
  assert.strictEqual(g.score(0), 1);
  g = setup([['loser', 0], ['heckler', 0]]);
  dice1(g, [2]);
  turn1(g, 'loser');
  assert.strictEqual(g.score(0), 0);
});
test('魔术象：主移动最多重掷两次，用最后一次点数', () => {
  const g = setup([['magician', 0], ['heckler', 20]]);
  dice1(g, [1, 2, 5]);
  const asked = [];
  turn1(g, 'magician', { reroll: d => { asked.push(d.options.map(o => o.v)); return d.options.some(o => o.v === 'magic') ? 'magic' : 'keep'; } });
  assert.strictEqual(R(g, 'magician').pos, 5);
  assert.strictEqual(asked.length, 2, '第三次掷完不再提供重掷');
});
test('火箭科学家：点数翻倍，移动后摔倒', () => {
  const g = setup([['rocket', 0], ['heckler', 20]]);
  dice1(g, [3]);
  turn1(g, 'rocket', { rocket: 'yes' });
  assert.strictEqual(R(g, 'rocket').pos, 6);
  assert.strictEqual(R(g, 'rocket').tripped, true);
});
test('双胞胎：赛前复制往届冠军技能，没有冠军时不复制', () => {
  let g = setup([['twin', 0], ['heckler', 0]]);
  g.winners = ['legs'];
  run(g, g.beforeRace(), { twin: 'legs' });
  assert.strictEqual(R(g, 'twin').power, 'legs');
  g = setup([['twin', 0], ['heckler', 0]]);
  run(g, g.beforeRace());
  assert.strictEqual(R(g, 'twin').power, 'twin');
});
test('半人马：冲线那一步超过的人也后退 2 格', () => {
  const g = setup([['centaur', 26], ['heckler', 28], ['gunk', 5]]);
  run(g, g.move(R(g, 'centaur'), 5, 'main'));
  assert.strictEqual(R(g, 'centaur').finished, 1);
  assert.strictEqual(R(g, 'heckler').pos, 26);
  assert.strictEqual(R(g, 'gunk').pos, 5);
});
test('香蕉：冲线那一步超过香蕉不再绊倒冲线者，也不触发技能', () => {
  const g = setup([['heckler', 26], ['banana', 28], ['gunk', 5]]);
  run(g, g.move(R(g, 'heckler'), 5, 'main'));
  assert.strictEqual(R(g, 'heckler').finished, 1);
  assert.strictEqual(R(g, 'heckler').tripped, false);
  assert(!g.events.some(e => e.t === 'power' && e.key === 'banana'));
});

let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.message); }
}
console.log(fail ? `${fail} 项失败` : `全部 ${tests.length} 项通过`);
process.exit(fail ? 1 : 0);
