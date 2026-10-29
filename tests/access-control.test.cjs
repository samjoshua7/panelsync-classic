const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(records, user = {email:'member@example.com',emailVerified:true}) {
  const context={window:{},Promise}; vm.createContext(context);
  vm.runInContext(fs.readFileSync('access-control.js','utf8'),context);
  const auth={onAuthStateChanged(callback){queueMicrotask(()=>callback(user));return ()=>{};}};
  const db={ref(path){return {once:async()=>({val:()=>records[path]||null})};}};
  return selected=>context.window.PanelAccess.resolve(auth,db,selected);
}
const member={email:'member@example.com',active:true,roleLevel:1};
test('department member cannot open another department or trust session role',async()=>{
  const resolve=harness({depts:{cse:true,civil:true},'dept/cse/users/member_example_com':member});
  const allowed=await resolve('cse'); assert.equal(allowed.role,1);
  assert.deepEqual(Object.keys(allowed.roles),['cse']);
  await assert.rejects(resolve('civil'),/not authorized/);
});
test('disabled, unlisted, unverified and logged-out accounts are denied',async()=>{
  for(const value of [null,{...member,active:false}]) await assert.rejects(harness({depts:{cse:true},'dept/cse/users/member_example_com':value})('cse'));
  await assert.rejects(harness({},null)('cse'));
  await assert.rejects(harness({}, {email:'member@example.com',emailVerified:false})('cse'));
});
test('only active verified global role 3 crosses department boundaries',async()=>{
  const records={depts:{cse:true,civil:true},'users/member_example_com':{...member,roleLevel:3}};
  assert.equal((await harness(records)('civil')).role,3);
  records['users/member_example_com'].roleLevel=2;
  await assert.rejects(harness(records)('civil'));
});
test('missing, empty, literal null and unknown department allow authorized selection',async()=>{
  const resolve=harness({depts:{cse:true,civil:true},'dept/cse/users/member_example_com':member});
  for(const value of [null,'','null','NULL','undefined','missing']){
    const access=await resolve(value);assert.deepEqual(Object.keys(access.roles),['cse']);
  }
});
