const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const {webcrypto}=require('node:crypto');
async function upload(responses){
  const calls=[],delays=[];const context={window:{},crypto:webcrypto,Uint8Array,Array,Promise,Object,Error,URLSearchParams,location:{search:''},setTimeout(fn,ms){delays.push(ms);queueMicrotask(fn);},XMLHttpRequest:class{
    constructor(){this.upload={};}open(method,url){this.url=url;}setRequestHeader(){}
    send(file){calls.push({url:this.url,file});const response=responses[calls.length-1];queueMicrotask(()=>{this.status=response.status;this.responseText=JSON.stringify(response.data);this.onload();});}
  }};vm.createContext(context);vm.runInContext(fs.readFileSync('browser-storage.js','utf8'),context);
  const storage=context.window.PanelB2Storage({currentUser:{getIdToken:async()=>'test'},onAuthStateChanged(){return()=>{};}},'https://media.example.com');
  const file={size:3,type:'image/png',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
  const task=storage.ref('panelsyncclassic/dev/slides/a.png').put(file);
  let error;try{await new Promise((resolve,reject)=>task.on('state_changed',()=>{},reject,resolve));}catch(e){error=e;}
  return{calls,delays,error};
}
test('server-confirmed absent upload is retried once using the same key and File',async()=>{
 const result=await upload([{status:503,data:{retryable:true}},{status:201,data:{url:'https://media.example.com/media/a'}}]);
 assert.equal(result.error,undefined);assert.equal(result.calls.length,2);assert.equal(result.calls[0].url,result.calls[1].url);assert.equal(result.calls[0].file,result.calls[1].file);assert.deepEqual(result.delays,[1000]);
});
test('ambiguous failure is not replayed; repeated transient failures stop after two attempts',async()=>{
 const ambiguous=await upload([{status:503,data:{error:'Unknown state',retryable:false}}]);assert.equal(ambiguous.calls.length,1);assert.ok(ambiguous.error);
 const transient=await upload([{status:503,data:{retryable:true}},{status:503,data:{retryable:true}}]);assert.equal(transient.calls.length,2);assert.ok(transient.error);
});
