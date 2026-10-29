// Local-only sign-in bridge. Never serve this script or the private directory.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, webcrypto } from 'node:crypto';
import { verifyFirebaseToken } from './auth.mjs';
const privateDir = path.resolve(fileURLToPath(new URL('../.migration-private/', import.meta.url)));
const directory = path.resolve(process.argv[2] || '');
if (!directory.startsWith(privateDir + path.sep) || !fs.statSync(directory).isDirectory()) throw new Error('Supply an isolated staging build directory');
const config = JSON.parse(fs.readFileSync(new URL('./config.local.json', import.meta.url), 'utf8'));
const nonce = randomBytes(32).toString('hex');
const origin = 'http://127.0.0.1:5501';
const loginExpires = Date.now() + 15 * 60 * 1000;
const helper = `<!doctype html><html><head><meta charset="utf-8"><title>PanelSync staging migration sign-in</title></head>
<body style="font:18px system-ui;max-width:650px;margin:60px auto;padding:20px">
<h1>Authorize staging migration</h1><p>Sign in as <strong>fxodapp@gmail.com</strong>. This authorizes the new Firebase project only. No password or token is shown or sent to chat.</p>
<button id="login" style="font:inherit;padding:12px">Sign in with Google</button><p id="status"></p>
<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
<script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js"></script>
<script>
firebase.initializeApp(${JSON.stringify(config.firebase)});
document.getElementById('login').onclick = async function () {
  const status = document.getElementById('status'); this.disabled = true;
  try {
    const provider = new firebase.auth.GoogleAuthProvider(); provider.setCustomParameters({prompt:'select_account',login_hint:'fxodapp@gmail.com'});
    const result = await firebase.auth().signInWithPopup(provider);
    if (result.user.email.toLowerCase() !== 'fxodapp@gmail.com') throw new Error('Choose fxodapp@gmail.com');
    const response = await fetch('/_migration/token', {method:'POST',headers:{'Content-Type':'application/json','X-Migration-Nonce':${JSON.stringify(nonce)}},body:JSON.stringify({idToken:await result.user.getIdToken(true)})});
    if (!response.ok) throw new Error('Local verification failed. Tell Codex; do not copy any tokens.');
    status.textContent = 'Authorized. You can return to Codex and say: signed in.';
  } catch(e) { status.textContent = e.code || e.message; this.disabled = false; }
};
</script></body></html>`;
const files = new Set(['index.html','admin.html','display.html','media-cache.js','browser-storage.js']);
let signedIn = false;
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.headers.host !== '127.0.0.1:5501') { response.writeHead(403).end(); return; }
  const url = new URL(request.url, origin);
  if (url.pathname === '/_migration/token' && request.method === 'POST') {
    if (Date.now() > loginExpires || request.headers.origin !== origin || request.headers['x-migration-nonce'] !== nonce) { response.writeHead(403).end(); return; }
    try {
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 20000) throw new Error('Too large'); }
      const { idToken } = JSON.parse(body);
      const claims = await verifyFirebaseToken(idToken, config.firebase.projectId, { subtle: webcrypto.subtle });
      if (claims.email.toLowerCase() !== config.bootstrapAdminEmail.toLowerCase()) throw new Error('Wrong account');
      fs.writeFileSync(path.join(privateDir, 'firebase-migration-session.json'), JSON.stringify({ idToken, expires: claims.exp }), { mode: 0o600 });
      signedIn = true;
      console.log('Verified destination administrator signed in. Private session saved; expires ' + new Date(claims.exp * 1000).toISOString());
      response.writeHead(204).end();
    } catch { response.writeHead(400).end('Sign-in verification failed'); }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  if (url.pathname === '/migration-login.html') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(request.method === 'HEAD' ? undefined : helper); return;
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!files.has(name)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(path.join(directory, name)));
});
server.listen(5501, '127.0.0.1', () => console.log('Staging sign-in: ' + origin + '/migration-login.html'));
// Limit the lifetime of the credential-accepting endpoint; static staging can
// remain open after sign-in for the subsequent display test.
setTimeout(() => { if (!signedIn) { console.log('Sign-in window expired; restart server to try again.'); server.close(); } }, 15 * 60 * 1000).unref();
