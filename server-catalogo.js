const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PDF_DIR = path.join(ROOT, 'registros_pdf');
const META_DIR = path.join(PDF_DIR, '_meta');
const PORT = Number(process.env.PORT || 7788);
const ADMIN_KEY = process.env.ADMIN_KEY || 'perfumeria2026';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
};

function ensureDirs() {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  fs.mkdirSync(META_DIR, { recursive: true });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function safeFilePart(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function sanitizePdfName(name) {
  const raw = safeFilePart(name || 'cotizacion_cliente.pdf') || 'cotizacion_cliente.pdf';
  const base = raw.endsWith('.pdf') ? raw.slice(0, -4) : raw;
  const noDots = base.replace(/\.+/g, '_') || 'cotizacion_cliente';
  return `${noDots}.pdf`;
}

function makeUniqueFile(fileName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = fileName.replace(/\.pdf$/i, '');
  return `${base}_${stamp}.pdf`;
}

function readBody(req, maxBytes = 18 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Payload demasiado grande')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function routeSavePdf(req, res) {
  readBody(req).then((raw) => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {
      sendJson(res, 400, { ok: false, error: 'JSON invalido' }); return;
    }
    const fileName = sanitizePdfName(body.fileName);
    const base64 = String(body.pdfBase64 || '');
    if (!base64) { sendJson(res, 400, { ok: false, error: 'pdfBase64 es requerido' }); return; }
    let pdfBuffer = null;
    try { pdfBuffer = Buffer.from(base64, 'base64'); } catch {
      sendJson(res, 400, { ok: false, error: 'pdfBase64 invalido' }); return;
    }
    if (!pdfBuffer || pdfBuffer.length < 200) { sendJson(res, 400, { ok: false, error: 'Contenido PDF invalido' }); return; }
    if (pdfBuffer.slice(0, 4).toString('utf8') !== '%PDF') { sendJson(res, 400, { ok: false, error: 'El archivo no parece un PDF valido' }); return; }

    ensureDirs();
    let finalName = fileName;
    let finalPath = path.join(PDF_DIR, finalName);
    if (fs.existsSync(finalPath)) { finalName = makeUniqueFile(fileName); finalPath = path.join(PDF_DIR, finalName); }

    fs.writeFileSync(finalPath, pdfBuffer);
    const meta = {
      fileName: finalName,
      createdAt: new Date().toISOString(),
      sourceIp: req.socket.remoteAddress || '',
      bytes: pdfBuffer.length,
      payload: body.payload || null,
    };
    const metaName = finalName.replace(/\.pdf$/i, '.json');
    fs.writeFileSync(path.join(META_DIR, metaName), JSON.stringify(meta, null, 2), 'utf8');
    sendJson(res, 200, {
      ok: true, fileName: finalName,
      pdfPath: path.relative(ROOT, finalPath).replace(/\\/g, '/'),
      metaPath: path.relative(ROOT, path.join(META_DIR, metaName)).replace(/\\/g, '/'),
    });
  }).catch((err) => sendJson(res, 500, { ok: false, error: err.message || 'Error guardando PDF' }));
}

function routeAdmin(req, res, urlObj) {
  const key = urlObj.searchParams.get('key') || '';

  if (key !== ADMIN_KEY) {
    sendHtml(res, 401, `<!doctype html><html><head><meta charset="utf-8">
<title>Admin · Catálogo Mayorista</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,sans-serif;background:#f5f0e8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;padding:2.5rem 2rem;width:320px;box-shadow:0 8px 32px rgba(0,0,0,.10)}
h2{margin:0 0 1.5rem;font-size:1.2rem;color:#1a1209}
input{width:100%;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:15px;margin-bottom:12px}
button{width:100%;padding:11px;background:#1a1209;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer}
button:hover{background:#2e2010}.err{color:#c0392b;font-size:13px;margin-top:8px}</style>
</head><body><div class="card">
<h2>🔒 Panel Admin</h2>
<form method="GET" action="/admin">
<input type="password" name="key" placeholder="Contraseña" autofocus>
<button type="submit">Entrar</button>
${urlObj.searchParams.has('key') ? '<p class="err">Contraseña incorrecta</p>' : ''}
</form></div></body></html>`);
    return;
  }

  ensureDirs();
  let quotes = [];
  try {
    const files = fs.readdirSync(META_DIR).filter(f => f.endsWith('.json'));
    quotes = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(META_DIR, f), 'utf8')); } catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch {}

  const fmt = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' });
  const fmtKb = (b) => b >= 1024*1024 ? (b/1024/1024).toFixed(1)+' MB' : Math.round(b/1024)+' KB';

  const rows = quotes.map((q, i) => {
    const c = q.payload?.client || {};
    const items = q.payload?.items || [];
    const total = q.payload?.total;
    const totalStr = total ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(total) : '—';
    return `<tr>
      <td><span class="num">${quotes.length - i}</span></td>
      <td>${fmt(q.createdAt)}</td>
      <td><strong>${c.name || '—'}</strong>${c.city ? `<br><small>${c.city}</small>` : ''}</td>
      <td>${c.phone ? `<a href="https://wa.me/57${c.phone.replace(/\D/g,'')}" target="_blank">${c.phone}</a>` : '—'}</td>
      <td>${items.length} ref.</td>
      <td>${totalStr}</td>
      <td>${fmtKb(q.bytes)}</td>
      <td><a class="btn-dl" href="/registros_pdf/${encodeURIComponent(q.fileName)}" download>⬇ PDF</a></td>
    </tr>`;
  }).join('');

  sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8">
<title>Admin · Cotizaciones (${quotes.length})</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,sans-serif;background:#f5f0e8;color:#1a1209}
header{background:#1a1209;color:#fff;padding:1rem 2rem;display:flex;align-items:center;gap:1rem}
header h1{margin:0;font-size:1.1rem;font-weight:600}header .badge{background:#b5862a;color:#fff;border-radius:20px;padding:2px 12px;font-size:13px}
main{padding:1.5rem 2rem;max-width:1100px;margin:0 auto}
.meta{font-size:13px;color:#7a6a52;margin-bottom:1.2rem}
table{width:100%;background:#fff;border-radius:12px;border-collapse:collapse;box-shadow:0 2px 12px rgba(0,0,0,.07);overflow:hidden}
thead tr{background:#2e2010;color:#fff}th{padding:10px 14px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
td{padding:10px 14px;border-bottom:1px solid #f0ebe0;font-size:13px;vertical-align:middle}
tr:last-child td{border:none}tr:hover td{background:#fdf9f2}
.num{background:#eee;border-radius:4px;padding:2px 6px;font-size:11px;color:#888}
small{color:#999;font-size:11px}a{color:#b5862a}
.btn-dl{background:#1a1209;color:#fff;padding:5px 12px;border-radius:6px;text-decoration:none;font-size:12px;white-space:nowrap}
.btn-dl:hover{background:#2e2010}.empty{text-align:center;padding:3rem;color:#aaa}</style>
</head><body>
<header><h1>Cotizaciones Mayorista</h1><span class="badge">${quotes.length} registros</span></header>
<main>
<p class="meta">Solo visible para administradores · Actualizado ${new Date().toLocaleString('es-CO')}</p>
<table>
<thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Items</th><th>Total</th><th>Tamaño</th><th>PDF</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" class="empty">Sin cotizaciones guardadas aún</td></tr>'}</tbody>
</table></main></body></html>`);
}

function routeStatic(req, res, pathname) {
  const rawPath = pathname === '/' ? '/catalogo-mayorista.html' : pathname;
  const safePath = decodeURIComponent(rawPath.split('?')[0]);
  const joined = path.join(ROOT, safePath.replace(/^\/+/, ''));
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(path.resolve(ROOT))) { sendText(res, 403, 'Forbidden'); return; }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) { sendText(res, 404, 'Not Found'); return; }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'catalogo-server', now: new Date().toISOString() }); return;
  }

  if (req.method === 'POST' && pathname === '/api/guardar-pdf') {
    routeSavePdf(req, res); return;
  }

  if (req.method === 'GET' && pathname === '/admin') {
    routeAdmin(req, res, urlObj); return;
  }

  if (req.method === 'GET') {
    routeStatic(req, res, pathname); return;
  }

  sendText(res, 405, 'Method Not Allowed');
});

server.listen(PORT, () => {
  ensureDirs();
  console.log(`Catalogo server listo en http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin?key=${ADMIN_KEY}`);
  console.log(`PDFs en: ${PDF_DIR}`);
});
