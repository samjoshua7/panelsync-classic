const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const acorn=require('../r2-migration/node_modules/acorn');
test('TV display and cache scripts parse as ES5 (stricter than Chrome 66)',()=>{
  const html=fs.readFileSync('display.html','utf8');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!/\bsrc=/.test(match[1]))acorn.parse(match[2],{ecmaVersion:5});
  }
  acorn.parse(fs.readFileSync('media-cache.js','utf8'),{ecmaVersion:5});
  assert.ok(html.includes('#cornerControls > * + * { margin-top: 8px; }'));
  assert.ok(html.includes('.control-btn-row > * + * { margin-left: 16px; }'));
  assert.ok(!/dashboard\.(js|css)|access-control\.js|type="module"/.test(html),'modern admin assets must not enter TV page');
});
