const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function setup(){const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('playlist-draft.js','utf8'),context);const draft=context.window.PanelPlaylistDraft.create();const rows=[{id:'a',order:1,duration:5,url:'a.jpg'},{id:'b',order:2,duration:10,url:'b.jpg'},{id:'c',order:3,duration:15,disabled:true}];draft.ingest(rows);return{draft,rows};}
test('draft changes never mutate saved records; discard restores them',()=>{const{draft,rows}=setup();draft.edit('a','duration',20);draft.move(0,1);assert.equal(rows[0].duration,5);assert.equal(rows[0].order,1);assert.equal(draft.view()[0].id,'b');assert.ok(draft.dirty());draft.discard();assert.equal(draft.view()[0].id,'a');assert.equal(draft.view()[0].duration,5);assert.equal(draft.dirty(),false);});
test('save plan contains changed scalar fields only, including archive paths',()=>{const{draft,rows}=setup();draft.edit('a','duration',20);draft.edit('c','duration',25);const updates=draft.updates('cse',rows);assert.deepEqual(JSON.parse(JSON.stringify(updates)),{'dept/cse/media/a/duration':20,'dept/cse/disabled_media/c/duration':25});assert.ok(!JSON.stringify(updates).includes('url'));});
test('draft survives unrelated realtime edits; same-field conflicts are rejected',()=>{const{draft,rows}=setup();draft.edit('a','duration',20);const fresh=rows.map(row=>({...row}));fresh[0].useMusic=true;draft.ingest(fresh);assert.equal(draft.view()[0].duration,20);assert.equal(draft.view()[0].useMusic,true);assert.doesNotThrow(()=>draft.updates('cse',fresh));fresh[0].duration=30;assert.throws(()=>draft.updates('cse',fresh),/Another editor/);assert.ok(draft.dirty());});
test('deletion and archive moves cannot be silently recreated by a stale draft',()=>{const{draft,rows}=setup();draft.edit('a','duration',20);assert.throws(()=>draft.updates('cse',rows.slice(1)),/removed/);assert.throws(()=>draft.updates('cse',rows.map(row=>({...row,disabled:true}))),/enabled\/disabled/);});
test('validation and changing a field back to original clear the dirty state',()=>{const{draft}=setup();for(const value of [0,-1,601,1.2,NaN])assert.throws(()=>draft.edit('a','duration',value));draft.edit('a','duration',20);draft.edit('a','duration',5);assert.equal(draft.dirty(),false);assert.throws(()=>draft.edit('a','url',10));});
test('disable with duration/order produces a single non-overlapping atomic node move',()=>{
 const{draft,rows}=setup();draft.edit('a','duration',25);draft.move(0,1);draft.edit('a','disabled',true);
 const fresh=rows.map(row=>({...row,useMusic:true})),updates=draft.updates('cse',fresh);
 assert.equal(updates['dept/cse/media/a'],null);
 const archived=updates['dept/cse/disabled_media/a'];assert.equal(archived.duration,25);assert.equal(archived.order,2);assert.equal(archived.disabled,true);assert.equal(archived.useMusic,true);assert.equal(archived.url,'a.jpg');assert.equal(archived.id,undefined);
 const paths=Object.keys(updates);for(const a of paths)for(const b of paths)if(a!==b)assert.ok(!a.startsWith(b+'/'));
 assert.equal(rows[0].disabled,undefined);
});
test('enable preserves archive edits, removes disabled marker, and discard cancels it',()=>{
 const{draft,rows}=setup();draft.edit('c','disabled',false);draft.edit('c','duration',35);
 const updates=draft.updates('cse',rows);assert.equal(updates['dept/cse/disabled_media/c'],null);assert.equal(updates['dept/cse/media/c'].duration,35);assert.equal(updates['dept/cse/media/c'].disabled,undefined);
 assert.equal(draft.view().find(row=>row.id==='c').disabled,false);draft.discard();assert.equal(draft.view().find(row=>row.id==='c').disabled,true);
});
test('enable/disable toggled back to saved state clears the change without writes',()=>{
 const{draft,rows}=setup();draft.edit('a','disabled',true);assert.ok(draft.dirty());draft.edit('a','disabled',false);assert.equal(draft.dirty(),false);assert.deepEqual(Object.keys(draft.updates('cse',rows)),[]);
});
test('external archive movement blocks a stale enable/disable draft',()=>{
 const{draft,rows}=setup();draft.edit('a','disabled',true);assert.throws(()=>draft.updates('cse',rows.map(row=>row.id==='a'?{...row,disabled:true}:row)),/enabled\/disabled/);
});
