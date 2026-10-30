'use strict';
// 卡牌测试共用夹具：手工摆盘（不经过选人和赛前流程），指定骰点，直接驱动引擎内部生成器。
// 每个 *.test.js 用这里的 test() 登记用例，由 test/cards/run.js 统一执行。
const assert = require('assert');
const { Game } = require('../../game/engine');

/* ---------- 用例登记 ---------- */
const registry = [];
let currentFile = null;
// 正常用例：按卡牌文本该有的行为
function test(name, fn) { registry.push({ file: currentFile, name, fn, kind: 'test' }); }
// 疑似引擎 bug：按卡牌文本写的断言，眼下会失败。note 说明卡牌原文和引擎现状的差别。
// 运行器把它们单独列出、不算失败；哪天修好了（断言通过）会提示改成 test()。
test.bug = (name, fn, note) => registry.push({ file: currentFile, name, fn, kind: 'bug', note });
const setFile = (f) => { currentFile = f; };

/* ---------- 摆盘 ---------- */
// list：[[rid, pos, extra?], ...]，第 i 项默认坐第 i 席；extra 会合并进运动员对象（如 { seat: 0, tripped: true }）。
// 同一席位可以放多名运动员（额外运动员）：在 extra 里指定 seat，并保证 players 数量够（opts.players）。
// edition：'v1' 一代规则，'v2' 二代规则（默认），'mix' 混合；track 缺省时一代用 mild、二代用 twisty（都没有特殊格）。
function setup(list, opts = {}) {
  const edition = opts.edition || 'v2';
  const n = opts.players || Math.max(2, ...list.map(([, , x], i) => (x && x.seat != null ? x.seat : i) + 1));
  const g = new Game({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })), seed: opts.seed || 42, edition });
  g.phase = 'race'; g.raceNo = opts.raceNo || 1; g.trackKey = opts.track || (edition === 'v1' ? 'mild' : 'twisty'); g.curSeat = 0;
  g.finishCount = 0; g.outOrder = []; g.turns = 0; g.skipperNext = null; g.extraTurn = false;
  g.raceEndReason = 'finished';
  g.resetTurnCounters();
  g.resetRaceState();
  g.racers = list.map(([rid, pos, extra], i) => ({ rid, seat: i, pos, power: rid, tripped: false, finished: 0, out: false, ...(extra || {}) }));
  return g;
}

/* ---------- 驱动 ---------- */
// 骰点按顺序给出；多掷一颗就报错（暴露意料之外的掷骰）。用完后可用 diceLeft(g) 检查是否全部用掉。
function dice(g, seq) {
  g._dice = seq.slice();
  g.d6 = () => { assert(g._dice.length, `骰点不够：夹具只给了 ${seq.length} 颗`); return g._dice.shift(); };
}
const diceLeft = (g) => (g._dice ? g._dice.length : 0);

// 驱动生成器直到结束；answers[kind] 可以是值或 (d) => 值；没给的决策选第一个选项。
// 比赛结束（RaceEnd）时 g.ended = true。返回依次被问到的决策 kind。
function run(g, gen, answers = {}) {
  const asked = [];
  try {
    let r = gen.next();
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
const R = (g, rid) => { const r = g.racers.find((x) => x.rid === rid); assert(r, `场上没有 ${rid}`); return r; };
// 让 rid 走一个完整回合（默认选择「掷骰」）
const turn = (g, rid, answers) => run(g, g.takeTurn(R(g, rid)), { mode: 'roll', ...answers });
// 让 rid 移动 n 格（kind：main 主移动 / power 技能移动）
const move = (g, rid, n, kind = 'main', answers) => run(g, g.move(R(g, rid), n, kind), answers);
const ev = (g, t) => g.events.filter((e) => e.t === t);
const said = (g, re) => g.events.filter((e) => re.test(e.text || ''));
const pos = (g) => Object.fromEntries(g.racers.map((r) => [r.rid, r.pos]));
// 摆好局面后翻一张（或依次翻几张）变数卡，触发者是第一名运动员
function twist(ids, list, opts = {}, answers) {
  const g = setup(list, opts);
  g.twistDeck = Array.isArray(ids) ? ids.slice() : [ids];
  run(g, g.drawTwist(g.racers[0]), answers);
  return g;
}

module.exports = { assert, Game, test, setFile, registry, setup, dice, diceLeft, run, R, turn, move, ev, said, pos, twist };
