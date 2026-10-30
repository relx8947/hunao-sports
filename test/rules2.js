'use strict';
// 二代（Second Wind）技能、变数卡、漩涡与模式的语义单测：手工摆盘，直接驱动引擎内部生成器
const assert = require('assert');
const { Game } = require('../game/engine');
const { RACER_IDS, RACER_IDS_V2, TWISTS } = require('../game/racers');
const { TRACKS, EDITIONS } = require('../game/tracks');

function setup(list, track = 'twisty', edition = 'v2') {
  const g = new Game({ players: list.map((_, i) => ({ name: `P${i}` })), seed: 42, edition });
  g.phase = 'race'; g.raceNo = 1; g.trackKey = track; g.curSeat = 0;
  g.finishCount = 0; g.outOrder = []; g.turns = 0; g.skipperNext = null; g.extraTurn = false;
  g.raceEndReason = 'finished';
  g.resetTurnCounters();
  g.resetRaceState();
  g.racers = list.map(([rid, pos], i) => ({ rid, seat: i, pos, power: rid, tripped: false, finished: 0, out: false }));
  return g;
}
const R = (g, rid) => g.racers.find((r) => r.rid === rid);
const dice = (g, seq) => { g.d6 = () => { assert(seq.length, '骰点不得超出夹具'); return seq.shift(); }; };
// answers[kind] 可以是值或函数；simul 决策给每个席位同一个答案
function run(g, gen, answers = {}) {
  const asked = [];
  let r;
  try {
    r = gen.next();
    while (!r.done) {
      const d = r.value;
      asked.push(d.kind);
      const a = answers[d.kind];
      let v;
      if (d.simul) {
        v = {};
        for (const s of d.seats) v[s] = a !== undefined ? (typeof a === 'function' ? a(d, s) : a) : d.optionsBySeat[s][0].v;
      } else v = a !== undefined ? (typeof a === 'function' ? a(d) : a) : d.options[0].v;
      r = gen.next(v);
    }
  } catch (e) { if (e.constructor.name !== 'RaceEnd') throw e; g.ended = true; }
  return asked;
}
const turn = (g, rid, answers) => run(g, g.takeTurn(R(g, rid)), { mode: 'roll', ...answers });
const ev = (g, t) => g.events.filter((e) => e.t === t);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ================= 模式与赛道 ================= */
test('三种模式的卡池与赛程', () => {
  const pl = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const v1 = new Game({ players: pl, seed: 1 });
  assert.strictEqual(v1.edition, 'v1');
  assert.deepStrictEqual(v1.schedule, ['mild', 'wild', 'mild', 'wild']);
  assert.deepStrictEqual(v1.deck.slice().sort(), RACER_IDS.slice().sort());
  assert.strictEqual(v1.twistDeck, undefined, '一代不洗变数卡，随机序列与原来一致');
  const v2 = new Game({ players: pl, seed: 1, edition: 'v2' });
  assert.deepStrictEqual(v2.schedule, ['twisty', 'whirly', 'twisty', 'whirly']);
  assert.deepStrictEqual(v2.deck.slice().sort(), RACER_IDS_V2.slice().sort());
  assert.strictEqual(v2.twistDeck.length, 13);
  const mix = new Game({ players: pl, seed: 1, edition: 'mix' });
  assert.deepStrictEqual(mix.schedule, ['mild', 'wild', 'twisty', 'whirly']);
  assert.strictEqual(mix.deck.length, 72);
  assert.throws(() => new Game({ players: pl, edition: 'v9' }));
  // 一代同 seed 的牌堆与改动前一致（只依赖原有 36 张的洗牌）
  const again = new Game({ players: pl, seed: 1, edition: 'v1' });
  assert.deepStrictEqual(again.deck, v1.deck);
  assert.strictEqual(new Game({ players: pl, seed: 1 }).snapshot().v2, undefined);
  assert.strictEqual(EDITIONS.mix.twists, true);
});
test('漩涡乐园：6 对漩涡双向传送，传送不算移动，不会被吸回', () => {
  assert.deepStrictEqual(TRACKS.whirly.whirls, [[4, 6], [8, 12], [11, 15], [17, 22], [20, 23], [24, 28]]);
  assert.strictEqual(Object.keys(TRACKS.whirly.spaces).length, 12);
  for (const [a, b] of TRACKS.whirly.whirls) {
    for (const [from, to] of [[a, b], [b, a]]) {
      const g = setup([['hotel', 0], ['gloth', 29]], 'whirly');
      run(g, g.move(R(g, 'hotel'), from, 'main'));
      assert.strictEqual(R(g, 'hotel').pos, to, `${from} 应传送到 ${to}`);
      const moves = ev(g, 'move'), warps = ev(g, 'warp');
      assert.strictEqual(moves.length, 1, '传送不产生 move 事件');
      assert.deepStrictEqual(warps.map((e) => [e.from, e.to]), [[from, to]]);
      assert.deepStrictEqual(ev(g, 'space').map((e) => [e.space, e.pos, e.to]), [['whirl', from, to]]);
    }
  }
  // 经过漩涡不触发
  const g = setup([['hotel', 0], ['gloth', 29]], 'whirly');
  run(g, g.move(R(g, 'hotel'), 5, 'main'));
  assert.strictEqual(R(g, 'hotel').pos, 5);
});
test('漩涡传送后照常结算落点同格技能（停到旅馆格付房费）', () => {
  const g = setup([['gloth', 0], ['hotel', 6]], 'whirly');
  g.giveChip(0, 'bronze', 1);
  run(g, g.move(R(g, 'gloth'), 4, 'main'));
  assert.strictEqual(R(g, 'gloth').pos, 6);
  assert.strictEqual(g.score(0), 0); assert.strictEqual(g.score(1), 1);
});
test('扭扭糖果：本场第一个移动到/经过第 14 格的运动员抽一张变数卡，之后不再抽', () => {
  const g = setup([['hotel', 10], ['gloth', 12]]);
  g.twistDeck = ['roastchicken', 'bonkbug'];
  run(g, g.move(R(g, 'hotel'), 3, 'main'));
  assert.strictEqual(ev(g, 'twist').length, 0, '13 还没到招牌');
  run(g, g.move(R(g, 'gloth'), 4, 'main'));
  assert.deepStrictEqual(ev(g, 'twist').map((e) => [e.id, e.rid]), [['roastchicken', 'gloth']]);
  run(g, g.move(R(g, 'hotel'), 5, 'main'));
  assert.strictEqual(ev(g, 'twist').length, 1);
  // 其他赛道没有招牌
  const w = setup([['hotel', 10], ['gloth', 0]], 'whirly');
  w.twistDeck = ['roastchicken'];
  run(w, w.move(R(w, 'hotel'), 5, 'main'));
  assert.strictEqual(ev(w, 'twist').length, 0);
});

/* ================= 二代 36 名运动员 ================= */
test('咬痕：掷 1/2 变身，同一步就淘汰被超过的人', () => {
  const g = setup([['bitemark', 0], ['hotel', 1], ['gloth', 9]]);
  dice(g, [2]);
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').wolf, true);
  assert.strictEqual(R(g, 'hotel').out, true);
  assert.strictEqual(ev(g, 'out')[0].cause, 'bitemark');
  // 没变身时超过人不咬
  const h = setup([['bitemark', 0], ['hotel', 1], ['gloth', 9]]);
  dice(h, [4]);
  turn(h, 'bitemark');
  assert.strictEqual(R(h, 'hotel').out, false);
});
test('糊涂狗：垫底 ×3，不垫底改为后退', () => {
  let g = setup([['blunderdog', 0], ['hotel', 5]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 6);
  g = setup([['blunderdog', 5], ['hotel', 0]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 3);
  assert.strictEqual(ev(g, 'calc')[0].reverse, true);
});
test('老千豹：上家猜错按暗定步数走，猜中不动；暗定数字不算掷骰', () => {
  let g = setup([['hotel', 0], ['cheatah', 0], ['gloth', 20]]);
  g.d6 = () => { throw new Error('不应掷骰'); };
  const seen = [];
  turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '5', cheatahGuess: (d) => { seen.push(d.seat); return '3'; } });
  assert.deepStrictEqual(seen, [0], '上家是上一席');
  assert.strictEqual(R(g, 'cheatah').pos, 5);
  g = setup([['hotel', 0], ['cheatah', 0], ['gloth', 20]]);
  turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '4', cheatahGuess: '4' });
  assert.strictEqual(R(g, 'cheatah').pos, 0);
  assert.strictEqual(ev(g, 'cheat')[0].hit, true);
});
test('毒舌家：可让前面的运动员重掷一次主移动骰（每回合一次）', () => {
  const g = setup([['critic', 0], ['hotel', 5]]);
  dice(g, [6, 2]);
  const asked = turn(g, 'hotel', { critic: 'yes' });
  assert.strictEqual(asked.filter((k) => k === 'critic').length, 1);
  assert.strictEqual(R(g, 'hotel').pos, 7);
  // 在身后的人不能被差评
  const h = setup([['critic', 5], ['hotel', 0]]);
  dice(h, [6]);
  assert(!turn(h, 'hotel', { critic: 'yes' }).includes('critic'));
});
test('大明星：垫底和领跑者换位，否则和最后一名换位（不算移动）', () => {
  let g = setup([['diva', 0], ['hotel', 10], ['gloth', 4]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'hotel').pos, 0);
  assert.strictEqual(R(g, 'diva').pos, 11);
  g = setup([['diva', 5], ['hotel', 0], ['gloth', 9]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'hotel').pos, 5);
  assert.strictEqual(R(g, 'diva').pos, 1);
  assert.strictEqual(ev(g, 'swap').length, 1);
});
test('冒牌货：第一个到终点的被淘汰，冒牌货获得其技能；之后的人正常冲线', () => {
  const g = setup([['doppel', 0], ['hotel', 28], ['gloth', 27]]);
  run(g, g.move(R(g, 'hotel'), 2, 'main'));
  assert.strictEqual(R(g, 'hotel').out, true);
  assert.strictEqual(R(g, 'hotel').finished, 0);
  assert.deepStrictEqual(R(g, 'doppel').stack, ['hotel']);
  assert(g.has(R(g, 'doppel'), 'hotel'));
  assert.strictEqual(g.finishCount, 0);
  run(g, g.move(R(g, 'gloth'), 3, 'main'));
  assert.strictEqual(R(g, 'gloth').finished, 1);
  // 自己先到也淘汰
  const h = setup([['doppel', 28], ['hotel', 0]]);
  run(h, h.move(R(h, 'doppel'), 2, 'main'));
  assert.strictEqual(R(h, 'doppel').out, true);
});
test('树懒：主移动 -1；本场结束没过第二弯道拿 3 分', () => {
  const g = setup([['gloth', 0], ['hotel', 20]]);
  dice(g, [4]);
  turn(g, 'gloth');
  assert.strictEqual(R(g, 'gloth').pos, 3);
  R(g, 'gloth').pos = 15;
  g.afterRace(0);
  assert.strictEqual(g.score(0), 3);
  const h = setup([['gloth', 16], ['hotel', 20]]);
  h.afterRace(0);
  assert.strictEqual(h.score(0), 0);
});
test('野猪骑士：赛前骑猪，主移动 +2；别人停到格子上抢走野猪', () => {
  const g = setup([['hogknight', 0], ['hotel', 0]]);
  run(g, g.applyBeforeRace(R(g, 'hogknight'), 'hogknight', 0));
  assert.strictEqual(R(g, 'hogknight').hogs, 1);
  dice(g, [3]);
  turn(g, 'hogknight');
  assert.strictEqual(R(g, 'hogknight').pos, 5);
  run(g, g.move(R(g, 'hotel'), 5, 'main'));
  assert.strictEqual(R(g, 'hotel').hogs, 1);
  assert.strictEqual(R(g, 'hogknight').hogs, 0);
  assert.strictEqual(ev(g, 'hog').at(-1).from, 'hogknight');
});
test('蹦蹦蛙：回合结束正好有人在前 1 格，再来一回合', () => {
  const g = setup([['hopfrog', 0], ['hotel', 3]]);
  dice(g, [2]);
  turn(g, 'hopfrog');
  assert.strictEqual(g.extraTurn, true);
  const h = setup([['hopfrog', 0], ['hotel', 4]]);
  dice(h, [2]);
  turn(h, 'hopfrog');
  assert.strictEqual(h.extraTurn, false);
});
test('小旅馆：停到旅馆格要付 1 分，付不出被绊倒', () => {
  let g = setup([['gloth', 0], ['hotel', 5]]);
  g.giveChip(0, 'bronze', 1); g.giveChip(0, 'bronze', 1);
  run(g, g.move(R(g, 'gloth'), 5, 'main'));
  assert.strictEqual(g.score(0), 1); assert.strictEqual(g.score(1), 1);
  g = setup([['gloth', 0], ['hotel', 5]]);
  run(g, g.move(R(g, 'gloth'), 5, 'main'));
  assert.strictEqual(R(g, 'gloth').tripped, true);
});
test('伊卡洛斯：主移动 +3，最终掷出 6 淘汰（被重掷掉的 6 不算）', () => {
  let g = setup([['icarus', 0], ['hotel', 20]]);
  dice(g, [2]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').pos, 5);
  g = setup([['icarus', 0], ['hotel', 20]]);
  dice(g, [6]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').out, true);
  g = setup([['icarus', 0], ['critic', -0], ['hotel', 20]]);
  R(g, 'icarus').pos = 3;
  dice(g, [6, 1]);
  turn(g, 'icarus', { critic: 'yes' });
  assert.strictEqual(R(g, 'icarus').out, false);
  assert.strictEqual(R(g, 'icarus').pos, 7);
});
test('绊脚王：回合开始可以绊倒领跑者', () => {
  const g = setup([['kingtripper', 0], ['hotel', 9], ['gloth', 4]]);
  dice(g, [1]);
  turn(g, 'kingtripper', { kingtripper: 'hotel' });
  assert.strictEqual(R(g, 'hotel').tripped, true);
  assert.strictEqual(R(g, 'gloth').tripped, false);
});
test('大海怪：每场一次把所有人卷到自己格子并绊倒', () => {
  const g = setup([['kraken', 3], ['hotel', 9], ['gloth', 0]]);
  dice(g, [1, 1]);
  turn(g, 'kraken', { kraken: 'yes' });
  assert.strictEqual(R(g, 'hotel').pos, 3); assert.strictEqual(R(g, 'gloth').pos, 3);
  assert(R(g, 'hotel').tripped && R(g, 'gloth').tripped);
  R(g, 'hotel').pos = 20;
  const asked = turn(g, 'kraken', { kraken: 'yes' });
  assert(!asked.includes('kraken'), '每场只能用一次');
});
test('捣蛋鬼：别人掷出 3 整段反向；两个捣蛋鬼抵消', () => {
  let g = setup([['saboteur', 0], ['hotel', 10]]);
  dice(g, [3]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 7);
  g = setup([['saboteur', 0], ['hotel', 10], ['saboteur', 0]]);
  g.racers[2].rid = 'saboteur2';
  dice(g, [3]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 13);
});
test('魔法健将：六种点数效果', () => {
  // 1 → 前进 7
  let g = setup([['magicalathlete', 0], ['hotel', 20]]);
  dice(g, [1]); turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 7);
  // 2 → 最后一名都传来，自己不动
  g = setup([['magicalathlete', 8], ['hotel', 2], ['gloth', 2], ['diva', 20]]);
  dice(g, [2]); turn(g, 'magicalathlete');
  assert.deepStrictEqual([R(g, 'hotel').pos, R(g, 'gloth').pos, R(g, 'magicalathlete').pos], [8, 8, 8]);
  // 3 → 瞬移到目标格并绊倒那格的人
  g = setup([['magicalathlete', 0], ['hotel', 9], ['gloth', 4]]);
  dice(g, [3]); turn(g, 'magicalathlete', { athleteWarp: 'hotel' });
  assert.strictEqual(R(g, 'magicalathlete').pos, 9);
  assert.strictEqual(R(g, 'hotel').tripped, true);
  // 4 → 前进 4 再来一回合
  g = setup([['magicalathlete', 0], ['hotel', 20]]);
  dice(g, [4]); turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 4); assert.strictEqual(g.extraTurn, true);
  // 5 → 领跑者后退 5
  g = setup([['magicalathlete', 0], ['hotel', 12], ['gloth', 12]]);
  dice(g, [5]); turn(g, 'magicalathlete');
  assert.deepStrictEqual([R(g, 'hotel').pos, R(g, 'gloth').pos, R(g, 'magicalathlete').pos], [7, 7, 0]);
  // 6 → 前进 6 并绊倒被超过的人
  g = setup([['magicalathlete', 0], ['hotel', 3], ['gloth', 20]]);
  dice(g, [6]); turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 6); assert.strictEqual(R(g, 'hotel').tripped, true);
});
test('魔法健将掷 3 瞬移后照常结算落点（落到漩涡口会被传走）', () => {
  const g = setup([['magicalathlete', 0], ['gloth', 11], ['hotel', 2]], 'whirly');
  dice(g, [3]); turn(g, 'magicalathlete', { athleteWarp: 'gloth' });
  assert.strictEqual(R(g, 'gloth').tripped, true, '先绊倒目标格的人');
  assert.strictEqual(R(g, 'magicalathlete').pos, 15, '11 号漩涡口传到 15');
});
test('浪漫鳄：停格者被漩涡送走后不再算「恰好两人」，不会来回循环', () => {
  const g = setup([['romantic', 2], ['gloth', 6]], 'whirly');
  run(g, g.move(R(g, 'romantic'), 4, 'main'));
  assert.strictEqual(R(g, 'romantic').pos, 4);
  assert.strictEqual(g.events.filter((e) => /啊，爱情/.test(e.text || '')).length, 0);
});
test('无限循环走完一遍就停：浪漫鳄从漩涡冒出来正好又凑成两人', () => {
  const g = setup([['romantic', 0], ['gloth', 4]], 'whirly');
  run(g, g.move(R(g, 'romantic'), 6, 'main'));
  assert.strictEqual(R(g, 'romantic').pos, 4);
  assert(g.events.filter((e) => /啊，爱情/.test(e.text || '')).length <= 2, '之前要来回 30 遍');
  assert(g.events.some((e) => /无限循环/.test(e.text || '')));
});
test('糊涂狗：垫底 ×3 的算式写全；垫底又被捣蛋鬼反向时按卡牌不乘 3', () => {
  let g = setup([['blunderdog', 0], ['hotel', 5]]);
  dice(g, [2]); turn(g, 'blunderdog');
  const c = ev(g, 'calc')[0];
  assert.strictEqual(c.raw, 2);
  assert.match(c.text, /主移动：2×3（糊涂狗垫底） = 6/);
  g = setup([['blunderdog', 4], ['saboteur', 5]]);
  dice(g, [3]); turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 1, '后退 3 而不是 9');
  assert.match(ev(g, 'calc')[0].text, /主移动：3，反向 = -3/);
  g = setup([['blunderdog', 9], ['saboteur', 5]]);
  dice(g, [3]); turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 12, '没垫底反向 + 捣蛋鬼反向 = 抵消');
  assert.strictEqual(ev(g, 'calc')[0].cancel, true);
  assert.match(ev(g, 'calc')[0].text, /两次反向抵消/);
});
test('绊倒提示：企鹅照样掷骰；自己回合主移动前摔倒是这回合不能动；已经摔倒不重复提示', () => {
  const g = setup([['penguin', 3], ['hotel', 5]]);
  g.trip(R(g, 'penguin'), '测试');
  assert.match(ev(g, 'trip')[0].text, /下回合照样掷骰，主移动翻倍/);
  g.trip(R(g, 'penguin'), '再来');
  assert.strictEqual(ev(g, 'trip').length, 1);
  g.preMain = R(g, 'hotel');
  g.trip(R(g, 'hotel'), '踩到石头');
  assert.match(ev(g, 'trip')[1].text, /这回合不能主移动/);
});
test('鼹鼠：身边 1 格没人时可以直接走 6；有人时没有这个选项', () => {
  let g = setup([['mole', 0], ['hotel', 2]]);
  g.d6 = () => { throw new Error('不应掷骰'); };
  turn(g, 'mole', { mode: 'mole' });
  assert.strictEqual(R(g, 'mole').pos, 6);
  g = setup([['mole', 0], ['hotel', 1]]);
  dice(g, [2]);
  const asked = turn(g, 'mole');
  assert(!asked.includes('mode'), '只有掷骰一种方式');
});
test('骰子先生：掷 6 颗挑重复点数；全不同不动', () => {
  let g = setup([['diceguy', 0], ['hotel', 20]]);
  dice(g, [3, 3, 5, 5, 1, 2]);
  turn(g, 'diceguy', { diceguy: '5' });
  assert.strictEqual(R(g, 'diceguy').pos, 5);
  assert.deepStrictEqual(ev(g, 'rolls')[0].dice, [3, 3, 5, 5, 1, 2]);
  g = setup([['diceguy', 0], ['hotel', 20]]);
  dice(g, [1, 2, 3, 4, 5, 6]);
  turn(g, 'diceguy');
  assert.strictEqual(R(g, 'diceguy').pos, 0);
});
test('派对杀手：骰子先生一次掷 6 颗，其中的 6 都要作废重掷', () => {
  const g = setup([['diceguy', 0], ['pooper', 5]]);
  dice(g, [6, 3, 6, 5, 5, 1, 2, 4]);
  turn(g, 'diceguy');
  assert.deepStrictEqual(ev(g, 'rolls')[0].dice, [3, 5, 5, 1, 2, 4]);
  assert.strictEqual(ev(g, 'voided').length, 2);
  assert.strictEqual(R(g, 'pooper').pos, 7);
});
test('派对杀手：诅咒魔杖给已没有运动员的玩家掷的 6 也要作废重掷', () => {
  const g = setup([['pooper', 0], ['hotel', 5]]);
  g.racers[1].finished = 1; // 玩家 1 已冲线，没有场上运动员
  g.twistActive = new Set(['cursewands']);
  dice(g, [6, 6, 2]);
  const gen = g.curseNext(1);
  let r = gen.next(); while (!r.done) r = gen.next();
  assert.strictEqual(r.value, (1 + 1 + 2) % 2);
  assert.strictEqual(ev(g, 'voided').length, 2);
  assert.strictEqual(ev(g, 'curse')[0].value, 2);
});
test('派对杀手：连续掷出 7 个 6 也要一直作废，直到不是 6', () => {
  const g = setup([['hotel', 0], ['pooper', 20]]);
  dice(g, [6, 6, 6, 6, 6, 6, 6, 2]);
  turn(g, 'hotel');
  assert.strictEqual(ev(g, 'voided').length, 7);
  assert.strictEqual(R(g, 'hotel').pos, 2);
});
test('巨婴：空指针离开它身后、巨婴恢复技能的那一刻，把同格的人挤到身后一格', () => {
  const g = setup([['nul', 3], ['hugebaby', 5], ['hotel', 5]], 'twisty', 'mix');
  assert(!g.has(R(g, 'hugebaby'), 'hugebaby'), '空指针在身后时巨婴没有技能');
  dice(g, [4]);
  turn(g, 'nul');
  assert.strictEqual(R(g, 'nul').pos, 7);
  assert(g.has(R(g, 'hugebaby'), 'hugebaby'));
  assert.strictEqual(R(g, 'hotel').pos, 4);
});
test('蘑菇：掷 1/2 抽一名运动员叠加技能；抽到赛前技能这次白抽（卡牌注释）', () => {
  const g = setup([['mush', 0], ['hotel', 20]]);
  g.deck = ['icarus', 'nepobaby'];
  dice(g, [2]);
  turn(g, 'mush');
  assert.deepStrictEqual(R(g, 'mush').stack, ['icarus']);
  assert.strictEqual(R(g, 'mush').pos, 5, '叠上伊卡洛斯后本次主移动就 +3');
  assert.deepStrictEqual(g.deck, ['nepobaby']);
  const h = setup([['mush', 0], ['hotel', 20]]);
  h.deck = ['nepobaby', 'icarus'];
  dice(h, [2]);
  turn(h, 'mush');
  assert.strictEqual(R(h, 'mush').stack, undefined, '抽到星二代（赛前技能）白抽，不再抽下一张');
  assert.strictEqual(R(h, 'mush').pos, 2);
  assert.deepStrictEqual(h.deck, ['icarus', 'nepobaby']);
});
test('蘑菇：长出咬痕的这一掷就变身', () => {
  const g = setup([['mush', 0], ['hotel', 20]]);
  g.deck = ['bitemark'];
  dice(g, [1]);
  turn(g, 'mush');
  assert.strictEqual(R(g, 'mush').wolf, true);
});
test('宿敌：跟掷点数相同，等对方走完再前进同样格数', () => {
  const g = setup([['nemesis', 0], ['hotel', 2]]);
  dice(g, [4, 4]);
  turn(g, 'hotel', { nemesis: 'yes' });
  assert.strictEqual(R(g, 'hotel').pos, 6);
  assert.strictEqual(R(g, 'nemesis').pos, 4);
  const moves = ev(g, 'move').map((e) => e.rid);
  assert.deepStrictEqual(moves, ['hotel', 'nemesis']);
  const h = setup([['nemesis', 0], ['hotel', 2]]);
  dice(h, [4, 3]);
  turn(h, 'hotel', { nemesis: 'yes' });
  assert.strictEqual(R(h, 'nemesis').pos, 0);
});
test('星二代：直接从第一弯道（12）出发，不算移动', () => {
  const g = setup([['nepobaby', 0], ['hotel', 0]], 'whirly');
  run(g, g.applyBeforeRace(R(g, 'nepobaby'), 'nepobaby', 0));
  assert.strictEqual(R(g, 'nepobaby').pos, 12, '12 是漩涡，但摆放不触发');
  assert.strictEqual(ev(g, 'move').length, 0);
});
test('空指针：前面的人失去技能且主移动 -1；一超过它立刻失效', () => {
  const g = setup([['nul', 3], ['icarus', 5], ['hotel', 0]]);
  assert.deepStrictEqual(g.powers(R(g, 'icarus')), []);
  assert.deepStrictEqual(g.powers(R(g, 'hotel')), ['hotel']);
  dice(g, [2]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').pos, 6, '没有 +3，还要 -1');
  assert.strictEqual(g.snapshot().racers[1].nulled, true);
  // 赛场外技能（返场王）不受影响
  const h = setup([['nul', 0], ['rerunner', 5]]);
  assert.deepStrictEqual(h.powers(R(h, 'rerunner')), ['rerunner']);
});
test('超车王：前面每有一名在场运动员主移动 +1', () => {
  const g = setup([['overtaker', 0], ['hotel', 5], ['gloth', 9], ['diva', 30]]);
  R(g, 'diva').finished = 1;
  dice(g, [1]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').pos, 3);
});
test('派对杀手：任何人掷出 6 都作废重掷，派对杀手前进 1', () => {
  const g = setup([['pooper', 0], ['hotel', 5]]);
  dice(g, [6, 6, 2]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'pooper').pos, 2);
  assert.strictEqual(R(g, 'hotel').pos, 7);
  assert.strictEqual(ev(g, 'voided').length, 2);
});
test('攀滚企鹅：被超过就摔倒；摔倒时照常掷骰且翻倍，走完才爬起来', () => {
  const g = setup([['penguin', 3], ['hotel', 0]]);
  run(g, g.move(R(g, 'hotel'), 5, 'main'));
  assert.strictEqual(R(g, 'penguin').tripped, true);
  dice(g, [3]);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 9);
  assert.strictEqual(R(g, 'penguin').tripped, false);
});
test('返场王：首次上场后之后每场作为额外运动员上场，额外运动员也有自己的回合', () => {
  const g = setup([['rerunner', 4], ['hotel', 9]]);
  g.afterRace(0);
  assert.deepStrictEqual(g.players[0].extras, [{ rid: 'rerunner', power: 'rerunner', keep: true }]);
  // 下一场：正常暗选后，返场王作为额外运动员一起上场
  g.players[0].hand = ['rerunner', 'gloth']; g.players[0].used = ['rerunner'];
  g.players[1].hand = ['hotel', 'diva']; g.players[1].used = ['hotel'];
  g.raceNo = 2; g.trackKey = 'whirly';
  g.d6 = () => 1;
  g.gen = g.runRace(1); g.start();
  const d = g.pending;
  assert.strictEqual(d.kind, 'pickRacer');
  g.answer(0, d.id, 'gloth'); g.answer(1, d.id, 'diva');
  assert.deepStrictEqual(g.racers.map((r) => [r.rid, r.seat, !!r.extra]), [['gloth', 0, false], ['diva', 1, false], ['rerunner', 0, true]]);
  assert.deepStrictEqual(ev(g, 'reveal')[0].extras, [{ seat: 0, rid: 'rerunner' }]);
  // 席位 0 的回合里两名运动员都行动
  let guard = 0;
  while (g.pending && g.pending.kind !== 'roll' && guard++ < 10) g.answer(g.pending.seat, g.pending.id, g.pending.options[0].v);
  g.answer(0, g.pending.id, 'roll');
  while (g.pending && g.pending.seat === 0 && guard++ < 20) g.answer(0, g.pending.id, g.pending.options[0].v);
  assert.deepStrictEqual(ev(g, 'turn').slice(0, 2).map((e) => e.rid), ['gloth', 'rerunner']);
});
test('显摆王：继续掷必须更大，成功累加，失败这次不动', () => {
  let g = setup([['showoff', 0], ['hotel', 20]]);
  dice(g, [2, 5]);
  let n = 0;
  turn(g, 'showoff', { showoff: () => (n++ === 0 ? 'more' : 'stop') });
  assert.strictEqual(R(g, 'showoff').pos, 7);
  g = setup([['showoff', 0], ['hotel', 20]]);
  dice(g, [2, 4, 3]);
  turn(g, 'showoff', { showoff: 'more' });
  assert.strictEqual(R(g, 'showoff').pos, 0);
});
test('灵魂伴侣：赛前选伴侣；回合开始相距 5 格内瞬移过去后照常主移动', () => {
  const g = setup([['soulmate', 0], ['streaker', 5], ['gloth', 1]]);
  run(g, g.applyBeforeRace(R(g, 'soulmate'), 'soulmate', 0), { soulmate: 'streaker' });
  assert.strictEqual(R(g, 'soulmate').mate, 'streaker');
  dice(g, [2]);
  turn(g, 'soulmate');
  assert.strictEqual(R(g, 'soulmate').pos, 7);
  R(g, 'streaker').pos = 20;
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.strictEqual(R(g, 'soulmate').pos, 8, '超过 5 格不瞬移');
});
test('飙车魔：每有 1 分主移动 +1；领先所有人至少 4 格被淘汰', () => {
  const g = setup([['speeddemon', 0], ['hotel', 3]]);
  g.giveChip(0, 'gold', 3);
  dice(g, [1]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').pos, 4);
  R(g, 'speeddemon').pos = 7;
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, true);
  assert.strictEqual(ev(g, 'out')[0].cause, 'speeddemon');
});
test('搅局鬼：其他人都领先至少 5 格时取消本场并拿 3 分', () => {
  const g = setup([['spoilsport', 0], ['hotel', 5], ['gloth', 7]]);
  turn(g, 'spoilsport');
  assert(g.ended);
  assert.strictEqual(g.raceEndReason, 'cancelled');
  assert.strictEqual(g.score(0), 3);
  const h = setup([['spoilsport', 0], ['hotel', 5], ['gloth', 4]]);
  dice(h, [1]);
  turn(h, 'spoilsport');
  assert(!h.ended);
});
test('后爸：下家的运动员主移动 +2，它夺冠时后爸拿 3 分', () => {
  const g = setup([['stepdad', 0], ['hotel', 0], ['streaker', 0]]);
  dice(g, [1, 1]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 3);
  turn(g, 'streaker');
  assert.strictEqual(R(g, 'streaker').pos, 1, '不是继子不加成');
  R(g, 'hotel').pos = 28;
  run(g, g.move(R(g, 'hotel'), 2, 'main'));
  assert.strictEqual(R(g, 'hotel').finished, 1);
  assert.strictEqual(g.score(0), 3);
});
test('裸奔侠：一次移动超过人拿 1 分（超过多人也只 1 分，瞬移不算）', () => {
  const g = setup([['streaker', 0], ['hotel', 1], ['gloth', 2]]);
  run(g, g.move(R(g, 'streaker'), 4, 'main'));
  assert.strictEqual(g.score(0), 1);
  run(g, g.warp(R(g, 'streaker'), 0));
  run(g, g.warp(R(g, 'streaker'), 9));
  assert.strictEqual(g.score(0), 1);
});
test('裸奔侠：冲线那一步超过人也拿 1 分', () => {
  const g = setup([['streaker', 27], ['hotel', 28], ['gloth', 1]]);
  run(g, g.move(R(g, 'streaker'), 5, 'main'));
  assert.strictEqual(R(g, 'streaker').finished, 1);
  assert(ev(g, 'chip').some((e) => e.seat === 0 && e.text.includes('裸奔侠')), '冲线超车应得 1 分');
  assert.strictEqual(g.score(0), 1 + 3);
});
test('冲线那一步超过的人：企鹅照样摔倒、狼人照样咬、魔法健将掷 6 照样绊倒', () => {
  let g = setup([['hotel', 26], ['penguin', 28], ['gloth', 5]]);
  run(g, g.move(R(g, 'hotel'), 5, 'main'));
  assert.strictEqual(R(g, 'hotel').finished, 1);
  assert.strictEqual(R(g, 'penguin').tripped, true);
  g = setup([['bitemark', 26], ['hotel', 28], ['gloth', 5]]);
  R(g, 'bitemark').wolf = true;
  run(g, g.move(R(g, 'bitemark'), 5, 'main'));
  assert.strictEqual(R(g, 'bitemark').finished, 1);
  assert.strictEqual(R(g, 'hotel').out, true);
  assert.strictEqual(R(g, 'gloth').out, false);
  g = setup([['magicalathlete', 25], ['hotel', 28], ['gloth', 5]]);
  dice(g, [6]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').finished, 1);
  assert.strictEqual(R(g, 'hotel').tripped, true);
  assert.strictEqual(R(g, 'gloth').tripped, false);
});
test('捣蛋鬼 × 骰子先生：只看选中的点数，其他骰子出 3 不反向', () => {
  let g = setup([['diceguy', 0], ['saboteur', 20]]);
  dice(g, [5, 5, 3, 1, 2, 4]);
  turn(g, 'diceguy');
  assert.strictEqual(R(g, 'diceguy').pos, 5);
  g = setup([['diceguy', 10], ['saboteur', 20]]);
  dice(g, [3, 3, 5, 1, 2, 4]);
  turn(g, 'diceguy');
  assert.strictEqual(R(g, 'diceguy').pos, 7, '选中 3 时照样反向');
});
test('电鳗：1 格内其他运动员掷出的骰子一律算 1', () => {
  const g = setup([['stunner', 4], ['hotel', 5], ['streaker', 0]]);
  dice(g, [5, 5]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 6);
  turn(g, 'streaker');
  assert.strictEqual(R(g, 'streaker').pos, 5, '离得远不受影响');
});
test('调包精：回合结束和 1 格内另一位玩家的运动员交换控制权', () => {
  const g = setup([['switcharoo', 0], ['hotel', 3]]);
  dice(g, [2]);
  turn(g, 'switcharoo', { switcharoo: 'hotel' });
  assert.strictEqual(R(g, 'switcharoo').seat, 1);
  assert.strictEqual(R(g, 'hotel').seat, 0);
  assert.deepStrictEqual(ev(g, 'control').map((e) => [e.a, e.seatA, e.b, e.seatB]), [['switcharoo', 1, 'hotel', 0]]);
  // 之后名次分归新的控制者
  R(g, 'hotel').pos = 29;
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(g.score(0), 3);
});
test('跟屁虫：回合开始瞬移到前方最近运动员身后一格', () => {
  const g = setup([['tail', 0], ['hotel', 8], ['gloth', 15]]);
  dice(g, [1]);
  turn(g, 'tail', { tail: 'yes' });
  assert.strictEqual(R(g, 'tail').pos, 8, '7 再走 1');
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to]), [[0, 7]]);
});
test('水龙头：回合结束掷骰，前方这个距离内的人全部绊倒', () => {
  const g = setup([['hose', 0], ['hotel', 3], ['gloth', 5], ['diva', 9]]);
  dice(g, [1, 4]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 1);
  assert.deepStrictEqual(g.racers.map((r) => r.tripped), [false, true, true, false]);
});
test('替补演员：赛前学一名对手的技能，学到赛前技能立刻生效（野猪骑士多一头猪）', () => {
  const g = setup([['understudy', 0], ['hogknight', 0]]);
  run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0), { understudy: 'hogknight' });
  assert.strictEqual(R(g, 'understudy').power, 'hogknight');
  assert.strictEqual(R(g, 'understudy').hogs, 1);
  const h = setup([['understudy', 0], ['icarus', 0]]);
  run(h, h.applyBeforeRace(R(h, 'understudy'), 'understudy', 0), { understudy: 'icarus' });
  assert(h.has(R(h, 'understudy'), 'icarus'));
});

/* ================= 13 张变数卡 ================= */
function twist(id, list, answers) {
  const g = setup(list);
  g.twistDeck = Array.isArray(id) ? id.slice() : [id];
  run(g, g.drawTwist(g.racers[0]), answers);
  return g;
}
test('变数卡数据：13 张', () => {
  assert.strictEqual(TWISTS.length, 13);
  assert.strictEqual(new Set(TWISTS.map((t) => t.id)).size, 13);
});
test('撞头虫：之后停在 28、29 后退 5', () => {
  const g = twist('bonkbug', [['hotel', 14], ['gloth', 20]]);
  run(g, g.move(R(g, 'gloth'), 8, 'main'));
  assert.strictEqual(R(g, 'gloth').pos, 23);
  run(g, g.move(R(g, 'hotel'), 13, 'main'));
  assert.strictEqual(R(g, 'hotel').pos, 27);
});
test('镜像世界：位置 p → 30-p，还在起点的人直接冲线', () => {
  const g = twist('mirror', [['hotel', 14], ['gloth', 20], ['diva', 0]]);
  assert.strictEqual(R(g, 'hotel').pos, 16);
  assert.strictEqual(R(g, 'gloth').pos, 10);
  assert.strictEqual(R(g, 'diva').finished, 1);
  assert.strictEqual(g.mirrored, true);
});
test('诅咒魔杖：每个玩家回合结束掷骰跳过对应人数', () => {
  const g = twist('cursewands', [['hotel', 14], ['gloth', 0], ['diva', 0], ['mole', 0]]);
  assert(g.twistOn('cursewands'));
  dice(g, [2]);
  const next = run(g, (function* () { const s = yield* g.curseNext(0); g.nextSeat = s; })());
  assert.deepStrictEqual(next, []);
  assert.strictEqual(g.nextSeat, 3);
});
test('皮纳塔：第一弯道后的空格放 1 分，停上去拿走', () => {
  const g = twist('pinata', [['hotel', 14], ['gloth', 20]]);
  assert.strictEqual(g.coins.length, 15);
  assert(!g.coins.includes(14) && !g.coins.includes(20) && !g.coins.includes(12));
  run(g, g.move(R(g, 'gloth'), 2, 'main'));
  assert.strictEqual(g.score(1), 1);
  assert(!g.coins.includes(22));
});
test('炼金实验室：狼人怪每个玩家回合后掷骰前进，淘汰被它超过的人', () => {
  const g = twist('alchemylab', [['hotel', 14], ['gloth', 3], ['diva', 5]]);
  assert.strictEqual(g.monster, 0);
  dice(g, [5]);
  run(g, g.moveMonster());
  assert.strictEqual(g.monster, 5);
  assert.strictEqual(R(g, 'gloth').out, true);
  assert.strictEqual(R(g, 'diva').out, false, '停在同格不算超过');
});
test('炼金实验室：运动员都离场的玩家没有回合，狼人怪不替他前进', () => {
  const g = setup([['hotel', 28], ['gloth', 10], ['streaker', 29]]);
  g.monster = 0;
  R(g, 'gloth').out = true;
  dice(g, [2, 1, 1]); // 旅馆冲线 → 狼人怪 1 → （1 号席没有回合）→ 裸奔侠冲线
  run(g, g.raceLoop(0));
  assert.strictEqual(ev(g, 'monster').length, 1);
  assert.strictEqual(R(g, 'streaker').finished, 2);
});
test('全员出局结束的比赛，结束原因记为 all-out', () => {
  const g = setup([['hotel', 3], ['gloth', 5]]);
  for (const r of g.racers) r.out = true;
  assert.throws(() => g.checkEnd(), (e) => e.constructor.name === 'RaceEnd');
  assert.strictEqual(g.raceEndReason, 'all-out');
});
test('粉丝要乱来：再连抽两张依次结算', () => {
  const g = twist(['chaos', 'conveyor', 'roastchicken'], [['hotel', 14], ['gloth', 20]]);
  assert.deepStrictEqual(g.twistDrawn, ['chaos', 'conveyor', 'roastchicken']);
  assert.strictEqual(R(g, 'hotel').pos, 8);
  assert.strictEqual(R(g, 'gloth').pos, 8);
});
test('传送带：所有人传到第 1 格，之后主移动 +3', () => {
  const g = twist('conveyor', [['hotel', 14], ['streaker', 20]]);
  assert.deepStrictEqual(g.racers.map((r) => r.pos), [1, 1]);
  dice(g, [2]);
  turn(g, 'streaker');
  assert.strictEqual(R(g, 'streaker').pos, 6);
});
test('水晶球：之后主移动 6 格及以上改为淘汰', () => {
  const g = twist('scrying', [['hotel', 14], ['streaker', 0], ['diva', 0]]);
  dice(g, [6, 2]);
  turn(g, 'streaker');
  assert.strictEqual(R(g, 'streaker').out, true);
  assert.strictEqual(ev(g, 'out')[0].cause, 'scrying');
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 16);
});
test('水晶球生效时，AI/托管不会自己走进 6 格淘汰（鼹鼠、显摆王、骰子先生、老千豹）', () => {
  const { decide } = require('../game/ai');
  const g = setup([['mole', 5], ['showoff', 0], ['diceguy', 0], ['cheatah', 0], ['hotel', 14]]);
  const ask = (rid, kind, options, extra = {}) => decide(g, { kind, seat: R(g, rid).seat, rid, options: options.map((v) => ({ v, label: v })), ...extra }, R(g, rid).seat);
  assert.strictEqual(ask('mole', 'mode', ['roll', 'mole']), 'mole', '没有水晶球时照常打地洞');
  g.twistActive = new Set(['scrying']);
  assert.strictEqual(ask('mole', 'mode', ['roll', 'mole']), 'roll');
  assert.strictEqual(ask('showoff', 'showoff', ['stop', 'more'], { roll: 1, sum: 1 }), 'stop', '再掷点数随机，水晶球下停下最稳');
  assert.strictEqual(ask('cheatah', 'reroll', ['keep', 'magic'], { roll: 6 }), 'magic', '6 会被看穿，能重掷就重掷');
  assert.strictEqual(ask('cheatah', 'rocket', ['yes', 'no'], { title: '火箭科学家：把 3 翻倍成 6？（之后会摔倒）' }), 'no');
  assert.strictEqual(ask('diceguy', 'diceguy', ['1', '5']), '5');
  for (let k = 0; k < 20; k++) assert(Number(ask('cheatah', 'cheatahSet', ['1', '2', '3', '4', '5', '6'])) <= 5);
  g.twistActive = new Set(['scrying', 'conveyor']);
  assert.strictEqual(ask('diceguy', 'diceguy', ['1', '5']), '1', '传送带 +3：5 会变成 8');
});
test('AI：伊卡洛斯掷出 6 会重掷；催眠蛇不拉大嘴怪；啦啦队长不把大嘴怪送到自己格子上', () => {
  const { decide } = require('../game/ai');
  const g = setup([['icarus', 0], ['hypnotist', 3], ['mouth', 12], ['hotel', 10], ['cheerleader', 5], ['gloth', 0]]);
  const ask = (rid, kind, options, extra = {}) => decide(g, { kind, seat: R(g, rid).seat, rid, options: options.map((v) => ({ v, label: v })), ...extra }, R(g, rid).seat);
  assert.strictEqual(ask('icarus', 'reroll', ['keep', 'dice'], { roll: 6 }), 'dice');
  assert.strictEqual(ask('hypnotist', 'hypnotist', ['mouth', 'hotel', '_no']), 'hotel', '最远的是大嘴怪，但拉过来会被吃');
  assert.strictEqual(ask('cheerleader', 'cheerleader', ['yes', 'no']), 'yes');
  R(g, 'mouth').pos = 3; R(g, 'gloth').pos = 4; R(g, 'icarus').pos = 4; R(g, 'hypnotist').pos = 6;
  assert.strictEqual(ask('cheerleader', 'cheerleader', ['yes', 'no']), 'no', '大嘴怪垫底，前进 2 正好停到我独占的第 5 格');
});
test('AI：按实际落点决策（石头、箭头、漩涡、撞头虫），返场王先派，毒舌家不帮后退的人重掷，西西弗斯不冒险', () => {
  const { decide } = require('../game/ai');
  const g = setup([['legs', 0], ['mole', 11], ['diceguy', 0], ['alchemist', 12], ['critic', 3], ['blunderdog', 9]], 'wild');
  const h = setup([['sisyphus', 4], ['flipflop', 0], ['hotel', 9], ['gloth', 10]]);
  const ask = (rid, kind, options, extra = {}) => { const x = g.racers.some((r) => r.rid === rid) ? g : h; return decide(x, { kind, seat: R(x, rid).seat, rid, options: options.map((v) => ({ v, label: v })), ...extra }, R(x, rid).seat); };
  assert.strictEqual(ask('legs', 'mode', ['roll', 'legs']), 'roll', '走 5 正好踩第 5 格石头');
  R(g, 'legs').pos = 1;
  assert.strictEqual(ask('legs', 'mode', ['roll', 'legs']), 'legs');
  assert.strictEqual(ask('mole', 'mode', ['roll', 'mole']), 'roll', '走 6 正好踩第 17 格石头');
  assert.strictEqual(ask('diceguy', 'diceguy', ['3', '5']), '3', '5 会踩石头');
  assert.strictEqual(ask('alchemist', 'alchemist', ['yes', 'no'], { title: '炼金术士：把 1 变成 4？' }), 'no', '12+4 踩 16 号箭头退回 12，走 1 到 13 还有星星');
  R(g, 'alchemist').pos = 0;
  assert.strictEqual(ask('alchemist', 'alchemist', ['yes', 'no'], { title: '炼金术士：把 1 变成 4？' }), 'yes');
  assert.strictEqual(ask('critic', 'critic', ['yes', 'no'], { target: 'blunderdog', roll: 5 }), 'no', '糊涂狗没垫底，这一步是后退');
  assert.strictEqual(ask('critic', 'critic', ['yes', 'no'], { target: 'mole', roll: 5 }), 'yes');
  assert.strictEqual(ask('sisyphus', 'reroll', ['keep', 'dice'], { roll: 2 }), 'keep');
  assert.strictEqual(ask('sisyphus', 'reroll', ['keep', 'dice'], { roll: 6 }), 'dice');
  assert.strictEqual(ask('flipflop', 'mode', ['roll', 'flip:hotel', 'flip:gloth']), 'flip:gloth', '挑换过去最远的');
  assert.strictEqual(ask('hotel', 'pickRacer', ['gloth', 'rerunner']), 'rerunner');
  g.twistActive = new Set(['bonkbug']);
  R(g, 'legs').pos = 25;
  assert.strictEqual(ask('legs', 'showoff', ['stop', 'more'], { roll: 4, sum: 4 }), 'more', '停在 29 会被撞回 24');
  R(g, 'legs').pos = 26;
  for (let k = 0; k < 20; k++) assert(Number(ask('legs', 'cheatahSet', ['1', '2', '3', '4', '5', '6'])) >= 4, '差 4 格就定能冲线的点数');
  const w = setup([['tail', 18], ['hotel', 23]], 'whirly');
  const tail = (target) => decide(w, { kind: 'tail', seat: 0, rid: 'tail', target, options: [{ v: 'yes' }, { v: 'no' }] }, 0);
  assert.strictEqual(tail(22), 'no', '贴到 22 号漩涡口会被传回 17');
  assert.strictEqual(tail(21), 'yes');
});
test('跳蚤市场：每人抽一张，同时暗中决定换不换', () => {
  const g = setup([['hotel', 14], ['gloth', 3]]);
  g.twistDeck = ['swapmeet'];
  g.deck = ['icarus', 'mole'];
  let seen;
  run(g, g.drawTwist(g.racers[0]), { swapmeet: (d, s) => { seen = d; return s === 0 ? 'swap' : 'keep'; } });
  assert.deepStrictEqual(seen.seats, [0, 1]);
  assert.strictEqual(seen.optionsBySeat[0][1].card, 'icarus');
  assert.strictEqual(R(g, 'hotel').power, 'icarus');
  assert.strictEqual(R(g, 'gloth').power, 'gloth');
  assert.deepStrictEqual(g.deck, ['mole'], '没换的卡放回牌堆');
});
test('季终决战：前两名冲线后回第二弯道单挑，胜者通吃金银，原第一先走', () => {
  const g = new Game({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 3, edition: 'v2' });
  ['hotel', 'gloth', 'diva'].forEach((id, s) => { g.players[s].hand = [id]; });
  g.raceNo = 1; g.trackKey = 'twisty'; g.firstSeat = 0;
  g.twistDeck = ['finale'];
  g.d6 = () => 6;
  g.gen = g.runRace(0); g.start();
  const d = g.pending;
  ['hotel', 'gloth', 'diva'].forEach((id, s) => g.answer(s, d.id, id));
  let guard = 0;
  while (g.pending && guard++ < 500) g.answer(g.pending.seat, g.pending.id, g.pending.options[0].v);
  const fin = g.events.find((e) => e.t === 'finale');
  assert(fin, '应进入季终决战');
  assert.strictEqual(fin.pos, 15);
  const res = g.results[0];
  const winners = res.standings.filter((s) => s.finished === 1);
  assert.strictEqual(winners.length, 1);
  assert.strictEqual(g.score(winners[0].seat), 3 + 1, '金 3 + 银 1 通吃');
  assert.strictEqual(g.players.reduce((s, p) => s + g.score(p.seat), 0), 4, '只发一次通吃分');
  // 原第一名先走
  const firstTurn = g.events.slice(g.events.indexOf(fin)).find((e) => e.t === 'turn');
  assert.strictEqual(firstTurn.rid, fin.rids[0]);
});
test('时间小鬼：抽到的运动员淘汰，下一场作为额外运动员上场', () => {
  const g = twist('timeimp', [['hotel', 14], ['gloth', 3]]);
  assert.strictEqual(R(g, 'hotel').out, true);
  assert.deepStrictEqual(g.players[0].extras, [{ rid: 'hotel', power: 'hotel', keep: false }]);
});
test('随机停止：每位玩家掷一次，之后他的骰子都固定为这个点数', () => {
  const g = setup([['hotel', 14], ['streaker', 3]]);
  g.twistDeck = ['noluck'];
  dice(g, [4, 2]);
  run(g, g.drawTwist(g.racers[0]));
  assert.deepStrictEqual(g.fixedRoll, { 0: 4, 1: 2 });
  g.d6 = () => { throw new Error('固定后不再真正掷骰'); };
  turn(g, 'streaker');
  assert.strictEqual(R(g, 'streaker').pos, 5);
});
test('烤鸡：最后一名（含并列）前进 7', () => {
  const g = twist('roastchicken', [['hotel', 14], ['gloth', 3], ['diva', 3]]);
  assert.deepStrictEqual(g.racers.map((r) => r.pos), [14, 10, 10]);
});

/* ================= 综合 ================= */
test('二代/混合整局：AI 跑完 4 场，快照可序列化且不泄漏老千豹暗定数字', () => {
  const { decide } = require('../game/ai');
  for (const edition of ['v2', 'mix']) {
    for (let seed = 1; seed <= 20; seed++) {
      const g = new Game({ players: Array.from({ length: 3 + (seed % 4) }, (_, i) => ({ name: `P${i}`, ai: true })), seed, edition });
      g.start();
      let guard = 0;
      while (g.pending && guard++ < 20000) {
        const d = g.pending;
        if (d.kind === 'cheatahGuess') {
          const snap = JSON.stringify(g.snapshot(d.seat));
          assert(!/cheatSet|"set"/.test(snap));
        }
        if (d.simul) for (const s of d.seats) g.answer(s, d.id, decide(g, d, s));
        else g.answer(d.seat, d.id, decide(g, d, d.seat));
      }
      assert.strictEqual(g.phase, 'over');
      assert.deepStrictEqual(g.results.map((r) => r.track), EDITIONS[edition].schedule);
    }
  }
});

let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); }
}
console.log(fail ? `${fail} 项失败` : `二代规则全部 ${tests.length} 项通过`);
process.exit(fail ? 1 : 0);
