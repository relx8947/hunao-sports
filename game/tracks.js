'use strict';
// 赛道：0 = 起点，1..29 为赛道格，30 = 冲过终点线
const FINISH = 30;

// 每场比赛的金/银奖牌分值（规则书图示：金 3/4/5…，银 1/2/3…；第 4 场按递增补齐）
const GOLD = [3, 4, 5, 6];
const SILVER = [1, 2, 3, 4];

// 狂野荒原的特殊格：arrow = 箭头（按数字前进/后退，算作一次独立移动），rock = 石头（绊倒），star = 星星（铜牌 1 分）
const TRACKS = {
  mild: {
    key: 'mild',
    name: '温和一英里',
    secondCorner: 15,
    spaces: {},
  },
  wild: {
    key: 'wild',
    name: '狂野荒原',
    secondCorner: 15,
    spaces: {
      4: { type: 'arrow', n: 2 },
      7: { type: 'star' },
      9: { type: 'rock' },
      12: { type: 'arrow', n: -3 },
      14: { type: 'star' },
      17: { type: 'rock' },
      19: { type: 'arrow', n: 3 },
      22: { type: 'star' },
      24: { type: 'rock' },
      26: { type: 'arrow', n: -4 },
      28: { type: 'star' },
    },
  },
};

// 四场比赛依次：温和、狂野、温和、狂野
const SCHEDULE = ['mild', 'wild', 'mild', 'wild'];

module.exports = { FINISH, GOLD, SILVER, TRACKS, SCHEDULE };
