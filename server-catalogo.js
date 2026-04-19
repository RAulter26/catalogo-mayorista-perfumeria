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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip', '.pdf': 'application/pdf',
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
  return String(input || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

function sanitizePdfName(name) {
  const raw = safeFilePart(name || 'cotizacion_cliente.pdf') || 'cotizacion_cliente.pdf';
  const base = raw.endsWith('.pdf') ? raw.slice(0, -4) : raw;
  const noDots = base.replace(/\.+/g, '_') || 'cotizacion_cliente';
  return `${noDots}.pdf`;
}

function makeUniqueFile(fileName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${fileName.replace(/\.pdf$/i, '')}_${stamp}.pdf`;
}

function readBody(req, maxBytes = 18 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Payload demasiado grande')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function loadQuotes() {
  ensureDirs();
  try {
    return fs.readdirSync(META_DIR).filter(f => f.endsWith('.json')).map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(META_DIR, f), 'utf8')); } catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch { return []; }
}

function deletePdfRecord(fileName) {
  const safe = path.basename(fileName);
  const pdfPath = path.join(PDF_DIR, safe);
  const metaPath = path.join(META_DIR, safe.replace(/\.pdf$/i, '.json'));
  let deleted = 0;
  if (fs.existsSync(pdfPath)) { fs.unlinkSync(pdfPath); deleted++; }
  if (fs.existsSync(metaPath)) { fs.unlinkSync(metaPath); deleted++; }
  return deleted > 0;
}

// ── Routes ──────────────────────────────────────────────────────────────────

function routeSavePdf(req, res) {
  readBody(req).then((raw) => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {
      sendJson(res, 400, { ok: false, error: 'JSON invalido' }); return;
    }
    const fileName = sanitizePdfName(body.fileName);
    const base64 = String(body.pdfBase64 || '');
    if (!base64) { sendJson(res, 400, { ok: false, error: 'pdfBase64 es requerido' }); return; }
    let pdfBuffer;
    try { pdfBuffer = Buffer.from(base64, 'base64'); } catch {
      sendJson(res, 400, { ok: false, error: 'pdfBase64 invalido' }); return;
    }
    if (!pdfBuffer || pdfBuffer.length < 200) { sendJson(res, 400, { ok: false, error: 'Contenido PDF invalido' }); return; }
    if (pdfBuffer.slice(0, 4).toString('utf8') !== '%PDF') { sendJson(res, 400, { ok: false, error: 'No parece un PDF valido' }); return; }

    ensureDirs();
    let finalName = fileName;
    let finalPath = path.join(PDF_DIR, finalName);
    if (fs.existsSync(finalPath)) { finalName = makeUniqueFile(fileName); finalPath = path.join(PDF_DIR, finalName); }

    fs.writeFileSync(finalPath, pdfBuffer);
    const meta = {
      fileName: finalName, createdAt: new Date().toISOString(),
      sourceIp: req.socket.remoteAddress || '', bytes: pdfBuffer.length,
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

function routeAdminDelete(req, res) {
  readBody(req).then((raw) => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}
    if (body.key !== ADMIN_KEY) { sendJson(res, 401, { ok: false, error: 'No autorizado' }); return; }
    if (body.deleteAll) {
      const quotes = loadQuotes();
      quotes.forEach(q => deletePdfRecord(q.fileName));
      sendJson(res, 200, { ok: true, deleted: quotes.length });
    } else if (body.fileName) {
      const ok = deletePdfRecord(body.fileName);
      sendJson(res, ok ? 200 : 404, { ok, fileName: body.fileName });
    } else {
      sendJson(res, 400, { ok: false, error: 'fileName o deleteAll requerido' });
    }
  }).catch(() => sendJson(res, 500, { ok: false, error: 'Error al eliminar' }));
}

function routeAdmin(req, res, urlObj) {
  const key = urlObj.searchParams.get('key') || '';
  if (key !== ADMIN_KEY) {
    sendHtml(res, 401, `<!doctype html><html><head><meta charset="utf-8"><title>Admin</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,sans-serif;background:#f5f0e8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;padding:2.5rem 2rem;width:320px;box-shadow:0 8px 32px rgba(0,0,0,.10)}
h2{margin:0 0 1.5rem;font-size:1.2rem;color:#1a1209}
input{width:100%;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:15px;margin-bottom:12px}
button{width:100%;padding:11px;background:#1a1209;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer}
.err{color:#c0392b;font-size:13px;margin-top:8px}</style></head>
<body><div class="card"><h2>🔒 Panel Admin</h2>
<form method="GET" action="/admin">
<input type="password" name="key" placeholder="Contraseña" autofocus>
<button type="submit">Entrar</button>
${urlObj.searchParams.has('key') ? '<p class="err">Contraseña incorrecta</p>' : ''}
</form></div></body></html>`);
    return;
  }

  const quotes = loadQuotes();
  const cities = [...new Set(quotes.map(q => q.payload?.client?.city).filter(Boolean))].sort();
  const fmt = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  const fmtKb = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  const fmtMoney = (v) => v ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v) : '—';

  const rows = quotes.map((q, i) => {
    const c = q.payload?.client || {};
    const items = q.payload?.items || [];
    return `<tr data-city="${(c.city || '').toLowerCase()}">
      <td><span class="num">${quotes.length - i}</span></td>
      <td>${fmt(q.createdAt)}</td>
      <td><strong>${c.name || '—'}</strong>${c.city ? `<br><small>${c.city}</small>` : ''}</td>
      <td>${c.phone ? `<a href="https://wa.me/57${c.phone.replace(/\D/g, '')}" target="_blank">${c.phone}</a>` : '—'}</td>
      <td>${items.length} ref.</td>
      <td>${fmtMoney(q.payload?.total)}</td>
      <td>${fmtKb(q.bytes)}</td>
      <td class="actions">
        <button class="btn-view" onclick="openPdf('/registros_pdf/${encodeURIComponent(q.fileName)}')">👁 Ver</button>
        <a class="btn-dl" href="/registros_pdf/${encodeURIComponent(q.fileName)}" download>⬇</a>
        <button class="btn-del" onclick="deleteOne('${q.fileName.replace(/'/g, "\\'")}', this)">🗑</button>
      </td>
    </tr>`;
  }).join('');

  const cityOptions = cities.map(c => `<option value="${c.toLowerCase()}">${c}</option>`).join('');

  sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8">
<title>Admin · Cotizaciones (${quotes.length})</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,sans-serif;background:#f5f0e8;color:#1a1209}
header{background:#1a1209;color:#fff;padding:1rem 2rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
header h1{margin:0;font-size:1.1rem;font-weight:600;flex:1}
.badge{background:#b5862a;color:#fff;border-radius:20px;padding:2px 12px;font-size:13px}
.toolbar{padding:1rem 2rem;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:1100px;margin:0 auto}
.toolbar select,.toolbar input{padding:7px 12px;border:1px solid #d4c9b4;border-radius:8px;font-size:13px;background:#fff;color:#1a1209}
.btn-danger{padding:7px 16px;background:#c0392b;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;margin-left:auto}
.btn-danger:hover{background:#a93226}
main{padding:0 2rem 2rem;max-width:1100px;margin:0 auto}
.meta{font-size:12px;color:#9a8a72;margin-bottom:1rem}
table{width:100%;background:#fff;border-radius:12px;border-collapse:collapse;box-shadow:0 2px 12px rgba(0,0,0,.07)}
thead tr{background:#2e2010;color:#fff}
th{padding:10px 12px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
td{padding:9px 12px;border-bottom:1px solid #f0ebe0;font-size:13px;vertical-align:middle}
tr:last-child td{border:none}tr:hover td{background:#fdf9f2}
tr.hidden{display:none}
.num{background:#eee;border-radius:4px;padding:2px 6px;font-size:11px;color:#888}
small{color:#999;font-size:11px}a{color:#b5862a}
.actions{display:flex;gap:5px;align-items:center}
.btn-view{padding:4px 10px;background:#2e5fa3;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap}
.btn-view:hover{background:#1e4a8a}
.btn-dl{background:#1a1209;color:#fff;padding:5px 10px;border-radius:6px;text-decoration:none;font-size:12px}
.btn-dl:hover{background:#2e2010}
.btn-del{padding:4px 10px;background:#e74c3c;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer}
.btn-del:hover{background:#c0392b}
.empty{text-align:center;padding:3rem;color:#aaa}
/* Modal */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center}
.modal-overlay.open{display:flex}
.modal-box{background:#fff;border-radius:12px;width:90vw;height:90vh;display:flex;flex-direction:column;overflow:hidden}
.modal-head{display:flex;align-items:center;padding:12px 16px;background:#1a1209;color:#fff;gap:10px}
.modal-head span{flex:1;font-size:14px;font-weight:600}
.modal-head button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0 4px}
.modal-body{flex:1;overflow:hidden}
.modal-body iframe{width:100%;height:100%;border:none}
</style>
</head><body>
<header>
  <h1>Cotizaciones Mayorista</h1>
  <span class="badge" id="count-badge">${quotes.length} registros</span>
</header>
<div class="toolbar">
  <input type="text" id="filter-name" placeholder="🔍 Buscar cliente..." oninput="applyFilter()">
  <select id="filter-city" onchange="applyFilter()">
    <option value="">Todas las ciudades</option>
    ${cityOptions}
  </select>
  <button class="btn-danger" onclick="deleteAll()">🗑 Eliminar todo</button>
</div>
<main>
  <p class="meta">Solo administradores · ${new Date().toLocaleString('es-CO')} · <span id="visible-count">${quotes.length}</span> mostrando</p>
  <table id="tabla">
    <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Items</th><th>Total</th><th>Tamaño</th><th>Acciones</th></tr></thead>
    <tbody id="tbody">${rows || '<tr><td colspan="8" class="empty">Sin cotizaciones guardadas aún</td></tr>'}</tbody>
  </table>
</main>

<!-- Modal visor PDF -->
<div class="modal-overlay" id="modal">
  <div class="modal-box">
    <div class="modal-head">
      <span id="modal-title">Cotización</span>
      <a id="modal-dl" href="#" download style="color:#f0c040;font-size:13px;text-decoration:none">⬇ Descargar</a>
      <button onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body"><iframe id="modal-frame" src=""></iframe></div>
  </div>
</div>

<script>
const ADMIN_KEY = '${ADMIN_KEY}';

function applyFilter() {
  const name = document.getElementById('filter-name').value.toLowerCase();
  const city = document.getElementById('filter-city').value.toLowerCase();
  const rows = document.querySelectorAll('#tbody tr[data-city]');
  let visible = 0;
  rows.forEach(row => {
    const rowCity = row.dataset.city || '';
    const rowText = row.textContent.toLowerCase();
    const show = (!name || rowText.includes(name)) && (!city || rowCity === city);
    row.classList.toggle('hidden', !show);
    if (show) visible++;
  });
  document.getElementById('visible-count').textContent = visible;
}

function openPdf(url) {
  const modal = document.getElementById('modal');
  document.getElementById('modal-frame').src = url;
  document.getElementById('modal-dl').href = url;
  document.getElementById('modal-title').textContent = decodeURIComponent(url.split('/').pop());
  modal.classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  document.getElementById('modal-frame').src = '';
}

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

async function deleteOne(fileName, btn) {
  if (!confirm('¿Eliminar esta cotización?')) return;
  btn.disabled = true;
  const r = await fetch('/api/admin/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: ADMIN_KEY, fileName })
  });
  if ((await r.json()).ok) {
    const row = btn.closest('tr');
    row.remove();
    const remaining = document.querySelectorAll('#tbody tr[data-city]').length;
    document.getElementById('count-badge').textContent = remaining + ' registros';
    document.getElementById('visible-count').textContent = remaining;
  }
}

async function deleteAll() {
  const total = document.querySelectorAll('#tbody tr[data-city]').length;
  if (!total) return alert('No hay cotizaciones.');
  if (!confirm('¿Eliminar TODAS las ' + total + ' cotizaciones? Esta acción no se puede deshacer.')) return;
  const r = await fetch('/api/admin/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: ADMIN_KEY, deleteAll: true })
  });
  if ((await r.json()).ok) {
    document.getElementById('tbody').innerHTML = '<tr><td colspan="8" class="empty">Sin cotizaciones guardadas aún</td></tr>';
    document.getElementById('count-badge').textContent = '0 registros';
    document.getElementById('visible-count').textContent = '0';
  }
}
</script>
</body></html>`);
}

function routeStatic(req, res, pathname) {
  const rawPath = pathname === '/' ? '/catalogo-mayorista.html' : pathname;
  const safePath = decodeURIComponent(rawPath.split('?')[0]);
  const joined = path.join(ROOT, safePath.replace(/^\/+/, ''));
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(path.resolve(ROOT))) { sendText(res, 403, 'Forbidden'); return; }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) { sendText(res, 404, 'Not Found'); return; }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(resolved).pipe(res);
}

// ── Server ───────────────────────────────────────────────────────────────────

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

  if (req.method === 'POST' && pathname === '/api/guardar-pdf') { routeSavePdf(req, res); return; }
  if (req.method === 'POST' && pathname === '/api/admin/delete') { routeAdminDelete(req, res); return; }
  if (req.method === 'GET' && pathname === '/admin') { routeAdmin(req, res, urlObj); return; }

  if (req.method === 'GET') { routeStatic(req, res, pathname); return; }

  sendText(res, 405, 'Method Not Allowed');
});

server.listen(PORT, () => {
  ensureDirs();
  console.log(`Catalogo server listo en http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin?key=${ADMIN_KEY}`);
  console.log(`PDFs en: ${PDF_DIR}`);
});
