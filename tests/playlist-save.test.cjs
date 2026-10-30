const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function environment(fail=false){
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('playlist-draft.js','utf8'),context);
 const draft=context.window.PanelPlaylistDraft.create(),data={media:{a:{order:1,duration:5,url:'same.jpg',type:'image',useMusic:true}},disabled_media:{}};
 draft.ingest([{...data.media.a,id:'a',disabled:false}]);draft.edit('a','duration',20);draft.edit('a','disabled',true);
 const writes=[],messages=[];Object.assign(context,{playlistDraft:draft,draftSaving:false,currentDept:'cse',navigator:{onLine:true},document:{getElementById(){return{disabled:false};}},updateDraftBar(message){messages.push(message);},mergeAndRenderMedia(){},db:{ref(path){return{once:async()=>({val:()=>data[path.split('/').at(-1)]}),update:async value=>{if(fail)throw Error('Simulated save failure');writes.push(value);}};}}});
 const source=fs.readFileSync('admin.html','utf8');vm.runInContext(source.slice(source.indexOf('        async function savePlaylistDraft()'),source.indexOf('        function updateBackground(')),context);
 return{context,draft,writes,messages};
}
test('Save commits disable plus duration together, then updates local saved-node maps',async()=>{
 const h=environment();await h.context.savePlaylistDraft();assert.equal(h.writes.length,1);assert.equal(h.writes[0]['dept/cse/media/a'],null);assert.equal(h.writes[0]['dept/cse/disabled_media/a'].duration,20);assert.equal(h.draft.dirty(),false);assert.equal(h.context.activeMediaArray.length,0);assert.equal(h.context.disabledMediaMap.a.duration,20);assert.equal(h.context.draftSaving,false);
});
test('failed Save preserves the complete draft and unlocks controls',async()=>{
 const h=environment(true);await h.context.savePlaylistDraft();assert.equal(h.writes.length,0);assert.equal(h.draft.dirty(),true);assert.equal(h.context.draftSaving,false);assert.ok(h.messages.some(message=>message?.includes('Not saved')));
});
test('enable/disable UI does not perform immediate Firebase writes',()=>{
 const source=fs.readFileSync('admin.html','utf8');const body=source.slice(source.indexOf('        async function toggleDisableSlide('),source.indexOf('        // --- SLIDE PREVIEW MODAL HANDLERS'));
 assert.ok(body.includes("playlistDraft.edit(slideId,'disabled'"));assert.ok(!body.includes('db.ref'));
});
