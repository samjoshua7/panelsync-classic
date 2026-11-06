const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('display.html','utf8');
function setup(search='?dept=cse',online=true){
 const requests=[],navigations=[];
 const context={document:{getElementById:()=>({})},urlParams:{},navigator:{onLine:online},window:{location:{search,pathname:'/panelsync-classic/display.html',hash:'',replace:url=>navigations.push(url)}},XMLHttpRequest:function(){requests.push(this);this.open=(method,url)=>{this.url=url;};this.send=()=>{};}};
 vm.createContext(context);vm.runInContext(html.slice(html.indexOf("    var DISPLAY_VERSION"),html.indexOf('    // Department support')),context);
 return{context,requests,navigations};
}
test('refresh preflights a versioned same-origin page, preserves department, and never clears media',()=>{
 const h=setup();h.context.queueDisplayRefresh('request_123');h.context.refreshDisplayAtBoundary();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/panelsync-classic/display.html?dept=cse&displayRefresh=request_123');
 assert.equal(h.navigations.length,0);Object.assign(h.requests[0],{status:200,responseText:'var DISPLAY_VERSION'});h.requests[0].onload();assert.equal(h.navigations.length,1);
});
test('processed tokens, malformed commands and offline state cannot trigger navigation',()=>{
 const h=setup();h.context.urlParams.displayRefresh='done';h.context.queueDisplayRefresh('done');h.context.queueDisplayRefresh('https://bad');h.context.refreshDisplayAtBoundary();assert.equal(h.requests.length,0);
 const offline=setup('?dept=cse',false);offline.context.queueDisplayRefresh('new');offline.context.refreshDisplayAtBoundary();assert.equal(offline.requests.length,0);
});
test('failed preflight keeps player running and retries are bounded',()=>{
 const h=setup();h.context.queueDisplayRefresh('new');h.context.refreshDisplayAtBoundary();Object.assign(h.requests[0],{status:503,responseText:''});h.requests[0].onload();h.context.refreshDisplayAtBoundary();assert.equal(h.requests.length,1);assert.equal(h.navigations.length,0);
});
test('only live settings enqueue refresh and the existing boundary consumes it',()=>{
 assert.match(html,/if \(live && data\) queueDisplayRefresh\(data.displayRefresh\)/);
 assert.match(html,/function nextSlide\(\) \{\s*refreshDisplayAtBoundary\(\)/);
 assert.ok(!html.includes('location.reload(true)'));
});
