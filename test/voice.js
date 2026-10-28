'use strict';
// 语音开麦：名单广播、开麦上限、同身份多标签互斥、信令只在同房间内按连接转发、TURN 临时凭证
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createHub } = require('../server/hub');
let count = 0;
function fixture(options = {}) {
  let time = 1000000;
  const hub = createHub({ now: () => time, random: () => 0.3, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, ...options });
  const socket = (name, token) => {
    const ws = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
    assert.equal(hub.handle(ws, { type: 'hello', name, ...(token ? { token } : {}) }), null);
    return ws;
  };
  const last = (ws, type) => ws.messages.filter((m) => m.type === type).at(-1);
  return { hub, socket, last, tick: (ms) => { time += ms; } };
}
function test(name, fn, options) {
  const f = fixture(options);
  try { fn(f); count++; console.log(`✓ ${name}`); } finally { f.hub.dispose(); }
}
const offer = { sid: 'abc', sdp: { type: 'offer', sdp: 'v=0\r\n' } };

test('进房即收到语音名单，开麦/闭麦广播给全房间', (f) => {
  const A = f.socket('房主'), B = f.socket('朋友');
  f.hub.handle(A, { type: 'create' });
  const code = A.room;
  assert.equal(f.hub.handle(B, { type: 'join', code }), null);
  const vb = f.last(B, 'voice');
  assert.equal(vb.you, B.vid);
  assert.deepEqual(vb.peers.map((p) => [p.id, p.seat, p.mic]), [[A.vid, 0, false], [B.vid, 1, false]]);
  assert.deepEqual(vb.ice, [], '没配置 TURN 时不下发中继');
  assert.equal(f.hub.handle(A, { type: 'voice', mic: true }), null);
  assert.equal(f.last(B, 'voice').peers[0].mic, true);
  const before = B.messages.length;
  f.hub.handle(A, { type: 'voice', mic: true });
  assert.equal(B.messages.length, before, '名单没变不重发');
  f.hub.handle(A, { type: 'voice', mic: false });
  assert.equal(f.last(B, 'voice').peers[0].mic, false);
});

test('信令只转发给同房间指定连接，并清洗字段', (f) => {
  const A = f.socket('甲'), B = f.socket('乙'), C = f.socket('丙');
  f.hub.handle(A, { type: 'create' });
  f.hub.handle(B, { type: 'join', code: A.room });
  assert.equal(f.hub.handle(A, { type: 'rtc', to: B.vid, data: { ...offer, extra: 'x' } }), null);
  assert.deepEqual(f.last(B, 'rtc'), { type: 'rtc', from: A.vid, data: offer });
  assert.equal(f.hub.handle(A, { type: 'rtc', to: C.vid, data: offer }), null);
  assert.equal(f.last(C, 'rtc'), undefined, '不能发给房间外的连接');
  assert.equal(f.hub.handle(C, { type: 'rtc', to: A.vid, data: offer }), null);
  assert.equal(A.messages.filter((m) => m.type === 'rtc').length, 0, '房间外的人发不进来');
  const ice = { sid: 'abc', ice: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } };
  f.hub.handle(B, { type: 'rtc', to: A.vid, data: ice });
  assert.deepEqual(f.last(A, 'rtc').data, ice);
  for (const bad of [{ sid: 'A B' }, { sid: 'abc' }, { sid: 'abc', sdp: { type: 'pranswer', sdp: '' } }, { sid: 'abc', sdp: { type: 'offer', sdp: 'x'.repeat(12001) } }, { sid: 'abc', ice: { candidate: 1 } }, { sid: 'abc', ice: { candidate: '', sdpMLineIndex: 99 } }]) {
    assert.equal(f.hub.handle(A, { type: 'rtc', to: B.vid, data: bad }), '语音信令格式不正确', JSON.stringify(bad));
  }
});

test('信令限频：10 秒内超过上限的直接丢弃', (f) => {
  const A = f.socket('甲'), B = f.socket('乙');
  f.hub.handle(A, { type: 'create' });
  f.hub.handle(B, { type: 'join', code: A.room });
  for (let i = 0; i < 320; i++) f.hub.handle(A, { type: 'rtc', to: B.vid, data: offer });
  assert.equal(B.messages.filter((m) => m.type === 'rtc').length, 300);
  f.tick(10000);
  f.hub.handle(A, { type: 'rtc', to: B.vid, data: offer });
  assert.equal(B.messages.filter((m) => m.type === 'rtc').length, 301);
});

test('同身份多标签只留一个开麦；断线、离房清掉开麦状态', (f) => {
  const A = f.socket('甲');
  f.hub.handle(A, { type: 'create' });
  const A2 = f.socket('甲', f.last(A, 'hello').token);
  assert.equal(A2.room, A.room, '同身份新标签自动进房');
  assert.notEqual(A2.vid, A.vid);
  f.hub.handle(A, { type: 'voice', mic: true });
  f.hub.handle(A2, { type: 'voice', mic: true });
  assert.deepEqual(f.last(A, 'voice').peers.map((p) => p.mic), [false, true]);
  const B = f.socket('乙');
  f.hub.handle(B, { type: 'join', code: A.room });
  f.hub.disconnect(A2);
  assert.deepEqual(f.last(B, 'voice').peers.map((p) => [p.id, p.mic]), [[A.vid, false], [B.vid, false]]);
  f.hub.handle(B, { type: 'voice', mic: true });
  f.hub.handle(B, { type: 'leave' });
  assert.equal(B.mic, null);
  assert.equal(f.hub.handle(B, { type: 'voice', mic: true }), '你不在房间里');
});

test('观战房观众也能开麦，同时开麦有上限', (f) => {
  const W = [];
  W.push(f.socket('观众0'));
  f.hub.handle(W[0], { type: 'watch', ai: 3 });
  for (let i = 1; i < 8; i++) { W.push(f.socket(`观众${i}`)); assert.equal(f.hub.handle(W[i], { type: 'join', code: W[0].room }), null); }
  for (let i = 0; i < 6; i++) assert.equal(f.hub.handle(W[i], { type: 'voice', mic: true }), null);
  assert.match(f.hub.handle(W[6], { type: 'voice', mic: true }), /最多 6 人同时开麦/);
  assert.equal(f.last(W[7], 'voice').peers.filter((p) => p.mic).length, 6);
  assert.ok(f.last(W[7], 'voice').peers.every((p) => p.seat === -1), '观众没有座位');
});

test('配置 TURN 后下发可被 coturn 校验的临时凭证', (f) => {
  const A = f.socket('甲');
  f.hub.handle(A, { type: 'create' });
  const [stun, relay] = f.last(A, 'voice').ice;
  assert.deepEqual(stun, { urls: ['stun:example.com:3478'] });
  assert.deepEqual(relay.urls, ['turn:example.com:3478?transport=udp']);
  const [expiry, pid] = relay.username.split(':');
  assert.equal(Number(expiry), 1000 + 24 * 3600);
  assert.equal(pid, A.player.id);
  assert.equal(relay.credential, crypto.createHmac('sha1', 's3cret').update(relay.username).digest('base64'));
}, { turn: { urls: ['turn:example.com:3478?transport=udp'], secret: 's3cret', stun: ['stun:example.com:3478'] } });

console.log(`voice: ${count} passed`);
