const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'); const fs=require('node:fs');
function harness(seed={}) {
  const state=structuredClone(seed), removed=[];let sequence=0,failDelete=false;
  const get=p=>p.split('/').filter(Boolean).reduce((v,k)=>v&&v[k],state);
  const set=(p,v)=>{const parts=p.split('/').filter(Boolean);let o=state;for(const k of parts.slice(0,-1))o=o[k]||(o[k]={});if(v===null)delete o[parts.at(-1)];else o[parts.at(-1)]=structuredClone(v);};
  function ref(p=''){return{key:p.split('/').at(-1),once:async()=>({val:()=>get(p)||null,exists:()=>get(p)!=null}),set:async v=>set(p,v),remove:async()=>set(p,null),push:()=>ref(p+'/job'+(++sequence)),update:async values=>{for(const [k,v]of Object.entries(values))set((p?p+'/':'')+k,v);}};}
  const storage={ref:p=>({delete:async()=>{if(failDelete)throw Error('B2 unavailable');removed.push(p);}})};
  const context={window:{},Date,Object,Promise}; vm.createContext(context);vm.runInContext(fs.readFileSync('media-management.js','utf8'),context);
  return {state,removed,manage:context.window.PanelMediaManagement({ref},storage,'cse'),fail:()=>failDelete=true,recover:()=>failDelete=false};
}
test('delete atomically removes active/archive references then cleans tracked media',async()=>{
 const item={storagePath:'path'};const h=harness({dept:{cse:{media:{x:item},disabled_media:{x:item}}}});
 await h.manage.remove('media','x',item);
 assert.equal(h.state.dept.cse.media.x,undefined);assert.equal(h.state.dept.cse.disabled_media.x,undefined);assert.deepEqual(h.removed,['path']);assert.deepEqual(h.state.dept.cse.cleanup_jobs,{});
});
test('failed storage cleanup remains visible and can be retried',async()=>{
 const item={storagePath:'path'};const h=harness({dept:{cse:{media:{x:item}}}});h.fail();
 await assert.rejects(h.manage.remove('media','x',item),/cleanup is pending/);
 assert.equal(h.state.dept.cse.media.x,undefined);assert.equal(Object.keys(h.state.dept.cse.cleanup_jobs).length,1);
 h.recover();await h.manage.retry();assert.deepEqual(h.removed,['path']);assert.deepEqual(h.state.dept.cse.cleanup_jobs,{});
});
test('shared file is preserved, replacement cleans only unreferenced old file',async()=>{
 const item={storagePath:'shared'};const h=harness({dept:{cse:{media:{x:item,y:item},background:{storagePath:'old'}}}});
 await h.manage.remove('media','x',item);assert.deepEqual(h.removed,[]);
 await h.manage.replace('background',{storagePath:'new'});assert.deepEqual(h.removed,['old']);assert.equal(h.state.dept.cse.background.storagePath,'new');
});
test('upload obligation persists until atomic publication and active upload is not deleted',async()=>{
 const h=harness({dept:{cse:{}}});await h.manage.stage('new');await h.manage.retry();assert.equal(h.removed.length,0);
 assert.equal(Object.keys(h.state.dept.cse.cleanup_jobs).length,1);
 await h.manage.publish('slide',{storagePath:'new'});assert.equal(h.state.dept.cse.media.slide.storagePath,'new');assert.deepEqual(h.state.dept.cse.cleanup_jobs,{});
});
