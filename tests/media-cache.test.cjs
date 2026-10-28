const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('media-cache.js', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function environment(records = new Map(), options = {}) {
  let requests = 0, writes = 0, revoked = [], urls = 0;
  const warnings = [];
  const db = {
    close() {},
    transaction() {
      const tx = { objectStore() { return {
        get(key) {
          const req = {};
          setImmediate(() => { req.result = records.get(key); req.onsuccess(); });
          return req;
        },
        put(blob, key) {
          writes++;
          setImmediate(() => {
            if (options.quota) { tx.onabort(); return; }
            records.set(key, blob); tx.oncomplete();
          });
        },
        clear() { setImmediate(() => { records.clear(); tx.oncomplete(); }); }
      }; } };
      return tx;
    }
  };
  class XHR {
    open() {}
    getResponseHeader() { return String(options.length || 12); }
    abort() { if (this.onabort) this.onabort(); }
    send() {
      requests++;
      setImmediate(() => {
        if (options.network) { this.onerror(); return; }
        this.status = options.status || 200;
        this.response = { size: 12, type: 'video/mp4' };
        this.onload();
      });
    }
  }
  const root = {
    indexedDB: { open() {
      const req = { result: db };
      setImmediate(() => req.onsuccess()); return req;
    } },
    URL: { createObjectURL() { return 'blob:' + (++urls); }, revokeObjectURL(url) { revoked.push(url); } },
    console: { warn(message) { warnings.push(message); } }
  };
  vm.runInNewContext(source, { window: root, XMLHttpRequest: XHR, setTimeout, clearTimeout });
  const cache = root.PanelMediaCache;
  return {
    cache, records, warnings,
    acquire: url => new Promise(resolve => cache.acquire(url, resolve)),
    warm: url => new Promise(resolve => cache.warm(url, (blob, persisted) => resolve({ blob, persisted }))),
    counts: () => ({ requests, writes, revoked, urls })
  };
}

(async () => {
  const e = environment();
  const [warm, a, b] = await Promise.all([e.warm('video'), e.acquire('video'), e.acquire('video')]);
  assert.equal(warm.persisted, true);
  assert.equal(a, b);
  assert.equal(e.counts().requests, 1, 'preloader/playback share one body transfer');
  assert.equal(e.counts().writes, 1, 'one committed write');
  e.cache.release(a);
  assert.equal(e.counts().revoked.length, 0, 'second consumer still owns URL');
  e.cache.release(b);
  assert.deepEqual(e.counts().revoked, [a]);
  const c = await e.acquire('video');
  assert.equal(e.counts().requests, 1, 'second loop reads local storage');
  e.cache.release(c);
  const reload = environment(e.records);
  await reload.acquire('video');
  assert.equal(reload.counts().requests, 0, 'fresh page instance reuses persistent records');

  for (const options of [{ status: 206 }, { length: 99 }, { network: true }]) {
    const bad = environment(new Map(), options);
    assert.equal(await bad.acquire('bad'), 'bad');
    assert.equal(await bad.acquire('bad'), 'bad');
    assert.equal(bad.counts().requests, 1, 'failed asset does not trigger repeated cache downloads');
    assert.equal(bad.records.size, 0, 'invalid body never persisted');
  }
  const quota = environment(new Map(), { quota: true });
  const q = await quota.acquire('quota'); quota.cache.release(q);
  const q2 = await quota.acquire('quota'); quota.cache.release(q2);
  assert.equal(quota.counts().requests, 1, 'failed writes reuse bounded session memory');
  assert.equal(quota.cache.stats.persisted, 0);
  assert.equal(quota.warnings.length, 1);

  const different = environment(new Map(), { network: true });
  await different.acquire('one'); await different.acquire('two');
  assert.equal(different.counts().requests, 2, 'one failure does not poison the entire origin');

  const clearing = environment();
  const loading = clearing.acquire('video');
  const busy = await new Promise(resolve => clearing.cache.clear(resolve));
  assert.equal(busy, false, 'clear cannot race an in-flight write');
  const held = await loading;
  assert.equal(await new Promise(resolve => clearing.cache.clear(resolve)), true);
  assert.equal(clearing.records.size, 0);
  assert.equal(clearing.counts().revoked.length, 0, 'clear preserves active consumers');
  clearing.cache.release(held);
  assert.equal(clearing.counts().revoked.length, 1);
  await tick();
  console.log('PASS: deduplication, commit, reference ownership, loop/reload reuse, partial/invalid rejection, failure suppression, quota fallback, per-asset isolation, safe clear');
})().catch(error => { console.error(error); process.exitCode = 1; });
