'use strict';
// 胡闹运动会 · 联机服务：静态资源 + WebSocket
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const hub = require('./server/hub');

const { RACERS } = require('./game/racers');
const { TRACKS, FINISH, GOLD, SILVER, SCHEDULE } = require('./game/tracks');
const RACERS_JS = `window.RACERS=${JSON.stringify(RACERS)};window.TRACKS=${JSON.stringify(TRACKS)};window.FINISH=${FINISH};window.GOLD=${JSON.stringify(GOLD)};window.SILVER=${JSON.stringify(SILVER)};window.SCHEDULE=${JSON.stringify(SCHEDULE)};`;

const PORT = Number(process.env.PORT) || 8096;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: hub.rooms.size }));
  }
  if (url.pathname === '/racers-data.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
    return res.end(RACERS_JS);
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || !path.extname(file)) file = path.join(PUBLIC, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type !== 'hello' && !ws.player) return ws.send(JSON.stringify({ type: 'error', msg: '请先连接' }));
    try {
      const err = hub.handle(ws, msg);
      if (typeof err === 'string') ws.send(JSON.stringify({ type: 'error', msg: err, for: msg.type }));
    } catch (e) {
      console.error('处理消息出错', msg.type, e);
      ws.send(JSON.stringify({ type: 'error', msg: '服务器开小差了' }));
    }
  });
  ws.on('close', () => hub.disconnect(ws));
});

// 心跳，清理掉线连接
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

server.listen(PORT, HOST, () => console.log(`胡闹运动会 已启动：http://${HOST}:${PORT}`));
