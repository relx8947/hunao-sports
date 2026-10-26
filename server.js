'use strict';
// 胡闹运动会 · 联机服务：静态资源 + WebSocket
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocket, WebSocketServer } = require('ws');
const defaultHub = require('./server/hub');

const { RACERS, RACERS_ALL, TWISTS } = require('./game/racers');
const { TRACKS, FINISH, GOLD, SILVER, SCHEDULE, EDITIONS, EDITION_KEYS, DEFAULT_EDITION } = require('./game/tracks');
// 现有前端读取的 RACERS/TRACKS/SCHEDULE 保持一代内容不变；二代与混合模式的数据放在新增的 *_ALL/EDITIONS/TWISTS 里。
const TRACKS_V1 = { mild: TRACKS.mild, wild: TRACKS.wild };
const RACERS_JS = `window.RACERS=${JSON.stringify(RACERS)};window.TRACKS=${JSON.stringify(TRACKS_V1)};window.FINISH=${FINISH};window.GOLD=${JSON.stringify(GOLD)};window.SILVER=${JSON.stringify(SILVER)};window.SCHEDULE=${JSON.stringify(SCHEDULE)};` +
  `window.RACERS_ALL=${JSON.stringify(RACERS_ALL)};window.TRACKS_ALL=${JSON.stringify(TRACKS)};window.TWISTS=${JSON.stringify(TWISTS)};window.EDITIONS=${JSON.stringify(EDITIONS)};window.DEFAULT_EDITION=${JSON.stringify(DEFAULT_EDITION)};`;

const PORT = Number(process.env.PORT) || 8096;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const RESPONSE_HEADERS = {
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

function reply(req, res, status, body, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    ...RESPONSE_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
    ...(status >= 400 ? { 'Cache-Control': 'no-store' } : {}),
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function boundedString(value, max) { return typeof value === 'string' && value.length <= max; }
function optionalString(value, max) { return value == null || boundedString(value, max); }
const NO_PAYLOAD = new Set(['leave', 'addAI', 'start', 'speed', 'lobby', 'replay', 'again', 'skip']);
const optionalEdition = (value) => value === undefined || (typeof value === 'string' && EDITION_KEYS.includes(value));

// 不将数组/对象/字符串数字强制转换成业务字段，避免非法输入绕过席位、决策或开关校验。
function messageError(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || !boundedString(msg.type, 32) || !msg.type) return '消息格式不正确';
  if (msg.type === 'listRooms') return Object.keys(msg).every((key) => key === 'type') ? null : '指令参数不正确';
  if (NO_PAYLOAD.has(msg.type)) return null;
  let valid;
  switch (msg.type) {
    case 'hello': valid = optionalString(msg.token, 128) && optionalString(msg.name, 128); break;
    case 'setName': valid = boundedString(msg.name, 128); break;
    case 'join': valid = boundedString(msg.code, 16) && /^[a-z2-9]{4}$/i.test(msg.code); break;
    case 'removeAI': valid = Number.isInteger(msg.seat) && msg.seat >= 0 && msg.seat < 6; break;
    case 'create': valid = optionalEdition(msg.edition); break;
    case 'edition': valid = typeof msg.edition === 'string' && EDITION_KEYS.includes(msg.edition); break;
    case 'quick': valid = (msg.ai === undefined || (Number.isInteger(msg.ai) && msg.ai >= 2 && msg.ai <= 5)) && optionalEdition(msg.edition); break;
    case 'watch': valid = (msg.ai === undefined || (Number.isSafeInteger(msg.ai) && msg.ai >= 3 && msg.ai <= 6)) && optionalEdition(msg.edition); break;
    case 'act':
      valid = boundedString(msg.gameId, 64) && msg.gameId.length > 0 &&
        Number.isSafeInteger(msg.id) && msg.id > 0 &&
        (boundedString(msg.value, 128) || typeof msg.value === 'boolean' || msg.value === null ||
          (typeof msg.value === 'number' && Number.isFinite(msg.value)));
      break;
    case 'auto': valid = typeof msg.on === 'boolean'; break;
    case 'emote': valid = boundedString(msg.key, 32) && msg.key.length > 0; break;
    default: return '未知指令';
  }
  return valid ? null : '指令参数不正确';
}

function sendError(ws, text, type, hub) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (type === 'act') hub.recover(ws);
  ws.send(JSON.stringify({ type: 'error', msg: text, ...(type ? { for: type } : {}), ...hub.errorContext(ws, type) }));
}

// require() 不监听端口；测试和本地预览可以绑定 loopback 临时端口。
function createServer({ publicDir = PUBLIC, hub } = {}) {
  const publicRoot = fs.realpathSync(publicDir);
  const ownsHub = !hub;
  hub ||= defaultHub.createHub();
  let stopped = false;
  function disconnect(ws) {
    if (ws.hubDisconnected) return;
    ws.hubDisconnected = true;
    try { hub.disconnect(ws); }
    catch (err) { console.error('清理连接出错', err); }
  }
  async function request(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply(req, res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    }
    // 保留原始路径，不能先让 URL 规范化掉 ../ 再做静态根目录检查。
    const rawPath = (req.url || '').split('?')[0];
    if (!rawPath.startsWith('/')) return reply(req, res, 400, 'bad request');
    let pathname;
    try { pathname = decodeURIComponent(rawPath); }
    catch { return reply(req, res, 400, 'bad request'); }
    if (/[\u0000-\u001f\u007f]/.test(pathname)) return reply(req, res, 400, 'bad request');
    if (pathname.includes('\\') || pathname.split('/').includes('..')) return reply(req, res, 403, 'forbidden');

    if (pathname === '/healthz') {
      return reply(req, res, 200, JSON.stringify({ ok: true, rooms: hub.rooms.size }), { 'Content-Type': MIME['.json'] });
    }
    if (pathname === '/racers-data.js') {
      return reply(req, res, 200, RACERS_JS, { 'Content-Type': MIME['.js'] });
    }
    let file = path.resolve(publicRoot, `.${pathname}`);
    if (!inside(publicRoot, file)) return reply(req, res, 403, 'forbidden');
    // 保持原有无扩展名的前端路由回退；带扩展名的缺失资源必须返回 404。
    if (pathname === '/' || !path.extname(file)) file = path.join(publicRoot, 'index.html');
    try {
      // 文本前缀检查不能隔离 public-other，同样不能阻止指向目录外的软链接。
      file = await fs.promises.realpath(file);
      if (!inside(publicRoot, file)) return reply(req, res, 403, 'forbidden');
      const buf = await fs.promises.readFile(file);
      return reply(req, res, 200, buf, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    } catch (err) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(err.code)) return reply(req, res, 404, 'not found');
      if (['EACCES', 'EPERM'].includes(err.code)) return reply(req, res, 403, 'forbidden');
      throw err;
    }
  }

  const server = http.createServer((req, res) => {
    request(req, res).catch((err) => {
      console.error('HTTP 请求处理出错', err.code || err.message);
      if (res.headersSent) res.destroy();
      else reply(req, res, 500, 'internal server error');
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  server.wss = wss;
  // ws 会转发 HTTP server 的 error；绑定失败仍交给 server 的调用方处理。
  wss.on('error', () => {});
  wss.on('connection', (ws) => {
    ws.on('close', () => disconnect(ws));
    if (stopped) { disconnect(ws); ws.terminate(); return; }
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // 超长帧、非法 UTF-8 等由 ws 关闭连接，但 error 无监听会使整个进程退出。
    ws.on('error', () => {});
    ws.on('message', (raw, isBinary) => {
      if (stopped) return;
      if (isBinary) return sendError(ws, '只支持文本消息', undefined, hub);
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return sendError(ws, '消息格式不正确', undefined, hub); }
      const type = msg && boundedString(msg.type, 32) ? msg.type : undefined;
      const validationError = messageError(msg);
      if (validationError) return sendError(ws, validationError, type, hub);
      if (msg.type !== 'hello' && !ws.player) return sendError(ws, '请先连接', msg.type, hub);
      try {
        const err = hub.handle(ws, msg);
        if (typeof err === 'string') sendError(ws, err, msg.type, hub);
      } catch (err) {
        console.error('处理消息出错', msg.type, err);
        sendError(ws, '服务器开小差了', msg.type, hub);
      }
    });
  });

  // 心跳只访问可写连接；关闭 factory 同时释放升级连接和计时器。
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  const close = server.close;
  const closeCallbacks = [];
  let httpClosed = false, wsClosed = false, closeFinished = false, closeError;
  function finishClose() {
    if (!httpClosed || !wsClosed || closeFinished) return;
    closeFinished = true;
    for (const callback of closeCallbacks.splice(0)) process.nextTick(() => callback.call(server, closeError));
  }
  server.close = function (callback) {
    if (typeof callback === 'function') {
      if (closeFinished) process.nextTick(() => callback.call(server, closeError));
      else closeCallbacks.push(callback);
    }
    if (stopped) return this;
    stopped = true;
    clearInterval(heartbeat);
    // 先移除升级入口，再同步解绑身份。terminate 的 close 事件是异步的，不能靠它取消对局计时器。
    wss.close(() => { wsClosed = true; finishClose(); });
    for (const ws of [...wss.clients]) { disconnect(ws); ws.terminate(); }
    if (ownsHub) hub.dispose();
    // HTTP 与所有升级连接均完成关闭后才通知调用方；未监听/监听失败仍返回原生 HTTP close 错误。
    close.call(this, (err) => { closeError = err; httpClosed = true; finishClose(); });
    return this;
  };
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  const logDir = process.env.HUNAO_LOG_DIR
    || (process.env.STATE_DIRECTORY ? path.join(process.env.STATE_DIRECTORY.split(':')[0], 'games') : path.join(__dirname, 'logs', 'games'));
  const hub = defaultHub.createHub({ logDir });
  const server = createServer({ hub });
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { hub.shutdownLogs(); process.exit(0); });
  server.on('error', (err) => {
    console.error('服务启动失败', err.message);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => console.log(`胡闹运动会 已启动：http://${HOST}:${PORT}，对局日志 ${logDir}`));
}
