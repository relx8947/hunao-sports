'use strict';
// 胡闹运动会 · 对局引擎
// 用生成器串起整局流程：需要玩家决策时 yield 一个决策对象，外部 answer() 后继续。
// 每个动作都会往 events 里推送事件，前端按序播放动画。
const { BY_ID, RACER_IDS, RACER_IDS_V2, BEFORE_RACE, OFF_TRACK, TWISTS, TWIST_BY_ID } = require('./racers');
const { FINISH, GOLD, SILVER, TRACKS, EDITIONS, DEFAULT_EDITION } = require('./tracks');

class RaceEnd extends Error {}

const OUT_TEXT = {
  doppel: '冲线时被冒牌货顶包',
  bitemark: '被狼人咬了一口',
  monster: '被狼人怪追上',
  icarus: '飞得太高，翅膀融化了',
  speeddemon: '油门焊死冲出了赛道',
  scrying: '被水晶球看穿',
  timeimp: '被时间小鬼拽进了下一场',
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PW_PER_TURN = 30; // 同一技能每回合生效次数兜底上限
const PW_BUDGET = 160; // 每回合技能生效总预算，兜底防止连锁爆炸
const MAX_TURNS = 240; // 单场回合上限兜底
// 仅用于前端/服务端动画节奏：AI 座位回合内的这些事件带 ai 标记，播放更快；不参与任何结算。
const AI_PACED = new Set(['turn', 'recover', 'roll', 'calc', 'power', 'move']);

class Game {
  constructor({ players, seed = Date.now(), edition = DEFAULT_EDITION }) {
    if (players.length < 2 || players.length > 6) throw new Error('人数需在 2-6 之间');
    if (!EDITIONS[edition]) throw new Error('未知的模式');
    this.rand = mulberry32(seed);
    this.edition = edition;
    this.schedule = EDITIONS[edition].schedule.slice();
    this.players = players.map((p, i) => ({
      seat: i, name: p.name, ai: !!p.ai, hand: [], used: [], chips: [], extras: [],
    }));
    this.n = this.players.length;
    // 一代卡池与洗牌顺序保持原样；二代/混合再额外洗变数卡，不影响一代的随机序列。
    const pool = edition === 'v1' ? RACER_IDS.slice() : edition === 'v2' ? RACER_IDS_V2.slice() : RACER_IDS.concat(RACER_IDS_V2);
    this.deck = this.shuffle(pool);
    if (EDITIONS[edition].twists) {
      this.twistDeck = this.shuffle(TWISTS.map((t) => t.id));
      this.twistDiscard = [];
    }
    this.faceUp = [];
    this.phase = 'draft';
    this.raceNo = 0; // 1..4
    this.trackKey = this.schedule[0];
    this.racers = [];
    this.winners = []; // 往届冠军的运动员卡 id
    this.firstSeat = 0;
    this.curSeat = null;
    this.events = [];
    this.evSeq = 0;
    this.log = [];
    this.pending = null;
    this.decSeq = 0;
    this.results = [];
    this.gen = this.main();
  }

  /* ================= 驱动 ================= */
  start() { this.advance(undefined); }

  advance(val) {
    let r;
    try {
      r = this.gen.next(val);
    } catch (e) {
      this.pending = null;
      throw e;
    }
    if (r.done) { this.pending = null; return; }
    const d = r.value;
    d.id = ++this.decSeq;
    if (d.simul) d.answers = {};
    this.pending = d;
  }

  // 提交决策；返回错误字符串或 null
  answer(seat, decisionId, value) {
    const d = this.pending;
    if (!d) return '当前没有待决策项';
    if (decisionId != null && decisionId !== d.id) return '决策已过期';
    if (d.simul) {
      if (!d.seats.includes(seat)) return '不需要你决策';
      if (d.answers[seat] !== undefined) return '你已经选好了';
      const opts = d.optionsBySeat[seat];
      if (!opts.some((o) => o.v === value)) return '无效选项';
      d.answers[seat] = value;
      this.emit({ t: 'picked', seat });
      if (d.seats.every((s) => d.answers[s] !== undefined)) this.advance(d.answers);
      return null;
    }
    if (d.seat !== seat) return '还没轮到你';
    if (!d.options.some((o) => o.v === value)) return '无效选项';
    this.advance(value);
    return null;
  }

  // 取出并清空待播放事件
  drain() { const e = this.events; this.events = []; return e; }

  emit(ev) {
    // 事件可能包含 results/champions 等内部数组，消费者不得反向改写对局。
    ev = structuredClone(ev);
    ev.seq = ++this.evSeq;
    if (AI_PACED.has(ev.t) && this.phase === 'race' && this.curSeat != null && this.players[this.curSeat]?.ai) ev.ai = true;
    this.events.push(ev);
    if (ev.text) {
      this.log.push({ seq: ev.seq, text: ev.text, race: this.raceNo });
      if (this.log.length > 300) this.log.shift();
    }
  }

  ask(seat, kind, title, options, extra = {}) {
    return { seat, kind, title, options, ...extra };
  }

  /* ================= 工具 ================= */
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  d6() { return 1 + Math.floor(this.rand() * 6); }
  get track() { return TRACKS[this.trackKey]; }
  nm(r) { return `${this.players[r.seat].name}的${BY_ID[r.rid].name}`; }
  active(r) { return !!r && !r.finished && !r.out; }
  onTrack() { return this.racers.filter((r) => this.active(r)); }
  others(r) { return this.onTrack().filter((o) => o !== r); }
  at(pos, except) { return this.onTrack().filter((o) => o.pos === pos && o !== except); }
  // 一名玩家可能同时控制多名运动员（额外运动员、调包精换来的）：主运动员优先
  racerOfSeat(seat) { return this.racers.find((r) => r.seat === seat && !r.extra) || this.racers.find((r) => r.seat === seat); }
  seatRacers(seat) {
    const list = this.racers.filter((r) => r.seat === seat);
    return list.filter((r) => !r.extra).concat(list.filter((r) => r.extra));
  }
  byRid(rid) { return this.racers.find((r) => r.rid === rid); }
  seatOrder(seat) { return (seat - (this.curSeat ?? 0) + this.n) % this.n; }
  sortByTurn(list) { return list.slice().sort((a, b) => this.seatOrder(a.seat) - this.seatOrder(b.seat)); }

  leaders() {
    const on = this.onTrack();
    if (!on.length) return [];
    const m = Math.max(...on.map((r) => r.pos));
    return on.filter((r) => r.pos === m);
  }
  lasts() {
    const on = this.onTrack();
    if (!on.length) return [];
    const m = Math.min(...on.map((r) => r.pos));
    return on.filter((r) => r.pos === m);
  }

  copyCandidates(r) {
    return this.leaders().filter((x) => x !== r && x.power !== 'copycat' && !BEFORE_RACE.has(x.power));
  }
  copyKey(candidates) { return candidates.map((r) => `${r.rid}:${r.power}`).sort().join('|'); }

  // 查询不修改状态，也不替玩家选择；新并列局面在生成器边界处理。
  power(r) {
    if (!this.active(r)) return null;
    if (r.power !== 'copycat') return r.power;
    const candidates = this.copyCandidates(r);
    if (candidates.length === 1) return candidates[0].power;
    const picked = r.copyChoices?.[this.copyKey(candidates)];
    return candidates.find((x) => x.rid === picked)?.power || null;
  }

  *refreshCopies() {
    for (const r of this.sortByTurn(this.onTrack().filter((o) => o.power === 'copycat'))) {
      const candidates = this.copyCandidates(r);
      const key = this.copyKey(candidates);
      let picked = candidates.length === 1 ? candidates[0].rid : r.copyChoices?.[key];
      if (candidates.length > 1 && !candidates.some((o) => o.rid === picked)) {
        picked = yield this.ask(r.seat, 'copycat', '模仿猫：并列领跑，复制谁的技能？', candidates.map((o) => ({
          v: o.rid, label: `${this.nm(o)} · ${BY_ID[o.power].skill}`,
        })));
        // 当前回合连锁中，同一批领跑者再次出现时沿用选择；下回合可重选。
        r.copyChoices ||= Object.create(null);
        r.copyChoices[key] = picked;
      }
      const eff = candidates.find((o) => o.rid === picked)?.power || null;
      if (r.copyEff !== eff) {
        r.copyEff = eff;
        this.emit({ t: 'copy', rid: r.rid, target: picked || null, power: eff,
          text: eff ? `${this.nm(r)} 复制了「${BY_ID[eff].skill}」` : `${this.nm(r)} 当前没有可复制的领跑技能` });
        // 先保存选择和有效技能，再处理同格排斥；嵌套刷新不会重复询问同一局面。
        if (eff === 'hugebaby') yield* this.shoveByBaby(r);
      }
    }
  }
  // 运动员当前生效的全部技能：主技能 + 蘑菇/冒牌货叠加的技能；被空指针屏蔽时只剩赛场外技能。
  powers(r) {
    if (!this.active(r)) return [];
    const main = this.power(r);
    const list = main ? [main] : [];
    if (r.stack) for (const k of r.stack) if (!list.includes(k)) list.push(k);
    if (this.edition !== 'v1' && this.nulled(r)) return list.filter((k) => OFF_TRACK.has(k));
    return list;
  }
  // 空指针：在它前面的运动员失去技能。空指针自己也可能被更后面的空指针屏蔽。
  nulled(r, depth = 0) {
    if (depth > 8) return false;
    for (const o of this.racers) {
      if (o === r || !this.active(o) || o.pos >= r.pos) continue;
      if ((o.power === 'nul' || (o.stack && o.stack.includes('nul'))) && !this.nulled(o, depth + 1)) return true;
    }
    return false;
  }
  has(r, key) { return this.powers(r).includes(key); }
  holders(key) { return this.sortByTurn(this.onTrack().filter((r) => this.has(r, key))); }
  twistOn(key) { return !!this.twistActive && this.twistActive.has(key); }
  // 后爸的「继子」：左手边（回合顺序下一位）玩家仍在场的运动员
  stepchild(sd) {
    for (let k = 1; k < this.n; k++) {
      const seat = (sd.seat + k) % this.n;
      const kid = this.seatRacers(seat).find((o) => this.active(o));
      if (kid) return kid;
    }
    return null;
  }
  loseChip(seat, v = 1) {
    const chips = this.players[seat].chips;
    let left = v;
    for (let guard = 0; guard < 20 && left > 0; guard++) {
      const i = chips.findIndex((c) => c.kind === 'bronze' && c.v > 0);
      const j = i >= 0 ? i : chips.reduce((best, c, k) => c.v > 0 && (best < 0 || c.v < chips[best].v) ? k : best, -1);
      if (j < 0) break;
      const [lost] = chips.splice(j, 1);
      if (lost.v > 1) chips.push({ ...lost, v: lost.v - 1 });
      left--;
    }
    return v - left;
  }
  rightOf(seat) { return (seat - 1 + this.n) % this.n; }

  score(seat) { return this.players[seat].chips.reduce((s, c) => s + c.v, 0); }
  giveChip(seat, kind, v, why) {
    this.players[seat].chips.push({ kind, v, race: this.raceNo });
    this.emit({ t: 'chip', seat, kind, v, text: `${this.players[seat].name} 获得${kind === 'gold' ? '金杯' : kind === 'silver' ? '银牌' : '铜牌'} ${v} 分${why ? `（${why}）` : ''}` });
  }

  /* ================= 主流程 ================= */
  *main() {
    yield* this.draft();
    for (let i = 0; i < 4; i++) {
      this.raceNo = i + 1;
      this.trackKey = this.schedule[i];
      yield* this.runRace(i);
    }
    this.phase = 'over';
    this.curSeat = null;
    const scores = this.players.map((p) => ({ seat: p.seat, score: this.score(p.seat) }));
    const top = Math.max(...scores.map((s) => s.score));
    this.champions = scores.filter((s) => s.score === top).map((s) => s.seat);
    this.emit({ t: 'gameOver', scores, champions: this.champions, text: `比赛结束！冠军：${this.champions.map((s) => this.players[s].name).join('、')}` });
  }

  rollOff(reason) {
    let cands = this.players.map((p) => p.seat);
    for (let guard = 0; guard < 20; guard++) {
      const rolls = cands.map((s) => ({ seat: s, v: this.d6() }));
      this.emit({ t: 'rollOff', reason, rolls });
      const m = Math.max(...rolls.map((r) => r.v));
      const top = rolls.filter((r) => r.v === m).map((r) => r.seat);
      if (top.length === 1) return top[0];
      cands = top;
    }
    return cands[0];
  }

  *draft() {
    this.phase = 'draft';
    const start = this.rollOff('draft');
    this.emit({ t: 'draftStart', seat: start, text: `${this.players[start].name} 掷骰最大，第一个选人` });
    for (let round = 0; round < 2; round++) {
      this.faceUp = this.deck.splice(0, this.n * 2);
      const first = (start + round) % this.n;
      const fwd = Array.from({ length: this.n }, (_, k) => (first + k) % this.n);
      const order = fwd.concat(fwd.slice().reverse());
      this.emit({ t: 'faceUp', cards: this.faceUp.slice(), round, order });
      this.draftOrder = order;
      this.draftRound = round;
      for (let k = 0; k < order.length; k++) {
        const seat = order[k];
        this.draftIdx = k;
        this.curSeat = seat;
        const v = yield this.ask(seat, 'draft', '选一名运动员加入你的队伍', this.faceUp.map((id) => ({ v: id, label: BY_ID[id].name })), { pickNo: round * this.n * 2 + k + 1 });
        this.faceUp = this.faceUp.filter((id) => id !== v);
        this.players[seat].hand.push(v);
        this.emit({ t: 'drafted', seat, rid: v, text: `${this.players[seat].name} 选了 ${BY_ID[v].name}` });
      }
    }
    this.faceUp = [];
    this.firstSeat = this.rollOff('race');
    this.emit({ t: 'firstPlayer', seat: this.firstSeat, text: `${this.players[this.firstSeat].name} 掷骰最大，第一场先手` });
  }

  *runRace(idx) {
    this.phase = 'pick';
    this.curSeat = null;
    this.racers = [];
    const seats = this.players.map((p) => p.seat);
    const optionsBySeat = {};
    for (const s of seats) {
      optionsBySeat[s] = this.players[s].hand.filter((id) => !this.players[s].used.includes(id)).map((id) => ({ v: id, label: BY_ID[id].name }));
    }
    this.emit({ t: 'raceIntro', race: this.raceNo, track: this.trackKey, gold: GOLD[idx], silver: SILVER[idx], text: `第 ${this.raceNo} 场 · ${this.track.name}（金 ${GOLD[idx]} 分 / 银 ${SILVER[idx]} 分）` });
    const picks = yield { simul: true, kind: 'pickRacer', title: `第 ${this.raceNo} 场派谁上场？`, seats, optionsBySeat };
    this.phase = 'race';
    this.finishCount = 0;
    this.outOrder = [];
    this.turns = 0;
    this.raceEndReason = 'finished';
    this.resetRaceState();
    for (const s of seats) {
      const rid = picks[s];
      this.players[s].used.push(rid);
      this.racers.push({ rid, seat: s, pos: 0, power: rid, tripped: false, finished: 0, out: false });
    }
    // 额外运动员（返场王、时间小鬼）：跟随本场主运动员一起上场
    const extras = [];
    for (const s of seats) {
      const p = this.players[s];
      for (const ex of p.extras) {
        if (this.racers.some((o) => o.rid === ex.rid)) continue;
        this.racers.push({ rid: ex.rid, seat: s, pos: 0, power: ex.power || ex.rid, tripped: false, finished: 0, out: false, extra: true });
        extras.push({ seat: s, rid: ex.rid });
      }
      p.extras = p.extras.filter((ex) => ex.keep);
    }
    this.emit({ t: 'reveal', picks: seats.map((s) => ({ seat: s, rid: picks[s] })), ...(extras.length ? { extras } : {}),
      text: `上场：${seats.map((s) => `${this.players[s].name}·${BY_ID[picks[s]].name}`).join('，')}${extras.length ? `；额外运动员：${extras.map((x) => `${this.players[x.seat].name}·${BY_ID[x.rid].name}`).join('，')}` : ''}` });

    this.skipperNext = null;
    this.extraTurn = false;
    this.resetTurnCounters();
    try {
      yield* this.beforeRace();
      yield* this.raceLoop(this.firstSeat);
    } catch (e) {
      if (!(e instanceof RaceEnd)) throw e;
    }
    // 季终决战：前两名回到第二个弯道单挑，原第一名先走
    if (this.finale === 'armed') {
      const first = this.startFinale();
      if (first != null) {
        try {
          yield* this.raceLoop(first);
        } catch (e) {
          if (!(e instanceof RaceEnd)) throw e;
        }
      }
    }
    // 比赛在技能链或回合上限处结束时，不能把旧场的下一回合带入下一场。
    this.extraTurn = false;
    this.skipperNext = null;
    this.afterRace(idx);
  }

  // 每场重置的二代状态；一代对局中这些字段保持空值，不参与任何结算。
  resetRaceState() {
    this.doppelDone = false;
    this.twistDone = false;
    this.twistActive = null;
    this.twistDrawn = [];
    this.coins = null;
    this.monster = null;
    this.fixedRoll = null;
    this.mirrored = false;
    this.finale = null;
    this.finaleHeld = [];
  }

  // 额外回合也是完整的新回合，必须经过同一调度循环与全部安全检查。
  *raceLoop(startSeat) {
    let seat = startSeat;
    let extraFor = null;
    for (let guard = 0; guard < 400; guard++) {
      const list = extraFor ? [extraFor] : this.seatRacers(seat);
      const isExtra = !!extraFor;
      extraFor = null;
      for (const r of list) {
        this.extraTurn = false;
        if (this.active(r)) {
          if (isExtra) this.emit({ t: 'extraTurn', rid: r.rid, text: `${this.nm(r)} 再来一回合！` });
          yield* this.takeTurn(r);
        }
        this.checkEnd();
        if (this.turns >= MAX_TURNS) {
          this.raceEndReason = 'turn-limit';
          this.emit({ t: 'info', text: '本场达到回合上限，保留已获得分数并进入结算' });
          throw new RaceEnd();
        }
        if (this.extraTurn && this.active(r) && !extraFor) extraFor = r;
        this.extraTurn = false;
      }
      // 炼金实验室：每个玩家回合结束后狼人怪前进
      if (this.monster != null) { yield* this.moveMonster(); this.checkEnd(); }
      // 规则书 Genius 注释：猜中1时，后触发的 Skipper 抢走下一回合。
      if (this.skipperNext != null) { seat = this.skipperNext; this.skipperNext = null; extraFor = null; }
      else if (extraFor) { /* 同一名运动员再来一回合 */ }
      else if (this.twistOn('cursewands')) seat = yield* this.curseNext(seat);
      else seat = (seat + 1) % this.n;
    }
    this.raceEndReason = 'loop-limit';
    this.emit({ t: 'info', text: '本场达到循环保护上限，保留已获得分数并进入结算' });
    throw new RaceEnd();
  }

  // 诅咒魔杖：每个玩家回合结束掷骰，跳过这么多名玩家（已完赛/淘汰的玩家也计数）
  *curseNext(seat) {
    const r = this.racerOfSeat(seat);
    const v = r && this.active(r) ? yield* this.rollFor(r) : this.fixedFor(seat) ?? this.d6();
    const next = (seat + 1 + v) % this.n;
    this.emit({ t: 'curse', seat, value: v, next, text: `诅咒魔杖：${this.players[seat].name} 掷出 ${v}，跳过 ${v} 名玩家，下一位是 ${this.players[next].name}` });
    return next;
  }

  *moveMonster() {
    const from = this.monster;
    const v = this.d6();
    const to = Math.min(FINISH, from + v);
    this.monster = to;
    this.emit({ t: 'monster', from, to, value: v, text: `狼人怪掷出 ${v}，从第 ${from} 格冲到第 ${to} 格` });
    const victims = this.sortByTurn(this.onTrack().filter((o) => o.pos > from && o.pos < to));
    for (const o of victims) yield* this.eliminate(o, null, 'monster');
    if (to >= FINISH) {
      this.monster = null;
      this.emit({ t: 'info', text: '狼人怪冲出了终点，扬长而去' });
    }
  }

  placesNeeded() { return this.finale === 'running' ? 1 : 2; }

  startFinale() {
    const placed = this.racers.filter((r) => r.finished === 1 || r.finished === 2).sort((a, b) => a.finished - b.finished);
    const held = this.finaleHeld;
    this.finaleHeld = [];
    if (placed.length < 2 || this.raceEndReason !== 'finished') {
      // 没凑齐两名冲线者：暂扣的名次分照常发放
      this.finale = null;
      const idx = this.raceNo - 1;
      held.forEach((r, i) => this.giveChip(r.seat, i === 0 ? 'gold' : 'silver', i === 0 ? GOLD[idx] : SILVER[idx], `第 ${this.raceNo} 场第 ${i + 1} 名`));
      return null;
    }
    this.finale = 'running';
    this.finishCount = 0;
    const pos = this.track.secondCorner;
    for (const r of this.racers) {
      if (placed.includes(r)) { r.finished = 0; r.pos = pos; r.tripped = false; r.out = false; }
      else if (!r.out && !r.finished) { r.out = true; r.benched = true; }
    }
    this.emit({ t: 'finale', rids: placed.map((r) => r.rid), pos, text: `季终决战！${placed.map((r) => this.nm(r)).join(' 和 ')} 回到第 ${pos} 格单挑，胜者通吃本场金银分` });
    return placed[0].seat;
  }

  checkEnd() {
    if (this.finishCount >= this.placesNeeded() || this.onTrack().length === 0) throw new RaceEnd();
  }

  *beforeRace() {
    this.curSeat = this.firstSeat;
    for (const r of this.sortByTurn(this.racers)) yield* this.applyBeforeRace(r, r.power, 0);
    yield* this.refreshCopies();
  }

  // Egg / Twin 拿到的技能若也是「赛前」技能，同样生效
  *applyBeforeRace(r, key, depth) {
    if (depth > 3) return;
    if (key === 'sisyphus') {
      for (let i = 0; i < 4; i++) this.players[r.seat].chips.push({ kind: 'bronze', v: 1, race: this.raceNo, sis: true });
      this.emit({ t: 'chip', seat: r.seat, kind: 'bronze', v: 4, text: `${this.nm(r)} 赛前拿到 4 分` });
      yield* this.pw(r, 'sisyphus');
    } else if (key === 'egg') {
      const draw = this.deck.splice(0, 3);
      if (!draw.length) return;
      const v = yield this.ask(r.seat, 'egg', '神秘蛋：从 3 名运动员中挑一个技能', draw.map((id) => ({ v: id, label: BY_ID[id].name })));
      this.deck.push(...draw.filter((id) => id !== v));
      r.power = v;
      r.via = v;
      this.emit({ t: 'transform', rid: r.rid, power: v, text: `${this.nm(r)} 孵出了 ${BY_ID[v].name} 的技能「${BY_ID[v].skill}」` });
      yield* this.pw(r, 'egg');
      yield* this.applyBeforeRace(r, v, depth + 1);
    } else if (key === 'hogknight') {
      r.hogs = (r.hogs || 0) + 1;
      this.emit({ t: 'hog', to: r.rid, n: 1, text: `${this.nm(r)} 骑上了一头野猪` });
      yield* this.pw(r, 'hogknight');
    } else if (key === 'nepobaby') {
      // 直接摆到第一个弯道：不算移动也不算瞬移，不触发停格（暂定）
      const from = r.pos;
      r.pos = this.track.firstCorner;
      this.emit({ t: 'warp', rid: r.rid, from, to: r.pos, place: true, text: `${this.nm(r)} 赢在起跑线，直接从第 ${r.pos} 格出发` });
      yield* this.pw(r, 'nepobaby');
    } else if (key === 'soulmate') {
      const cands = this.racers.filter((o) => o !== r && o.seat !== r.seat);
      const pool = cands.length ? cands : this.racers.filter((o) => o !== r);
      if (!pool.length) return;
      const v = yield this.ask(r.seat, 'soulmate', '灵魂伴侣：赛前选一名运动员当你的灵魂伴侣', pool.map((o) => ({ v: o.rid, label: `${this.nm(o)}` })), { rid: r.rid });
      const mate = this.byRid(v);
      if (!mate) return;
      r.mate = mate.rid;
      this.emit({ t: 'mate', rid: r.rid, target: mate.rid, text: `${this.nm(r)} 认定 ${this.nm(mate)} 是灵魂伴侣` });
      yield* this.pw(r, 'soulmate', 1, [mate]);
    } else if (key === 'understudy') {
      const cands = this.racers.filter((o) => o !== r && o.seat !== r.seat && o.power !== 'understudy' && !OFF_TRACK.has(o.power));
      if (!cands.length) {
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 没有可以学的对手技能` });
        return;
      }
      const v = yield this.ask(r.seat, 'understudy', '替补演员：本场学谁的技能？', cands.map((o) => ({ v: o.rid, label: `${this.nm(o)} · ${BY_ID[o.power].skill}` })), { rid: r.rid });
      const o = this.byRid(v);
      if (!o) return;
      const k = o.power;
      r.power = k;
      r.via = k;
      this.emit({ t: 'transform', rid: r.rid, power: k, text: `${this.nm(r)} 现学现卖，获得「${BY_ID[k].skill}」` });
      yield* this.pw(r, 'understudy', 1, [o]);
      yield* this.applyBeforeRace(r, k, depth + 1);
    } else if (key === 'twin') {
      const opts = [...new Set(this.winners)].filter((id) => id !== 'twin');
      if (!opts.length) {
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 还没有往届冠军可以复制` });
        return;
      }
      const v = yield this.ask(r.seat, 'twin', '双胞胎：复制哪位往届冠军的技能？', opts.map((id) => ({ v: id, label: BY_ID[id].name })).concat([{ v: '_skip', label: '不复制' }]));
      if (v === '_skip') return;
      r.power = v;
      r.via = v;
      this.emit({ t: 'transform', rid: r.rid, power: v, text: `${this.nm(r)} 化身 ${BY_ID[v].name}，获得「${BY_ID[v].skill}」` });
      yield* this.pw(r, 'twin');
      yield* this.applyBeforeRace(r, v, depth + 1);
    }
  }

  afterRace(idx) {
    this.phase = 'between';
    // 树懒：本场结束时还没过第二个弯道（停在弯道上也算）拿 3 分
    for (const r of this.sortByTurn(this.racers)) {
      if (r.out || r.finished || r.pos > this.track.secondCorner || !this.has(r, 'gloth')) continue;
      this.emit({ t: 'power', rid: r.rid, key: 'gloth' });
      this.giveChip(r.seat, 'bronze', 3, '树懒慢慢来');
    }
    // 返场王（原卡，赛场外技能）：之后每场都作为额外运动员跟着控制它的玩家上场
    for (const r of this.racers) {
      if (r.rid !== 'rerunner' || this.raceNo >= 4) continue;
      for (const p of this.players) p.extras = p.extras.filter((ex) => ex.rid !== r.rid);
      this.players[r.seat].extras.push({ rid: r.rid, power: 'rerunner', keep: true });
      this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 会作为额外运动员参加之后的每一场` });
    }
    const placed = this.racers.filter((r) => r.finished).sort((a, b) => a.finished - b.finished);
    const first = placed.find((r) => r.finished === 1);
    if (first) this.winners.push(first.rid);
    // 下一场先手：落后最多（或最先被淘汰）的运动员
    let next;
    if (this.outOrder.length) next = this.outOrder[0];
    else {
      const rest = this.racers.filter((r) => !r.finished && !r.benched);
      if (rest.length) {
        const m = Math.min(...rest.map((r) => r.pos));
        next = this.sortByTurn(rest.filter((r) => r.pos === m))[0];
      } else next = placed[placed.length - 1];
    }
    if (next) this.firstSeat = next.seat;
    const res = {
      race: this.raceNo, track: this.trackKey, turns: this.turns, reason: this.raceEndReason,
      standings: this.racers.map((r) => ({ seat: r.seat, rid: r.rid, pos: r.pos, finished: r.finished, out: r.out, bonus: r.bonusSecond || false, ...(r.extra ? { extra: true } : {}), ...(r.benched ? { benched: true } : {}) })),
      scores: this.players.map((p) => this.score(p.seat)),
    };
    this.results.push(res);
    this.emit({ t: 'raceEnd', ...res, nextFirst: this.firstSeat, text: `第 ${this.raceNo} 场结束` });
    this.curSeat = null;
  }

  /* ================= 技能生效 & 蹭蹭狗 ================= */
  // targets 只给前端画「谁影响了谁」，不参与结算
  *pw(r, key, times = 1, targets) {
    yield* this.refreshCopies();
    for (let i = 0; i < times; i++) {
      const k = `${r.rid}:${key}`;
      const c = (this.pwCount.get(k) || 0) + 1;
      this.pwCount.set(k, c);
      // 规则 8：同一技能在完全相同的局面下再次触发 = 进入无限循环，走完一遍就停
      const sig = `${k}|${this.stateSig()}`;
      const looped = this.pwSeen.has(sig);
      this.pwSeen.add(sig);
      if (c > PW_PER_TURN || ++this.pwTotal > PW_BUDGET) return;
      this.emit({ t: 'power', rid: r.rid, key, ...(targets && targets.length ? { targets: targets.map((o) => o.rid) } : {}) });
      const scoochers = this.holders('scoocher').filter((s) => s !== r);
      if (looped && scoochers.length) {
        if (!this.loopNoted) { this.loopNoted = true; this.emit({ t: 'info', text: '触发了无限循环，按规则走完一遍就停' }); }
        return;
      }
      // 其他运动员的技能每生效一次，蹭蹭狗前进 1
      for (const s of scoochers) {
        if (s === r) continue;
        this.emit({ t: 'info', rid: s.rid, text: `${this.nm(s)} 蹭了一格` });
        yield* this.move(s, 1, 'power');
        yield* this.pw(s, 'scoocher');
      }
    }
  }

  /* ================= 状态变化 ================= */
  trip(r, why) {
    if (!this.active(r)) return;
    r.tripped = true;
    this.emit({ t: 'trip', rid: r.rid, text: `${this.nm(r)} 被绊倒了${why ? `（${why}）` : ''}，下回合跳过主移动` });
  }

  // cause 缺省为大嘴怪吞人（一代原有文案）；二代的其他淘汰原因单独说明
  *eliminate(r, by, cause) {
    if (!this.active(r)) return;
    r.out = true;
    this.outOrder.push(r);
    if (!cause) this.emit({ t: 'out', rid: r.rid, by: by?.rid, text: `${this.nm(r)} 被${by ? this.nm(by) : ''}一口吞掉，淘汰出本场！` });
    else this.emit({ t: 'out', rid: r.rid, by: by?.rid, cause, text: `${this.nm(r)} ${OUT_TEXT[cause] || '被淘汰'}${by ? `（${this.nm(by)}）` : ''}，淘汰出本场！` });
    this.checkEnd();
  }

  // 名次分：季终决战待定时先暂扣，决赛胜者通吃金银
  awardPlace(r, place, why) {
    const idx = this.raceNo - 1;
    if (this.finale === 'armed') {
      this.finaleHeld.push(r);
      this.emit({ t: 'info', rid: r.rid, text: `季终决战：${this.nm(r)} 的名次分留到决赛再算` });
      return;
    }
    if (this.finale === 'running') {
      this.giveChip(r.seat, 'gold', GOLD[idx] + SILVER[idx], '季终决战冠军，通吃金银');
      return;
    }
    this.giveChip(r.seat, place === 1 ? 'gold' : 'silver', place === 1 ? GOLD[idx] : SILVER[idx], why);
  }

  finish(r) {
    if (r.finished) return;
    // 冒牌货：本场第一个冲到终点的运动员改为淘汰，冒牌货获得它的技能（自己先到也淘汰）
    if (this.finishCount === 0 && !this.doppelDone && this.finale !== 'running') {
      const dps = this.holders('doppel');
      if (dps.length) {
        this.doppelDone = true;
        const gained = this.powers(r).filter((k) => !OFF_TRACK.has(k) && k !== 'doppel');
        r.out = true;
        this.outOrder.push(r);
        this.emit({ t: 'out', rid: r.rid, by: dps[0].rid, cause: 'doppel', text: `${this.nm(r)} ${OUT_TEXT.doppel}，淘汰出本场！` });
        for (const d of dps) {
          if (d === r) continue;
          d.stack ||= [];
          for (const k of gained) if (!d.stack.includes(k) && d.power !== k) d.stack.push(k);
          this.emit({ t: 'power', rid: d.rid, key: 'doppel', targets: [r.rid] });
          if (gained.length) this.emit({ t: 'stack', rid: d.rid, powers: gained, text: `${this.nm(d)} 顶包成功，获得「${gained.map((k) => BY_ID[k].skill).join('」「')}」` });
        }
        this.checkEnd();
        return;
      }
    }
    // 主谋预言检查（在冲线者技能失效前完成）
    let mmEnd = null;
    if (this.finishCount === 0 && this.finale !== 'running') {
      for (const m of this.onTrack()) {
        if (this.has(m, 'mastermind') && m.mmPredict === r.rid) { mmEnd = m; break; }
      }
    }
    // 后爸：继子拿第一时后爸拿 3 分（在冲线者离场前判定继子）
    const dads = this.finishCount === 0 && this.finale !== 'running' && this.edition !== 'v1'
      ? this.holders('stepdad').filter((sd) => sd !== r && this.stepchild(sd) === r) : [];
    const place = ++this.finishCount;
    r.finished = place;
    const idx = this.raceNo - 1;
    this.emit({ t: 'finish', rid: r.rid, place, text: `${this.nm(r)} 冲线，第 ${place} 名！` });
    this.awardPlace(r, place, `第 ${this.raceNo} 场第 ${place} 名`);
    for (const sd of dads) {
      this.emit({ t: 'power', rid: sd.rid, key: 'stepdad', targets: [r.rid] });
      this.giveChip(sd.seat, 'bronze', 3, '后爸：继子夺冠');
    }
    if (mmEnd) {
      this.emit({ t: 'power', rid: mmEnd.rid, key: 'mastermind' });
      this.finishCount = 2;
      if (mmEnd === r) {
        r.bonusSecond = true;
        this.emit({ t: 'finish', rid: r.rid, place: 2, text: `${this.nm(r)} 预言了自己夺冠，第 2 名也归他！` });
      } else {
        mmEnd.finished = 2;
        this.emit({ t: 'finish', rid: mmEnd.rid, place: 2, text: `${this.nm(mmEnd)} 预言成真，比赛立刻结束，拿下第 2 名！` });
      }
      if (this.finale === 'armed') this.finaleHeld.push(mmEnd);
      else this.giveChip(mmEnd.seat, 'silver', SILVER[idx], '主谋预言成真');
    }
    if (this.finishCount >= this.placesNeeded()) throw new RaceEnd();
  }

  // 巨婴：落点不能和巨婴同格（起点除外），改放到巨婴身后一格
  babyAdjust(r, pos) {
    for (let g = 0; g < 6; g++) {
      if (pos <= 0 || pos >= FINISH) return pos;
      const baby = this.holders('hugebaby').find((b) => b !== r && b.pos === pos);
      if (!baby) return pos;
      pos = pos - 1;
      this.babyPushed = baby;
    }
    return pos;
  }

  // 普通巨婴停格和模仿猫切换技能共用；挤人不算移动，但校正后必须结算停格。
  *shoveByBaby(r) {
    if (!this.active(r) || !this.has(r, 'hugebaby') || r.pos <= 0 || r.pos >= FINISH) return;
    const from = r.pos;
    const shoved = [];
    for (const o of this.sortByTurn(this.at(from, r))) {
      this.babyPushed = null;
      const to = this.babyAdjust(o, from - 1);
      const baby = this.babyPushed;
      o.pos = to;
      this.emit({ t: 'warp', rid: o.rid, from, to, text: `${this.nm(o)} 被${this.nm(r)}挤到后面` });
      shoved.push({ racer: o, to, baby });
    }
    if (!shoved.length) return;
    yield* this.pw(r, 'hugebaby', 1, shoved.map((x) => x.racer));
    for (const { racer: o, to, baby } of shoved) {
      if (baby) yield* this.pw(baby, 'hugebaby');
      if (this.active(o) && o.pos === to) yield* this.afterStop(o, from, to, { passed: [], moved: false, sharedBefore: [] });
    }
  }

  /* ================= 移动 ================= */
  // kind: main | power | arrow | twist；opts.tripPassed：魔法健将掷 6 时绊倒被超过的人
  *move(r, amount, kind = 'power', opts = {}) {
    if (!this.active(r) || !amount) return;
    yield* this.refreshCopies();
    // 兜底：同一回合里，同一运动员在完全相同的局面下反复做同样的移动 = 无限循环。
    // 例：狂野荒原 24 号箭头（后退 2）+ 浪漫鳄的「啊，爱情！」会在 22↔24 之间往返，先移动后计数的技能
    // 绕过了 PW_PER_TURN，只剩深度上限，分支会指数爆炸。同一签名超过 PW_PER_TURN 次就停。
    const sig = `${r.rid}|${amount}|${kind}|${this.stateSig()}`;
    const seen = (this.moveSeen.get(sig) || 0) + 1;
    this.moveSeen.set(sig, seen);
    if (seen > PW_PER_TURN) {
      if (!this.loopNoted) { this.loopNoted = true; this.emit({ t: 'info', text: '触发了无限循环，按规则走完一遍就停' }); }
      return;
    }
    if (++this.depth > 60) { this.depth--; return; }
    try {
      const from = r.pos;
      const dir = Math.sign(amount);
      let steps = Math.abs(amount);
      let pos = from;
      const path = [];
      const leap = this.has(r, 'leaptoad');
      let skipped = 0;
      while (steps > 0) {
        pos += dir;
        if (pos <= 0) { pos = 0; path.push(0); steps = 0; break; }
        if (pos >= FINISH) { pos = FINISH; path.push(FINISH); steps--; break; }
        path.push(pos);
        if (leap && this.at(pos, r).length) { skipped++; continue; }
        steps--;
      }
      // 较真怪：冲线必须步数正好
      if (pos === FINISH && steps > 0) {
        const st = this.holders('stickler').find((s) => s !== r);
        if (st) {
          this.emit({ t: 'blocked', rid: r.rid, by: st.rid, text: `${this.nm(st)}：「其实吧……步数不对，不能冲线。」${this.nm(r)} 原地不动` });
          yield* this.pw(st, 'stickler', 1, [r]);
          return;
        }
      }
      if (pos === from) return; // 移动 0 不算移动
      this.babyPushed = null;
      const final = this.babyAdjust(r, pos);
      const baby = this.babyPushed;
      if (final === from) {
        this.emit({ t: 'blocked', rid: r.rid, text: `${this.nm(r)} 被巨婴挡住，原地不动` });
        if (baby) yield* this.pw(baby, 'hugebaby', 1, [r]);
        return;
      }
      if (final !== pos) {
        while (path.length && path[path.length - 1] !== final && (dir > 0 ? path[path.length - 1] > final : path[path.length - 1] < final)) path.pop();
        if (path[path.length - 1] !== final) path.push(final);
      }
      const passed = dir > 0 ? this.others(r).filter((o) => o.pos > from && o.pos < final) : [];
      const sharedBefore = this.at(from, r);
      r.pos = final;
      this.emit({ t: 'move', rid: r.rid, from, to: final, path, kind });
      // 扭扭糖果：本场第一个移动到/经过变数招牌（第 14 格）的运动员抽一张变数卡（暂定，瞬移不算）
      const tw = this.track.twistAt;
      const twistHit = !!tw && this.twistDeck && !this.twistDone && from < tw && final >= tw;
      if (twistHit) this.twistDone = true;
      if (final === FINISH) {
        this.finish(r);
        if (skipped) yield* this.pw(r, 'leaptoad', skipped);
        yield* this.afterFinishMove(r, from, sharedBefore);
        if (twistHit) yield* this.drawTwist(r);
        return;
      }
      if (skipped) yield* this.pw(r, 'leaptoad', skipped);
      if (baby) {
        this.emit({ t: 'info', rid: baby.rid, text: `${this.nm(baby)} 太大了，${this.nm(r)} 只能停在它身后` });
        yield* this.pw(baby, 'hugebaby', 1, [r]);
      }
      yield* this.afterStop(r, from, final, { passed, moved: true, sharedBefore, tripPassed: !!opts.tripPassed });
      if (twistHit) yield* this.drawTwist(r);
    } finally {
      this.depth--;
    }
  }

  // 冲线也算一次移动：同格的吸盘鱼可以跟着冲线
  *afterFinishMove(r, from, sharedBefore) {
    yield* this.refreshCopies();
    for (const sf of this.holders('suckerfish')) {
      if (sf === r || !sharedBefore.includes(sf) || sf.pos !== from) continue;
      const ok = yield this.ask(sf.seat, 'suckerfish', `吸盘鱼：跟着 ${this.nm(r)} 一起冲线？`, [{ v: 'yes', label: '黏上去！' }, { v: 'no', label: '算了' }]);
      if (ok !== 'yes' || !this.active(sf)) continue;
      yield* this.move(sf, FINISH - sf.pos, 'power');
      yield* this.pw(sf, 'suckerfish');
    }
  }

  *warp(r, to, why, opts = {}) {
    if (!this.active(r) || r.pos === to) return;
    const from = r.pos;
    if (to >= FINISH) {
      r.pos = FINISH;
      this.emit({ t: 'warp', rid: r.rid, from, to: FINISH, text: why ? `${this.nm(r)} ${why}` : undefined });
      this.finish(r);
      return;
    }
    if (to < 0) to = 0;
    this.babyPushed = null;
    const final = this.babyAdjust(r, to);
    const baby = this.babyPushed;
    r.pos = final;
    this.emit({ t: 'warp', rid: r.rid, from, to: final, text: why ? `${this.nm(r)} ${why}` : undefined });
    if (baby) yield* this.pw(baby, 'hugebaby', 1, [r]);
    if (final !== from) yield* this.afterStop(r, from, final, { passed: [], moved: false, sharedBefore: [], viaWhirl: !!opts.viaWhirl });
  }

  // 同时瞬移（大海怪、镜像世界、传送带、魔法健将）：不结算停格与同格技能（暂定），冲线者按回合顺序计名次
  *warpAll(list, why) {
    const finishers = [];
    for (const [o, to0] of list) {
      if (!this.active(o)) continue;
      const to = Math.max(0, Math.min(FINISH, to0));
      if (to === o.pos) continue;
      const from = o.pos;
      o.pos = to;
      this.emit({ t: 'warp', rid: o.rid, from, to, mass: true, text: why ? `${this.nm(o)} ${why}` : undefined });
      if (to >= FINISH) finishers.push(o);
    }
    for (const o of this.sortByTurn(finishers)) this.finish(o);
    yield* this.refreshCopies();
  }

  // 停在某格之后的连锁：赛道格 → 当前玩家 → 其他玩家（顺时针）
  *afterStop(r, from, final, { passed, moved, sharedBefore, tripPassed = false, viaWhirl = false }) {
    if (!this.active(r)) return;
    yield* this.refreshCopies();
    // 前置连锁可能改变落点；只跳过位置相关触发，原移动的超车/同格历史仍须结算。
    // 巨婴落到有人的格子：把他们挤到身后一格（不算移动，视为停在那里）
    if (r.pos === final) yield* this.shoveByBaby(r);
    const trig = [];
    const add = (order, fn) => trig.push({ order, fn });
    const sp = this.track.spaces[final];

    if (sp && final > 0 && final < FINISH) {
      add(-1, function* () {
        if (r.pos !== final || !this.active(r)) return;
        if (sp.type === 'arrow') {
          this.emit({ t: 'space', rid: r.rid, pos: final, space: 'arrow', text: `${this.nm(r)} 踩到箭头，${sp.n > 0 ? '前进' : '后退'} ${Math.abs(sp.n)} 格` });
          yield* this.move(r, sp.n, 'arrow');
        } else if (sp.type === 'rock') {
          this.emit({ t: 'space', rid: r.rid, pos: final, space: 'rock' });
          this.trip(r, '踩到石头');
        } else if (sp.type === 'star') {
          this.emit({ t: 'space', rid: r.rid, pos: final, space: 'star' });
          this.giveChip(r.seat, 'bronze', 1, '踩到星星');
        } else if (sp.type === 'whirl' && !viaWhirl) {
          // 漩涡：传送到配对的另一端；传送不算移动，到达另一端不会再被吸回来
          this.emit({ t: 'space', rid: r.rid, pos: final, space: 'whirl', to: sp.to, text: `${this.nm(r)} 掉进漩涡，从第 ${sp.to} 格冒出来` });
          yield* this.warp(r, sp.to, null, { viaWhirl: true });
        }
      });
    }
    // 撞头虫：停在终点前最后两格后退 5
    if (this.twistOn('bonkbug') && final >= FINISH - 2 && final < FINISH) {
      add(-1, function* () {
        if (r.pos !== final || !this.active(r)) return;
        this.emit({ t: 'space', rid: r.rid, pos: final, space: 'bonkbug', text: `${this.nm(r)} 被撞头虫撞了一下，后退 5 格` });
        yield* this.move(r, -5, 'twist');
      });
    }
    // 皮纳塔：停在有分的格子上拿走 1 分
    if (this.coins && this.coins.includes(final)) {
      add(-1, function* () {
        if (r.pos !== final || !this.active(r) || !this.coins.includes(final)) return;
        this.coins = this.coins.filter((c) => c !== final);
        this.emit({ t: 'coin', rid: r.rid, pos: final });
        this.giveChip(r.seat, 'bronze', 1, '皮纳塔里掉出 1 分');
      });
    }
    // 野猪：停到骑猪者的格子，把野猪抢过来
    if (r.pos === final && this.edition !== 'v1') {
      const riders = this.at(final, r).filter((o) => o.hogs);
      if (riders.length) {
        add(-1, function* () {
          if (r.pos !== final || !this.active(r)) return;
          for (const o of riders) {
            if (!o.hogs || o.pos !== final) continue;
            const n = o.hogs;
            o.hogs = 0;
            r.hogs = (r.hogs || 0) + n;
            this.emit({ t: 'hog', from: o.rid, to: r.rid, n, text: `${this.nm(r)} 抢走了 ${this.nm(o)} 的野猪` });
          }
        });
      }
    }

    // 香蕉：超过我的人被绊倒
    for (const b of passed) {
      if (!this.has(b, 'banana')) continue;
      add(this.seatOrder(b.seat), function* () {
        if (!this.active(r) || !this.active(b)) return;
        this.trip(r, `超过了${this.nm(b)}`);
        yield* this.pw(b, 'banana', 1, [r]);
      });
    }
    // 半人马：被我超过的人后退 2
    if (moved && passed.length && this.has(r, 'centaur')) {
      add(this.seatOrder(r.seat), function* () {
        for (const o of this.sortByTurn(passed)) {
          if (!this.active(o) || !this.active(r)) continue;
          this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 一记后蹄踢飞 ${this.nm(o)}` });
          yield* this.move(o, -2, 'power');
          yield* this.pw(r, 'centaur', 1, [o]);
        }
      });
    }

    if (moved && passed.length && this.edition !== 'v1') {
      // 攀滚企鹅：被超过就摔倒
      for (const b of passed) {
        if (!this.has(b, 'penguin')) continue;
        add(this.seatOrder(b.seat), function* () {
          if (!this.active(b)) return;
          this.trip(b, `被${this.nm(r)}超过`);
          yield* this.pw(b, 'penguin');
        });
      }
      // 咬痕（已变身）：被超过的人淘汰
      if (r.wolf && this.has(r, 'bitemark')) {
        add(this.seatOrder(r.seat), function* () {
          for (const o of this.sortByTurn(passed)) {
            if (!this.active(o) || !this.active(r)) continue;
            yield* this.eliminate(o, r, 'bitemark');
            yield* this.pw(r, 'bitemark', 1, [o]);
          }
        });
      }
      // 魔法健将掷 6：绊倒被超过的人
      if (tripPassed) {
        add(this.seatOrder(r.seat), function* () {
          const hit = passed.filter((o) => this.active(o));
          for (const o of hit) this.trip(o, `被${this.nm(r)}超过`);
          if (hit.length) yield* this.pw(r, 'magicalathlete', 1, hit);
        });
      }
      // 裸奔侠：这次移动超过了人就拿 1 分
      if (this.has(r, 'streaker')) {
        add(this.seatOrder(r.seat), function* () {
          if (!this.active(r)) return;
          this.giveChip(r.seat, 'bronze', 1, '裸奔侠一闪而过');
          yield* this.pw(r, 'streaker', 1, passed);
        });
      }
    }

    const here = r.pos === final ? this.at(final, r) : [];
    // 小旅馆：停到旅馆的格子要付 1 分，付不出被绊倒
    for (const h of here) {
      if (h.seat === r.seat || !this.has(h, 'hotel')) continue;
      add(this.seatOrder(h.seat), function* () {
        if (r.pos !== final || h.pos !== final || !this.active(r) || !this.active(h)) return;
        if (this.score(r.seat) > 0) {
          this.loseChip(r.seat, 1);
          this.emit({ t: 'chip', seat: r.seat, kind: 'lose', v: -1, text: `${this.nm(r)} 住进${this.nm(h)}，付房费 1 分` });
          this.giveChip(h.seat, 'bronze', 1, '收到房费');
        } else this.trip(r, `付不起${this.nm(h)}的房费`);
        yield* this.pw(h, 'hotel', 1, [r]);
      });
    }
    // 芭芭雅嘎
    if (this.has(r, 'babayaga') && here.length) {
      add(this.seatOrder(r.seat), function* () {
        const hit = this.at(final, r);
        if (r.pos !== final || !hit.length) return;
        for (const o of hit) this.trip(o, `和${this.nm(r)}同格`);
        yield* this.pw(r, 'babayaga', 1, hit);
      });
    }
    for (const by of here) {
      if (!this.has(by, 'babayaga')) continue;
      add(this.seatOrder(by.seat), function* () {
        if (r.pos !== final || by.pos !== final || !this.active(by)) return;
        this.trip(r, `停到了${this.nm(by)}的格子`);
        yield* this.pw(by, 'babayaga', 1, [r]);
      });
    }
    // 大嘴怪
    if (this.has(r, 'mouth') && here.length === 1) {
      add(this.seatOrder(r.seat), function* () {
        const hit = this.at(final, r);
        if (r.pos !== final || hit.length !== 1 || !this.active(r)) return;
        yield* this.eliminate(hit[0], r);
        yield* this.pw(r, 'mouth', 1, [hit[0]]);
      });
    }
    // 浪漫鳄：恰好两人同格
    if (here.length === 1) {
      for (const ro of this.holders('romantic')) {
        add(this.seatOrder(ro.seat), function* () {
          if (!this.active(ro)) return;
          this.emit({ t: 'info', rid: ro.rid, text: `${this.nm(ro)}：啊，爱情！前进 2 格` });
          yield* this.move(ro, 2, 'power');
          yield* this.pw(ro, 'romantic');
        });
      }
    }
    // 决斗家
    if (here.length) {
      if (this.has(r, 'duelist')) {
        add(this.seatOrder(r.seat), function* () { yield* this.duelOffer(r, final); });
      }
      for (const d of here) {
        if (!this.has(d, 'duelist')) continue;
        add(this.seatOrder(d.seat), function* () { yield* this.duelOffer(d, final, r); });
      }
    }
    // 吸盘鱼：同格的人移动了，可以跟过去
    if (moved) {
      for (const sf of sharedBefore) {
        if (!this.has(sf, 'suckerfish')) continue;
        add(this.seatOrder(sf.seat), function* () {
          if (!this.active(sf) || sf.pos !== from || !this.active(r) || r.pos === sf.pos) return;
          const ok = yield this.ask(sf.seat, 'suckerfish', `吸盘鱼：跟着 ${this.nm(r)} 移动到第 ${r.pos} 格？`, [{ v: 'yes', label: '黏上去！' }, { v: 'no', label: '算了' }], { target: r.pos });
          if (ok !== 'yes' || !this.active(sf) || !this.active(r)) return;
          yield* this.move(sf, r.pos - sf.pos, 'power');
          yield* this.pw(sf, 'suckerfish');
        });
      }
    }

    trig.sort((a, b) => a.order - b.order);
    for (const t of trig) yield* t.fn.call(this);
  }

  *duelOffer(d, pos, only) {
    if (!this.active(d) || d.pos !== pos) return;
    const foes = (only ? [only] : this.at(pos, d)).filter((o) => this.active(o) && o.pos === pos);
    if (!foes.length) return;
    const opts = foes.map((o) => ({ v: o.rid, label: `和${this.nm(o)}决斗` })).concat([{ v: '_no', label: '不决斗' }]);
    const v = yield this.ask(d.seat, 'duel', '决斗家：要喊「决斗！」吗？', opts);
    if (v === '_no') return;
    const o = this.byRid(v);
    if (!this.active(o) || o.pos !== d.pos) return;
    const a = yield* this.rollFor(d), b = yield* this.rollFor(o);
    const win = a >= b ? d : o;
    this.emit({ t: 'duel', a: d.rid, b: o.rid, ra: a, rb: b, win: win.rid, text: `决斗！${this.nm(d)} 掷 ${a}，${this.nm(o)} 掷 ${b}，${this.nm(win)} 胜出前进 2 格` });
    yield* this.move(win, 2, 'power');
    yield* this.pw(d, 'duelist');
  }

  /* ================= 回合 ================= */
  stateSig() { return this.racers.map((o) => `${o.pos}${o.tripped ? 't' : ''}${o.finished || o.out ? 'x' : ''}`).join(','); }

  resetTurnCounters() {
    this.pwCount = new Map();
    this.pwSeen = new Set();
    this.moveSeen = new Map();
    this.pwTotal = 0;
    this.depth = 0;
    this.loopNoted = false;
    // 缓存仅覆盖本回合技能连锁；清空后 power() 在新选择完成前返回 null。
    for (const r of this.racers) delete r.copyChoices;
  }

  *takeTurn(r) {
    this.curSeat = r.seat;
    this.turns++;
    this.resetTurnCounters();
    yield* this.refreshCopies();
    this.emit({ t: 'turn', seat: r.seat, rid: r.rid });
    const startPos = r.pos;
    let skipMain = false;
    let penguin = false;

    if (this.edition !== 'v1') {
      yield* this.turnStart(r);
      if (!this.active(r)) { this.emit({ t: 'turnEnd', seat: r.seat }); return; }
    }
    if (r.tripped) {
      if (this.edition !== 'v1' && this.has(r, 'penguin')) {
        // 攀滚企鹅：摔倒时照样掷骰且主移动翻倍，主移动之后才爬起来
        penguin = true;
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 趴在地上肚皮滑行，本回合主移动翻倍` });
      } else {
        r.tripped = false;
        skipMain = true;
        this.emit({ t: 'recover', rid: r.rid, text: `${this.nm(r)} 爬起来了，本回合不掷骰` });
      }
    }
    if (this.has(r, 'mastermind') && !r.mmDone) {
      r.mmDone = true;
      const opts = this.onTrack().map((o) => ({ v: o.rid, label: o === r ? '我自己' : this.nm(o) }));
      const v = yield this.ask(r.seat, 'mastermind', '主谋：预言谁会夺冠？', opts);
      r.mmPredict = v;
      this.emit({ t: 'predict', rid: r.rid, target: v, text: `${this.nm(r)} 预言：${v === r.rid ? '我自己' : this.nm(this.byRid(v))} 会夺冠` });
      yield* this.pw(r, 'mastermind');
    }
    if (!skipMain && this.active(r) && this.has(r, 'hare')) {
      const lead = this.leaders();
      if (lead.length === 1 && lead[0] === r && this.onTrack().length > 1) {
        skipMain = true;
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 独自领跑，骄傲地睡了一觉（跳过主移动）` });
        yield* this.pw(r, 'hare');
      }
    }
    if (!skipMain && this.active(r)) yield* this.mainMove(r, startPos, penguin);
    if (penguin && this.active(r) && r.tripped) {
      r.tripped = false;
      this.emit({ t: 'recover', rid: r.rid, penguin: true, text: `${this.nm(r)} 滑完爬起来了` });
    }

    // 起哄怪按回合实际位移触发：第一名技能失效不抹去本回合的移动事实。
    if (!r.out && this.finishCount < 2 && Math.abs(r.pos - startPos) <= 1) {
      for (const h of this.holders('heckler')) {
        if (!this.active(h)) continue;
        this.emit({ t: 'info', rid: h.rid, text: `${this.nm(h)}：哈哈哈，原地踏步！前进 2 格` });
        yield* this.move(h, 2, 'power');
        yield* this.pw(h, 'heckler');
      }
    }
    if (this.edition !== 'v1' && this.active(r)) yield* this.turnEnd(r);
    this.emit({ t: 'turnEnd', seat: r.seat });
  }

  /* ---------- 二代：回合开始 ---------- */
  *turnStart(r) {
    const yn = (yes, no) => [{ v: 'yes', label: yes }, { v: 'no', label: no }];
    // 搅局鬼：其他人都领先我至少 5 格 → 取消本场，拿 3 分
    if (this.has(r, 'spoilsport')) {
      const others = this.others(r);
      if (others.length && others.every((o) => o.pos >= r.pos + 5)) {
        this.emit({ t: 'cancel', rid: r.rid, text: `${this.nm(r)}：不玩了！本场比赛取消` });
        this.giveChip(r.seat, 'bronze', 3, '搅局鬼取消比赛');
        yield* this.pw(r, 'spoilsport');
        this.raceEndReason = 'cancelled';
        throw new RaceEnd();
      }
    }
    // 飙车魔：领先所有人至少 4 格就冲出赛道
    if (this.active(r) && this.has(r, 'speeddemon')) {
      const others = this.others(r);
      if (others.length && others.every((o) => r.pos - o.pos >= 4)) {
        yield* this.pw(r, 'speeddemon');
        yield* this.eliminate(r, null, 'speeddemon');
        return;
      }
    }
    // 大明星：垫底就和领跑者换位，否则和最后一名换位（并列由自己挑）
    if (this.active(r) && this.has(r, 'diva')) {
      const isLast = this.lasts().includes(r);
      const pool = (isLast ? this.leaders() : this.lasts()).filter((o) => o !== r && o.pos !== r.pos);
      if (pool.length) {
        let o = pool[0];
        if (pool.length > 1) {
          const v = yield this.ask(r.seat, 'diva', `大明星：和哪位${isLast ? '领跑者' : '最后一名'}换位置？`, this.sortByTurn(pool).map((x) => ({ v: x.rid, label: `${this.nm(x)}（第 ${x.pos} 格）` })), { rid: r.rid });
          o = this.byRid(v) || o;
        }
        if (this.active(o) && this.active(r) && o.pos !== r.pos) {
          const a = r.pos, b = o.pos;
          r.pos = b; o.pos = a;
          this.emit({ t: 'swap', a: r.rid, b: o.rid, pa: b, pb: a, text: `${this.nm(r)}：C 位给我！和 ${this.nm(o)} 交换了位置` });
          yield* this.pw(r, 'diva', 1, [o]);
          yield* this.afterStop(r, a, b, { passed: [], moved: false, sharedBefore: [] });
          yield* this.afterStop(o, b, a, { passed: [], moved: false, sharedBefore: [] });
        }
      }
    }
    // 灵魂伴侣：相距 5 格以内就瞬移过去
    if (this.active(r) && this.has(r, 'soulmate') && r.mate) {
      const m = this.byRid(r.mate);
      if (this.active(m) && m.pos !== r.pos && Math.abs(m.pos - r.pos) <= 5) {
        yield* this.warp(r, m.pos, `飞奔到灵魂伴侣 ${this.nm(m)} 身边`);
        yield* this.pw(r, 'soulmate', 1, [m]);
      }
    }
    // 绊脚王：可以绊倒一名领跑者
    if (this.active(r) && this.has(r, 'kingtripper')) {
      const lead = this.leaders().filter((o) => o !== r && !o.tripped);
      if (lead.length) {
        const opts = this.sortByTurn(lead).map((o) => ({ v: o.rid, label: `绊倒${this.nm(o)}（第 ${o.pos} 格）` })).concat([{ v: '_no', label: '不绊' }]);
        const v = yield this.ask(r.seat, 'kingtripper', '绊脚王：要绊倒领跑者吗？', opts, { rid: r.rid });
        const o = this.byRid(v);
        if (v !== '_no' && this.active(o) && this.active(r)) {
          this.trip(o, `被${this.nm(r)}使了绊子`);
          yield* this.pw(r, 'kingtripper', 1, [o]);
        }
      }
    }
    // 大海怪：每场一次，把所有人卷到自己格子并绊倒
    if (this.active(r) && this.has(r, 'kraken') && !r.krakenUsed) {
      if (this.others(r).some((o) => o.pos !== r.pos)) {
        const v = yield this.ask(r.seat, 'kraken', '大海怪：把所有人卷到你的格子并绊倒？（每场一次）', yn('卷进深海！', '先不用'), { rid: r.rid });
        if (v === 'yes' && this.active(r)) {
          r.krakenUsed = true;
          const all = this.others(r);
          yield* this.warpAll(all.map((o) => [o, r.pos]), '被大海怪卷了过来');
          for (const o of all) if (this.active(o)) this.trip(o, '被大海怪缠住');
          yield* this.pw(r, 'kraken', 1, all);
        }
      }
    }
    // 跟屁虫：瞬移到前方最近那名运动员身后一格
    if (this.active(r) && this.has(r, 'tail')) {
      const ahead = this.others(r).filter((o) => o.pos > r.pos);
      if (ahead.length) {
        const near = Math.min(...ahead.map((o) => o.pos));
        const to = near - 1;
        if (to > r.pos) {
          const tgt = this.sortByTurn(ahead.filter((o) => o.pos === near))[0];
          const v = yield this.ask(r.seat, 'tail', `跟屁虫：瞬移到 ${this.nm(tgt)} 身后（第 ${to} 格）？`, yn('贴上去！', '不跟'), { rid: r.rid, target: to });
          if (v === 'yes' && this.active(r)) {
            yield* this.warp(r, to, `贴到了 ${this.nm(tgt)} 身后`);
            yield* this.pw(r, 'tail', 1, [tgt]);
          }
        }
      }
    }
  }

  /* ---------- 二代：回合结束 ---------- */
  *turnEnd(r) {
    // 蹦蹦蛙：正好有人在我前面 1 格 → 再来一回合
    if (this.active(r) && this.has(r, 'hopfrog') && this.others(r).some((o) => o.pos === r.pos + 1)) {
      this.extraTurn = true;
      this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 前面正好有人，跳山羊！再来一回合` });
      yield* this.pw(r, 'hopfrog');
    }
    // 水龙头：掷骰，前方这个距离内的人全部绊倒
    if (this.active(r) && this.has(r, 'hose')) {
      const v = yield* this.rollFor(r);
      this.emit({ t: 'roll', rid: r.rid, seat: r.seat, value: v, purpose: 'hose', text: `${this.nm(r)} 打开水龙头，掷出 ${v}` });
      const hit = this.others(r).filter((o) => o.pos > r.pos && o.pos <= r.pos + v);
      for (const o of hit) this.trip(o, `被${this.nm(r)}滋了一身`);
      yield* this.pw(r, 'hose', 1, hit);
    }
    // 调包精：可以和 1 格内另一位玩家的运动员交换控制权
    if (this.active(r) && this.has(r, 'switcharoo')) {
      const cands = this.others(r).filter((o) => o.seat !== r.seat && Math.abs(o.pos - r.pos) <= 1);
      if (cands.length) {
        const opts = this.sortByTurn(cands).map((o) => ({ v: o.rid, label: `和${this.nm(o)}调包（第 ${o.pos} 格）` })).concat([{ v: '_no', label: '不调包' }]);
        const v = yield this.ask(r.seat, 'switcharoo', '调包精：和谁交换控制权？', opts, { rid: r.rid });
        const o = this.byRid(v);
        if (v !== '_no' && this.active(o) && this.active(r) && o.seat !== r.seat) {
          const before = `${this.nm(r)} 和 ${this.nm(o)}`;
          const sa = r.seat;
          r.seat = o.seat; o.seat = sa;
          this.emit({ t: 'control', a: r.rid, b: o.rid, seatA: r.seat, seatB: o.seat, text: `狸猫换太子！${before} 交换了控制权` });
          yield* this.pw(r, 'switcharoo', 1, [o]);
        }
      }
    }
  }

  /* ---------- 掷骰 ---------- */
  fixedFor(seat) { return this.fixedRoll ? this.fixedRoll[seat] : undefined; }
  // 归属于某名运动员的一次掷骰：随机停止（固定点数）→ 电鳗（算 1）→ 派对杀手（6 作废重掷）。
  // 一代对局里等价于一次 d6()，不产生额外事件或随机消耗。
  *rollFor(r) {
    let v = 0;
    for (let k = 0; k < 6; k++) {
      const fixed = r ? this.fixedFor(r.seat) : undefined;
      v = fixed != null ? fixed : this.d6();
      if (this.edition === 'v1') return v;
      if (v !== 1 && r && this.active(r)) {
        const st = this.holders('stunner').find((o) => o !== r && Math.abs(o.pos - r.pos) <= 1);
        if (st) {
          this.emit({ t: 'info', rid: st.rid, text: `${this.nm(st)} 电麻了 ${this.nm(r)}：${v} 点只算 1` });
          v = 1;
          yield* this.pw(st, 'stunner', 1, [r]);
        }
      }
      if (v !== 6) return v;
      const poopers = this.holders('pooper');
      if (!poopers.length) return v;
      this.emit({ t: 'voided', rid: r ? r.rid : null, seat: r ? r.seat : null, value: 6, text: `${r ? this.nm(r) : ''} 掷出的 6 被派对杀手作废，重掷` });
      for (const p of poopers) {
        if (!this.active(p)) continue;
        yield* this.move(p, 1, 'power');
        yield* this.pw(p, 'pooper');
      }
      // 暂定：点数被固定成 6 时只结算一遍派对杀手，避免无限重掷
      if (fixed === 6) return v;
    }
    return v;
  }

  // 一代原有的重掷环节（魔术象、骰子贩子），st 保存本次掷骰状态
  *rerollPhase(r, st) {
    for (let g = 0; g < 4; g++) {
      const opts = [{ v: 'keep', label: `就用 ${st.roll}` }];
      if (st.magic > 0) opts.push({ v: 'magic', label: `魔术重掷（还剩 ${st.magic} 次）` });
      const dealers = !st.diceUsed ? this.holders('dicemonger') : [];
      if (dealers.length) opts.push({ v: 'dice', label: '骰子交易：重掷一次' });
      if (opts.length === 1) break;
      const v = yield this.ask(r.seat, 'reroll', `掷出了 ${st.roll}，要重掷吗？`, opts, { roll: st.roll });
      if (v === 'keep' || !this.active(r)) break;
      st.roll = yield* this.rollFor(r);
      this.emit({ t: 'roll', rid: r.rid, seat: r.seat, value: st.roll, reroll: true, text: `${this.nm(r)} 重掷出 ${st.roll}` });
      if (v === 'magic') { st.magic--; yield* this.pw(r, 'magician'); } else {
        st.diceUsed = true;
        // 机会共享一次；本次交易触发的所有有效贩子依回合顺序结算奖励。
        for (const dm of dealers) {
          if (!this.active(dm)) continue;
          if (dm !== r) {
            this.emit({ t: 'info', rid: dm.rid, text: `${this.nm(dm)} 做成一笔骰子生意，前进 1 格` });
            yield* this.move(dm, 1, 'power');
          }
          yield* this.pw(dm, 'dicemonger');
        }
      }
    }
  }

  // 老千豹：暗定 1–6，右手边玩家猜；猜中不动。返回主移动步数（0 = 不动）
  *cheatahPlay(r) {
    const nums = () => [1, 2, 3, 4, 5, 6].map((k) => ({ v: String(k), label: `${k} 格` }));
    const set = Number(yield this.ask(r.seat, 'cheatahSet', '老千豹：暗中定一个步数（别人看不到）', nums(), { rid: r.rid }));
    if (!this.active(r)) return 0;
    const gs = this.rightOf(r.seat);
    this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 暗中定好了步数，请 ${this.players[gs].name} 来猜` });
    const guess = Number(yield this.ask(gs, 'cheatahGuess', `猜猜 ${this.nm(r)} 暗定了几格？猜中它就走不了`, nums(), { rid: r.rid }));
    const hit = guess === set;
    this.emit({ t: 'cheat', rid: r.rid, seat: gs, set, guess, hit, text: hit ? `${this.players[gs].name} 猜中了 ${set}！${this.nm(r)} 原地不动` : `${this.players[gs].name} 猜 ${guess}，实际是 ${set}，${this.nm(r)} 走 ${set} 格` });
    yield* this.pw(r, 'cheatah');
    return hit ? 0 : set;
  }

  // 蘑菇：从牌堆抽一名运动员，把它的技能叠加到自己身上
  *mushGrow(r) {
    for (let tries = 0; tries < 6 && this.deck.length; tries++) {
      const id = this.deck.shift();
      // 暂定：赛前/赛场外技能和模仿猫叠上来没有意义，放回牌堆底再抽
      if (BEFORE_RACE.has(id) || OFF_TRACK.has(id) || id === 'copycat' || id === 'mush' || this.has(r, id)) { this.deck.push(id); continue; }
      (r.stack ||= []).push(id);
      this.emit({ t: 'stack', rid: r.rid, powers: [id], text: `${this.nm(r)} 吃啥长啥，长出了「${BY_ID[id].skill}」（${BY_ID[id].name}）` });
      yield* this.pw(r, 'mush');
      return;
    }
  }

  /* ---------- 变数卡 ---------- */
  *drawTwist(r, depth = 0) {
    if (!this.twistDeck || depth > 3) return;
    if (!this.twistDeck.length) {
      this.twistDeck = this.shuffle(this.twistDiscard);
      this.twistDiscard = [];
    }
    const id = this.twistDeck.shift();
    if (!id) return;
    this.twistDiscard.push(id);
    this.twistDrawn.push(id);
    const tw = TWIST_BY_ID[id];
    this.emit({ t: 'twist', id, rid: r ? r.rid : null, text: `${r ? `${this.nm(r)} 经过变数招牌，` : ''}翻开变数卡「${tw.name}」：${tw.text}` });
    yield* this.applyTwist(id, r, depth);
  }

  *applyTwist(id, r, depth) {
    if (['bonkbug', 'cursewands', 'conveyor', 'scrying'].includes(id)) (this.twistActive ||= new Set()).add(id);
    switch (id) {
      case 'mirror': {
        // 镜像世界：赛道方向反转，所有人位置 p → 30-p（同时瞬移）；还在起点的人直接冲线，按回合顺序计名次
        this.mirrored = !this.mirrored;
        if (this.coins) this.coins = this.coins.map((c) => FINISH - c).filter((c) => c > 0 && c < FINISH);
        if (this.monster != null) this.monster = FINISH - this.monster;
        yield* this.warpAll(this.sortByTurn(this.onTrack()).map((o) => [o, FINISH - o.pos]), '随镜像世界翻转');
        break;
      }
      case 'pinata': {
        const taken = new Set(this.onTrack().map((o) => o.pos));
        this.coins = [];
        for (let p = this.track.firstCorner + 1; p < FINISH; p++) if (!taken.has(p)) this.coins.push(p);
        this.emit({ t: 'coins', coins: this.coins.slice(), text: `皮纳塔炸开了！${this.coins.length} 个空格各放上 1 分` });
        break;
      }
      case 'alchemylab':
        this.monster = 0;
        this.emit({ t: 'monster', from: null, to: 0, value: 0, text: '狼人怪从起点出发了！' });
        break;
      case 'chaos':
        yield* this.drawTwist(r, depth + 1);
        yield* this.drawTwist(r, depth + 1);
        break;
      case 'conveyor':
        yield* this.warpAll(this.sortByTurn(this.onTrack()).map((o) => [o, 1]), '被传送带送回第 1 格');
        break;
      case 'swapmeet':
        yield* this.swapMeet();
        break;
      case 'finale':
        if (this.finale == null) { this.finale = 'armed'; this.finaleHeld = []; }
        break;
      case 'timeimp':
        if (r && this.active(r)) {
          const p = this.players[r.seat];
          if (this.raceNo < 4 && !p.extras.some((ex) => ex.rid === r.rid)) p.extras.push({ rid: r.rid, power: r.power, keep: false });
          yield* this.eliminate(r, null, 'timeimp');
        }
        break;
      case 'noluck': {
        this.fixedRoll = {};
        for (const p of this.players) {
          const me = this.racerOfSeat(p.seat);
          const v = me && this.active(me) ? yield* this.rollFor(me) : this.d6();
          this.fixedRoll[p.seat] = v;
          this.emit({ t: 'fixedRoll', seat: p.seat, value: v, text: `${p.name} 掷出 ${v}，本场之后他的骰子都是 ${v}` });
        }
        break;
      }
      case 'roastchicken': {
        for (const o of this.sortByTurn(this.lasts())) {
          this.emit({ t: 'info', rid: o.rid, text: `${this.nm(o)} 吃了烤鸡，前进 7 格` });
          yield* this.move(o, 7, 'twist');
        }
        break;
      }
      default: break;
    }
  }

  // 跳蚤市场：每位玩家抽一名新运动员，同时暗中决定换不换（选项值 swap 带上新卡 card）
  *swapMeet() {
    const seats = [], optionsBySeat = {}, offers = {};
    for (const p of this.players) {
      const cur = this.seatRacers(p.seat).find((o) => this.active(o));
      if (!cur || !this.deck.length) continue;
      const card = this.deck.shift();
      offers[p.seat] = { rid: cur.rid, card };
      seats.push(p.seat);
      optionsBySeat[p.seat] = [
        { v: 'keep', label: `留着${(BY_ID[cur.power] || BY_ID[cur.rid]).name}` },
        { v: 'swap', label: `换成${BY_ID[card].name}（${BY_ID[card].skill}）`, card },
      ];
    }
    if (!seats.length) return;
    const ans = yield { simul: true, kind: 'swapmeet', title: '跳蚤市场：要不要把场上的运动员换掉？', seats, optionsBySeat };
    for (const s of seats) {
      const { rid, card } = offers[s];
      const o = this.byRid(rid);
      if (ans[s] === 'swap' && this.active(o)) {
        o.power = card;
        o.via = card;
        o.stack = [];
        o.wolf = false;
        this.emit({ t: 'transform', rid: o.rid, power: card, swap: true, text: `${this.nm(o)} 在跳蚤市场换成了 ${BY_ID[card].name}「${BY_ID[card].skill}」` });
      } else this.deck.push(card);
    }
    yield* this.refreshCopies();
  }

  *mainMove(r, startPos, penguin = false) {
    yield* this.refreshCopies();
    const yn = (yes, no) => [{ v: 'yes', label: yes }, { v: 'no', label: no }];
    // ---- 主移动前 ----
    if (this.has(r, 'cheerleader')) {
      const v = yield this.ask(r.seat, 'cheerleader', '啦啦队长：让最后一名前进 2 格，自己前进 1 格？', yn('加油加油！', '不了'));
      if (v === 'yes' && this.active(r)) {
        const ls = this.sortByTurn(this.lasts());
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 为最后一名加油！` });
        for (const l of ls) yield* this.move(l, 2, 'power');
        yield* this.move(r, 1, 'power');
        yield* this.pw(r, 'cheerleader', 1, ls.filter((l) => l !== r));
      }
    }
    if (this.active(r) && this.has(r, 'loser')) {
      const ls = this.lasts();
      if (ls.length === 1 && ls[0] === r) {
        this.giveChip(r.seat, 'bronze', 1, '可爱废柴独自垫底');
        yield* this.pw(r, 'loser');
      }
    }
    if (this.active(r) && this.has(r, 'hypnotist')) {
      const cands = this.others(r).filter((o) => o.pos !== r.pos);
      if (cands.length) {
        const opts = cands.map((o) => ({ v: o.rid, label: `${this.nm(o)}（第 ${o.pos} 格）` })).concat([{ v: '_no', label: '不催眠' }]);
        const v = yield this.ask(r.seat, 'hypnotist', '催眠蛇：把谁瞬移到你身边？', opts);
        const o = this.byRid(v);
        if (v !== '_no' && this.active(o) && this.active(r)) {
          yield* this.warp(o, r.pos, `被${this.nm(r)}催眠，瞬移过来`);
          yield* this.pw(r, 'hypnotist', 1, [o]);
        }
      }
    }
    let partyBonus = 0;
    if (this.active(r) && this.has(r, 'partyanimal')) {
      this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 开派对！所有人朝它靠近 1 格` });
      for (const o of this.sortByTurn(this.others(r))) {
        if (!this.active(o) || !this.active(r) || o.pos === r.pos) continue;
        yield* this.move(o, o.pos < r.pos ? 1 : -1, 'power');
      }
      if (this.active(r)) {
        partyBonus = this.at(r.pos, r).length;
        yield* this.pw(r, 'partyanimal');
      }
    }
    if (this.active(r) && this.has(r, 'thirdwheel')) {
      const counts = {};
      for (const o of this.onTrack()) counts[o.pos] = (counts[o.pos] || 0) + 1;
      const spaces = Object.keys(counts).map(Number).filter((p) => counts[p] === 2 && p !== r.pos);
      if (spaces.length) {
        const opts = spaces.sort((a, b) => b - a).map((p) => ({ v: `s${p}`, label: `第 ${p} 格` })).concat([{ v: '_no', label: '不挤了' }]);
        const v = yield this.ask(r.seat, 'thirdwheel', '电灯泡：挤进哪个两人格？', opts);
        if (v !== '_no' && this.active(r)) {
          yield* this.warp(r, Number(v.slice(1)), '硬挤进了两人世界');
          yield* this.pw(r, 'thirdwheel');
        }
      }
    }
    if (!this.active(r)) return;

    // ---- 主移动方式 ----
    const modes = [{ v: 'roll', label: '掷骰子' }];
    if (this.has(r, 'legs')) modes.push({ v: 'legs', label: '迈大步：直接走 5 格' });
    if (this.has(r, 'flipflop')) {
      for (const o of this.others(r)) if (o.pos !== r.pos) modes.push({ v: `flip:${o.rid}`, label: `和${this.nm(o)}换位（第 ${o.pos} 格）` });
    }
    if (this.has(r, 'mole') && !this.others(r).some((o) => Math.abs(o.pos - r.pos) <= 1)) modes.push({ v: 'mole', label: '打地洞：直接走 6 格' });
    if (this.has(r, 'cheatah')) modes.push({ v: 'cheat', label: '暗箱操作：暗定步数让右手边玩家猜' });
    let mode = 'roll';
    if (modes.length > 1) mode = yield this.ask(r.seat, 'mode', '这回合怎么走？', modes);
    else mode = yield this.ask(r.seat, 'roll', '轮到你了，掷骰子！', modes);
    if (!this.active(r)) return;

    if (mode.startsWith('flip:')) {
      const o = this.byRid(mode.slice(5));
      if (!this.active(o)) return;
      const a = r.pos, b = o.pos;
      r.pos = b; o.pos = a;
      this.emit({ t: 'swap', a: r.rid, b: o.rid, pa: b, pb: a, text: `${this.nm(r)} 和 ${this.nm(o)} 乾坤大挪移，交换了位置` });
      yield* this.pw(r, 'flipflop', 1, [o]);
      yield* this.afterStop(r, a, b, { passed: [], moved: false, sharedBefore: [] });
      yield* this.afterStop(o, b, a, { passed: [], moved: false, sharedBefore: [] });
      return;
    }

    let base, roll = null, dice = [];
    let tripPassed = false;
    const nemFollow = [];
    if (mode === 'legs') {
      base = 5;
      this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 迈开大长腿，直接走 5 格` });
      yield* this.pw(r, 'legs');
    } else if (mode === 'mole') {
      base = 6;
      this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 打地洞，直接走 6 格` });
      yield* this.pw(r, 'mole');
    } else if (mode === 'cheat') {
      base = yield* this.cheatahPlay(r);
      if (!base || !this.active(r)) return;
    } else {
      let predict = null;
      if (this.has(r, 'genius')) {
        predict = Number(yield this.ask(r.seat, 'genius', '天才：预言你这次会掷出几点？', [1, 2, 3, 4, 5, 6].map((k) => ({ v: String(k), label: String(k) }))));
        this.emit({ t: 'predict', rid: r.rid, value: predict, text: `${this.nm(r)} 预言会掷出 ${predict}` });
      }
      let bust = false;
      if (this.has(r, 'diceguy')) {
        // 骰子先生：一次掷 6 颗，从重复出现的点数里挑一个；全不同就不动
        for (let k = 0; k < 6; k++) dice.push(yield* this.rollFor(r));
        if (!this.active(r)) return;
        this.emit({ t: 'rolls', rid: r.rid, seat: r.seat, dice: dice.slice(), text: `${this.nm(r)} 一口气掷出 ${dice.join(' ')}` });
        const dup = [...new Set(dice)].filter((v) => dice.filter((x) => x === v).length > 1).sort((a, b) => b - a);
        if (!dup.length) bust = true;
        else if (dup.length === 1) roll = dup[0];
        else roll = Number(yield this.ask(r.seat, 'diceguy', `骰子先生：掷出 ${dice.join(' ')}，走哪个重复的点数？`, dup.map((v) => ({ v: String(v), label: `走 ${v} 格` })), { dice: dice.slice(), rid: r.rid }));
        if (!bust) yield* this.pw(r, 'diceguy');
      } else {
        roll = yield* this.rollFor(r);
        this.emit({ t: 'roll', rid: r.rid, seat: r.seat, value: roll, text: `${this.nm(r)} 掷出 ${roll}` });
        const st = { roll, magic: this.has(r, 'magician') ? 2 : 0, diceUsed: false };
        yield* this.rerollPhase(r, st);
        // 毒舌家：每回合一次，让前面的人重掷主移动骰（之前的点数作废）
        if (this.edition !== 'v1') {
          const used = new Set();
          for (let g = 0; g < 6 && this.active(r); g++) {
            const critic = this.holders('critic').find((c) => c !== r && c.pos < r.pos && !used.has(c));
            if (!critic) break;
            used.add(critic);
            const v = yield this.ask(critic.seat, 'critic', `毒舌家：让 ${this.nm(r)} 把 ${st.roll} 重掷？`, yn('差评，重来！', '算了'), { roll: st.roll, rid: critic.rid, target: r.rid });
            if (v !== 'yes' || !this.active(r) || !this.active(critic)) continue;
            st.roll = yield* this.rollFor(r);
            this.emit({ t: 'roll', rid: r.rid, seat: r.seat, value: st.roll, reroll: true, by: critic.rid, text: `${this.nm(critic)} 给了差评，${this.nm(r)} 重掷出 ${st.roll}` });
            yield* this.pw(critic, 'critic', 1, [r]);
            yield* this.rerollPhase(r, st);
          }
        }
        roll = st.roll;
        dice = [roll];
        // 显摆王：可以继续掷并累加，每次必须比上一次大，否则这次主移动不动
        if (this.active(r) && this.has(r, 'showoff')) {
          for (let k = 0; k < 6; k++) {
            const last = dice[dice.length - 1];
            const sum = dice.reduce((a, b) => a + b, 0);
            if (last >= 6) break;
            const v = yield this.ask(r.seat, 'showoff', `显摆王：现在 ${dice.join('+')}=${sum}，再掷必须大于 ${last}`, [{ v: 'stop', label: `就走 ${sum} 格` }, { v: 'more', label: `再掷！（要大于 ${last}）` }], { roll: last, sum, rid: r.rid });
            if (v !== 'more' || !this.active(r)) break;
            const nv = yield* this.rollFor(r);
            dice.push(nv);
            this.emit({ t: 'roll', rid: r.rid, seat: r.seat, value: nv, extra: true, text: `${this.nm(r)} 显摆再掷出 ${nv}` });
            if (nv <= last) {
              bust = true;
              this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 没掷出更大的点数，显摆失败，这次不动` });
              break;
            }
          }
          if (dice.length > 1) yield* this.pw(r, 'showoff');
        }
      }
      if (!this.active(r)) return;
      // 宿敌：跟着掷一颗，点数相同就在对方之后前进同样格数
      if (roll != null && this.edition !== 'v1') {
        for (const nm of this.holders('nemesis')) {
          if (nm === r || !this.active(r)) continue;
          const v = yield this.ask(nm.seat, 'nemesis', `宿敌：${this.nm(r)} 掷出 ${roll}，跟着掷一颗？`, yn('跟掷！', '不跟'), { roll, rid: nm.rid, target: r.rid });
          if (v !== 'yes' || !this.active(nm)) continue;
          const nv = yield* this.rollFor(nm);
          const same = nv === roll;
          this.emit({ t: 'roll', rid: nm.rid, seat: nm.seat, value: nv, purpose: 'nemesis', text: same ? `${this.nm(nm)} 跟掷出 ${nv}，冤家路窄！` : `${this.nm(nm)} 跟掷出 ${nv}，没对上` });
          if (same) nemFollow.push(nm);
        }
      }
      if (!this.active(r)) return;
      if (predict != null && predict === roll) {
        this.extraTurn = true;
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 算到了！回合结束后再来一回合` });
        yield* this.pw(r, 'genius');
      }
      // 伊卡洛斯：最终掷出 6 就淘汰
      if (this.has(r, 'icarus') && (dice.includes(6) || roll === 6)) {
        yield* this.pw(r, 'icarus');
        yield* this.eliminate(r, null, 'icarus');
        return;
      }
      if (roll === 1 || roll === 2) {
        // 咬痕：掷出 1 或 2 永久变身（这一步就生效）
        if (this.has(r, 'bitemark') && !r.wolf) {
          r.wolf = true;
          this.emit({ t: 'wolf', rid: r.rid, text: `${this.nm(r)} 月圆变身成狼人！被它超过的人会被淘汰` });
          yield* this.pw(r, 'bitemark');
        }
        if (this.active(r) && this.has(r, 'mush')) yield* this.mushGrow(r);
      }
      if (!this.active(r)) return;
      // 掷骰触发
      let skip = false;
      if (roll === 1) {
        for (const w of this.holders('inchworm')) {
          if (w === r) continue;
          skip = true;
          this.emit({ t: 'info', rid: w.rid, text: `${this.nm(w)} 扭一扭：${this.nm(r)} 这步作废` });
          yield* this.move(w, 1, 'power');
          yield* this.pw(w, 'inchworm', 1, [r]);
        }
        const sk = this.holders('skipper')[0];
        if (sk && this.active(sk)) {
          this.skipperNext = sk.seat;
          this.emit({ t: 'info', rid: sk.rid, text: sk === r ? `${this.nm(sk)} 掷出 1，老水手再来一回合！` : `${this.nm(sk)}：掷出 1 了？下一个轮到老水手我！` });
          yield* this.pw(sk, 'skipper');
        }
      }
      if (roll === 6) {
        if (this.has(r, 'sisyphus')) {
          skip = true;
          const chips = this.players[r.seat].chips;
          const i = chips.findIndex((c) => c.kind === 'bronze' && c.v > 0);
          const j = i >= 0 ? i : chips.reduce((best, c, k) => c.v > 0 && (best < 0 || c.v < chips[best].v) ? k : best, -1);
          if (j >= 0) {
            const [lost] = chips.splice(j, 1);
            if (lost.v > 1) chips.push({ ...lost, v: lost.v - 1 });
          }
          if (j >= 0) this.emit({ t: 'chip', seat: r.seat, kind: 'lose', v: -1, text: `${this.nm(r)} 掷出 6，石头滚回起点，失去 1 分` });
          else this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 掷出 6，石头滚回起点；当前没有分数可失去` });
          yield* this.warp(r, 0);
          yield* this.pw(r, 'sisyphus');
        }
        for (const l of this.holders('lackey')) {
          if (l === r || !this.active(l)) continue;
          this.emit({ t: 'info', rid: l.rid, text: `${this.nm(l)}：遵命老爷！抢先 2 格` });
          yield* this.move(l, 2, 'power');
          yield* this.pw(l, 'lackey');
        }
      }
      if (skip || !this.active(r)) return;
      if (bust) { yield* this.nemesisFollow(nemFollow, roll); return; }
      base = dice.length > 1 ? dice.reduce((a, b) => a + b, 0) : roll;
      // 魔法健将：按点数发动（掷 2、3、5 不再主移动）
      if (this.has(r, 'magicalathlete') && dice.length <= 1) {
        const out = yield* this.magicalAthlete(r, roll);
        if (out === 'done') { yield* this.nemesisFollow(nemFollow, roll); return; }
        base = out.base;
        tripPassed = !!out.tripPassed;
      }
      if (!this.active(r)) return;
      if (this.has(r, 'alchemist') && (roll === 1 || roll === 2)) {
        const v = yield this.ask(r.seat, 'alchemist', `炼金术士：把 ${roll} 变成 4？`, yn('点石成金！', `就走 ${roll}`));
        if (v === 'yes') { base = 4; yield* this.pw(r, 'alchemist'); }
      }
      if (this.active(r) && this.has(r, 'rocket')) {
        const v = yield this.ask(r.seat, 'rocket', `火箭科学家：把 ${base} 翻倍成 ${base * 2}？（之后会摔倒）`, yn('咔嘣！点火！', '稳一点'));
        if (v === 'yes') { base *= 2; r.rocketTrip = true; yield* this.pw(r, 'rocket'); }
      }
    }
    if (!this.active(r)) return;

    // ---- 加减值 ----
    const mods = [];
    let reverse = false;
    if (this.edition !== 'v1') {
      // 攀滚企鹅摔倒时翻倍；糊涂狗垫底 ×3、否则反向
      if (penguin && this.has(r, 'penguin')) { mods.push({ label: '企鹅滑行', v: base, mult: 2 }); base *= 2; yield* this.pw(r, 'penguin'); }
      if (this.has(r, 'blunderdog')) {
        if (this.lasts().includes(r)) { mods.push({ label: '糊涂狗垫底', v: base * 2, mult: 3 }); base *= 3; } else reverse = !reverse;
        yield* this.pw(r, 'blunderdog');
      }
    }
    for (const c of this.holders('coach')) if (c.pos === r.pos) { mods.push({ label: '教练', v: 1 }); yield* this.pw(c, 'coach', 1, c === r ? [] : [r]); }
    for (const gk of this.holders('gunk')) if (gk !== r) { mods.push({ label: '黏液怪', v: -1 }); yield* this.pw(gk, 'gunk', 1, [r]); }
    if (this.has(r, 'hare')) { mods.push({ label: '野兔', v: 2 }); yield* this.pw(r, 'hare'); }
    if (this.has(r, 'blimp')) { const v = startPos < this.track.secondCorner ? 3 : -1; mods.push({ label: '飞艇', v }); yield* this.pw(r, 'blimp'); }
    if (partyBonus) mods.push({ label: '派对', v: partyBonus });
    if (this.edition !== 'v1') {
      if (this.has(r, 'gloth')) { mods.push({ label: '树懒', v: -1 }); yield* this.pw(r, 'gloth'); }
      if (this.has(r, 'icarus')) { mods.push({ label: '伊卡洛斯', v: 3 }); yield* this.pw(r, 'icarus'); }
      if (this.has(r, 'overtaker')) {
        const n = this.others(r).filter((o) => o.pos > r.pos).length;
        if (n) { mods.push({ label: '超车王', v: n }); yield* this.pw(r, 'overtaker'); }
      }
      if (this.has(r, 'speeddemon')) {
        const s = this.score(r.seat);
        if (s > 0) { mods.push({ label: '飙车魔', v: s }); yield* this.pw(r, 'speeddemon'); }
      }
      if (r.hogs) mods.push({ label: '野猪', v: 2 * r.hogs });
      for (const nl of this.holders('nul')) if (nl !== r && nl.pos < r.pos) { mods.push({ label: '空指针', v: -1 }); yield* this.pw(nl, 'nul', 1, [r]); }
      for (const sd of this.holders('stepdad')) if (sd !== r && this.stepchild(sd) === r) { mods.push({ label: '后爸', v: 2 }); yield* this.pw(sd, 'stepdad', 1, [r]); }
      if (this.twistOn('conveyor')) mods.push({ label: '传送带', v: 3 });
      // 捣蛋鬼：别人掷出 3 时整段反向（两个反向抵消）
      if (dice.includes(3)) {
        for (const sb of this.holders('saboteur')) {
          if (sb === r) continue;
          reverse = !reverse;
          yield* this.pw(sb, 'saboteur', 1, [r]);
        }
      }
    }
    if (!this.active(r)) return;
    let total = Math.max(0, base + mods.reduce((s, m) => s + (m.mult ? 0 : m.v), 0));
    if (reverse) total = -total;
    if (mods.length || reverse) this.emit({ t: 'calc', rid: r.rid, base, mods, total, ...(reverse ? { reverse: true } : {}), text: `${this.nm(r)} 主移动：${base}${mods.filter((m) => !m.mult).map((m) => `${m.v > 0 ? '+' : ''}${m.v}（${m.label}）`).join('')}${reverse ? '，反向' : ''} = ${total}` });
    // 水晶球：主移动 6 格或以上改为淘汰
    if (this.twistOn('scrying') && total >= 6) {
      yield* this.eliminate(r, null, 'scrying');
      return;
    }
    yield* this.move(r, total, 'main', tripPassed ? { tripPassed } : undefined);
    if (r.rocketTrip) {
      r.rocketTrip = false;
      this.trip(r, '火箭过载');
    }
    yield* this.nemesisFollow(nemFollow, roll);
  }

  *nemesisFollow(list, roll) {
    for (const nm of list) {
      if (!this.active(nm)) continue;
      this.emit({ t: 'info', rid: nm.rid, text: `${this.nm(nm)} 冤家路窄，也前进 ${roll} 格` });
      yield* this.move(nm, roll, 'power');
      yield* this.pw(nm, 'nemesis');
    }
  }

  // 魔法健将：返回 'done'（本回合不再主移动）或 { base, tripPassed }
  *magicalAthlete(r, roll) {
    const say = (text) => this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 六六大顺·${roll}：${text}` });
    switch (roll) {
      case 1:
        say('前进 7 格');
        yield* this.pw(r, 'magicalathlete');
        return { base: 7 };
      case 2: {
        const ls = this.lasts().filter((o) => o !== r && o.pos !== r.pos);
        say(ls.length ? '把最后一名都传到身边' : '没有可以传来的最后一名');
        if (ls.length) {
          yield* this.warpAll(this.sortByTurn(ls).map((o) => [o, r.pos]), `被${this.nm(r)}传了过来`);
          yield* this.pw(r, 'magicalathlete', 1, ls);
        }
        return 'done';
      }
      case 3: {
        const cands = this.others(r).filter((o) => o.pos !== r.pos);
        if (!cands.length) { say('没有可以瞬移的目标'); return 'done'; }
        const v = yield this.ask(r.seat, 'athleteWarp', '魔法健将：瞬移到谁的格子（绊倒那格的所有人）？', this.sortByTurn(cands).map((o) => ({ v: o.rid, label: `${this.nm(o)}（第 ${o.pos} 格）` })), { rid: r.rid });
        const o = this.byRid(v) || cands[0];
        if (!this.active(o) || !this.active(r)) return 'done';
        const to = o.pos;
        say(`瞬移到第 ${to} 格，绊倒那里的人`);
        yield* this.warpAll([[r, to]], '瞬移过去');
        if (!this.active(r)) return 'done';
        const hit = this.at(r.pos, r);
        for (const x of hit) this.trip(x, `被${this.nm(r)}砸中`);
        yield* this.pw(r, 'magicalathlete', 1, hit);
        return 'done';
      }
      case 4:
        say('前进 4 格并再来一回合');
        this.extraTurn = true;
        yield* this.pw(r, 'magicalathlete');
        return { base: 4 };
      case 5: {
        const lead = this.leaders().filter((o) => o !== r);
        say(lead.length ? '领跑者全部后退 5 格' : '没有别的领跑者');
        for (const o of this.sortByTurn(lead)) yield* this.move(o, -5, 'power');
        if (lead.length) yield* this.pw(r, 'magicalathlete', 1, lead);
        return 'done';
      }
      default:
        say('前进 6 格，绊倒被超过的人');
        yield* this.pw(r, 'magicalathlete');
        return { base: 6, tripPassed: true };
    }
  }

  /* ================= 对外快照 ================= */
  snapshot(viewerSeat) {
    const d = this.pending;
    const internal = viewerSeat === undefined;
    let pending = null;
    if (d) {
      if (d.simul) {
        const optionsBySeat = internal ? d.optionsBySeat :
          (d.seats.includes(viewerSeat) ? { [viewerSeat]: d.optionsBySeat[viewerSeat] } : {});
        pending = { id: d.id, kind: d.kind, title: d.title, simul: true, seats: d.seats,
          done: Object.keys(d.answers).map(Number), optionsBySeat };
      } else {
        pending = { id: d.id, kind: d.kind, title: d.title, seat: d.seat,
          options: internal || viewerSeat === d.seat ? d.options : [], roll: d.roll, target: d.target,
          ...(d.rid ? { rid: d.rid } : {}), ...(d.dice ? { dice: d.dice } : {}), ...(d.sum != null ? { sum: d.sum } : {}) };
      }
    }
    // 包括 chips、results、pending options、计分常量都必须与引擎脱离引用。
    return structuredClone({
      phase: this.phase,
      raceNo: this.raceNo,
      track: this.trackKey,
      gold: GOLD, silver: SILVER,
      curSeat: this.curSeat,
      firstSeat: this.firstSeat,
      faceUp: this.faceUp,
      draft: this.phase === 'draft' && this.draftOrder ? { order: this.draftOrder, idx: this.draftIdx, round: this.draftRound } : null,
      deckCount: this.deck.length,
      winners: this.winners,
      players: this.players.map((p) => ({ seat: p.seat, name: p.name, ai: p.ai, hand: p.hand, used: p.used, chips: p.chips, score: this.score(p.seat) })),
      racers: this.racers.map((r) => ({ rid: r.rid, seat: r.seat, pos: r.pos, tripped: r.tripped, finished: r.finished, out: r.out, power: r.power, eff: this.power(r), mmPredict: r.mmPredict, ...this.racerExtra(r) })),
      results: this.results,
      log: this.log.slice(-60),
      champions: this.champions || null,
      pending,
      seq: this.evSeq,
      edition: this.edition,
      schedule: this.schedule,
      ...(this.edition !== 'v1' ? { v2: this.v2State() } : {}),
    });
  }

  // 二代运动员的附加状态：只在有值时下发，一代快照保持原样
  racerExtra(r) {
    if (this.edition === 'v1') return {};
    const x = {};
    if (r.extra) x.extra = true;
    if (r.hogs) x.hogs = r.hogs;
    if (r.wolf) x.wolf = true;
    if (r.stack && r.stack.length) x.stack = r.stack.slice();
    if (r.mate) x.mate = r.mate;
    if (r.via) x.via = r.via;
    if (r.benched) x.benched = true;
    if (r.krakenUsed) x.krakenUsed = true;
    x.powers = this.powers(r);
    if (this.active(r) && this.nulled(r)) x.nulled = true;
    return x;
  }

  v2State() {
    return {
      twistDeckCount: this.twistDeck ? this.twistDeck.length : 0,
      twistDone: !!this.twistDone,
      twistDrawn: (this.twistDrawn || []).slice(),
      twistActive: this.twistActive ? [...this.twistActive] : [],
      coins: this.coins ? this.coins.slice() : [],
      monster: this.monster ?? null,
      fixedRoll: this.fixedRoll ? { ...this.fixedRoll } : null,
      mirrored: !!this.mirrored,
      finale: this.finale || null,
      extras: this.players.map((p) => p.extras.map((ex) => ex.rid)),
    };
  }
}

module.exports = { Game, FINISH };
