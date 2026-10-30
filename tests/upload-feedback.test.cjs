const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const html=fs.readFileSync('admin.html','utf8');
test('bytes sent cannot display 100 percent publication success',()=>{
  const start=html.indexOf('snapshot => {',html.indexOf('function uploadWithProgressUI'));
  const end=html.indexOf('\n                    },',start);
  assert.ok(start>0&&end>start);
  const body=html.slice(start+'snapshot => {'.length,end);
  const context={snapshot:{bytesTransferred:100,totalBytes:100},bar:{style:{}},percent:{},Math};
  vm.runInNewContext(body,context);
  assert.equal(context.bar.style.width,'95%');
  assert.match(context.percent.textContent,/verifying storage/);
});
test('terminal publication and failure feedback cannot be confused',()=>{
  const nodes=new Map();const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{style:{},setAttribute(){}});return nodes.get(id);}};
  const start=html.indexOf('        function uploadOutcome('),end=html.indexOf('        // Read duration',start);
  const context={document,setTimeout(){}};vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  context.uploadOutcome(false,'Storage unavailable');
  assert.equal(nodes.get('uploadTitle').textContent,'Not published');
  assert.equal(nodes.get('uploadBar').style.width,'0%');
  context.uploadOutcome(true,'Playlist saved');
  assert.equal(nodes.get('uploadTitle').textContent,'Published successfully');
  assert.match(nodes.get('uploadPercent').textContent,/100%.*Playlist saved/);
});
