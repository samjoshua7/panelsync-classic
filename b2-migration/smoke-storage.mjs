// Creates and removes ONE unique test object; never writes a playlist or source.
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const config = JSON.parse(fs.readFileSync(new URL('./config.local.json', import.meta.url), 'utf8'));
const { idToken } = JSON.parse(fs.readFileSync(new URL('../.migration-private/firebase-migration-session.json', import.meta.url), 'utf8'));
const api = config.mediaApi.replace(/\/$/, '');
const auth = { Authorization: 'Bearer ' + idToken };
async function usage() {
  const response = await fetch(api + '/api/usage?dept=cse', { headers: auth });
  assert.equal(response.status, 200);
  return response.json();
}
const before = await usage();
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const key = 'panelsyncclassic/cse/slides/migration-smoke-' + randomBytes(12).toString('hex') + '.png';
const object = api + '/api/object?key=' + encodeURIComponent(key);
const media = api + '/media/' + key;
let created = false;
try {
  const response = await fetch(object, { method: 'PUT', headers: {
    ...auth, 'Content-Type': 'image/png', 'X-File-Size': String(bytes.length),
    'X-Content-Sha1': createHash('sha1').update(bytes).digest('hex')
  }, body: bytes });
  assert.equal(response.status, 201, 'Smoke upload failed');
  created = true;
  const result = await fetch(media);
  assert.equal(result.status, 200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  assert.equal((await usage()).usedBytes, before.usedBytes + bytes.length);
} finally {
  if (created) {
    const removed = await fetch(object, { method: 'DELETE', headers: auth });
    assert.equal(removed.status, 200, 'Smoke cleanup failed; test object may remain');
    assert.equal((await fetch(media, { method: 'HEAD' })).status, 404);
    const after = await usage();
    assert.equal(after.usedBytes, before.usedBytes);
    assert.equal(after.reservedBytes, before.reservedBytes);
    console.log('PASS real B2 smoke: unique PNG upload/readback/version deletion; test file removed, storage accounting restored.');
  }
}
