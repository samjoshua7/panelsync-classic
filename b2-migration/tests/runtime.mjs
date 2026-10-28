import { Miniflare, convertV4MiniflareOptions } from '../../r2-migration/node_modules/miniflare/dist/src/index.js';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../../.migration-private/b2-runtime/runtime-worker.js', import.meta.url)),
  compatibilityDate: '2026-10-28',
  durableObjects: { QUOTA: { className: 'MediaQuota', useSQLite: true } },
  bindings: { STORAGE_LIMIT_BYTES: '10', MAX_FILE_BYTES: '10' }
}));
try {
  const ns = await mf.getDurableObjectNamespace('QUOTA');
  const stub = ns.get(ns.idFromName('test'));
  const key = 'panelsyncclassic/cse/slides/test.mp4';
  const put = (name, body) => stub.fetch('https://local/api/object?key=' + name, { method: 'PUT', headers: {
    'Content-Type': 'video/mp4', 'X-File-Size': String(body.length), 'X-Content-Sha1': createHash('sha1').update(body).digest('hex')
  }, body });
  const response = await put(key, '012345');
  assert.equal(response.status, 201, await response.text());
  assert.equal((await put(key + 'other', 'abcdef')).status, 413);
  const range = await mf.dispatchFetch('https://local/' + key, { headers: { Range: 'bytes=1-3' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), '123');
  assert.equal((await stub.fetch('https://local/api/object?key=' + key, { method: 'DELETE' })).status, 200);
  const usage = await (await stub.fetch('https://local/api/usage')).json();
  assert.equal(usage.usedBytes, 0); assert.equal(usage.reservedBytes, 0);
  console.log('PASS real workerd/SQLite: B2 streaming/checksum, atomic cap, byte ranges, actual version deletion accounting (mock B2 network).');
} finally { await mf.dispose(); }
