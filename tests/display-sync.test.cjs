const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('display.html', 'utf8');
for (const file of ['display.html', 'admin.html']) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1], { filename: file });
  }
}
const metadataSource = html.slice(html.indexOf('    var metadataRequests'), html.indexOf('    function nextSlide()'));
const requests = [], saved = new Map();
let now = 1000, warmCalls = 0;
class XHR {
  constructor() { this.headers = {}; requests.push(this); }
  open(method, url) { this.url = url; }
  setRequestHeader(key, value) { this.headers[key] = value; }
  send() {}
  getResponseHeader() { return this.etag || null; }
  respond(status, value, etag) {
    this.status = status; this.responseText = JSON.stringify(value); this.etag = etag;
    this.onload();
  }
}
const context = {
  XMLHttpRequest: XHR, navigator: { onLine: true }, Date: { now: () => now }, console,
  localStorage: { getItem: key => saved.has(key) ? saved.get(key) : null, setItem: (key, value) => saved.set(key, value) },
  RTDB_URL: 'media', SETTINGS_URL: 'settings', BACKGROUNDS_URL: 'background', MUSIC_URL: 'music',
  currentIndex: 0, preloadAllMedia: () => warmCalls++, nextSlide() {}
};
vm.createContext(context); vm.runInContext(metadataSource, context);
context.fetchMedia(); context.fetchMedia();
assert.equal(requests.length, 1, 'overlapping poll suppressed');
requests[0].respond(200, { one: { type: 'video', url: 'video', order: 1 }, hidden: { disabled: true } }, 'v1');
assert.equal(context.mediaArray.length, 1, 'disabled items excluded');
assert.equal(warmCalls, 1);
context.fetchMedia();
assert.equal(requests[1].headers['If-None-Match'], 'v1');
requests[1].respond(304);
assert.equal(warmCalls, 1, 'unchanged playlist does not scan cache again');
context.fetchMedia(); requests[2].respond(200, null, 'v2');
assert.equal(context.mediaArray.length, 0, 'deleting last item clears playlist');
context.fetchMusic(); requests[3].onerror();
context.fetchMusic(); assert.equal(requests.length, 4, 'failure backoff suppresses retry');
now += 31000; context.fetchMusic(); assert.equal(requests.length, 5);
requests[4].respond(200, { url: 'music' });

const offline = { ...context, navigator: { onLine: false }, currentIndex: 0 };
vm.createContext(offline); vm.runInContext(metadataSource, offline);
offline.fetchMusic(); assert.equal(offline.currentMusicObj.url, 'music', 'offline reload uses saved metadata');
assert.equal(requests.length, 5, 'offline does not request network');

const admin = fs.readFileSync('admin.html', 'utf8');
const grid = admin.slice(admin.indexOf('        function renderGrid()'), admin.indexOf('        function moveUp('));
assert.ok(!grid.includes('<video'), 'grid never creates auto-loading video elements');
assert.ok(grid.includes('openSlidePreview'), 'interactive preview remains available');
assert.ok(grid.includes('replaceWith(oldImage)'), 'unchanged loaded images are reused across edits');
assert.ok(html.includes('cleanupGeneration'), 'delayed cleanup guarded against layer reuse');
console.log('PASS: HTML script syntax, conditional sync, overlap protection, disabled filtering, unchanged playlist, empty playlist, backoff, offline metadata, click-only video preview');
