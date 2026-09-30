const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const dataDir = process.env.GIFT_DATA_DIR || path.join(root, 'gift-data');
const defaultPort = Number(process.env.PORT || 4173);
const maxBodyBytes = 2_000_000;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) throw new Error('Gift size is too large. Please use smaller photos.');
  }
  return JSON.parse(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    // API: Save Gift -> Returns short link /g/<id>
    if (req.method === 'POST' && url.pathname === '/api/gifts') {
      const gift = await readJson(req);
      await fs.mkdir(dataDir, { recursive: true });
      let id;
      do { 
        id = crypto.randomBytes(4).toString('hex'); // 8-char short ID (e.g. a8f2k93x)
      } while (await fs.stat(path.join(dataDir, `${id}.json`)).then(() => true, () => false));
      
      await fs.writeFile(path.join(dataDir, `${id}.json`), JSON.stringify(gift));
      return send(res, 201, { id, url: `${url.origin}/g/${id}` });
    }

    // API: Fetch Gift by ID
    const giftMatch = url.pathname.match(/^\/api\/gifts\/([A-Za-z0-9_-]{6,12})$/);
    if (req.method === 'GET' && giftMatch) {
      const file = path.join(dataDir, `${giftMatch[1]}.json`);
      try { 
        const data = await fs.readFile(file, 'utf8');
        return send(res, 200, JSON.parse(data)); 
      } catch (err) { 
        return send(res, 404, { error: 'Gift not found.' }); 
      }
    }

    // Serve index.html for recipient link /g/<id> or root /
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html' || /^\/g\/[A-Za-z0-9_-]{6,12}$/.test(url.pathname))) {
      const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    // Static assets
    let filePath = path.join(root, url.pathname);
    const content = await fs.readFile(filePath).catch(() => null);
    if (content) {
      const ext = path.extname(filePath);
      let contentType = 'text/plain';
      if (ext === '.css') contentType = 'text/css';
      if (ext === '.js') contentType = 'application/javascript';
      if (ext === '.png') contentType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      return send(res, 200, content, contentType);
    }

    return send(res, 404, { error: 'Not found.' });
  } catch (err) {
    return send(res, 500, { error: err.message || 'Server error' });
  }
});

function listenOnPort(p) {
  server.listen(p, '0.0.0.0', () => {
    console.log(`💌 Little Love Notes running at http://localhost:${p}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${p} in use, trying ${p + 1}...`);
      listenOnPort(p + 1);
    } else {
      console.error(err);
    }
  });
}

listenOnPort(defaultPort);
