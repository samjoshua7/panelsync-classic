/* Persistent media cache for legacy displays. ES5; no service-worker dependency. */
(function (root) {
  'use strict';
  var db = null, ready = false, waiters = [], pending = {}, live = {}, failures = {};
  var epoch = 0, volatileBytes = 0, volatileLimit = 96 * 1024 * 1024;
  var stats = { hits: 0, downloads: 0, downloadedBytes: 0, persisted: 0, failures: 0, streaming: 0 };
  function completeOpen(value) {
    if (ready) return;
    db = value; ready = true;
    var callbacks = waiters; waiters = [];
    callbacks.forEach(function (fn) { fn(!!db); });
  }
  function open(callback) {
    if (ready) { callback(!!db); return; }
    waiters.push(callback);
    if (waiters.length !== 1) return;
    var timer = setTimeout(function () { completeOpen(null); }, 8000);
    try {
      var req = root.indexedDB.open('PanelSyncClassicTVCache', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('media_blobs'); };
      req.onsuccess = function () {
        clearTimeout(timer);
        if (ready) { req.result.close(); return; }
        req.result.onversionchange = function () { req.result.close(); db = null; };
        completeOpen(req.result);
      };
      req.onerror = function () { clearTimeout(timer); completeOpen(null); };
    } catch (e) { clearTimeout(timer); completeOpen(null); }
  }
  function report(reason) {
    stats.failures++;
    // Never print signed/token-bearing URLs.
    if (root.console) root.console.warn('Media cache: ' + reason);
  }
  function load(url, callback) {
    if (!url) { callback(null, false); return; }
    if (live[url]) { stats.hits++; callback(live[url].blob, live[url].persisted); return; }
    if (pending[url]) { pending[url].push(callback); return; }
    pending[url] = [callback];
    var generation = epoch;
    function finish(blob, persisted) {
      var listeners = pending[url] || [];
      delete pending[url];
      // Keep failed writes in bounded session memory, avoiding download storms.
      if (blob && !persisted && !live[url] && volatileBytes + blob.size <= volatileLimit) {
        live[url] = { blob: blob, persisted: false, refs: 0, objectUrl: null };
        volatileBytes += blob.size;
      }
      if (!persisted) failures[url] = true;
      listeners.forEach(function (fn) {
        try { fn(blob, persisted); } catch (e) { report('consumer callback failed'); }
      });
    }
    function download() {
      if (failures[url]) { finish(null, false); return; }
      var xhr, done = false, idleTimer;
      function fail(reason) {
        if (done) return;
        done = true; clearTimeout(idleTimer); report(reason); finish(null, false);
      }
      function progress(event) {
        if (event && root.PanelMediaCache.onProgress) {
          root.PanelMediaCache.onProgress(event.loaded, event.lengthComputable ? event.total : 0);
        }
        clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
          fail('download stalled for 45 seconds');
          xhr.abort();
        }, 45000);
      }
      try {
        xhr = new XMLHttpRequest(); xhr.open('GET', url, true); xhr.responseType = 'blob';
        xhr.timeout = 10 * 60 * 1000;
        xhr.onprogress = progress;
        xhr.onerror = function () { fail('network/CORS failure; persistence unavailable'); };
        xhr.ontimeout = function () { fail('download time limit exceeded'); };
        xhr.onabort = function () { fail('download aborted'); };
        xhr.onload = function () {
          if (done) return;
          var blob = xhr.response;
          var length = Number(xhr.getResponseHeader('Content-Length'));
          if (xhr.status !== 200 || !blob || !blob.size || (length > 0 && length !== blob.size)) {
            fail('incomplete or invalid media response (HTTP ' + xhr.status + ')'); return;
          }
          done = true; clearTimeout(idleTimer);
          stats.downloads++; stats.downloadedBytes += blob.size;
          if (!db || generation !== epoch) { finish(blob, false); return; }
          var settled = false;
          function written(ok) {
            if (settled) return; settled = true;
            if (ok) stats.persisted++; else report('local write failed (quota/storage); retained in memory when possible');
            finish(blob, ok);
          }
          try {
            var tx = db.transaction('media_blobs', 'readwrite');
            tx.oncomplete = function () { written(true); };
            tx.onerror = tx.onabort = function () { written(false); };
            tx.objectStore('media_blobs').put(blob, url);
          } catch (e) { written(false); }
        };
        progress(); xhr.send();
      } catch (e) { fail('download could not start'); }
    }
    open(function () {
      if (!db) { finish(null, false); return; }
      try {
        var req = db.transaction('media_blobs', 'readonly').objectStore('media_blobs').get(url);
        req.onsuccess = function () {
          if (req.result && req.result.size > 0) { stats.hits++; finish(req.result, true); }
          else download();
        };
        req.onerror = function () { report('local read failed'); finish(null, false); };
      } catch (e) { report('local read unavailable'); finish(null, false); }
    });
  }
  function acquire(url, callback) {
    load(url, function (blob, persisted) {
      if (!blob) { stats.streaming++; callback(url); return; }
      var entry = live[url];
      if (!entry) entry = live[url] = { blob: blob, persisted: persisted, refs: 0, objectUrl: null };
      if (!entry.objectUrl) entry.objectUrl = root.URL.createObjectURL(entry.blob);
      entry.refs++; callback(entry.objectUrl);
    });
  }
  function release(objectUrl) {
    Object.keys(live).some(function (key) {
      var entry = live[key];
      if (entry.objectUrl !== objectUrl) return false;
      entry.refs = Math.max(0, entry.refs - 1);
      if (!entry.refs) {
        root.URL.revokeObjectURL(entry.objectUrl); entry.objectUrl = null;
        if (entry.persisted || entry.discardOnRelease) delete live[key];
      }
      return true;
    });
  }
  function clear(callback) {
    if (Object.keys(pending).length) { callback(false); return; }
    if (!db) { callback(false); return; }
    var tx;
    try {
      tx = db.transaction('media_blobs', 'readwrite');
      tx.oncomplete = function () {
        epoch++; failures = {};
        Object.keys(live).forEach(function (key) {
          // Current consumers keep their URLs until their normal release.
          live[key].persisted = false;
          live[key].discardOnRelease = true;
          if (!live[key].refs) delete live[key];
        });
        volatileBytes = 0; callback(true);
      };
      tx.onabort = tx.onerror = function () { callback(false); };
      tx.objectStore('media_blobs').clear();
    } catch (e) { callback(false); }
  }
  root.PanelMediaCache = { open: open, acquire: acquire, release: release, warm: load, clear: clear, stats: stats };
})(window);
