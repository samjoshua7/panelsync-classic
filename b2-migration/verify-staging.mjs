// Read-only acceptance checks. Never prints credentials or directory records.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const config = JSON.parse(fs.readFileSync(new URL('./config.local.json', import.meta.url), 'utf8'));
const session = JSON.parse(fs.readFileSync(new URL('../.migration-private/firebase-migration-session.json', import.meta.url), 'utf8'));
const base = config.firebase.databaseURL.replace(/\/$/, '');
const api = config.mediaApi.replace(/\/$/, '');
const authorized = { Authorization: 'Bearer ' + session.idToken };
const objects = new Map();
let departments = 0;
function inventory(value) {
  if (!value || typeof value !== 'object') return;
  if (value.url) {
    assert.ok(value.url.startsWith(api + '/media/'), 'A source/foreign URL remains');
    assert.equal(value.storageProvider, 'b2');
    assert.match(value.sha256, /^[a-f0-9]{64}$/);
    assert.ok(value.byteSize > 0);
    objects.set(value.url, value);
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') inventory(child);
}
const deptsResponse = await fetch(base + '/depts.json');
assert.equal(deptsResponse.status, 200);
const depts = await deptsResponse.json();
for (const dept of Object.keys(depts || {})) {
  departments++;
  const response = await fetch(base + '/dept/' + encodeURIComponent(dept) + '.json?auth=' + encodeURIComponent(session.idToken));
  // Reading a parent is deliberately denied by child-scoped Firebase rules.
  assert.ok([401, 403].includes(response.status));
  for (const node of ['media', 'disabled_media', 'background', 'music']) {
    const url = new URL(base + '/dept/' + encodeURIComponent(dept) + '/' + node + '.json');
    if (node === 'disabled_media') url.searchParams.set('auth', session.idToken);
    const result = await fetch(url);
    assert.equal(result.status, 200);
    inventory(await result.json());
  }
}
assert.ok(objects.size > 0, 'No migrated media found');
let total = 0, rangeChecked = false;
for (const [url, object] of objects) {
  const head = await fetch(url, { method: 'HEAD', headers: { Origin: 'http://127.0.0.1:5501' } });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('Content-Length')), object.byteSize);
  assert.equal(head.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5501');
  assert.ok(head.headers.get('Cache-Control').includes('immutable'));
  assert.ok(head.headers.get('ETag'));
  const conditional = await fetch(url, { headers: { 'If-None-Match': head.headers.get('ETag') } });
  assert.equal(conditional.status, 304);
  total += object.byteSize;
  if (!rangeChecked && url.endsWith('.mp4')) {
    assert.equal(head.headers.get('Content-Type'), 'video/mp4');
    const range = await fetch(url, { headers: { Range: 'bytes=0-15' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('Content-Range'), 'bytes 0-15/' + object.byteSize);
    assert.equal((await range.arrayBuffer()).byteLength, 16);
    rangeChecked = true;
  }
}
assert.ok(rangeChecked, 'No MP4 byte-range test performed');
const privateRead = await fetch(base + '/users.json');
assert.ok([401, 403].includes(privateRead.status));
assert.equal((await fetch(api + '/api/usage?dept=cse')).status, 401);
const usageResponse = await fetch(api + '/api/usage?dept=cse', { headers: authorized });
assert.equal(usageResponse.status, 200);
const usage = await usageResponse.json();
assert.equal(usage.usedBytes, total);
assert.equal(usage.reservedBytes, 0);
assert.equal((await fetch(api + '/api/usage?dept=cse', { headers: { Origin: 'https://foreign.example' } })).status, 403);
console.log('PASS staging: ' + departments + ' departments, ' + objects.size + ' unique media, ' + total + ' bytes accounted, zero pending reservations.');
console.log('PASS HEAD/MIME/CORS/immutable validators/304, MP4 byte ranges, private user-directory denial, anonymous API denial, authorized quota access.');
console.log('Browser/TV playback and persistent-cache reload acceptance still require a real browser.');
