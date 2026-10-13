// Leitura do Gmail sob demanda, retenção das revisões, charset e arquivamento seguro (gmail-review.js com serviços simulados).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('gmail-review.js','utf8');
const b64=(text,encoding='utf8')=>Buffer.from(text,encoding).toString('base64url');
const message=(id,{labels=['INBOX'],text='Pedido',subject='Turmas',charset='',time='1'}={})=>({id,labelIds:labels,internalDate:time,snippet:text.slice(0,40),payload:{mimeType:'text/plain',headers:[{name:'Subject',value:subject},{name:'From',value:'coord@ulbra.br'},...(charset?[{name:'Content-Type',value:'text/plain; charset="'+charset+'"'}]:[])],body:{data:b64(text,charset&&/8859|1252/i.test(charset)?'latin1':'utf8')}}});
function harness(threads={a:[message('a1')],b:[message('b1')]}){
 const calls=[],analyses=[];let history='100';
 const context={AbortSignal,TextDecoder,Uint8Array,URLSearchParams,atob,WeakMap,CustomEvent:class{},window:{dispatchEvent(){}},
  FlowCloud:{gmailToken:()=> 'token',info:()=>({user:{id:'owner',email:'user@ulbra.br'}}),analyzeGmail:async body=>{analyses.push(body);return {summary:'Resumo '+body.subject,title:'Revisar',areaId:'oferta',modelUsed:'gemini-test'};}},
  fetch:async(url,options={})=>{
   calls.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
   if(url.endsWith('/profile'))return Response.json({emailAddress:'user@ulbra.br',historyId:history});
   if(url.includes('/history?'))return Response.json({history:[{messagesAdded:Object.keys(threads).map(threadId=>({message:{threadId}}))}]});
   if(url.includes('/threads?'))return Response.json({threads:Object.keys(threads).map(id=>({id}))});
   if(url.endsWith('/messages/batchModify'))return new Response(null,{status:204});
   const id=decodeURIComponent(url.split('/threads/')[1].split('?')[0]);
   if(!threads[id])return Response.json({error:{}},{status:404});
   return Response.json({id,messages:threads[id]});
  }};
 vm.createContext(context);vm.runInContext(source,context);
 const formats=()=>calls.map(c=>/format=(\w+)/.exec(c.url)?.[1]).filter(Boolean);
 return {review:context.FlowGmailReview,context,calls,analyses,threads,formats,history:value=>{history=value}};
}

test('Opening the inbox reads metadata only; full bodies are fetched just for messages without a review',async()=>{
 const h=harness();await h.review.refresh();
 assert.deepEqual(h.formats(),['metadata','metadata']);
 assert.match(h.calls.find(c=>c.url.includes('format=metadata')).url,/metadataHeaders=From.*metadataHeaders=Subject.*metadataHeaders=Date/);
 assert.equal(h.review.info().emails[0].text,undefined);assert.equal(h.review.info().emails[0].snippet,'Pedido');
 const db={projects:[{id:'oferta',name:'Oferta'}],tasks:[],gmailReviews:{b:{messageId:'b1',state:'pending',summary:'Já analisado',at:Date.now()}}};
 h.calls.length=0;await h.review.analyze(db,()=>{});
 assert.deepEqual(h.calls.map(c=>c.url.split('/users/me/')[1]),['threads/a?format=full']);
 assert.equal(h.analyses.length,1);assert.match(h.analyses[0].text,/Pedido/);
 assert.equal(db.gmailReviews.a.state,'pending');assert.ok(Number.isFinite(db.gmailReviews.a.at));
 h.calls.length=0;await h.review.analyze(db,()=>{});assert.equal(h.calls.length,0,'A cached review makes no Gmail request');
});

test('A reopened app with every review cached downloads no conversation body',async()=>{
 const h=harness(),db={projects:[],tasks:[],gmailReviews:{a:{messageId:'a1',state:'pending',summary:'S',at:Date.now()},b:{messageId:'b1',state:'ignored',at:Date.now()}}};
 await h.review.refresh();await h.review.analyze(()=>db,()=>{});
 assert.ok(!h.formats().includes('full'));assert.equal(h.analyses.length,0);
});

test('Analysis re-resolves a workspace getter after every await so results land in the current workspace',async()=>{
 const h=harness({a:[message('a1')]});await h.review.refresh();let release;
 h.context.FlowCloud.analyzeGmail=()=>new Promise(resolve=>{release=resolve});
 let db={projects:[{id:'oferta',name:'Oferta'}],tasks:[]};const old=db;let persisted=0;
 const pending=h.review.analyze(()=>db,()=>{persisted++});while(!release)await new Promise(r=>setTimeout(r,1));
 db={...structuredClone(old),tasks:[{id:'captured-by-extension'}]};// outra aba ou a extensão substitui o workspace
 release({summary:'Resumo',title:'Revisar'});await pending;
 assert.equal(db.gmailReviews.a.summary,'Resumo');assert.equal(old.gmailReviews,undefined);assert.equal(persisted,1);
});

test('Reply context fetches the body lazily once and reuses it',async()=>{
 const h=harness({a:[message('a1',{text:'Texto completo da conversa'})]});await h.review.refresh();h.calls.length=0;
 const email=await h.review.replyContext('a');assert.match(email.text,/Texto completo/);
 await h.review.replyContext('a');assert.deepEqual(h.formats(),['full']);
 await assert.rejects(h.review.replyContext('zzz'),/HTTP 404/);
});

test('Body text honors ISO-8859-1 and Windows-1252 charsets and falls back to UTF-8',()=>{
 const h=harness(),labels=[];h.context.TextDecoder=class extends TextDecoder{constructor(label){labels.push(label);super(label);}};const part=(text,charset,encoding)=>({mimeType:'text/plain',headers:charset?[{name:'Content-Type',value:'text/plain; charset='+charset}]:[],body:{data:Buffer.from(text,encoding).toString('base64url')}});
 assert.equal(h.review.bodyText(part('Reunião às 14h','ISO-8859-1','latin1')),'Reunião às 14h');
 assert.equal(h.review.bodyText({mimeType:'multipart/alternative',parts:[part('Atenção – prazo','"windows-1252"','latin1')]}).replace('–','-').startsWith('Atenção'),true);
 assert.equal(h.review.bodyText(part('Ação concluída','','utf8')),'Ação concluída');
 assert.equal(h.review.bodyText(part('Ação concluída','x-desconhecido','utf8')),'Ação concluída');
 assert.deepEqual(labels,['ISO-8859-1','windows-1252','utf-8','x-desconhecido',undefined]);
 // Bytes 0x80–0x9F (aspas e €) são verificados no Chromium em tests/gmail-review-smoke.py; o Node pode decodificá-los como Latin-1.
});

test('Prune compacts decisions, expires old pending reviews, keeps visible ones and caps the map',async()=>{
 const h=harness({a:[message('a1')],b:[message('b1')]}),now=Date.UTC(2026,9,13),day=864e5;
 const db={tasks:[{id:'t',gmailThreadId:'old',gmailMessageId:'old1',geminiModel:null}],gmailReviews:{
  old:{messageId:'old1',state:'accepted',summary:'Resumo privado',title:'T',areaId:'oferta',modelUsed:'gemini-test',at:now-40*day},
  ign:{messageId:'i1',state:'ignored',summary:'Outro resumo'},
  fresh:{messageId:'f1',state:'pending',summary:'S',at:now-29*day},
  stale:{messageId:'s1',state:'pending',summary:'S',at:now-31*day},
  legacy:{messageId:'l1',state:'pending',summary:'S'},
  a:{messageId:'a1',state:'pending',summary:'S'},
  empty:{messageId:'e1',state:'pending'},broken:null}};
 assert.equal(h.review.prune(db,now),true);
 assert.deepEqual({...db.gmailReviews.old},{messageId:'old1',state:'accepted',at:now-40*day});
 assert.deepEqual({...db.gmailReviews.ign},{messageId:'i1',state:'ignored',at:now});
 assert.equal(db.tasks[0].geminiAnalyzed,true);assert.equal(db.tasks[0].geminiClassified,true);assert.equal(db.tasks[0].geminiModel,'gemini-test');
 assert.ok(db.gmailReviews.fresh&&!db.gmailReviews.stale&&!db.gmailReviews.empty&&!('broken' in db.gmailReviews));
 assert.ok(db.gmailReviews.legacy,'Without a loaded inbox list a legacy pending review is kept');
 await h.review.refresh();h.review.prune(db,now);
 assert.ok(!db.gmailReviews.legacy,'A legacy pending review outside the loaded inbox is removed');
 assert.ok(db.gmailReviews.a,'A legacy pending review still in the inbox is kept');
 assert.equal(h.review.prune(db,now),false,'A second pass changes nothing');
 for(let i=0;i<600;i++)db.gmailReviews['x'+i]={messageId:'m'+i,state:'accepted',at:now-i*1000};
 db.gmailReviews.b={messageId:'b1',state:'accepted',at:1};
 h.review.prune(db,now);const ids=Object.keys(db.gmailReviews);
 assert.equal(ids.length,500);assert.ok(db.gmailReviews.b&&db.gmailReviews.a,'Visible inbox threads survive the cap');
 assert.ok(db.gmailReviews.x0&&!db.gmailReviews.x599,'The most recent decisions are kept');
 assert.ok(JSON.stringify(db.gmailReviews).length<60000);
});

test('Accepted entries compacted by prune still hide the card and still count as analyzed',async()=>{
 const h=harness({a:[message('a1')]});await h.review.refresh();
 const db={projects:[],tasks:[{id:'t',gmailThreadId:'a',gmailMessageId:'a1'}],gmailReviews:{a:{messageId:'a1',state:'accepted',summary:'Resumo',areaId:''}}};
 h.review.prune(db);
 // Mesma regra de app.js (renderGmailReview e hasGeminiReview).
 const r=db.gmailReviews.a,email=h.review.info().emails[0],t=db.tasks[0];
 assert.equal(r.messageId===email.messageId&&['accepted','ignored'].includes(r.state),true);
 assert.equal(!!(t.geminiAnalyzed||t.geminiClassified||(r.state==='accepted'&&r.messageId===t.gmailMessageId&&r.summary)),true);
 await h.review.analyze(db,()=>{});assert.equal(h.analyses.length,0,'Compacted decisions are not analyzed again');
});

test('Archiving removes INBOX only from reviewed messages and refuses when a newer reply arrived',async()=>{
 const h=harness({a:[message('a1'),message('a2',{labels:['SENT']})],b:[message('b1'),message('b2')]});await h.review.refresh();
 await h.review.archive('a','a1');
 const modify=h.calls.find(c=>c.url.endsWith('/messages/batchModify'));
 assert.deepEqual(modify.body,{ids:['a1'],removeLabelIds:['INBOX']});assert.equal(modify.method,'POST');
 assert.ok(!h.review.info().emails.some(e=>e.id==='a'));
 h.calls.length=0;
 await assert.rejects(h.review.archive('b','b1'),/nova mensagem nesta conversa/);
 assert.ok(!h.calls.some(c=>c.url.includes('batchModify')||c.url.includes('/modify')));
 await assert.rejects(h.review.archive('b','missing'),/A conversa mudou/);
 assert.ok(!h.calls.some(c=>c.url.includes('batchModify')));
});

test('Archiving without an explicit message uses the accepted review rather than a newer refreshed message',async()=>{
 const h=harness({a:[message('a1')]});await h.review.refresh();
 const db={projects:[],tasks:[],gmailReviews:{a:{messageId:'a1',state:'accepted',at:1}}};await h.review.analyze(()=>db,()=>{});
 h.threads.a.push(message('a2'));h.history('101');await h.review.refresh();
 assert.equal(h.review.info().emails[0].messageId,'a2');
 await assert.rejects(h.review.archive('a'),/nova mensagem/);
 assert.ok(!h.calls.some(c=>c.url.includes('batchModify')));
});

test('A conversation captured at the same message (extension, phone or Entrada) is not analyzed again',async()=>{
 const h=harness({a:[message('a1')],b:[message('b1')]});await h.review.refresh();
 const db={projects:[],tasks:[{id:'ext',gmailThreadId:'a',gmailMessageId:'a1'},{id:'old',gmailThreadId:'b',gmailMessageId:'b0'}]};
 await h.review.analyze(()=>db,()=>{});
 assert.deepEqual(h.analyses.map(a=>a.subject),['Turmas']);assert.ok(!db.gmailReviews.a&&db.gmailReviews.b,'Only the conversation with a newer message is analyzed');
 assert.ok(!h.calls.some(c=>c.url.includes('threads/a?format=full')));
});
