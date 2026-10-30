'use strict';
const { assert, test, setup, dice, run, turn, move, R, ev, said, pos } = require('./helpers');
// 一代运动员（第二批）逐句规则测试：
// inchworm legs mastermind lackey loser mouth leaptoad magician partyanimal rocket
// sisyphus suckerfish romantic skipper thirdwheel scoocher stickler twin
// 填充用的「白板」运动员：egg / twin 只有赛前技能（setup 不跑赛前流程），比赛中没有任何技能。

const V1 = (list, opts = {}) => setup(list, { edition: 'v1', ...opts });
const WILD = (list, opts = {}) => setup(list, { edition: 'v1', track: 'wild', ...opts });
const keys = (g) => ev(g, 'power').map((e) => e.key);
const pwCount = (g, key) => ev(g, 'power').filter((e) => e.key === key).length;
const moves = (g, rid) => ev(g, 'move').filter((e) => !rid || e.rid === rid).map((e) => [e.rid, e.from, e.to]);
const turnSeats = (g) => ev(g, 'turn').map((e) => e.seat);
// 按顺序依次给出答案
const seq = (...vals) => () => vals.shift();
// 魔术象：有魔术重掷就用，没有就停
const magicAll = (d) => (d.options.some((o) => o.v === 'magic') ? 'magic' : 'keep');
// 赛前给西西弗斯 4 分（直接跑赛前技能）
const sisBefore = (g, rid = 'sisyphus') => run(g, g.applyBeforeRace(R(g, rid), 'sisyphus', 0));

/* ======================= 尺蠖 inchworm ======================= */
// 别人主移动掷出 1 时，他们这步作废，我前进 1 格。

test('尺蠖：别人主移动掷出 1，这步作废，尺蠖前进 1 格', () => {
  const g = V1([['egg', 4], ['inchworm', 10]]);
  dice(g, [1]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 4, inchworm: 11 });
  assert.deepStrictEqual(moves(g), [['inchworm', 10, 11]], '掷 1 的人完全不动');
  const p = ev(g, 'power').find((e) => e.key === 'inchworm');
  assert.deepStrictEqual(p.targets, ['egg']);
});

test('尺蠖：自己掷出 1 不触发（只管「别人」），照常走 1 格', () => {
  const g = V1([['inchworm', 4], ['egg', 10]]);
  dice(g, [1]);
  turn(g, 'inchworm');
  assert.deepStrictEqual(pos(g), { inchworm: 5, egg: 10 });
  assert.strictEqual(pwCount(g, 'inchworm'), 0);
});

test('尺蠖：别人掷出 2～6 不触发', () => {
  for (const v of [2, 3, 4, 5, 6]) {
    const g = V1([['egg', 0], ['inchworm', 10]]);
    dice(g, [v]);
    turn(g, 'egg');
    assert.deepStrictEqual(pos(g), { egg: v, inchworm: 10 }, `掷 ${v}`);
  }
});

test('尺蠖：看骰面不看步数——野兔掷 1（加 2 本该走 3）照样整步作废', () => {
  const g = V1([['hare', 0], ['inchworm', 10]]);
  dice(g, [1]);
  turn(g, 'hare');
  assert.deepStrictEqual(pos(g), { hare: 0, inchworm: 11 });
  assert.strictEqual(pwCount(g, 'hare'), 0, '作废后野兔的 +2 也不结算');
});

test('尺蠖：只认主移动骰——决斗时掷出 1 不触发', () => {
  const g = V1([['egg', 3], ['duelist', 5], ['inchworm', 20]]);
  dice(g, [1, 3]); // 决斗家掷 1，egg 掷 3
  move(g, 'egg', 2, 'main', { duel: 'egg' });
  assert.strictEqual(R(g, 'egg').pos, 7, 'egg 决斗获胜前进 2');
  assert.strictEqual(R(g, 'inchworm').pos, 20);
});

test('尺蠖：魔术象掷 1 后重掷成 4，被重掷掉的 1 不触发；最后一次掷出 1 才触发', () => {
  let g = V1([['magician', 0], ['inchworm', 10]]);
  dice(g, [1, 4]);
  turn(g, 'magician', { reroll: seq('magic', 'keep') });
  assert.deepStrictEqual(pos(g), { magician: 4, inchworm: 10 });

  g = V1([['magician', 0], ['inchworm', 10]]);
  dice(g, [4, 1]);
  turn(g, 'magician', { reroll: seq('magic', 'keep') });
  assert.deepStrictEqual(pos(g), { magician: 0, inchworm: 11 });
});

test('尺蠖：前进 1 格冲过终点，拿第 1 名', () => {
  const g = V1([['egg', 4], ['inchworm', 29], ['twin', 0]]);
  dice(g, [1]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'inchworm').finished, 1);
  assert.strictEqual(R(g, 'egg').pos, 4);
  assert.strictEqual(g.score(1), 3);
});

test('尺蠖（狂野荒原）：前进 1 格停到 7 号箭头，再前进 3 格', () => {
  const g = WILD([['egg', 0], ['inchworm', 6]]);
  dice(g, [1]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 0, inchworm: 10 });
});

test('尺蠖与船长同场：别人掷 1 时尺蠖先前进 1 格，然后船长抢下一回合', () => {
  const g = V1([['egg', 4], ['inchworm', 10], ['skipper', 2]]);
  dice(g, [1]);
  turn(g, 'egg');
  assert.deepStrictEqual(keys(g), ['inchworm', 'skipper']);
  assert.strictEqual(R(g, 'inchworm').pos, 11);
  assert.strictEqual(g.skipperNext, 2);
});

test('尺蠖：自己被绊倒时技能照样生效', () => {
  const g = V1([['egg', 4], ['inchworm', 10, { tripped: true }]]);
  dice(g, [1]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 4, inchworm: 11 });
  assert.strictEqual(R(g, 'inchworm').tripped, true);
});

test('尺蠖被模仿猫复制：领跑的尺蠖和模仿猫各前进 1 格', () => {
  const g = V1([['egg', 0], ['inchworm', 10], ['copycat', 3]]);
  assert.strictEqual(g.power(R(g, 'copycat')), 'inchworm');
  dice(g, [1]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 0, inchworm: 11, copycat: 4 });
});

test('[口径] 尺蠖与炼金术士：炼金术士掷 1 先被尺蠖作废，来不及改走 4 格', () => {
  const g = V1([['alchemist', 0], ['inchworm', 10]]);
  dice(g, [1]);
  const asked = turn(g, 'alchemist', { alchemist: 'yes' });
  assert(!asked.includes('alchemist'), '不会再问炼金术士');
  assert.deepStrictEqual(pos(g), { alchemist: 0, inchworm: 11 });
});

/* ======================= 大长腿 legs ======================= */
// 可以不掷骰，直接走 5 格作为主移动。

test('大长腿：选「迈大步」不掷骰，直接走 5 格', () => {
  const g = V1([['legs', 3], ['egg', 0]]);
  dice(g, []);
  let opts;
  turn(g, 'legs', { mode: (d) => { opts = d.options.map((o) => o.v); return 'legs'; } });
  assert.deepStrictEqual(opts, ['roll', 'legs']);
  assert.strictEqual(R(g, 'legs').pos, 8);
  assert.strictEqual(ev(g, 'roll').length, 0);
});

test('大长腿：也可以照常掷骰', () => {
  const g = V1([['legs', 3], ['egg', 0]]);
  dice(g, [2]);
  turn(g, 'legs', { mode: 'roll' });
  assert.strictEqual(R(g, 'legs').pos, 5);
  assert.strictEqual(pwCount(g, 'legs'), 0);
});

test('大长腿：迈大步仍是主移动——黏液怪 -1、教练 +1 照样结算', () => {
  const g = V1([['legs', 3], ['gunk', 0], ['coach', 3]]);
  dice(g, []);
  turn(g, 'legs', { mode: 'legs' });
  assert.strictEqual(R(g, 'legs').pos, 8); // 5 - 1 + 1
  const calc = ev(g, 'calc')[0];
  assert.strictEqual(calc.raw, 5);
  assert.strictEqual(calc.total, 5);
});

test('大长腿：被绊倒的回合跳过主移动，不能迈大步', () => {
  const g = V1([['legs', 3, { tripped: true }], ['egg', 0]]);
  dice(g, []);
  const asked = turn(g, 'legs', { mode: 'legs' });
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(R(g, 'legs').pos, 3);
  assert.strictEqual(R(g, 'legs').tripped, false, '爬起来了');
});

test('大长腿：从 25 迈大步正好冲线', () => {
  const g = V1([['legs', 25], ['egg', 0], ['twin', 0]]);
  dice(g, []);
  turn(g, 'legs', { mode: 'legs' });
  assert.strictEqual(R(g, 'legs').finished, 1);
});

test('大长腿：较真怪在场，27 迈大步走过头，这次不动', () => {
  const g = V1([['legs', 27], ['stickler', 0], ['egg', 0]]);
  dice(g, []);
  turn(g, 'legs', { mode: 'legs' });
  assert.strictEqual(R(g, 'legs').pos, 27);
  assert.strictEqual(R(g, 'legs').finished, 0);
  assert.strictEqual(ev(g, 'blocked').length, 1);
});

test('大长腿（狂野荒原）：从 2 迈大步落在 7 号箭头，再前进 3 到 10', () => {
  const g = WILD([['legs', 2], ['egg', 0]]);
  dice(g, []);
  turn(g, 'legs', { mode: 'legs' });
  assert.strictEqual(R(g, 'legs').pos, 10);
});

test('大长腿被模仿猫复制：模仿猫也能选迈大步', () => {
  const g = V1([['copycat', 0], ['legs', 10], ['egg', 3]]);
  dice(g, []);
  turn(g, 'copycat', { mode: 'legs' });
  assert.strictEqual(R(g, 'copycat').pos, 5);
  assert.strictEqual(ev(g, 'power').find((e) => e.key === 'legs').rid, 'copycat');
});

/* ======================= 主谋 mastermind ======================= */
// 我第一个回合开始时，预言谁会夺冠；猜中的话比赛立刻结束，我拿第 2 名。
// 注：预言自己并夺冠，可以同时拿第 1 和第 2。

test('主谋：第一个回合开始时（掷骰之前）预言，可选任何在场运动员，包括自己', () => {
  const g = V1([['mastermind', 0], ['egg', 5], ['twin', 3]]);
  dice(g, [2]);
  let opts;
  const asked = turn(g, 'mastermind', { mastermind: (d) => { opts = d.options.map((o) => o.v); return 'egg'; } });
  assert.deepStrictEqual(asked, ['mastermind', 'roll']);
  assert.deepStrictEqual(opts.sort(), ['egg', 'mastermind', 'twin']);
  assert.strictEqual(R(g, 'mastermind').mmPredict, 'egg');
  assert.strictEqual(R(g, 'mastermind').pos, 2);
});

test('主谋：只在第一个回合预言，之后的回合不再问、预言不变', () => {
  const g = V1([['mastermind', 0], ['egg', 5], ['twin', 3]]);
  dice(g, [2, 2]);
  turn(g, 'mastermind', { mastermind: 'twin' });
  const asked = turn(g, 'mastermind', { mastermind: 'egg' });
  assert.deepStrictEqual(asked, ['roll']);
  assert.strictEqual(R(g, 'mastermind').mmPredict, 'twin');
});

test('主谋：第一个回合被绊倒也照样在回合开始时预言，然后爬起来不掷骰', () => {
  const g = V1([['mastermind', 0, { tripped: true }], ['egg', 5]]);
  dice(g, []);
  const asked = turn(g, 'mastermind', { mastermind: 'egg' });
  assert.deepStrictEqual(asked, ['mastermind']);
  assert.strictEqual(R(g, 'mastermind').mmPredict, 'egg');
  assert.strictEqual(R(g, 'mastermind').pos, 0);
  assert.strictEqual(R(g, 'mastermind').tripped, false);
});

test('主谋：预言的人第一个冲线，比赛立刻结束，主谋拿第 2 名（银牌）', () => {
  const g = V1([['mastermind', 3], ['legs', 28], ['egg', 10]]);
  Object.assign(R(g, 'mastermind'), { mmPredict: 'legs', mmDone: true });
  move(g, 'legs', 2);
  assert.strictEqual(g.ended, true, '比赛立刻结束');
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert.strictEqual(R(g, 'mastermind').finished, 2);
  assert.strictEqual(R(g, 'egg').finished, 0);
  assert.strictEqual(g.score(1), 3, '冠军金杯 3 分');
  assert.strictEqual(g.score(0), 1, '主谋银牌 1 分');
});

test('主谋：「立刻结束」——和冲线者同格的吸盘鱼来不及跟着冲线', () => {
  const g = V1([['mastermind', 3], ['legs', 28], ['suckerfish', 28]]);
  Object.assign(R(g, 'mastermind'), { mmPredict: 'legs', mmDone: true });
  const asked = move(g, 'legs', 2);
  assert(!asked.includes('suckerfish'));
  assert.strictEqual(R(g, 'suckerfish').finished, 0);
  assert.strictEqual(R(g, 'mastermind').finished, 2);
});

test('主谋：预言错了（冲线的不是预言对象），比赛继续，主谋什么也不拿', () => {
  const g = V1([['mastermind', 3], ['legs', 28], ['egg', 10]]);
  Object.assign(R(g, 'mastermind'), { mmPredict: 'egg', mmDone: true });
  move(g, 'legs', 2);
  assert(!g.ended);
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert.strictEqual(R(g, 'mastermind').finished, 0);
  assert.strictEqual(g.finishCount, 1);
  assert.strictEqual(g.score(0), 0);
});

test('主谋：预言对象只拿到第 2 名不算猜中', () => {
  const g = V1([['mastermind', 3], ['legs', 28], ['egg', 29]]);
  Object.assign(R(g, 'mastermind'), { mmPredict: 'egg', mmDone: true });
  move(g, 'legs', 2);
  move(g, 'egg', 1);
  assert.strictEqual(g.ended, true, '两人冲线自然结束');
  assert.strictEqual(R(g, 'egg').finished, 2);
  assert.strictEqual(R(g, 'mastermind').finished, 0);
  assert.strictEqual(g.score(0), 0);
});

test('主谋：预言自己并夺冠，同时拿第 1 名和第 2 名（金 + 银）', () => {
  const g = V1([['mastermind', 28], ['egg', 10], ['twin', 5]]);
  Object.assign(R(g, 'mastermind'), { mmPredict: 'mastermind', mmDone: true });
  move(g, 'mastermind', 2);
  assert.strictEqual(g.ended, true);
  assert.strictEqual(R(g, 'mastermind').finished, 1);
  assert.strictEqual(R(g, 'mastermind').bonusSecond, true);
  assert.strictEqual(g.score(0), 4, '金 3 + 银 1');
  assert.strictEqual(R(g, 'egg').finished, 0);
});

test('主谋（真实回合流程）：第一回合预言，之后预言对象冲线时比赛结束', () => {
  // 席位 0 主谋预言大长腿并掷 2；席位 1 大长腿掷 4 冲线 → 比赛结束，席位 2 没有回合
  const g = V1([['mastermind', 0], ['legs', 26], ['egg', 0]]);
  dice(g, [2, 4]);
  const asked = run(g, g.raceLoop(0), { mastermind: 'legs', mode: 'roll' });
  assert.deepStrictEqual(asked, ['mastermind', 'roll', 'mode']);
  assert.strictEqual(g.ended, true);
  assert.deepStrictEqual(turnSeats(g), [0, 1]);
  assert.strictEqual(R(g, 'mastermind').finished, 2);
  assert.deepStrictEqual([g.score(0), g.score(1), g.score(2)], [1, 3, 0]);
});

test('[口径] 主谋被淘汰后预言失效：预言对象夺冠也不结束比赛', () => {
  const g = V1([['mouth', 0], ['mastermind', 3], ['legs', 28], ['egg', 0]]);
  Object.assign(R(g, 'mastermind'), { mmPredict: 'legs', mmDone: true });
  move(g, 'mouth', 3);
  assert.strictEqual(R(g, 'mastermind').out, true);
  move(g, 'legs', 2);
  assert(!g.ended);
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert.strictEqual(g.score(1), 0);
});

test('[口径] 模仿猫第一个回合没抄到主谋，之后抄到主谋的那个回合仍会预言', () => {
  const g = V1([['copycat', 0], ['mastermind', 10], ['egg', 12]]);
  dice(g, [1, 1]);
  let asked = turn(g, 'copycat'); // 领跑的是 egg（赛前技能，抄不到）
  assert.deepStrictEqual(asked, ['roll']);
  R(g, 'egg').pos = 3; // 主谋变成领跑者
  assert.strictEqual(g.power(R(g, 'copycat')), 'mastermind');
  asked = turn(g, 'copycat', { mastermind: 'egg' });
  assert.deepStrictEqual(asked, ['mastermind', 'roll']);
  assert.strictEqual(R(g, 'copycat').mmPredict, 'egg');
});

/* ======================= 跟班 lackey ======================= */
// 别人主移动掷出 6 时，我抢先前进 2 格。

test('跟班：别人主移动掷出 6，跟班在对方移动之前抢先前进 2 格', () => {
  const g = V1([['egg', 0], ['lackey', 10]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 6, lackey: 12 });
  assert.deepStrictEqual(moves(g), [['lackey', 10, 12], ['egg', 0, 6]], '跟班先走');
});

test('跟班：自己掷出 6 不触发，只走 6 格', () => {
  const g = V1([['lackey', 0], ['egg', 10]]);
  dice(g, [6]);
  turn(g, 'lackey');
  assert.deepStrictEqual(pos(g), { lackey: 6, egg: 10 });
  assert.strictEqual(pwCount(g, 'lackey'), 0);
});

test('跟班：别人掷出 1～5 不触发', () => {
  for (const v of [1, 2, 3, 4, 5]) {
    const g = V1([['egg', 0], ['lackey', 10]]);
    dice(g, [v]);
    turn(g, 'egg');
    assert.strictEqual(R(g, 'lackey').pos, 10, `掷 ${v}`);
  }
});

test('跟班：看骰面——火箭科学家掷 3 翻倍成 6 不触发；黏液怪在场时掷 6（只走 5）照样触发', () => {
  let g = V1([['rocket', 0], ['lackey', 10]]);
  dice(g, [3]);
  turn(g, 'rocket', { rocket: 'yes' });
  assert.deepStrictEqual(pos(g), { rocket: 6, lackey: 10 });

  g = V1([['egg', 0], ['lackey', 10], ['gunk', 20]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 5, lackey: 12, gunk: 20 }, '跟班的 2 格是技能移动，不受黏液怪影响');
});

test('跟班：魔术象掷 6 后重掷成 3，被重掷掉的 6 不触发；重掷出 6 才触发', () => {
  let g = V1([['magician', 0], ['lackey', 10]]);
  dice(g, [6, 3]);
  turn(g, 'magician', { reroll: seq('magic', 'keep') });
  assert.deepStrictEqual(pos(g), { magician: 3, lackey: 10 });

  g = V1([['magician', 0], ['lackey', 10]]);
  dice(g, [3, 6]);
  turn(g, 'magician', { reroll: seq('magic', 'keep') });
  assert.deepStrictEqual(pos(g), { magician: 6, lackey: 12 });
});

test('跟班：抢先 2 格冲线拿第 1 名，掷 6 的人随后才走', () => {
  const g = V1([['egg', 20], ['lackey', 28], ['twin', 0]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'lackey').finished, 1);
  assert.strictEqual(R(g, 'egg').pos, 26);
  assert.strictEqual(g.score(1), 3);
});

test('跟班：西西弗斯掷 6 瞬移回起点时，跟班照样前进 2 格', () => {
  const g = V1([['sisyphus', 10], ['lackey', 5]]);
  dice(g, [6]);
  turn(g, 'sisyphus');
  assert.deepStrictEqual(pos(g), { sisyphus: 0, lackey: 7 });
});

test('跟班（狂野荒原）：抢先 2 格停到 7 号箭头，再前进 3 格', () => {
  const g = WILD([['egg', 0], ['lackey', 5]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 6, lackey: 10 });
});

test('跟班（狂野荒原）：抢先 2 格停到 5 号石头，被绊倒', () => {
  const g = WILD([['egg', 0], ['lackey', 3]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'lackey').pos, 5);
  assert.strictEqual(R(g, 'lackey').tripped, true);
});

test('跟班被模仿猫复制：别人掷 6 时领跑的跟班和模仿猫各前进 2 格', () => {
  const g = V1([['egg', 0], ['lackey', 10], ['copycat', 3]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 6, lackey: 12, copycat: 5 });
});

/* ======================= 可爱废柴 loser ======================= */
// 主移动前，如果我独自垫底，拿 1 分铜牌。

test('可爱废柴：主移动前独自垫底，拿 1 分铜牌', () => {
  const g = V1([['loser', 0], ['egg', 10]]);
  dice(g, [2]);
  turn(g, 'loser');
  assert.deepStrictEqual(g.players[0].chips.map((c) => [c.kind, c.v]), [['bronze', 1]]);
});

test('可爱废柴：和别人并列垫底不拿', () => {
  const g = V1([['loser', 3], ['egg', 3], ['twin', 10]]);
  dice(g, [2]);
  turn(g, 'loser');
  assert.strictEqual(g.score(0), 0);
});

test('可爱废柴：不是垫底不拿', () => {
  const g = V1([['loser', 5], ['egg', 3]]);
  dice(g, [2]);
  turn(g, 'loser');
  assert.strictEqual(g.score(0), 0);
});

test('可爱废柴：在主移动之前判定——这回合掷骰跑到前面也照拿', () => {
  const g = V1([['loser', 0], ['egg', 2]]);
  dice(g, [5]);
  turn(g, 'loser');
  assert.strictEqual(R(g, 'loser').pos, 5);
  assert.strictEqual(g.score(0), 1);
  const chipAt = g.events.findIndex((e) => e.t === 'chip');
  const rollAt = g.events.findIndex((e) => e.t === 'roll');
  assert(chipAt >= 0 && chipAt < rollAt, '先拿分再掷骰');
});

test('可爱废柴：每个回合都能拿，不限一次', () => {
  const g = V1([['loser', 0], ['egg', 20]]);
  dice(g, [1, 1]);
  turn(g, 'loser');
  turn(g, 'loser');
  assert.strictEqual(g.score(0), 2);
});

test('可爱废柴：被淘汰的运动员不算在场，后面没人了也算独自垫底', () => {
  const g = V1([['loser', 5], ['egg', 2, { out: true }], ['twin', 8]]);
  dice(g, [1]);
  turn(g, 'loser');
  assert.strictEqual(g.score(0), 1);
});

test('可爱废柴被模仿猫复制：模仿猫独自垫底时也拿 1 分', () => {
  const g = V1([['copycat', 0], ['loser', 10], ['egg', 5]]);
  dice(g, [2]);
  turn(g, 'copycat');
  assert.strictEqual(g.score(0), 1);
  assert.strictEqual(g.score(1), 0);
});

test('[口径] 可爱废柴：被绊倒跳过主移动的回合不拿分', () => {
  const g = V1([['loser', 0, { tripped: true }], ['egg', 10]]);
  dice(g, []);
  turn(g, 'loser');
  assert.strictEqual(g.score(0), 0);
  assert.strictEqual(R(g, 'loser').tripped, false);
});

/* ======================= 大嘴怪 mouth ======================= */
// 我停到恰好只有 1 名其他运动员的格子上时，把它吃掉（淘汰出本场）。

test('大嘴怪：停到恰好只有 1 名其他运动员的格子，把它淘汰出本场', () => {
  const g = V1([['mouth', 0], ['egg', 3], ['twin', 10]]);
  dice(g, [3]);
  turn(g, 'mouth');
  assert.strictEqual(R(g, 'egg').out, true);
  assert.deepStrictEqual(g.outOrder.map((r) => r.rid), ['egg']);
  assert.strictEqual(ev(g, 'out')[0].by, 'mouth');
  assert.strictEqual(R(g, 'mouth').pos, 3);
});

test('大嘴怪：格子上有 2 名其他运动员时不吃', () => {
  const g = V1([['mouth', 0], ['egg', 3], ['twin', 3]]);
  dice(g, [3]);
  turn(g, 'mouth');
  assert(!R(g, 'egg').out && !R(g, 'twin').out);
});

test('大嘴怪：只是经过不吃；停到空格也没事', () => {
  const g = V1([['mouth', 0], ['egg', 2]]);
  dice(g, [3]);
  turn(g, 'mouth');
  assert.strictEqual(R(g, 'egg').out, false);
  assert.strictEqual(ev(g, 'out').length, 0);
});

test('大嘴怪：别人停到大嘴怪的格子不算（只有「我停到」才吃）', () => {
  const g = V1([['egg', 0], ['mouth', 3]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').out, false);
  assert.strictEqual(R(g, 'egg').pos, 3);
});

test('大嘴怪：技能移动停下也算（不限主移动）', () => {
  const g = V1([['mouth', 1], ['egg', 3]]);
  move(g, 'mouth', 2, 'power');
  assert.strictEqual(R(g, 'egg').out, true);
});

test('大嘴怪：起点也是格子——被半人马踢回起点，起点恰好 1 人就吃掉', () => {
  const g = V1([['centaur', 0], ['mouth', 1], ['egg', 0]]);
  move(g, 'centaur', 3);
  assert.strictEqual(R(g, 'mouth').pos, 0);
  assert.strictEqual(R(g, 'egg').out, true);
});

test('大嘴怪：吃掉的运动员技能立刻失效（吃掉尺蠖后，别人掷 1 照常走）', () => {
  const g = V1([['mouth', 0], ['inchworm', 3], ['egg', 10]]);
  dice(g, [3, 1]);
  turn(g, 'mouth');
  assert.strictEqual(R(g, 'inchworm').out, true);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').pos, 11);
  assert.strictEqual(R(g, 'inchworm').pos, 3);
});

test('大嘴怪：吃到只剩自己时没人拿第 2 名，银牌不发', () => {
  const g = V1([['mouth', 26], ['egg', 28]]);
  dice(g, [2, 4]);
  run(g, g.raceLoop(0));
  assert.strictEqual(g.ended, true);
  assert.strictEqual(R(g, 'egg').out, true);
  assert.strictEqual(R(g, 'mouth').finished, 1);
  assert.deepStrictEqual(g.players.map((p) => p.chips.map((c) => [c.kind, c.v])), [[['gold', 3]], []]);
  assert.deepStrictEqual(turnSeats(g), [0, 0], 'egg 已淘汰，没有回合');
});

test('大嘴怪被模仿猫复制：模仿猫停到恰好 1 人的格子也吃人', () => {
  const g = V1([['copycat', 0], ['mouth', 10], ['egg', 3]]);
  dice(g, [3]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'egg').out, true);
  assert.strictEqual(ev(g, 'out')[0].by, 'copycat');
});

test('[口径] 大嘴怪：被催眠蛇瞬移到它的格子，也算停到恰好 1 人的格子，把催眠蛇吃掉', () => {
  const g = V1([['hypnotist', 5], ['mouth', 2], ['egg', 0]]);
  dice(g, []);
  turn(g, 'hypnotist', { hypnotist: 'mouth' });
  assert.strictEqual(R(g, 'mouth').pos, 5);
  assert.strictEqual(R(g, 'hypnotist').out, true);
  assert.strictEqual(ev(g, 'roll').length, 0, '催眠蛇被吃，主移动不再进行');
});

test('[口径] 大嘴怪（狂野荒原）：停到 7 号箭头上恰好 1 人的格子，先按箭头走掉，不吃人', () => {
  const g = WILD([['mouth', 4], ['egg', 7], ['twin', 20]]);
  dice(g, [3]);
  turn(g, 'mouth');
  assert.strictEqual(R(g, 'mouth').pos, 10);
  assert.strictEqual(R(g, 'egg').out, false);
});

test('[口径] 大嘴怪与浪漫鳄：大嘴怪先吃掉对手，格子不再是两人，浪漫鳄不前进', () => {
  const g = V1([['mouth', 0], ['egg', 3], ['romantic', 10]]);
  dice(g, [3]);
  turn(g, 'mouth');
  assert.strictEqual(R(g, 'egg').out, true);
  assert.strictEqual(R(g, 'romantic').pos, 10);
});

/* ======================= 跳跳蛙 leaptoad ======================= */
// 移动时跳过有人的格子（不计步数）。

test('跳跳蛙：主移动跳过有人的格子，被跳过的格子不计步数', () => {
  const g = V1([['leaptoad', 0], ['egg', 1], ['twin', 2]]);
  dice(g, [2]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').pos, 4);
  assert.deepStrictEqual(ev(g, 'move')[0].path, [1, 2, 3, 4]);
});

test('跳跳蛙：落点有人就继续往前跳，不会停在有人的格子', () => {
  const g = V1([['leaptoad', 0], ['egg', 3]]);
  dice(g, [3]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').pos, 4);
});

test('跳跳蛙：没人挡路时照常走', () => {
  const g = V1([['leaptoad', 0], ['egg', 10]]);
  dice(g, [3]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').pos, 3);
  assert.strictEqual(pwCount(g, 'leaptoad'), 0);
});

test('跳跳蛙：技能移动同样跳格（不限主移动）', () => {
  const g = V1([['leaptoad', 0], ['egg', 1]]);
  move(g, 'leaptoad', 1, 'power');
  assert.strictEqual(R(g, 'leaptoad').pos, 2);
});

test('跳跳蛙（狂野荒原）：后退也跳格——24 号箭头后退 2，跳过 23 上的人落到 21', () => {
  const g = WILD([['leaptoad', 22], ['egg', 23], ['twin', 0]]);
  dice(g, [1]);
  turn(g, 'leaptoad');
  assert.deepStrictEqual(moves(g, 'leaptoad'), [['leaptoad', 22, 24], ['leaptoad', 24, 21]]);
});

test('跳跳蛙：跳过香蕉也算超过，被绊倒', () => {
  const g = V1([['leaptoad', 0], ['banana', 1], ['twin', 10]]);
  dice(g, [1]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').pos, 2);
  assert.strictEqual(R(g, 'leaptoad').tripped, true);
});

test('跳跳蛙：每跳过一格算技能生效一次，蹭蹭狗前进相应格数', () => {
  const g = V1([['leaptoad', 0], ['egg', 1], ['twin', 2], ['scoocher', 10]]);
  dice(g, [1]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').pos, 3);
  assert.strictEqual(pwCount(g, 'leaptoad'), 2);
  assert.strictEqual(R(g, 'scoocher').pos, 12);
});

test('跳跳蛙与较真怪：跳过的格子不计入冲线步数——27 掷 2 跳过 28 正好冲线，掷 3 就算走过头', () => {
  let g = V1([['leaptoad', 27], ['egg', 28], ['stickler', 0]]);
  dice(g, [2]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').finished, 1);

  g = V1([['leaptoad', 27], ['egg', 28], ['stickler', 0]]);
  dice(g, [3]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').pos, 27);
  assert.strictEqual(R(g, 'leaptoad').finished, 0);
});

test('跳跳蛙：终点前的格子都有人时，1 步就跳过终点', () => {
  const g = V1([['leaptoad', 27], ['egg', 28], ['twin', 29]]);
  dice(g, [1]);
  turn(g, 'leaptoad');
  assert.strictEqual(R(g, 'leaptoad').finished, 1);
});

test('跳跳蛙被模仿猫复制：模仿猫移动时也跳格', () => {
  const g = V1([['copycat', 0], ['leaptoad', 10], ['egg', 1]]);
  dice(g, [1]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 2);
});

/* ======================= 魔术象 magician ======================= */
// 主移动最多可以重掷两次（必须用最后一次的点数）。

test('魔术象：最多重掷两次，第三次掷完不再提供重掷，按最后一次点数走', () => {
  const g = V1([['magician', 0], ['egg', 20]]);
  dice(g, [1, 2, 5]);
  const offers = [];
  turn(g, 'magician', { reroll: (d) => { offers.push(d.options.map((o) => o.v)); return magicAll(d); } });
  assert.deepStrictEqual(offers, [['keep', 'magic'], ['keep', 'magic']]);
  assert.strictEqual(R(g, 'magician').pos, 5);
  assert.strictEqual(pwCount(g, 'magician'), 2);
});

test('魔术象：重掷后点数变小也只能用最后一次，不能退回之前的点数', () => {
  const g = V1([['magician', 0], ['egg', 20]]);
  dice(g, [5, 2]);
  turn(g, 'magician', { reroll: seq('magic', 'keep') });
  assert.strictEqual(R(g, 'magician').pos, 2);
});

test('魔术象：不重掷就用第一次点数，也不会多掷骰', () => {
  const g = V1([['magician', 0], ['egg', 20]]);
  dice(g, [3]);
  turn(g, 'magician', { reroll: 'keep' });
  assert.strictEqual(R(g, 'magician').pos, 3);
  assert.strictEqual(pwCount(g, 'magician'), 0);
});

test('魔术象：重掷次数每回合重新计算', () => {
  const g = V1([['magician', 0], ['egg', 20]]);
  dice(g, [2, 3, 4, 1, 2, 3]);
  turn(g, 'magician', { reroll: magicAll });
  turn(g, 'magician', { reroll: magicAll });
  assert.strictEqual(R(g, 'magician').pos, 7);
  assert.strictEqual(pwCount(g, 'magician'), 4);
});

test('魔术象：每次重掷都算技能生效（即使最后没采用），蹭蹭狗各前进 1 格', () => {
  const g = V1([['magician', 0], ['scoocher', 10]]);
  dice(g, [2, 3, 4]);
  turn(g, 'magician', { reroll: magicAll });
  assert.strictEqual(R(g, 'scoocher').pos, 12);
  assert.strictEqual(R(g, 'magician').pos, 4);
});

test('魔术象：被绊倒的回合不掷骰，也就没有重掷', () => {
  const g = V1([['magician', 0, { tripped: true }], ['egg', 20]]);
  dice(g, []);
  const asked = turn(g, 'magician', { reroll: magicAll });
  assert.deepStrictEqual(asked, []);
});

test('魔术象被模仿猫复制：模仿猫的主移动也能重掷两次', () => {
  const g = V1([['copycat', 0], ['magician', 10], ['egg', 3]]);
  dice(g, [1, 2, 3]);
  turn(g, 'copycat', { reroll: magicAll });
  assert.strictEqual(R(g, 'copycat').pos, 3);
});

test('魔术象被模仿猫复制：重掷途中领跑者换人、模仿猫不再有魔术象技能时，不能再用魔术重掷', () => {
  // 模仿猫抄领跑的魔术象（11）；骰子贩子（10）在模仿猫做骰子交易后前进到 11 并列领跑，模仿猫改抄骰子贩子
  const g = V1([['copycat', 0], ['magician', 11], ['dicemonger', 10], ['egg', 3]]);
  dice(g, [2, 3]);
  const offers = [];
  turn(g, 'copycat', {
    copycat: 'dicemonger',
    reroll: (d) => { offers.push(d.options.map((o) => o.v)); return offers.length === 1 ? 'dice' : 'keep'; },
  });
  assert.strictEqual(g.power(R(g, 'copycat')), 'dicemonger');
  assert.deepStrictEqual(offers[0], ['keep', 'magic', 'dice']);
  assert(!offers[1] || !offers[1].includes('magic'), `模仿猫已经没有魔术象技能，仍提供了 ${(offers[1] || []).join('/')}`);
});

/* ======================= 派对熊 partyanimal ======================= */
// 主移动前，所有运动员朝我靠近 1 格；之后每有一名运动员和我同格，我主移动 +1。

test('派对熊：主移动前，后面的人前进 1、前面的人后退 1，同格的人不动', () => {
  const g = V1([['partyanimal', 5], ['egg', 2], ['twin', 9], ['banana', 5]]);
  dice(g, [2]);
  turn(g, 'partyanimal');
  assert.deepStrictEqual(moves(g).slice(0, 2), [['egg', 2, 3], ['twin', 9, 8]]);
  assert.strictEqual(R(g, 'banana').pos, 5);
  const rollAt = g.events.findIndex((e) => e.t === 'roll');
  const lastPull = g.events.findIndex((e) => e.t === 'move' && e.rid === 'twin');
  assert(lastPull < rollAt, '靠拢在掷骰之前');
  assert.strictEqual(R(g, 'partyanimal').pos, 8, '同格 1 人：2 + 1');
});

test('派对熊：靠拢之后数同格人数，每人主移动 +1', () => {
  const g = V1([['partyanimal', 5], ['egg', 4], ['twin', 6], ['banana', 2]]);
  dice(g, [1]);
  turn(g, 'partyanimal');
  assert.deepStrictEqual(pos(g), { partyanimal: 8, egg: 5, twin: 5, banana: 3 });
  const calc = ev(g, 'calc')[0];
  assert.deepStrictEqual(calc.mods.map((m) => [m.label, m.v]), [['派对', 2]]);
  assert.strictEqual(calc.total, 3);
});

test('派对熊：靠拢后没人同格就没有加成', () => {
  const g = V1([['partyanimal', 5], ['egg', 0], ['twin', 10]]);
  dice(g, [2]);
  turn(g, 'partyanimal');
  assert.deepStrictEqual(pos(g), { partyanimal: 7, egg: 1, twin: 9 });
  assert.strictEqual(ev(g, 'calc').length, 0);
});

test('派对熊在起点：前面的人后退 1，退回起点的人也算同格加成', () => {
  const g = V1([['partyanimal', 0], ['egg', 1], ['twin', 4]]);
  dice(g, [2]);
  turn(g, 'partyanimal');
  assert.deepStrictEqual(pos(g), { partyanimal: 3, egg: 0, twin: 3 });
});

test('派对熊（狂野荒原）：靠拢是真正的移动——起点的人前进到 1 号星星拿 1 分', () => {
  const g = WILD([['partyanimal', 4], ['egg', 0], ['twin', 10]]);
  dice(g, [2]);
  turn(g, 'partyanimal');
  assert.strictEqual(R(g, 'egg').pos, 1);
  assert.strictEqual(g.score(1), 1);
  assert.strictEqual(R(g, 'twin').pos, 9);
  assert.strictEqual(R(g, 'partyanimal').pos, 6);
});

test('派对熊：被拉过来的大嘴怪停到派对熊格子把它吃掉，派对中断、不再主移动', () => {
  const g = V1([['partyanimal', 5], ['mouth', 4], ['twin', 10]]);
  dice(g, []);
  const asked = turn(g, 'partyanimal');
  assert.strictEqual(R(g, 'partyanimal').out, true);
  assert.strictEqual(R(g, 'mouth').pos, 5);
  assert.strictEqual(R(g, 'twin').pos, 10, '派对熊出局后不再拉人');
  assert.deepStrictEqual(asked, []);
});

test('派对熊被模仿猫复制：模仿猫的回合把所有人拉向模仿猫', () => {
  const g = V1([['copycat', 0], ['partyanimal', 10], ['egg', 3]]);
  dice(g, [1]);
  turn(g, 'copycat');
  assert.deepStrictEqual(pos(g), { copycat: 1, partyanimal: 9, egg: 2 });
});

test('[口径] 派对熊与跳跳蛙：跳跳蛙被拉动 1 格时跳过派对熊所在格，反而落到派对熊前面', () => {
  const g = V1([['partyanimal', 5], ['leaptoad', 4], ['twin', 10]]);
  dice(g, [1]);
  turn(g, 'partyanimal');
  assert.strictEqual(R(g, 'leaptoad').pos, 6);
  assert.strictEqual(ev(g, 'calc').length, 0, '跳跳蛙没留在派对熊格子，没有加成');
});

test('[口径] 派对熊：被绊倒跳过主移动的回合不开派对', () => {
  const g = V1([['partyanimal', 5, { tripped: true }], ['egg', 0], ['twin', 10]]);
  dice(g, []);
  turn(g, 'partyanimal');
  assert.deepStrictEqual(pos(g), { partyanimal: 5, egg: 0, twin: 10 });
});

/* ======================= 火箭科学家 rocket ======================= */
// 主移动掷骰后，可以把点数翻倍；这么做的话移动后我摔倒。

test('火箭科学家：掷骰后才问要不要翻倍；翻倍走双倍点数，移动后摔倒', () => {
  const g = V1([['rocket', 0], ['egg', 20]]);
  dice(g, [3]);
  let title;
  const asked = turn(g, 'rocket', { rocket: (d) => { title = d.title; return 'yes'; } });
  assert.deepStrictEqual(asked, ['roll', 'rocket']);
  assert(/3/.test(title) && /6/.test(title), '询问时已知点数');
  assert.strictEqual(R(g, 'rocket').pos, 6);
  assert.strictEqual(R(g, 'rocket').tripped, true);
  const moveAt = g.events.findIndex((e) => e.t === 'move' && e.rid === 'rocket');
  const tripAt = g.events.findIndex((e) => e.t === 'trip' && e.rid === 'rocket');
  assert(moveAt >= 0 && tripAt > moveAt, '移动后才摔倒');
});

test('火箭科学家：不翻倍就照常走，也不摔倒', () => {
  const g = V1([['rocket', 0], ['egg', 20]]);
  dice(g, [3]);
  turn(g, 'rocket', { rocket: 'no' });
  assert.strictEqual(R(g, 'rocket').pos, 3);
  assert.strictEqual(R(g, 'rocket').tripped, false);
});

test('火箭科学家：翻倍的是骰子点数，加减值之后再算（黏液怪：3×2−1=5）', () => {
  const g = V1([['rocket', 0], ['gunk', 20]]);
  dice(g, [3]);
  turn(g, 'rocket', { rocket: 'yes' });
  assert.strictEqual(R(g, 'rocket').pos, 5);
});

test('火箭科学家：摔倒后下一回合跳过主移动，再下一回合恢复正常', () => {
  const g = V1([['rocket', 0], ['egg', 20]]);
  dice(g, [3, 2]);
  turn(g, 'rocket', { rocket: 'yes' });
  const asked = turn(g, 'rocket', { rocket: 'no' });
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(R(g, 'rocket').pos, 6);
  assert.strictEqual(R(g, 'rocket').tripped, false);
  turn(g, 'rocket', { rocket: 'no' });
  assert.strictEqual(R(g, 'rocket').pos, 8);
});

test('火箭科学家：翻倍冲线后已离场，不再摔倒', () => {
  const g = V1([['rocket', 26], ['egg', 0], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'rocket', { rocket: 'yes' });
  assert.strictEqual(R(g, 'rocket').finished, 1);
  assert.strictEqual(R(g, 'rocket').tripped, false);
  assert.strictEqual(ev(g, 'trip').length, 0);
});

test('火箭科学家：掷 1 被尺蠖作废时没有主移动，不问翻倍也不摔倒', () => {
  const g = V1([['rocket', 0], ['inchworm', 10]]);
  dice(g, [1]);
  const asked = turn(g, 'rocket', { rocket: 'yes' });
  assert(!asked.includes('rocket'));
  assert.strictEqual(R(g, 'rocket').tripped, false);
});

test('火箭科学家（狂野荒原）：翻倍落到 7 号箭头，箭头走完才摔倒', () => {
  const g = WILD([['rocket', 1], ['egg', 20]]);
  dice(g, [3]);
  turn(g, 'rocket', { rocket: 'yes' });
  assert.strictEqual(R(g, 'rocket').pos, 10);
  assert.strictEqual(R(g, 'rocket').tripped, true);
  const lastMove = g.events.map((e) => e.t === 'move' && e.rid === 'rocket').lastIndexOf(true);
  const tripAt = g.events.findIndex((e) => e.t === 'trip');
  assert(tripAt > lastMove);
});

test('火箭科学家被模仿猫复制：模仿猫也能翻倍，翻倍后摔倒', () => {
  const g = V1([['copycat', 0], ['rocket', 10], ['egg', 3]]);
  dice(g, [2]);
  turn(g, 'copycat', { rocket: 'yes' });
  assert.strictEqual(R(g, 'copycat').pos, 4);
  assert.strictEqual(R(g, 'copycat').tripped, true);
});

test('[口径] 火箭科学家：翻倍后被较真怪拦下（走过头不动），仍然摔倒', () => {
  const g = V1([['rocket', 26], ['stickler', 0], ['egg', 0]]);
  dice(g, [3]);
  turn(g, 'rocket', { rocket: 'yes' });
  assert.strictEqual(R(g, 'rocket').pos, 26);
  assert.strictEqual(R(g, 'rocket').tripped, true);
});

/* ======================= 西西弗斯 sisyphus ======================= */
// 赛前拿 4 分。主移动掷出 6 时不移动，而是瞬移回起点并失去 1 分。

test('西西弗斯：赛前拿 4 分（4 个 1 分铜牌）', () => {
  const g = V1([['sisyphus', 0], ['egg', 0]]);
  sisBefore(g);
  assert.strictEqual(g.score(0), 4);
  assert.deepStrictEqual(g.players[0].chips.map((c) => [c.kind, c.v]), [['bronze', 1], ['bronze', 1], ['bronze', 1], ['bronze', 1]]);
});

test('西西弗斯（赛前流程）：beforeRace 里自动拿 4 分', () => {
  const g = V1([['sisyphus', 0], ['egg', 0]]);
  run(g, g.beforeRace());
  assert.strictEqual(g.score(0), 4);
  assert.strictEqual(g.score(1), 0);
});

test('西西弗斯：主移动掷出 6 不移动，瞬移回起点并失去 1 分', () => {
  const g = V1([['sisyphus', 12], ['egg', 0]]);
  sisBefore(g);
  dice(g, [6]);
  turn(g, 'sisyphus');
  assert.strictEqual(R(g, 'sisyphus').pos, 0);
  assert.strictEqual(g.score(0), 3);
  assert.strictEqual(moves(g, 'sisyphus').length, 0, '没有移动');
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.rid, e.from, e.to]), [['sisyphus', 12, 0]]);
});

test('西西弗斯：掷出 1～5 照常前进，不扣分', () => {
  for (const v of [1, 2, 3, 4, 5]) {
    const g = V1([['sisyphus', 12], ['egg', 0]]);
    sisBefore(g);
    dice(g, [v]);
    turn(g, 'sisyphus');
    assert.strictEqual(R(g, 'sisyphus').pos, 12 + v);
    assert.strictEqual(g.score(0), 4);
  }
});

test('西西弗斯：回起点是瞬移不是移动——同格吸盘鱼不能跟，路上的人不受影响', () => {
  const g = V1([['sisyphus', 10], ['suckerfish', 10], ['banana', 5]]);
  dice(g, [6]);
  const asked = turn(g, 'sisyphus', { suckerfish: 'yes' });
  assert(!asked.includes('suckerfish'));
  assert.strictEqual(R(g, 'suckerfish').pos, 10);
  assert.strictEqual(R(g, 'sisyphus').tripped, false);
});

test('西西弗斯：在起点掷出 6，留在起点并照样失去 1 分', () => {
  const g = V1([['sisyphus', 0], ['egg', 5]]);
  sisBefore(g);
  dice(g, [6]);
  turn(g, 'sisyphus');
  assert.strictEqual(R(g, 'sisyphus').pos, 0);
  assert.strictEqual(g.score(0), 3);
});

test('西西弗斯：掷出 6 超过 4 次，分扣光后照样回起点，分数不会变负', () => {
  const g = V1([['sisyphus', 10], ['egg', 0]]);
  sisBefore(g);
  dice(g, [6, 6, 6, 6, 6]);
  for (let i = 0; i < 5; i++) {
    R(g, 'sisyphus').pos = 10;
    turn(g, 'sisyphus');
    assert.strictEqual(R(g, 'sisyphus').pos, 0);
    assert.strictEqual(g.score(0), Math.max(0, 3 - i));
  }
});

test('西西弗斯：只有大额奖牌时扣 1 分（金杯 3 分变 2 分）', () => {
  const g = V1([['sisyphus', 10], ['egg', 0]]);
  g.players[0].chips.push({ kind: 'gold', v: 3, race: 0 });
  dice(g, [6]);
  turn(g, 'sisyphus');
  assert.strictEqual(g.score(0), 2);
});

test('[口径] 西西弗斯：整张卡算赛前技能，领跑时模仿猫什么都抄不到（掷 6 回起点那句也不抄）', () => {
  const g = V1([['copycat', 0], ['sisyphus', 10], ['egg', 3]]);
  assert.strictEqual(g.power(R(g, 'copycat')), null);
  dice(g, [6]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 6);
});

/* ======================= 吸盘鱼 suckerfish ======================= */
// 和我同格的运动员移动时，我可以跟着移动到它的新位置。注：可以借此冲过终点。

test('吸盘鱼：同格的人主移动后，可以跟到它的新位置', () => {
  const g = V1([['egg', 4], ['suckerfish', 4], ['twin', 0]]);
  dice(g, [3]);
  const asked = turn(g, 'egg', { suckerfish: 'yes' });
  assert(asked.includes('suckerfish'));
  assert.deepStrictEqual(pos(g), { egg: 7, suckerfish: 7, twin: 0 });
  assert.deepStrictEqual(moves(g, 'suckerfish'), [['suckerfish', 4, 7]], '跟随是一次真正的移动');
});

test('吸盘鱼：也可以选择不跟', () => {
  const g = V1([['egg', 4], ['suckerfish', 4], ['twin', 0]]);
  dice(g, [3]);
  turn(g, 'egg', { suckerfish: 'no' });
  assert.deepStrictEqual(pos(g), { egg: 7, suckerfish: 4, twin: 0 });
});

test('吸盘鱼：不同格的人移动时不问', () => {
  const g = V1([['egg', 3], ['suckerfish', 4], ['twin', 0]]);
  dice(g, [3]);
  const asked = turn(g, 'egg', { suckerfish: 'yes' });
  assert(!asked.includes('suckerfish'));
  assert.strictEqual(R(g, 'suckerfish').pos, 4);
});

test('吸盘鱼：起点也是格子——开局同在起点的人出发时也能跟', () => {
  const g = V1([['egg', 0], ['suckerfish', 0], ['twin', 0]]);
  dice(g, [4]);
  turn(g, 'egg', { suckerfish: 'yes' });
  assert.deepStrictEqual(pos(g), { egg: 4, suckerfish: 4, twin: 0 });
});

test('吸盘鱼：技能移动也能跟（同格的跟班抢先 2 格）', () => {
  const g = V1([['egg', 0], ['lackey', 4], ['suckerfish', 4]]);
  dice(g, [6]);
  turn(g, 'egg', { suckerfish: 'yes' });
  assert.deepStrictEqual(pos(g), { egg: 6, lackey: 6, suckerfish: 6 });
});

test('吸盘鱼：同格的人后退时也能跟着后退', () => {
  const g = V1([['egg', 8], ['suckerfish', 8]]);
  move(g, 'egg', -3, 'power', { suckerfish: 'yes' });
  assert.deepStrictEqual(pos(g), { egg: 5, suckerfish: 5 });
});

test('吸盘鱼：瞬移不是移动——同格的电灯泡瞬移走时不能跟', () => {
  const g = V1([['thirdwheel', 2], ['suckerfish', 2], ['egg', 10], ['twin', 10]]);
  dice(g, [1]);
  const asked = turn(g, 'thirdwheel', { thirdwheel: 's10', suckerfish: 'yes' });
  assert(!asked.includes('suckerfish'));
  assert.strictEqual(R(g, 'suckerfish').pos, 2);
  assert.strictEqual(R(g, 'thirdwheel').pos, 11);
});

test('吸盘鱼：可以借此冲过终点，拿第 2 名', () => {
  const g = V1([['egg', 27], ['suckerfish', 27], ['twin', 0]]);
  dice(g, [5]);
  turn(g, 'egg', { suckerfish: 'yes' });
  assert.strictEqual(R(g, 'egg').finished, 1);
  assert.strictEqual(R(g, 'suckerfish').finished, 2);
  assert.strictEqual(g.ended, true);
  assert.strictEqual(g.score(1), 1, '银牌 1 分');
});

test('吸盘鱼：较真怪在场时跟着冲线也算步数正好，不会被拦', () => {
  const g = V1([['egg', 27], ['suckerfish', 27], ['stickler', 0]]);
  dice(g, [3]);
  turn(g, 'egg', { suckerfish: 'yes' });
  assert.strictEqual(R(g, 'egg').finished, 1);
  assert.strictEqual(R(g, 'suckerfish').finished, 2);
});

test('吸盘鱼：同格的人走过头被较真怪拦下（没移动），吸盘鱼没得跟', () => {
  const g = V1([['egg', 27], ['suckerfish', 27], ['stickler', 0]]);
  dice(g, [5]);
  const asked = turn(g, 'egg', { suckerfish: 'yes' });
  assert(!asked.includes('suckerfish'));
  assert.deepStrictEqual(pos(g), { egg: 27, suckerfish: 27, stickler: 0 });
});

test('吸盘鱼被模仿猫复制：和模仿猫同格的人移动时，模仿猫也能跟', () => {
  const g = V1([['egg', 4], ['suckerfish', 10], ['copycat', 4]]);
  dice(g, [2]);
  turn(g, 'egg', { suckerfish: 'yes' });
  assert.strictEqual(R(g, 'copycat').pos, 6);
});

/* ======================= 浪漫鳄 romantic ======================= */
// 任何运动员停到恰好只有另一名运动员的格子上时，我前进 2 格。

test('浪漫鳄：有人停到恰好只有另一名运动员的格子，我前进 2 格', () => {
  const g = V1([['egg', 0], ['twin', 3], ['romantic', 10]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'romantic').pos, 12);
});

test('浪漫鳄：停到已有 2 人的格子（变成 3 人）不触发', () => {
  const g = V1([['egg', 0], ['twin', 3], ['banana', 3], ['romantic', 10]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'romantic').pos, 10);
});

test('浪漫鳄：停到空格不触发，只是经过有人的格子也不触发', () => {
  const g = V1([['egg', 0], ['twin', 2], ['romantic', 10]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'romantic').pos, 10);
});

test('浪漫鳄：自己停到恰好有 1 人的格子也触发（任何运动员包括自己）', () => {
  const g = V1([['romantic', 0], ['egg', 3]]);
  dice(g, [3]);
  turn(g, 'romantic');
  assert.strictEqual(R(g, 'romantic').pos, 5);
});

test('浪漫鳄：被绊倒时技能照样生效，前进后仍是绊倒状态', () => {
  const g = V1([['egg', 0], ['twin', 3], ['romantic', 10, { tripped: true }]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'romantic').pos, 12);
  assert.strictEqual(R(g, 'romantic').tripped, true);
});

test('浪漫鳄：前进 2 格冲过终点', () => {
  const g = V1([['egg', 0], ['twin', 3], ['romantic', 28]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'romantic').finished, 1);
});

test('浪漫鳄：瞬移停下也算——西西弗斯掷 6 瞬移回起点，起点恰好 1 人，浪漫鳄前进 2 格', () => {
  const g = V1([['sisyphus', 10], ['egg', 0], ['romantic', 20]]);
  dice(g, [6]);
  turn(g, 'sisyphus');
  assert.strictEqual(R(g, 'sisyphus').pos, 0);
  assert.strictEqual(R(g, 'romantic').pos, 22);
});

test('浪漫鳄（狂野荒原）：前进 2 格停到 13 号星星，拿 1 分', () => {
  const g = WILD([['egg', 0], ['twin', 3], ['romantic', 11]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'romantic').pos, 13);
  assert.strictEqual(g.score(2), 1);
});

test('浪漫鳄被模仿猫复制：有人停到两人格时，领跑的浪漫鳄和模仿猫各前进 2 格', () => {
  const g = V1([['egg', 0], ['twin', 3], ['romantic', 10], ['copycat', 5]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'romantic').pos, 12);
  assert.strictEqual(R(g, 'copycat').pos, 7);
});

test('浪漫鳄（狂野荒原）无限循环：停到两人格前进 2 → 24 号箭头退回同一格，同一局面再次出现就停', () => {
  const g = WILD([['romantic', 20], ['egg', 22], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'romantic');
  assert.deepStrictEqual(moves(g, 'romantic'), [['romantic', 20, 22], ['romantic', 22, 24], ['romantic', 24, 22]]);
  assert.strictEqual(R(g, 'romantic').pos, 22);
  assert.strictEqual(said(g, /无限循环/).length, 1);
});

test('[口径] 浪漫鳄与吸盘鱼：两人一起移到空格，引擎只算吸盘鱼后到的那一次，浪漫鳄只前进 2 格', () => {
  const g = V1([['egg', 4], ['suckerfish', 4], ['romantic', 20]]);
  dice(g, [3]);
  turn(g, 'egg', { suckerfish: 'yes' });
  assert.deepStrictEqual(pos(g), { egg: 7, suckerfish: 7, romantic: 22 });
});

/* ======================= 船长 skipper ======================= */
// 任何人主移动掷出 1 时，下一个行动的是我；之后从我的下家继续。
// 注：下家是行动顺序里排在我后面的那位玩家。

test('船长：别人主移动掷出 1，下一个行动的是船长，之后从船长的下家继续', () => {
  // 席位 0 twin、1 egg、2 船长；0 掷 1 → 船长插队 → 船长下家是 0 → 再到 1
  const g = V1([['twin', 0], ['egg', 25], ['skipper', 26]]);
  dice(g, [1, 4, 2, 5]);
  run(g, g.raceLoop(0));
  assert.deepStrictEqual(turnSeats(g), [0, 2, 0, 1]);
  assert.strictEqual(R(g, 'skipper').finished, 1);
  assert.strictEqual(R(g, 'egg').finished, 2);
  assert.strictEqual(R(g, 'twin').pos, 3);
});

test('船长：别人掷出 2～6 不改变行动顺序', () => {
  const g = V1([['twin', 0], ['egg', 25], ['skipper', 26]]);
  dice(g, [2, 5, 4]);
  run(g, g.raceLoop(0));
  assert.deepStrictEqual(turnSeats(g), [0, 1, 2]);
});

test('船长：自己掷出 1 也算，再来一回合；掷别的点数后交给下家', () => {
  const g = V1([['twin', 0], ['skipper', 20], ['egg', 25]]);
  dice(g, [1, 1, 6, 5, 3, 2]);
  run(g, g.raceLoop(1));
  assert.deepStrictEqual(turnSeats(g), [1, 1, 1, 2, 0, 1]);
  assert.strictEqual(R(g, 'egg').finished, 1);
  assert.strictEqual(R(g, 'skipper').finished, 2);
});

test('船长：插队的回合被绊倒也只是爬起来（不掷骰），然后照样从下家继续', () => {
  const g = V1([['twin', 0], ['egg', 25], ['skipper', 26, { tripped: true }]]);
  dice(g, [1, 2, 5, 4]);
  run(g, g.raceLoop(0));
  assert.deepStrictEqual(turnSeats(g), [0, 2, 0, 1, 2]);
  assert.strictEqual(R(g, 'skipper').finished, 2);
});

test('船长：已冲线后能力失效，别人掷 1 不再插队', () => {
  const g = V1([['twin', 0], ['egg', 25], ['skipper', 30, { finished: 1 }]]);
  g.finishCount = 1;
  dice(g, [1, 5]);
  run(g, g.raceLoop(0));
  assert.deepStrictEqual(turnSeats(g), [0, 1]);
  assert.strictEqual(R(g, 'egg').finished, 2);
});

test('船长：魔术象掷 1 后重掷成别的点数，被重掷掉的 1 不让船长插队', () => {
  const g = V1([['magician', 0], ['egg', 25], ['skipper', 26]]);
  dice(g, [1, 3, 5, 4]);
  run(g, g.raceLoop(0), { reroll: seq('magic', 'keep') });
  assert.deepStrictEqual(turnSeats(g), [0, 1, 2]);
});

test('[口径] 船长：插队后、轮到它之前就被大嘴怪吃掉，仍从船长的下家继续（掷 1 者的下家被跳过）', () => {
  // 席位 0 大嘴怪掷 1 → 船长（席位 2）插队 → 大嘴怪走 1 格停到船长格把它吃掉
  // 之后从船长的下家（席位 3）继续，席位 1 这一轮被跳过
  const g = V1([['mouth', 0], ['egg', 25], ['skipper', 1], ['twin', 26]]);
  dice(g, [1, 4, 2, 5]);
  run(g, g.raceLoop(0));
  assert.strictEqual(R(g, 'skipper').out, true);
  assert.deepStrictEqual(turnSeats(g), [0, 3, 0, 1]);
});

test('[口径] 船长被模仿猫复制：有人掷 1 时只有回合顺序最靠前的那名持有者插队', () => {
  // 席位 0 egg 掷 1；1 号模仿猫（抄领跑的船长）、2 号船长都有「老水手」
  let g = V1([['egg', 0], ['copycat', 3], ['skipper', 10]]);
  dice(g, [1]);
  turn(g, 'egg');
  assert.strictEqual(g.skipperNext, 1, '模仿猫离掷骰者更近，由它插队');
  assert.strictEqual(pwCount(g, 'skipper'), 1);

  g = V1([['egg', 0], ['skipper', 10], ['copycat', 3]]);
  dice(g, [1]);
  turn(g, 'egg');
  assert.strictEqual(g.skipperNext, 1, '船长离掷骰者更近，由船长插队');
});

/* ======================= 电灯泡 thirdwheel ======================= */
// 主移动前，可以瞬移到任意一个恰好有 2 名运动员的格子。

test('电灯泡：主移动前瞬移到恰好有 2 人的格子，然后照常主移动', () => {
  const g = V1([['thirdwheel', 2], ['egg', 10], ['twin', 10], ['banana', 6]]);
  dice(g, [3]);
  const asked = turn(g, 'thirdwheel', { thirdwheel: 's10' });
  assert.deepStrictEqual(asked, ['thirdwheel', 'roll']);
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.rid, e.from, e.to]), [['thirdwheel', 2, 10]]);
  assert.strictEqual(R(g, 'thirdwheel').pos, 13);
  assert.strictEqual(R(g, 'thirdwheel').tripped, false, '瞬移越过香蕉不算超过');
});

test('电灯泡：可以选择不瞬移', () => {
  const g = V1([['thirdwheel', 2], ['egg', 10], ['twin', 10]]);
  dice(g, [3]);
  turn(g, 'thirdwheel', { thirdwheel: '_no' });
  assert.strictEqual(R(g, 'thirdwheel').pos, 5);
  assert.strictEqual(ev(g, 'warp').length, 0);
});

test('电灯泡：选项只有恰好 2 人的格子（前后都行），1 人格和 3 人格不算', () => {
  const g = V1([['thirdwheel', 6], ['egg', 5], ['twin', 3], ['banana', 3], ['legs', 12], ['lackey', 12]]);
  dice(g, [1]);
  let opts;
  turn(g, 'thirdwheel', { thirdwheel: (d) => { opts = d.options.map((o) => o.v); return 's3'; } });
  assert.deepStrictEqual(opts, ['s12', 's3', '_no']);
  assert.strictEqual(R(g, 'thirdwheel').pos, 4, '可以往回挤：3 + 1');

  const g2 = V1([['thirdwheel', 0], ['egg', 5], ['twin', 8], ['banana', 8], ['legs', 8]]);
  dice(g2, [1]);
  const asked = turn(g2, 'thirdwheel');
  assert.deepStrictEqual(asked, ['roll'], '没有两人格就不问');
});

test('电灯泡：自己所在的两人格不算（已经在那里了）', () => {
  const g = V1([['thirdwheel', 5], ['egg', 5], ['twin', 9]]);
  dice(g, [1]);
  const asked = turn(g, 'thirdwheel');
  assert.deepStrictEqual(asked, ['roll']);
});

test('电灯泡：瞬移不是移动——原来同格的吸盘鱼不能跟', () => {
  const g = V1([['thirdwheel', 2], ['suckerfish', 2], ['egg', 10], ['twin', 10]]);
  dice(g, [1]);
  const asked = turn(g, 'thirdwheel', { thirdwheel: 's10', suckerfish: 'yes' });
  assert(!asked.includes('suckerfish'));
  assert.strictEqual(R(g, 'suckerfish').pos, 2);
});

test('电灯泡（狂野荒原）：瞬移到 7 号箭头上的两人格，按停格结算箭头前进 3，再主移动', () => {
  const g = WILD([['thirdwheel', 0], ['egg', 7], ['twin', 7]]);
  dice(g, [2]);
  turn(g, 'thirdwheel', { thirdwheel: 's7' });
  assert.deepStrictEqual(moves(g, 'thirdwheel'), [['thirdwheel', 7, 10], ['thirdwheel', 10, 12]]);
  assert.strictEqual(R(g, 'thirdwheel').pos, 12);
});

test('电灯泡被模仿猫复制：模仿猫也能瞬移到两人格', () => {
  const g = V1([['copycat', 0], ['thirdwheel', 20], ['egg', 8], ['twin', 8]]);
  dice(g, [1]);
  turn(g, 'copycat', { thirdwheel: 's8' });
  assert.strictEqual(R(g, 'copycat').pos, 9);
});

test('[口径] 电灯泡：瞬移到芭芭雅嘎所在的两人格被绊倒，本回合主移动照常进行，下回合才跳过', () => {
  const g = V1([['thirdwheel', 0], ['babayaga', 10], ['egg', 10]]);
  dice(g, [2]);
  const asked = turn(g, 'thirdwheel', { thirdwheel: 's10' });
  assert.deepStrictEqual(asked, ['thirdwheel', 'roll']);
  assert.strictEqual(R(g, 'thirdwheel').pos, 12);
  assert.strictEqual(R(g, 'thirdwheel').tripped, true);
  const again = turn(g, 'thirdwheel');
  assert.deepStrictEqual(again, [], '下回合爬起来不掷骰');
});

/* ======================= 蹭蹭狗 scoocher ======================= */
// 其他运动员的技能每生效一次，我前进 1 格。

test('蹭蹭狗：别人的技能生效一次，我当场前进 1 格（跟班抢先后、掷 6 的人移动前）', () => {
  const g = V1([['egg', 0], ['lackey', 10], ['scoocher', 5]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.deepStrictEqual(pos(g), { egg: 6, lackey: 12, scoocher: 6 });
  assert.deepStrictEqual(moves(g).map((m) => m[0]), ['lackey', 'scoocher', 'egg']);
});

test('蹭蹭狗：加减值类技能每用一次也算——野兔 +2、黏液怪 -1', () => {
  let g = V1([['hare', 0], ['egg', 10], ['scoocher', 5]]);
  dice(g, [2]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 4);
  assert.strictEqual(R(g, 'scoocher').pos, 6);

  g = V1([['egg', 0], ['gunk', 20], ['scoocher', 5]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').pos, 2);
  assert.strictEqual(R(g, 'scoocher').pos, 6);
});

test('蹭蹭狗：技能没生效就不蹭——可爱废柴并列垫底没拿分', () => {
  const g = V1([['loser', 0], ['egg', 0], ['scoocher', 5]]);
  dice(g, [2]);
  turn(g, 'loser');
  assert.strictEqual(R(g, 'scoocher').pos, 5);
});

test('蹭蹭狗：自己的技能不算——只有一只蹭蹭狗时不会自己蹭自己', () => {
  const g = V1([['egg', 0], ['lackey', 10], ['scoocher', 5]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(pwCount(g, 'scoocher'), 1);
  assert.strictEqual(R(g, 'scoocher').pos, 6);
});

test('蹭蹭狗：赛前技能生效也算——西西弗斯赛前拿分，蹭蹭狗赛前就前进 1 格', () => {
  const g = V1([['sisyphus', 0], ['scoocher', 0]]);
  run(g, g.beforeRace());
  assert.strictEqual(R(g, 'scoocher').pos, 1);
});

test('蹭蹭狗：蹭 1 格冲过终点', () => {
  const g = V1([['egg', 0], ['lackey', 10], ['scoocher', 29]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'scoocher').finished, 1);
});

test('蹭蹭狗（狂野荒原）：蹭到 7 号箭头，再前进 3 格', () => {
  const g = WILD([['egg', 0], ['lackey', 10], ['scoocher', 6]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'scoocher').pos, 10);
});

test('蹭蹭狗无限循环：紧挨在巨婴身后蹭不过去、又触发巨婴，同一局面再次出现就停', () => {
  const g = V1([['egg', 0], ['lackey', 10], ['scoocher', 4], ['hugebaby', 5]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'scoocher').pos, 4);
  assert.strictEqual(said(g, /无限循环/).length, 1);
  assert.strictEqual(R(g, 'egg').pos, 6, '循环停下后回合照常继续');
});

test('蹭蹭狗被模仿猫复制：两者互相蹭不算无限循环，照常结算到蹭蹭狗冲线为止', () => {
  const g = V1([['egg', 0], ['lackey', 3], ['scoocher', 20], ['copycat', 0]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'scoocher').finished, 1);
  assert.strictEqual(R(g, 'copycat').pos, 10);
  assert.strictEqual(said(g, /无限循环/).length, 0);
});

/* ======================= 较真怪 stickler ======================= */
// 其他运动员只有走到正好的步数才能冲线；走过头的话，这次不移动。

test('较真怪：别人走过头，这次完全不动', () => {
  const g = V1([['egg', 27], ['stickler', 0]]);
  dice(g, [5]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').pos, 27);
  assert.strictEqual(R(g, 'egg').finished, 0);
  assert.strictEqual(moves(g).length, 0);
  assert.strictEqual(ev(g, 'blocked')[0].by, 'stickler');
});

test('较真怪：步数正好就能冲线', () => {
  const g = V1([['egg', 27], ['stickler', 0]]);
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').finished, 1);
});

test('较真怪：只管「其他运动员」，自己走过头照样冲线', () => {
  const g = V1([['stickler', 27], ['egg', 0]]);
  dice(g, [6]);
  turn(g, 'stickler');
  assert.strictEqual(R(g, 'stickler').finished, 1);
});

test('较真怪：技能移动也要步数正好——跟班在 29 抢先 2 格走过头，不动', () => {
  const g = V1([['egg', 0], ['lackey', 29], ['stickler', 5]]);
  dice(g, [6]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'lackey').pos, 29);
  assert.strictEqual(R(g, 'lackey').finished, 0);
});

test('较真怪：主移动加值算进步数——野兔在 27 掷 1（共 3）冲线，掷 2（共 4）走过头', () => {
  let g = V1([['hare', 27], ['egg', 27], ['stickler', 0]]);
  dice(g, [1]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').finished, 1);

  g = V1([['hare', 27], ['egg', 27], ['stickler', 0]]);
  dice(g, [2]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 27);
});

test('较真怪：被拦下等于原地没动，起哄怪照样前进 2 格', () => {
  const g = V1([['egg', 27], ['stickler', 0], ['heckler', 10]]);
  dice(g, [5]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').pos, 27);
  assert.strictEqual(R(g, 'heckler').pos, 12);
});

test('较真怪：拦人一次算技能生效，蹭蹭狗前进 1 格', () => {
  const g = V1([['egg', 27], ['stickler', 0], ['scoocher', 10]]);
  dice(g, [5]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'scoocher').pos, 11);
});

test('较真怪：冲线离场后能力失效，别人走过头也能冲线', () => {
  const g = V1([['egg', 27], ['stickler', 30, { finished: 1 }], ['twin', 0]]);
  g.finishCount = 1;
  dice(g, [5]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').finished, 2);
  assert.strictEqual(g.ended, true);
});

test('较真怪被模仿猫复制：较真怪自己冲线也得步数正好', () => {
  const g = V1([['stickler', 27], ['copycat', 0], ['egg', 3]]);
  assert.strictEqual(g.power(R(g, 'copycat')), 'stickler');
  dice(g, [6]);
  turn(g, 'stickler');
  assert.strictEqual(R(g, 'stickler').pos, 27);
  assert.strictEqual(ev(g, 'blocked')[0].by, 'copycat');
});

/* ======================= 双胞胎 twin ======================= */
// 赛前可以挑一名之前比赛的冠军，本场使用它的技能。

test('双胞胎：没有往届冠军时不问，保持没有技能', () => {
  const g = V1([['twin', 0], ['egg', 0]]);
  const asked = run(g, g.applyBeforeRace(R(g, 'twin'), 'twin', 0));
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(R(g, 'twin').power, 'twin');
});

test('双胞胎：只能从往届冠军里挑——同一名冠军只列一次，双胞胎自己不在选项里，可以不复制', () => {
  const g = V1([['twin', 0], ['egg', 0]]);
  g.winners = ['legs', 'twin', 'legs', 'mouth'];
  let opts;
  run(g, g.applyBeforeRace(R(g, 'twin'), 'twin', 0), { twin: (d) => { opts = d.options.map((o) => o.v); return '_skip'; } });
  assert.deepStrictEqual(opts, ['legs', 'mouth', '_skip']);
  assert.strictEqual(R(g, 'twin').power, 'twin');
  assert.strictEqual(pwCount(g, 'twin'), 0);
});

test('双胞胎：挑大长腿冠军后本场使用迈大步', () => {
  const g = V1([['twin', 0], ['egg', 0]]);
  g.winners = ['legs'];
  run(g, g.applyBeforeRace(R(g, 'twin'), 'twin', 0), { twin: 'legs' });
  assert.strictEqual(R(g, 'twin').power, 'legs');
  dice(g, []);
  turn(g, 'twin', { mode: 'legs' });
  assert.strictEqual(R(g, 'twin').pos, 5);
});

test('双胞胎：挑大嘴怪冠军后，停到恰好 1 人的格子就吃人', () => {
  const g = V1([['twin', 0], ['egg', 3]]);
  g.winners = ['mouth'];
  run(g, g.applyBeforeRace(R(g, 'twin'), 'twin', 0), { twin: 'mouth' });
  dice(g, [3]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'egg').out, true);
});

test('双胞胎：复制西西弗斯时赛前技能也生效，拿 4 分', () => {
  const g = V1([['twin', 0], ['egg', 0]]);
  g.winners = ['sisyphus'];
  run(g, g.beforeRace(), { twin: 'sisyphus' });
  assert.strictEqual(R(g, 'twin').power, 'sisyphus');
  assert.strictEqual(g.score(0), 4);
});

test('双胞胎：复制神秘蛋时接着从牌堆抽 3 选 1', () => {
  const g = V1([['twin', 0], ['egg', 0]]);
  g.winners = ['egg'];
  g.deck = ['legs', 'mouth', 'romantic', 'hare'];
  let opts;
  run(g, g.applyBeforeRace(R(g, 'twin'), 'twin', 0), { twin: 'egg', egg: (d) => { opts = d.options.map((o) => o.v); return 'mouth'; } });
  assert.deepStrictEqual(opts, ['legs', 'mouth', 'romantic']);
  assert.strictEqual(R(g, 'twin').power, 'mouth');
});

test('双胞胎：复制一次算技能生效，蹭蹭狗赛前前进 1 格；不复制就不算', () => {
  let g = V1([['twin', 0], ['scoocher', 0]]);
  g.winners = ['legs'];
  run(g, g.beforeRace(), { twin: 'legs' });
  assert.strictEqual(R(g, 'scoocher').pos, 1);

  g = V1([['twin', 0], ['scoocher', 0]]);
  g.winners = ['legs'];
  run(g, g.beforeRace(), { twin: '_skip' });
  assert.strictEqual(R(g, 'scoocher').pos, 0);
});

test('双胞胎与模仿猫：复制了大长腿的双胞胎领跑时，模仿猫抄到大长腿；没复制时什么也抄不到', () => {
  let g = V1([['twin', 10], ['copycat', 0], ['egg', 0]]);
  g.winners = ['legs'];
  run(g, g.applyBeforeRace(R(g, 'twin'), 'twin', 0), { twin: 'legs' });
  assert.strictEqual(g.power(R(g, 'copycat')), 'legs');

  g = V1([['twin', 10], ['copycat', 0], ['egg', 0]]);
  assert.strictEqual(g.power(R(g, 'copycat')), null);
});
