import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const BASE_PORT = Number(process.env.PORT || 4178);
const MAX_PORT = BASE_PORT + 20;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const rawUrl = req.url || '/';
      const pathname = decodeURIComponent(rawUrl.split('?')[0]);
      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolved = path.resolve(ROOT_DIR, relPath);

      if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      const data = await fs.readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    } catch (err) {
      const notFound = err && (err.code === 'ENOENT' || err.code === 'EISDIR');
      const status = notFound ? 404 : 500;
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 404 ? 'Not Found' : 'Internal Server Error');
    }
  });
}

function listenWithFallback(port) {
  const server = createServer();
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && port < MAX_PORT) {
      listenWithFallback(port + 1);
      return;
    }
    console.error(err);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log(`READY http://${HOST}:${port}/`);
  });
}

listenWithFallback(BASE_PORT);
