// Server tĩnh nhỏ cho game Đập Sếp — chỉ dùng module có sẵn của Node.js.
// /          -> app/
// /design/*  -> design/   (index.html nạp ../design/tokens.css)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const MOUNTS = [
  { prefix: '/design/', dir: path.join(ROOT, 'design') },
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

function resolveFile(urlPath) {
  const mount = MOUNTS.find((m) => urlPath.startsWith(m.prefix));
  let rel = urlPath.slice(mount.prefix.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(mount.dir, rel);
  // Chặn path traversal: file phải nằm trong thư mục được phục vụ
  if (file !== mount.dir && !file.startsWith(mount.dir + path.sep)) return null;
  // Không phục vụ file ẩn / file rác macOS (._*)
  if (path.basename(file).startsWith('.')) return null;
  return file;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'Method Not Allowed');
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  const file = resolveFile(urlPath);
  if (!file) return send(res, 404, 'Not Found');

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
    });
    console.log(`${req.method} ${urlPath} 200`);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Đập Sếp đang chạy tại http://localhost:${PORT}`);
});

// Dừng gọn khi Docker gửi tín hiệu
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
