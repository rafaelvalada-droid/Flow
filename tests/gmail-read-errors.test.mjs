import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('gmail-review.js','utf8');
function setup(status,body){let disconnected=0;const context={AbortSignal,TextDecoder,Uint8Array,URLSearchParams,CustomEvent:class{},window:{dispatchEvent(){}},FlowCloud:{gmailToken:()=>disconnected?null:'token',info:()=>({user:{id:'owner',email:'user@ulbra.br'}}),disconnectGmail:()=>{disconnected++},analyzeGmail:()=>{throw new Error('Must not analyze when inbox read failed')}},fetch:async()=>Response.json(body,{status})};vm.createContext(context);vm.runInContext(source,context);return {review:context.FlowGmailReview,disconnected:()=>disconnected};}
test('Disabled Gmail API remains visible after automatic analysis and keeps authorization',async()=>{const h=setup(403,{error:{details:[{reason:'SERVICE_DISABLED'}]}});await h.review.refresh();await h.review.analyze({tasks:[]},()=>{});assert.match(h.review.info().error,/Gmail API está desativada/);assert.equal(h.disconnected(),0);assert.equal(h.review.info().loading,false);});
test('Insufficient scopes request reauthorization and retain the reason',async()=>{const h=setup(403,{error:{errors:[{reason:'insufficientPermissions'}]}});await h.review.refresh();await h.review.analyze({},()=>{});assert.equal(h.disconnected(),1);assert.match(h.review.info().error,/não liberou a leitura/);});
test('Expired token and rate limit have different actionable messages',async()=>{const expired=setup(401,{});await expired.review.refresh();assert.match(expired.review.info().error,/expirou/);const limited=setup(429,{});await limited.review.refresh();assert.match(limited.review.info().error,/limite de consultas/);assert.equal(limited.disconnected(),0);});
test('Gemini failure pauses automatic retries until the user requests analysis again',async()=>{
 let attempts=0;
 const context={AbortSignal,TextDecoder,Uint8Array,URLSearchParams,CustomEvent:class{},window:{dispatchEvent(){}},FlowCloud:{gmailToken:()=> 'token',info:()=>({user:{id:'owner',email:'user@ulbra.br'}}),analyzeGmail:async()=>{attempts++;throw new Error('HTTP 429');}},fetch:async(url)=>Response.json(url.endsWith('/profile')?{emailAddress:'user@ulbra.br'}:url.includes('/threads?')?{threads:[{id:'abcdef123'}]}:{messages:[{id:'message',internalDate:'1',snippet:'Pedido',payload:{mimeType:'text/plain',headers:[],body:{data:'dGVzdA'}}}]})};
 vm.createContext(context);vm.runInContext(source,context);const review=context.FlowGmailReview;await review.refresh();
 await review.analyze({projects:[]},()=>{});await review.analyze({projects:[]},()=>{});assert.equal(attempts,1);
 await review.analyze({projects:[]},()=>{},true);assert.equal(attempts,2);assert.match(review.info().error,/429/);
});

test('Organization policy errors are identified without treating all 403 responses as organization restrictions',async()=>{const policy=setup(403,{error:{errors:[{reason:'domainPolicy'}]}});await policy.review.refresh();assert.match(policy.review.info().error,/administrador/);assert.match(policy.review.info().error,/domainPolicy/);const unknown=setup(403,{error:{status:'PERMISSION_DENIED'}});await unknown.review.refresh();assert.match(unknown.review.info().error,/PERMISSION_DENIED/);assert.ok(!unknown.review.info().error.includes('administrador'));});

function inboxHarness(){
 let history='100',expired=false,failThread='',token='token',changed=['a'];const calls=[];
 const messages={a:'a1',b:'b1'};let ids=['a','b'];
 const context={AbortSignal,TextDecoder,Uint8Array,URLSearchParams,atob,CustomEvent:class{},window:{dispatchEvent(){}},FlowCloud:{gmailToken:()=>token,info:()=>({user:{id:'owner',email:'user@ulbra.br'}}),analyzeGmail:async()=>({summary:'Resumo',title:'Revisar'})},fetch:async url=>{
  calls.push(url);
  if(url.endsWith('/profile'))return Response.json({emailAddress:'user@ulbra.br',historyId:history});
  if(url.includes('/history?'))return expired?Response.json({}, {status:404}):Response.json({history:[{messagesAdded:changed.map(threadId=>({message:{threadId}}))}]});
  if(url.includes('/threads?'))return Response.json({threads:ids.map(id=>({id}))});
  const id=url.split('/threads/')[1].split('?')[0];if(id===failThread)return Response.json({}, {status:500});
  return Response.json({messages:[{id:messages[id],internalDate:'1',snippet:'Pedido',payload:{mimeType:'text/plain',headers:[],body:{data:'dGVzdA'}}}]});
 }};vm.createContext(context);vm.runInContext(source,context);
 return {review:context.FlowGmailReview,calls,messages,context,change:value=>{history=value},expire:()=>{expired=true},fail:id=>{failThread=id},token:value=>{token=value},ids:value=>{ids=value},changed:value=>{changed=value}};
}
test('Unchanged Gmail polling makes one request and keeps loaded conversations',async()=>{
 const h=inboxHarness();await h.review.refresh();assert.equal(h.calls.length,4);h.calls.length=0;
 await h.review.refresh();assert.equal(h.calls.length,1);assert.match(h.calls[0],/profile$/);assert.equal(h.review.info().emails.length,2);
});
test('Gmail history fetches only changed conversations and removes archived rows',async()=>{
 const h=inboxHarness();await h.review.refresh();h.calls.length=0;h.change('101');h.messages.a='a2';
 await h.review.refresh();assert.equal(h.calls.filter(url=>url.includes('/threads/')).length,1);assert.equal(h.review.info().emails.find(e=>e.id==='a').messageId,'a2');assert.equal(h.review.info().emails.find(e=>e.id==='b').messageId,'b1');
 h.change('102');h.ids(['b']);await h.review.refresh();assert.deepEqual(Array.from(h.review.info().emails,e=>e.id),['b']);
});
test('Expired Gmail history falls back to a complete read without hiding messages',async()=>{
 const h=inboxHarness();await h.review.refresh();h.calls.length=0;h.change('101');h.expire();await h.review.refresh();assert.equal(h.calls.filter(url=>url.includes('/threads/')).length,2);assert.equal(h.review.info().error,'');
});
test('A partial Gmail failure does not advance the history cursor and can be retried',async()=>{
 const h=inboxHarness();await h.review.refresh();h.change('101');h.messages.a='a2';h.fail('a');await h.review.refresh();assert.match(h.review.info().error,/500/);
 h.fail('');h.calls.length=0;await h.review.refresh();assert.ok(h.calls.some(url=>url.includes('/threads/a?')));assert.equal(h.review.info().emails.find(e=>e.id==='a').messageId,'a2');
});
test('Disconnecting and resetting during Gemini analysis prevents stale results from being saved',async()=>{
 const h=inboxHarness();await h.review.refresh();let release,persisted=0;h.context.FlowCloud.analyzeGmail=()=>new Promise(resolve=>{release=resolve});const db={projects:[]};
 const pending=h.review.analyze(db,()=>{persisted++});h.review.reset();release({summary:'Old result'});await pending;assert.equal(persisted,0);assert.equal(h.review.info().analyzing,false);assert.equal(h.review.info().emails.length,0);
});
test('Approving an email while Gemini is pending cannot be undone by its late result',async()=>{
 const h=inboxHarness();h.ids(['a']);await h.review.refresh();let release;
 h.context.FlowCloud.analyzeGmail=()=>new Promise(resolve=>{release=resolve});const db={projects:[],gmailReviews:{}};
 const pending=h.review.analyze(db,()=>{});db.gmailReviews.a={messageId:'a1',state:'accepted',title:'My manual choice'};
 release({title:'AI title',summary:'Late result'});await pending;assert.equal(db.gmailReviews.a.state,'accepted');assert.equal(db.gmailReviews.a.title,'My manual choice');
});
