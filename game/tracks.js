'use strict';
// 赛道：0 = 起点，1..29 为赛道格，30 = 冲过终点线
const FINISH = 30;
// 所有赛道共用同一几何：第一个弯道 12，第二个弯道 15
const FIRST_CORNER = 12;
const SECOND_CORNER = 15;

// 每场比赛的金/银奖牌分值（规则书图示：金 3/4/5…，银 1/2/3…；第 4 场按递增补齐）
// 暂定：二代与混合模式沿用同一套分值，官方二代分值尚未核实。
const GOLD = [3, 4, 5, 6];
const SILVER = [1, 2, 3, 4];

// 漩涡乐园的漩涡格两两相连（对照赛道图逐格核对）：停在一端就传送到另一端
const WHIRLS = [[4, 6], [8, 12], [11, 15], [17, 22], [20, 23], [24, 28]];
function whirlSpaces(pairs) {
  const spaces = {};
  pairs.forEach(([a, b], pair) => {
    spaces[a] = { type: 'whirl', to: b, pair };
    spaces[b] = { type: 'whirl', to: a, pair };
  });
  return spaces;
}

// 特殊格：arrow = 箭头（按数字前进/后退，算作一次独立移动），rock = 石头（绊倒），star = 星星（铜牌 1 分），
// whirl = 漩涡（瞬移到配对的另一端，不算移动）
const TRACKS = {
  mild: {
    key: 'mild',
    name: '温和一英里',
    edition: 1,
    firstCorner: FIRST_CORNER,
    secondCorner: SECOND_CORNER,
    spaces: {},
  },
  // 狂野荒原按实物逐格核对；下排从右往左走，箭头指右即后退
  wild: {
    key: 'wild',
    name: '狂野荒原',
    edition: 1,
    firstCorner: FIRST_CORNER,
    secondCorner: SECOND_CORNER,
    spaces: {
      1: { type: 'star' },
      5: { type: 'rock' },
      7: { type: 'arrow', n: 3 },
      11: { type: 'arrow', n: 1 },
      13: { type: 'star' },
      16: { type: 'arrow', n: -4 },
      17: { type: 'rock' },
      23: { type: 'arrow', n: 2 },
      24: { type: 'arrow', n: -2 },
      26: { type: 'rock' },
    },
  },
  // 二代：扭扭糖果（Twisty Twirl）没有特殊格，第 13/14 格之间立着「TWIST」招牌
  twisty: {
    key: 'twisty',
    name: '扭扭糖果',
    en: 'Twisty Twirl',
    edition: 2,
    firstCorner: FIRST_CORNER,
    secondCorner: SECOND_CORNER,
    // 暂定：本场第一个移动到/经过第 14 格的运动员抽一张变数卡（每场一次）
    twistAt: 14,
    spaces: {},
  },
  // 二代：漩涡乐园（Whirly World）12 个漩涡格，管道两两相连
  whirly: {
    key: 'whirly',
    name: '漩涡乐园',
    en: 'Whirly World',
    edition: 2,
    firstCorner: FIRST_CORNER,
    secondCorner: SECOND_CORNER,
    whirls: WHIRLS,
    spaces: whirlSpaces(WHIRLS),
  },
};

// 模式：v1 一代（默认）、v2 二代、mix 一代+二代混合
const EDITIONS = {
  v1: { key: 'v1', name: '一代', desc: '经典 36 名运动员，温和一英里与狂野荒原交替', schedule: ['mild', 'wild', 'mild', 'wild'], pools: [1], twists: false },
  v2: { key: 'v2', name: '二代', desc: '续作 36 名新运动员，扭扭糖果与漩涡乐园交替，含变数卡', schedule: ['twisty', 'whirly', 'twisty', 'whirly'], pools: [2], twists: true },
  // 官方混盒顺序：Mild Mile → Wild Wilds → Twisty Twirl → Whirly World
  mix: { key: 'mix', name: '混合', desc: '72 名运动员一起选秀，四场依次跑四条不同赛道', schedule: ['mild', 'wild', 'twisty', 'whirly'], pools: [1, 2], twists: true },
};
const EDITION_KEYS = Object.keys(EDITIONS);
const DEFAULT_EDITION = 'v1';

// 默认模式（一代）四场依次：温和、狂野、温和、狂野
const SCHEDULE = EDITIONS.v1.schedule;

module.exports = { FINISH, FIRST_CORNER, SECOND_CORNER, GOLD, SILVER, TRACKS, SCHEDULE, EDITIONS, EDITION_KEYS, DEFAULT_EDITION, WHIRLS };
