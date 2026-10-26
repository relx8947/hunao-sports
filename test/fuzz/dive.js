// 复现单局：node dive.js <模式> <种子> <条件类型>，在条件第一次成立时打印前 25 个事件
const P = require('path').join(__dirname, '..', '..') + '/';
const { Game } = require(P + 'game/engine'); const { decide } = require(P + 'game/ai');
const [edition, seed, kind, arg] = [process.argv[2], +process.argv[3], process.argv[4], process.argv[5]];
const g = new Game({ players: Array.from({ length: 6 }, (_, k) => ({ name: `P${k}`, ai: true })), seed, edition });
const hist = [];
const fmt = (e) => `${e.seq} ${e.t}${e.rid ? ' ' + e.rid : ''}${e.key ? ' key=' + e.key : ''}${e.value != null ? ' v=' + e.value : ''}${e.from != null ? ` ${e.from}→${e.to}` : ''}${e.path ? ' path=' + e.path : ''}${e.kind ? ' ' + e.kind : ''} ${e.text || ''}`;
const state = () => g.racers.map((r) => `${r.rid}@${r.pos}${r.finished ? 'F' + r.finished : ''}${r.out ? 'X' : ''}${r.tripped ? 't' : ''}${g.active(r) && g.nulled(r) ? '∅' : ''}`).join(' ');
let hit = false;
const orig = g.emit.bind(g);
g.emit = (e) => {
  const out = orig(e); const ev = g.events[g.events.length - 1];
  hist.push(fmt(ev) + `   ‖ ${state()}`); if (hist.length > 30) hist.shift();
  if (!hit && kind === 'race' && ev.t === 'raceEnd' && ev.race === +arg) { hit = true; dump(); }
  if (!hit && kind === 'nulpow' && ev.t === 'power' && ev.key === arg) { const r = g.byRid(ev.rid); if (r && g.active(r) && !g.has(r, arg)) { hit = true; dump(); } }
  if (!hit && kind === 'event' && ev.t === arg.split(':')[0] && (!arg.split(':')[1] || JSON.stringify(ev).includes(arg.split(':')[1]))) { hit = true; dump(); }
  return out;
};
function dump() { console.log(`=== ${edition} seed ${seed} race ${g.raceNo} track ${g.trackKey}`); for (const h of hist) console.log(h.slice(0, 330)); }
g.start();
while (g.pending && !hit) {
  const d = g.pending;
  if (d.simul) for (const s of d.seats) g.answer(s, d.id, decide(g, d, s)); else g.answer(d.seat, d.id, decide(g, d, d.seat));
  g.drain();
  if (kind === 'baby' && g.phase === 'race') { const b = g.holders('hugebaby')[0]; if (b && b.pos > 0 && g.others(b).some((o) => o.pos === b.pos)) { hit = true; dump(); } }
}
