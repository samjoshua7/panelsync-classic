// Small local app server. Explicit allowlist excludes credentials/migration data.
import http from 'node:http';
import fs from 'node:fs';
const files = new Set(['index.html','admin.html','display.html','access-control.js','browser-storage.js','media-management.js','media-cache.js','dashboard.js','dashboard.css','playlist-draft.js']);
const port = Number(process.argv[2] || 5502);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid port');
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:' + port);
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!files.has(name) || !['GET','HEAD'].includes(request.method)) { response.writeHead(404).end(); return; }
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  response.setHeader('X-Content-Type-Options','nosniff');
  response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(new URL(name, import.meta.url)));
}).listen(port,'127.0.0.1',()=>console.log('New PanelSync app: http://127.0.0.1:' + port));
