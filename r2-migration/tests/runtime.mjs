// Local workerd/SQLite/R2 integration, not a cloud deployment.
// First run Wrangler's deploy --dry-run into .migration-private/worker-dry-run.
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const mf = new Miniflare({
  workers: [{
  name: 'panelsync-staging-test',
  modules: true,
  scriptPath: fileURLToPath(new URL('../../.migration-private/worker-dry-run/worker.js', import.meta.url)),
  compatibilityDate: '2026-10-28',
  r2Buckets: ['MEDIA'],
  durableObjects: { QUOTA: { className: 'MediaQuota', useSQLite: true } },
  bindings: { STORAGE_LIMIT_BYTES: '10', MAX_FILE_BYTES: '10', ALLOWED_ORIGINS: 'http://127.0.0.1:5501' }
  }]
});
try {
  const ns = await mf.getDurableObjectNamespace('QUOTA');
  const stub = ns.get(ns.idFromName('integration-test'));
  const key = 'panelsyncclassic/cse/slides/local.mp4';
  const response = await stub.fetch('https://local/api/object?key=' + key, {
    method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'X-File-Size': '6' }, body: '012345'
  });
  assert.equal(response.status, 201, await response.text());
  const usage = await (await stub.fetch('https://local/api/usage?dept=cse')).json();
  assert.equal(usage.usedBytes, 6); assert.equal(usage.reservedBytes, 0);
  const media = await mf.dispatchFetch('https://local/media/' + key, { headers: { Range: 'bytes=1-3', Origin: 'http://127.0.0.1:5501' } });
  assert.equal(media.status, 206); assert.equal(await media.text(), '123');
  assert.equal(media.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5501');
  const capped = await stub.fetch('https://local/api/object?key=' + key.replace('local', 'second'), {
    method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'X-File-Size': '6' }, body: 'abcdef'
  });
  assert.equal(capped.status, 413);
  const blocked = await mf.dispatchFetch('https://local/api/object?key=' + key, { method: 'DELETE' });
  assert.equal(blocked.status, 401);
  assert.equal((await stub.fetch('https://local/api/object?key=' + key, { method: 'DELETE' })).status, 200);
  assert.equal((await (await stub.fetch('https://local/api/usage?dept=cse')).json()).usedBytes, 0);
  console.log('PASS local workerd: real SQLite reservation, R2 streaming upload, quota rejection, byte-range/CORS response, unauthenticated write rejection, deletion accounting.');
} finally {
  await mf.dispose();
}
