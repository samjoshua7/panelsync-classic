import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import worker, { MediaQuota, parseKey, serveMedia } from '../worker.mjs';
import { verifyFirebaseToken } from '../auth.mjs';
import { transform, validateConfig } from '../build.mjs';
import { destinationRules } from '../rules.mjs';
import { inventory } from '../migrate.mjs';
const config = { firebase: { apiKey: 'test-api', appId: 'test-app', projectId: 'panelsync-test', authDomain: 'panelsync-test.firebaseapp.com', databaseURL: 'https://panelsync-test-default-rtdb.firebaseio.com' }, mediaApi: 'https://media.example.com' };
test('staging build preserves source and removes all source-project references', () => {
  for (const name of ['index.html', 'admin.html', 'display.html']) {
    const before = fs.readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
    const after = transform(name, before, config);
    assert.ok(!after.includes('civic-voice-530e3'));
    for (const match of after.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
    if (name === 'admin.html') {
      assert.ok(after.indexOf('src="browser-storage.js"') < after.indexOf('const storage = window.PanelR2Storage'));
      assert.ok(after.includes('openSlidePreview'));
      assert.ok(!after.includes('storage.ref(item.storagePath).delete().catch'));
    }
    assert.equal(fs.readFileSync(new URL('../../' + name, import.meta.url), 'utf8'), before);
  }
  assert.throws(() => validateConfig({ ...config, firebase: { ...config.firebase, projectId: 'civic-voice-530e3' } }));
  assert.throws(() => parseKey('panelsyncclassic/cse/slides/../secret.mp4'));
});
test('destination rules cover archive and gate role writes', () => {
  const rules = destinationRules().rules;
  assert.ok(rules.dept.$dept.disabled_media['.write'].includes('roleLevel'));
  assert.ok(rules.users['.write'].includes('=== 3'));
  assert.equal(rules['.write'], false);
});
test('migration inventory deduplicates active/archived assets and rejects foreign paths', () => {
  const item = { url: 'https://firebasestorage.googleapis.com/v0/b/civic-voice-530e3.firebasestorage.app/o/panelsyncclassic%2Fcse%2Fslides%2Fa.mp4?alt=media&token=private', storagePath: 'panelsyncclassic/cse/slides/a.mp4' };
  const assets = inventory({ dept: { cse: { media: { a: structuredClone(item) }, disabled_media: { b: structuredClone(item) }, music: null } } });
  assert.equal(assets.size, 1); assert.equal([...assets.values()][0].length, 2);
  assert.throws(() => inventory({ dept: { cse: { media: { a: { ...item, storagePath: 'complaints/private.jpg' } } } } }));
  assert.throws(() => inventory({ dept: { cse: { media: { a: { url: 'https://evil.example/file.mp4' } } } } }));
});
test('JWT validates signature, audience, verified email and expiry', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const key = await webcrypto.subtle.exportKey('jwk', pair.publicKey); key.kid = 'test-key';
  const now = Date.now(), seconds = Math.floor(now / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = { aud: 'panelsync-test', iss: 'https://securetoken.google.com/panelsync-test', exp: seconds + 1000, iat: seconds, auth_time: seconds, sub: 'uid', email: 'admin@example.com', email_verified: true };
  async function sign(value) {
    const unsigned = encode({ alg: 'RS256', kid: key.kid }) + '.' + encode(value);
    const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
    return unsigned + '.' + Buffer.from(signature).toString('base64url');
  }
  const options = { now, subtle: webcrypto.subtle, fetcher: async () => Response.json({ keys: [key] }) };
  assert.equal((await verifyFirebaseToken(await sign(claims), 'panelsync-test', options)).email, claims.email);
  const valid = await sign(claims);
  const pieces = valid.split('.');
  pieces[1] = encode({ ...claims, sub: 'tampered-user' });
  await assert.rejects(verifyFirebaseToken(pieces.join('.'), 'panelsync-test', options));
  await assert.rejects(verifyFirebaseToken(await sign({ ...claims, aud: 'wrong' }), 'panelsync-test', options));
  await assert.rejects(verifyFirebaseToken(await sign({ ...claims, exp: seconds }), 'panelsync-test', options));
  await assert.rejects(verifyFirebaseToken(await sign({ ...claims, email_verified: false }), 'panelsync-test', options));
});
function mockQuota(limit = 10) {
  let ledger, queue = Promise.resolve();
  const data = new Map();
  const storage = {
    async get() { return structuredClone(ledger); },
    transaction(fn) {
      const run = queue.then(() => fn({ get: async () => structuredClone(ledger), put: async (_, value) => { ledger = structuredClone(value); } }));
      queue = run.catch(() => {}); return run;
    }
  };
  const env = { STORAGE_LIMIT_BYTES: String(limit), MAX_FILE_BYTES: '20', MEDIA: {
    async put(key, body) {
      if (data.has(key)) return null;
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      data.set(key, bytes); return { size: bytes.length };
    },
    async head(key) { return data.has(key) ? { size: data.get(key).length } : null; },
    async delete(key) { data.delete(key); }
  } };
  return { quota: new MediaQuota({ storage }, env), data, ledger: () => ledger };
}
const key = name => 'panelsyncclassic/cse/slides/' + name + '.mp4';
function upload(name, bytes = 6, declared = bytes) {
  return new Request('https://media.example.com/api/object?key=' + key(name), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'X-File-Size': String(declared) }, body: new Uint8Array(bytes) });
}
test('quota cap remains atomic across concurrent uploads and deletion releases capacity', async () => {
  const q = mockQuota();
  const results = await Promise.all([q.quota.fetch(upload('one')), q.quota.fetch(upload('two'))]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 413]);
  assert.equal(q.ledger().used, 6); assert.equal(q.ledger().reserved, 0);
  assert.equal((await q.quota.fetch(upload('one'))).status, 409);
  assert.equal((await q.quota.fetch(new Request('https://media.example.com/api/object?key=' + key('one'), { method: 'DELETE' }))).status, 200);
  assert.equal(q.ledger().used, 0);
  assert.equal((await q.quota.fetch(upload('three'))).status, 201);
});
test('short body is cleaned up and untracked object is not overwritten', async () => {
  const q = mockQuota(20);
  assert.equal((await q.quota.fetch(upload('short', 3, 6))).status, 400);
  assert.equal(q.ledger().used + q.ledger().reserved, 0);
  q.data.set(key('existing'), new Uint8Array([9]));
  assert.equal((await q.quota.fetch(upload('existing'))).status, 503);
  assert.deepEqual(q.data.get(key('existing')), new Uint8Array([9]));
  assert.equal(q.ledger().reserved, 6, 'ambiguous/untracked object fails closed');
});
test('media serves correct whole/range/HEAD/304/416 responses', async () => {
  const bytes = new TextEncoder().encode('0123456789');
  const meta = { size: 10, httpEtag: '"v1"', writeHttpMetadata: headers => headers.set('Content-Type', 'video/mp4') };
  const env = { MEDIA: { head: async () => meta, get: async (_, options) => ({ body: options.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes }) } };
  const response = await serveMedia(new Request('https://x/media/a', { headers: { Range: 'bytes=2-5' } }), env, 'a');
  assert.equal(response.status, 206); assert.equal(await response.text(), '2345');
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal((await serveMedia(new Request('https://x', { headers: { Range: 'bytes=-3' } }), env, 'a')).headers.get('Content-Length'), '3');
  assert.equal((await serveMedia(new Request('https://x', { headers: { Range: 'bytes=50-' } }), env, 'a')).status, 416);
  assert.equal((await serveMedia(new Request('https://x', { headers: { 'If-None-Match': '"v1"' } }), env, 'a')).status, 304);
  assert.equal((await serveMedia(new Request('https://x', { method: 'HEAD' }), env, 'a')).body, null);
});
test('browser CORS rejects foreign origin and permits configured preflight', async () => {
  const env = { ALLOWED_ORIGINS: 'https://admin.example.com' };
  assert.equal((await worker.fetch(new Request('https://x', { headers: { Origin: 'https://evil.example' } }), env)).status, 403);
  const response = await worker.fetch(new Request('https://x', { method: 'OPTIONS', headers: { Origin: 'https://admin.example.com' } }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://admin.example.com');
});
