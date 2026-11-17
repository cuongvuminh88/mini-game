// API cho người chơi (/api/players, /api/rounds) và trang quản trị (/admin/*, /api/admin/*).
// Log không chứa dữ liệu cá nhân (QT-73): server.js chỉ ghi phương thức, đường dẫn, mã trạng thái.
'use strict';

const crypto = require('crypto');
const db = require('./db');
const Validate = require('../shared/validate');

const BODY_LIMIT = 10 * 1024;                 // 10 KB
const SESSION_MS = 8 * 60 * 60 * 1000;        // 8 giờ (QT-82)
const ADMIN_PASSWORD_MIN = 12;                // QT-80
const SESSION_COOKIE = 'admin_session';
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/* ------------------------------------------------------------------ */
/* Tiện ích HTTP                                                       */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, body) { super(String(status)); this.status = status; this.body = body; }
}

const ADMIN_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex',
};

function sendJson(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    if (!type.startsWith('application/json')) {
      reject(new HttpError(415, { error: 'Cần Content-Type: application/json' }));
      return;
    }
    let size = 0;
    const chunks = [];
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        failed = true;
        reject(new HttpError(413, { error: 'Dữ liệu quá lớn' }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, { error: 'JSON không hợp lệ' }));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function bearerToken(req) {
  const m = /^Bearer ([0-9a-f]{32})$/.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

function isHttps(req) {
  return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

// QT-83: yêu cầu thay đổi dữ liệu admin phải đến từ chính trang này
function sameOrigin(req) {
  const source = req.headers.origin || req.headers.referer;
  if (!source) return false;
  try {
    return new URL(source).host === req.headers.host;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Giới hạn tần suất (QT-70, QT-81) — đếm trong bộ nhớ                 */
/* ------------------------------------------------------------------ */

class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  _recent(key) {
    const cutoff = Date.now() - this.windowMs;
    const list = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  isBlocked(key) { return this._recent(key).length >= this.max; }
  record(key) { const list = this._recent(key); list.push(Date.now()); this.hits.set(key, list); }
  reset(key) { this.hits.delete(key); }
  prune() { for (const key of [...this.hits.keys()]) this._recent(key); }
}

const registerLimit = new RateLimiter(10, 10 * 60 * 1000);   // 10 lần / 10 phút / IP
const roundLimit = new RateLimiter(1, 20 * 1000);            // 1 lượt / 20 giây / token
const loginLimit = new RateLimiter(5, 15 * 60 * 1000);       // 5 lần sai / 15 phút / IP

/* ------------------------------------------------------------------ */
/* API người chơi                                                      */
/* ------------------------------------------------------------------ */

async function registerPlayer(req, res) {
  const ip = clientIp(req);
  if (registerLimit.isBlocked(ip)) {
    return sendJson(res, 429, { error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.' });
  }
  registerLimit.record(ip);

  const body = await readJson(req);
  const check = Validate.registration(body);
  if (!check.ok) return sendJson(res, 400, { errors: check.errors });

  const { fullName, email, phone } = check.values;
  const player = await db.registerPlayer({
    token: crypto.randomBytes(16).toString('hex'),        // QT-66
    fullName,
    nameSearch: Validate.foldForSearch(fullName),
    email,
    phone,
  });
  // QT-65: email đã có → cùng phản hồi 201 như đăng ký mới, trả tên vừa nhập
  console.log(`[player] ${player.created ? 'tạo mới' : 'dùng lại'} id=${player.id}`);
  sendJson(res, 201, { token: player.token, name: fullName });
}

async function getMe(req, res) {
  const token = bearerToken(req);
  const player = token && await db.findPlayerByToken(token);
  if (!player) return sendJson(res, 404, { error: 'Không tìm thấy người chơi' });
  sendJson(res, 200, { name: player.full_name });
}

async function saveRound(req, res) {
  const token = bearerToken(req);
  const body = await readJson(req);
  const player = token && await db.findPlayerByToken(token);
  if (!player) return sendJson(res, 404, { error: 'Không tìm thấy người chơi' });

  const check = Validate.round(body);
  if (!check.ok) return sendJson(res, 400, { error: 'Kết quả lượt không hợp lệ' });

  if (roundLimit.isBlocked(token)) return sendJson(res, 429, { error: 'Gửi kết quả quá nhanh' });
  roundLimit.record(token);

  await db.addRound(player.id, check.values);
  sendJson(res, 201, { ok: true });
}

/* ------------------------------------------------------------------ */
/* Quản trị                                                            */
/* ------------------------------------------------------------------ */

const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const adminEnabled = Boolean(ADMIN_USER) && ADMIN_PASSWORD.length >= ADMIN_PASSWORD_MIN;
if (!adminEnabled) {
  console.warn(`[admin] Trang quản trị TẮT: cần ADMIN_USER và ADMIN_PASSWORD (≥ ${ADMIN_PASSWORD_MIN} ký tự) trong .env`);
}

const sessions = new Map();   // sessionId → hết hạn lúc (ms)

// QT-80: so sánh mã băm để độ dài bằng nhau, thời gian không lộ thông tin
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function currentSession(req) {
  const id = parseCookies(req)[SESSION_COOKIE];
  if (!id) return null;
  const expires = sessions.get(id);
  if (!expires) return null;
  if (expires <= Date.now()) { sessions.delete(id); return null; }
  return id;
}

function isAdmin(req) {
  return adminEnabled && currentSession(req) !== null;
}

function sessionCookie(req, value, maxAgeSec) {
  const parts = [`${SESSION_COOKIE}=${value}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

async function login(req, res) {
  if (!adminEnabled) return sendJson(res, 503, { error: 'Trang quản trị chưa được bật.' }, ADMIN_HEADERS);
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Yêu cầu không hợp lệ' }, ADMIN_HEADERS);

  const ip = clientIp(req);
  if (loginLimit.isBlocked(ip)) {
    return sendJson(res, 429, { error: 'Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.' }, ADMIN_HEADERS);
  }
  const body = await readJson(req);
  // Luôn so sánh cả hai để thời gian phản hồi không lộ tên đăng nhập đúng hay sai
  const userOk = safeEqual(body.username, ADMIN_USER);
  const passOk = safeEqual(body.password, ADMIN_PASSWORD);
  if (!userOk || !passOk) {
    loginLimit.record(ip);
    console.log('[admin] đăng nhập sai');
    return sendJson(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' }, ADMIN_HEADERS);
  }
  loginLimit.reset(ip);
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, Date.now() + SESSION_MS);
  console.log('[admin] đăng nhập thành công');
  sendJson(res, 204, undefined, { ...ADMIN_HEADERS, 'Set-Cookie': sessionCookie(req, id, SESSION_MS / 1000) });
}

function logout(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Yêu cầu không hợp lệ' }, ADMIN_HEADERS);
  const id = currentSession(req);
  if (id) sessions.delete(id);
  sendJson(res, 204, undefined, { ...ADMIN_HEADERS, 'Set-Cookie': sessionCookie(req, '', 0) });
}

function requireAdmin(req, res) {
  if (!adminEnabled) { sendJson(res, 503, { error: 'Trang quản trị chưa được bật.' }, ADMIN_HEADERS); return false; }
  if (!currentSession(req)) { sendJson(res, 401, { error: 'Phiên đăng nhập đã hết hạn.' }, ADMIN_HEADERS); return false; }
  return true;
}

// QT-84: chuẩn bị từ khoá tìm kiếm
function parseSearch(url) {
  const raw = Validate.clean(url.searchParams.get('q') || '').slice(0, Validate.SEARCH_MAX);
  return {
    raw,
    folded: Validate.foldForSearch(raw),
    lower: raw.toLowerCase(),
    digits: raw.replace(/\D/g, ''),
  };
}

async function listPlayers(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const page = parseInt(url.searchParams.get('page'), 10) || 1;
  const result = await db.listPlayers(parseSearch(url), page);
  result.items = result.items.map(toPublicPlayer);
  sendJson(res, 200, result, ADMIN_HEADERS);
}

function toPublicPlayer(row) {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    consentAt: row.consent_at,
    rounds: row.rounds,
    bestScore: row.best_score,
    lastPlayed: row.last_played,
  };
}

async function deletePlayer(req, res, id) {
  if (!requireAdmin(req, res)) return;
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Yêu cầu không hợp lệ' }, ADMIN_HEADERS);
  const deleted = await db.deletePlayer(id);
  console.log(`[admin] xoá người chơi id=${id} ${deleted ? 'xong' : 'không tồn tại'}`);
  sendJson(res, deleted ? 204 : 404, deleted ? undefined : { error: 'Không tìm thấy người chơi' }, ADMIN_HEADERS);
}

/* ----- Xuất CSV (QT-85) ----- */

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function formatVnTime(value) {
  if (!value) return '';
  const p = Object.fromEntries(dateParts.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                  // chống chèn công thức
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function exportCsv(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const rows = await db.allPlayers(parseSearch(url));
  const header = ['Mã', 'Họ tên', 'Email', 'Số điện thoại', 'Ngày đăng ký', 'Đồng ý lúc', 'Số lượt', 'Điểm cao nhất', 'Lần chơi cuối'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.id, r.full_name, r.email, r.phone, formatVnTime(r.created_at), formatVnTime(r.consent_at),
      r.rounds, r.best_score === null ? '' : r.best_score, formatVnTime(r.last_played),
    ].map(csvCell).join(','));
  }
  const body = '﻿' + lines.join('\r\n') + '\r\n';
  const stamp = formatVnTime(new Date()).replace(/^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)$/, '$3$2$1-$4$5');
  res.writeHead(200, {
    ...ADMIN_HEADERS,
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="nguoi-choi-${stamp}.csv"`,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/* ------------------------------------------------------------------ */
/* Bộ định tuyến                                                       */
/* ------------------------------------------------------------------ */

const ROUTES = [
  { method: 'POST', path: '/api/players', handler: registerPlayer },
  { method: 'GET', path: '/api/players/me', handler: getMe },
  { method: 'POST', path: '/api/rounds', handler: saveRound },
  { method: 'POST', path: '/admin/login', handler: login },
  { method: 'POST', path: '/admin/logout', handler: logout },
  { method: 'GET', path: '/api/admin/players', handler: listPlayers },
  { method: 'GET', path: '/api/admin/players.csv', handler: exportCsv },
];
const DELETE_PLAYER = /^\/api\/admin\/players\/([1-9]\d{0,17})$/;

// Trả true nếu đường dẫn thuộc API (đã trả lời), false để server.js phục vụ file tĩnh.
function handle(req, res, urlPath, url) {
  const isApiPath = urlPath.startsWith('/api/') || urlPath === '/admin/login' || urlPath === '/admin/logout';
  let run = null;

  const route = ROUTES.find((r) => r.path === urlPath);
  const del = DELETE_PLAYER.exec(urlPath);
  if (route && route.method === req.method) run = () => route.handler(req, res, url);
  else if (del && req.method === 'DELETE') run = () => deletePlayer(req, res, Number(del[1]));

  if (!run) {
    // GET /admin/login là trang HTML, để server.js phục vụ
    if (urlPath === '/admin/login' && (req.method === 'GET' || req.method === 'HEAD')) return false;
    if (!isApiPath) return false;
    const allowed = route ? route.method : del ? 'DELETE' : null;
    if (allowed) {
      sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: allowed });
    } else {
      sendJson(res, 404, { error: 'Not Found' });
    }
    return true;
  }

  Promise.resolve()
    .then(run)
    .catch((err) => {
      if (err instanceof HttpError) return sendJson(res, err.status, err.body);
      console.error(`[api] lỗi ${req.method} ${urlPath}:`, err.code || err.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'Lỗi máy chủ' });
    });
  return true;
}

// Dọn bộ đếm và phiên hết hạn định kỳ
setInterval(() => {
  registerLimit.prune(); roundLimit.prune(); loginLimit.prune();
  const now = Date.now();
  for (const [id, exp] of sessions) if (exp <= now) sessions.delete(id);
}, 60 * 1000).unref();

module.exports = { handle, isAdmin, adminEnabled, ADMIN_HEADERS };
