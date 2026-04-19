const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INDEX_FILE = path.join(ROOT, 'catalogo-mayorista.html');
const PDF_DIR = path.join(ROOT, 'registros_pdf');
const META_DIR = path.join(PDF_DIR, '_meta');
const PORT = Number(process.env.PORT || 7788);

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
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
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
      if (size > maxBytes) {
        reject(new Error('Payload demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function routeSavePdf(req, res) {
  readBody(req)
    .then((raw) => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(res, 400, { ok: false, error: 'JSON invalido' });
        return;
      }

      const fileName = sanitizePdfName(body.fileName);
      const base64 = String(body.pdfBase64 || '');
      if (!base64) {
        sendJson(res, 400, { ok: false, error: 'pdfBase64 es requerido' });
        return;
      }

      let pdfBuffer = null;
      try {
        pdfBuffer = Buffer.from(base64, 'base64');
      } catch {
        sendJson(res, 400, { ok: false, error: 'pdfBase64 invalido' });
        return;
      }

      if (!pdfBuffer || pdfBuffer.length < 200) {
        sendJson(res, 400, { ok: false, error: 'Contenido PDF invalido' });
        return;
      }
      if (pdfBuffer.slice(0, 4).toString('utf8') !== '%PDF') {
        sendJson(res, 400, { ok: false, error: 'El archivo no parece un PDF valido' });
        return;
      }

      ensureDirs();
      let finalName = fileName;
      let finalPath = path.join(PDF_DIR, finalName);
      if (fs.existsSync(finalPath)) {
        finalName = makeUniqueFile(fileName);
        finalPath = path.join(PDF_DIR, finalName);
      }

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
        ok: true,
        fileName: finalName,
        pdfPath: path.relative(ROOT, finalPath).replace(/\\/g, '/'),
        metaPath: path.relative(ROOT, path.join(META_DIR, metaName)).replace(/\\/g, '/'),
      });
    })
    .catch((err) => {
      sendJson(res, 500, { ok: false, error: err.message || 'Error guardando PDF' });
    });
}

function routeStatic(req, res, pathname) {
  const rawPath = pathname === '/' ? '/catalogo-mayorista.html' : pathname;
  const safePath = decodeURIComponent(rawPath.split('?')[0]);
  const joined = path.join(ROOT, safePath.replace(/^\/+/, ''));
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(path.resolve(ROOT))) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    sendText(res, 404, 'Not Found');
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'catalogo-server', now: new Date().toISOString() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/guardar-pdf') {
    routeSavePdf(req, res);
    return;
  }

  if (req.method === 'GET') {
    routeStatic(req, res, pathname);
    return;
  }

  sendText(res, 405, 'Method Not Allowed');
});

server.listen(PORT, () => {
  ensureDirs();
  console.log(`Catalogo server listo en http://localhost:${PORT}`);
  console.log(`PDFs en: ${PDF_DIR}`);
});
