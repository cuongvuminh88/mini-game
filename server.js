// Server nhỏ cho game Đập Sếp.
// /             -> app/      (game)
// /design/*     -> design/   (index.html nạp ../design/tokens.css)
// /shared/*     -> shared/   (validate.js dùng chung trình duyệt + máy chủ)
// /admin        -> admin/index.html (phải đăng nhập), /admin/login -> admin/login.html
// /api/*        -> lib/api.js (đăng ký, lưu lượt, quản trị) — lưu vào PostgreSQL
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const api = require('./lib/api');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const ADMIN_DIR = path.join(ROOT, 'admin');

const MOUNTS = [
  { prefix: '/design/', dir: path.join(ROOT, 'design') },
  { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
  { prefix: '/admin/', dir: ADMIN_DIR, noHtml: true },
  { prefix: '/', dir: path.join(ROOT, 'app') },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function resolveFile(urlPath) {
  const mount = MOUNTS.find((m) => urlPath.startsWith(m.prefix));
  let rel = urlPath.slice(mount.prefix.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(mount.dir, rel);
  // Chặn path traversal: file phải nằm trong thư mục được phục vụ
  if (file !== mount.dir && !file.startsWith(mount.dir + path.sep)) return null;
  // Không phục vụ file ẩn / file rác macOS (._*)
  if (path.basename(file).startsWith('.')) return null;
  // Trang HTML của admin chỉ đi qua route /admin và /admin/login (có kiểm tra phiên)
  if (mount.noHtml && path.extname(file) === '.html') return null;
  return file;
}

function serveFile(req, res, urlPath, file, extraHeaders = {}) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      console.log(`${req.method} ${urlPath} 404`);
      return send(res, 404, 'Not Found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    });
    console.log(`${req.method} ${urlPath} 200`);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  let urlPath;
  try {
    url = new URL(req.url, 'http://localhost');
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  // Log chỉ có đường dẫn, không kèm query string (QT-73)
  // (file tĩnh tự ghi log trong serveFile)
  res.on('finish', () => {
    if (urlPath.startsWith('/api/') || !/^(GET|HEAD)$/.test(req.method)) {
      console.log(`${req.method} ${urlPath} ${res.statusCode}`);
    }
  });

  if (api.handle(req, res, urlPath, url)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'Method Not Allowed');
  }

  // Trang quản trị
  if (urlPath === '/admin' || urlPath === '/admin/') {
    if (!api.isAdmin(req)) return redirect(res, '/admin/login');
    return serveFile(req, res, urlPath, path.join(ADMIN_DIR, 'index.html'), api.ADMIN_HEADERS);
  }
  if (urlPath === '/admin/login') {
    if (api.isAdmin(req)) return redirect(res, '/admin');
    return serveFile(req, res, urlPath, path.join(ADMIN_DIR, 'login.html'), api.ADMIN_HEADERS);
  }

  const file = resolveFile(urlPath);
  if (!file) return send(res, 404, 'Not Found');
  serveFile(req, res, urlPath, file);
});

async function start() {
  try {
    await db.init();
    console.log('[db] đã kết nối PostgreSQL, bảng sẵn sàng');
  } catch (err) {
    // QT-78: không có database thì dừng hẳn để Docker báo lỗi rõ ràng
    console.error('[db] không kết nối được PostgreSQL:', err.code || err.message);
    process.exit(1);
  }
  server.listen(PORT, HOST, () => {
    console.log(`Đập Sếp đang chạy tại http://localhost:${PORT}`);
  });
}

start();

// Dừng gọn khi Docker gửi tín hiệu
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => db.pool.end().finally(() => process.exit(0))));
}
