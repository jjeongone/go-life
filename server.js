// 사활 노트 로컬 서버: 정적 파일 제공 + data/problems/<id>.json 읽기/쓰기
// 의존성 없음. 실행: node server.js  (또는 npm start)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data', 'problems');
const PORT = Number(process.env.PORT) || 4848;
const HOST = process.env.HOST || '127.0.0.1';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listProblems() {
  return fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
      catch (e) { console.warn(`[skip] ${f}: ${e.message}`); return null; }
    })
    .filter(Boolean);
}

function writeProblem(id, p) {
  const file = path.join(DATA_DIR, id + '.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2) + '\n');
  fs.renameSync(tmp, file); // 중간에 끊겨도 파일이 깨지지 않도록
}

async function handleApi(req, res, parts) {
  // /api/problems, /api/problems/:id
  if (parts.length === 2 && req.method === 'GET') return send(res, 200, listProblems());
  if (parts.length !== 3) return send(res, 404, { error: 'not found' });
  const id = parts[2];
  if (!ID_RE.test(id)) return send(res, 400, { error: 'bad id' });
  const file = path.join(DATA_DIR, id + '.json');

  if (req.method === 'PUT') {
    let p;
    try { p = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    if (!p || p.id !== id || !Number.isInteger(p.size) || !Array.isArray(p.stones)) return send(res, 400, { error: 'invalid problem' });
    writeProblem(id, p);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'DELETE') {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'method not allowed' });
}

function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const file = path.normalize(path.join(ROOT, rel));
  const inside = file.startsWith(ROOT + path.sep);
  const hidden = path.relative(ROOT, file).split(path.sep).some((s) => s.startsWith('.'));
  const type = MIME[path.extname(file)];
  if (!inside || hidden || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), type);
}

http.createServer(async (req, res) => {
  try {
    const urlPath = new URL(req.url, 'http://x').pathname;
    const parts = urlPath.split('/').filter(Boolean);
    if (parts[0] === 'api' && parts[1] === 'problems') return await handleApi(req, res, parts);
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    serveStatic(req, res, urlPath);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, () => {
  console.log(`사활 노트: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`기록 저장 위치: ${path.relative(process.cwd(), DATA_DIR) || DATA_DIR}`);
});
