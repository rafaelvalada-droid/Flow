// extensao-chrome/flow-bridge.js com DOM, armazenamento e app simulados: gravação imediata, mesclagem 409 e conversa duplicada.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('extensao-chrome/flow-bridge.js','utf8');
const user='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',key='flow.workspace.v1:'+user,thread='18b2c3d4e5f6a7b8';
function harness({cloud=true,tasks=[]}={}){
 const store=new Map(),win=new EventTarget(),timers=new Map();let listener,timer=0;
 const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const write=db=>store.set(key,JSON.stringify(db)),read=()=>JSON.parse(store.get(key));
 if(cloud){store.set('flow.cloud-required.v1','1');store.set('flow.active-workspace.v1',JSON.stringify({mode:'cloud',userId:user,key}));}
 write({version:1,projects:[{id:'oferta',name:'Oferta'}],tasks});
 if(!cloud)store.set('flow.workspace.v1',store.get(key));
 const context={window:win,localStorage,Event,CustomEvent,URL,crypto,location:{href:'https://flow.test/'},
  StorageEvent:class extends Event{constructor(type,init){super(type);Object.assign(this,init);}},
  setTimeout:(fn,ms)=>{const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  document:{querySelector:selector=>({'.app-shell':{hidden:false},'.sidebar':{inert:false},'#google-login':{hidden:true}})[selector]||null},
  chrome:{runtime:{id:'ext',onMessage:{addListener:fn=>{listener=fn;}}}}};
 context.globalThis=context;vm.createContext(context);vm.runInContext(source,context);
 const send=(type,data)=>new Promise(resolve=>listener({type,data},{id:'ext'},value=>resolve(JSON.parse(JSON.stringify(value)))));// cópia fora do realm do vm
 const capture=(over={})=>({requestId:'0b1c4a5e-1111-4222-8333-944455556666',projectId:'oferta',title:'Planejamento',dueDate:'2026-12-10',gmailUrl:'https://mail.google.com/mail/?authuser=user%40ulbra.br#all/'+thread,gmailSubject:'Planejamento',gmailSender:'coord@ulbra.br',gmailThreadId:thread,gmailMessageId:'18b2c3d4e5f6a7c0',...over});
 return {win,store,timers,write,read,send,capture};
}
// O app real responde a flow:cloud-save; aqui o flush devolve 409, mescla com a nuvem e salva de novo.
function app(h,{keep=true,ok=true}={}){
 h.win.addEventListener('flow:cloud-save',event=>{
  const {requestId}=event.detail;
  queueMicrotask(()=>{
   h.win.dispatchEvent(new CustomEvent('flow:cloud-remote-merged'));
   const merged=h.read();merged.projects.push({id:'remota',name:'Remota'});if(!keep)merged.tasks=merged.tasks.filter(t=>t.gmailCaptureId!==requestId);h.write(merged);
   queueMicrotask(()=>h.win.dispatchEvent(new CustomEvent('flow:cloud-save-result',{detail:{requestId,ok,...(ok?{}:{error:'Falha simulada'})}})));
  });
 });
}

test('The bridge asks the app to flush its debounced save before reading the workspace',async()=>{
 const h=harness();let flushed=0;
 h.win.addEventListener('flow:persist-flush',()=>{flushed++;const db=h.read();db.projects.push({id:'recente',name:'Criada agora'});h.write(db);});
 const result=await h.send('FLOW_BRIDGE_LISTS');
 assert.equal(flushed,1);assert.ok(result.ok);assert.deepEqual(result.projects.map(p=>p.id),['oferta','recente']);
});

test('A 409 merged automatically confirms the capture only when the merged workspace keeps it',async()=>{
 const h=harness();app(h);const result=await h.send('FLOW_BRIDGE_SAVE',h.capture());
 assert.ok(result.ok,result.error);const saved=h.read();
 assert.equal(saved.tasks.length,1);assert.equal(saved.tasks[0].id,result.taskId);assert.ok(saved.projects.some(p=>p.id==='remota'));
 assert.equal(saved.tasks[0].gmailThreadId,thread);assert.equal(saved.tasks[0].gmailMessageId,'18b2c3d4e5f6a7c0');
 assert.equal(h.timers.size,0,'No confirmation timer is left behind');
 const lost=harness();app(lost,{keep:false});const failed=await lost.send('FLOW_BRIDGE_SAVE',lost.capture());
 assert.equal(failed.ok,false);assert.match(failed.error,/Outro dispositivo alterou o UlbraFlow/);
 const rejected=harness();app(rejected,{ok:false});assert.match((await rejected.send('FLOW_BRIDGE_SAVE',rejected.capture())).error,/Falha simulada/);
});

test('A merge notice restarts the cloud confirmation deadline',async()=>{
 const h=harness();let saved;h.win.addEventListener('flow:cloud-save',event=>{saved=event.detail.requestId;});
 const pending=h.send('FLOW_BRIDGE_SAVE',h.capture());await new Promise(r=>setImmediate(r));
 const [first]=h.timers.keys();assert.equal(h.timers.get(first).ms,65000);
 h.win.dispatchEvent(new CustomEvent('flow:cloud-remote-merged'));
 assert.ok(!h.timers.has(first)&&h.timers.size===1,'The previous deadline is replaced');
 h.win.dispatchEvent(new CustomEvent('flow:cloud-save-result',{detail:{requestId:saved,ok:true}}));
 assert.ok((await pending).ok);
});

test('The same Gmail thread captured by any path is returned as a duplicate',async()=>{
 const review={id:'from-review',title:'Revisado',gmailCaptureId:'gmail-review-'+thread,gmailThreadId:thread};
 const h=harness({cloud:false,tasks:[review]});
 const duplicate=await h.send('FLOW_BRIDGE_SAVE',h.capture());
 assert.deepEqual(duplicate,{ok:true,taskId:'from-review',requestId:'gmail-review-'+thread,duplicate:true});
 assert.equal(JSON.parse(h.store.get('flow.workspace.v1')).tasks.length,1);
 const mobile=harness({cloud:false,tasks:[{id:'from-phone',gmailCaptureId:'gmail-mobile-'+thread}]});
 assert.equal((await mobile.send('FLOW_BRIDGE_SAVE',mobile.capture())).taskId,'from-phone');
 const legacy=harness({cloud:false,tasks:[{id:'legacy-url',gmailUrl:'https://mail.google.com/mail/?authuser=a%40b.c#all/'+thread}]});
 assert.equal((await legacy.send('FLOW_BRIDGE_SAVE',legacy.capture())).taskId,'legacy-url');
 const fresh=harness({cloud:false});
 // Captura anterior à 1.5 (sem ID): link de posição na caixa de entrada.
 const created=await fresh.send('FLOW_BRIDGE_SAVE',fresh.capture({gmailThreadId:'18B2C3D4E5F6A7B8',gmailUrl:'https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmTrlLQhJjZdcHtdkzGt'}));
 const task=JSON.parse(fresh.store.get('flow.workspace.v1')).tasks[0];
 assert.ok(created.ok&&!created.duplicate);assert.equal(task.gmailThreadId,undefined,'Only the lowercase API format is stored');
 const again=await fresh.send('FLOW_BRIDGE_SAVE',fresh.capture({requestId:'1b1c4a5e-1111-4222-8333-944455556666'}));
 assert.equal(again.duplicate,undefined,'A capture without the stored ID cannot be matched by thread');
 assert.equal(JSON.parse(fresh.store.get('flow.workspace.v1')).tasks.length,2);
 const third=await fresh.send('FLOW_BRIDGE_SAVE',fresh.capture({requestId:'2b1c4a5e-1111-4222-8333-944455556666'}));
 assert.deepEqual([third.duplicate,third.taskId,third.requestId],[true,again.taskId,'1b1c4a5e-1111-4222-8333-944455556666']);
});

test('Ver no UlbraFlow opens a duplicate by its own capture ID or task ID',async()=>{
 const h=harness({cloud:false,tasks:[{id:'manual',title:'Sem captura',gmailThreadId:thread}]});const opened=[];
 h.win.addEventListener('flow:open-capture',event=>opened.push({...event.detail}));
 const duplicate=await h.send('FLOW_BRIDGE_SAVE',h.capture());assert.equal(duplicate.taskId,'manual');assert.equal(duplicate.requestId,'');
 assert.ok((await h.send('FLOW_BRIDGE_OPEN',{requestId:duplicate.requestId,taskId:duplicate.taskId})).ok);
 assert.deepEqual(opened,[{requestId:'',taskId:'manual'}]);
 assert.equal((await h.send('FLOW_BRIDGE_OPEN',{requestId:'missing-request-id',taskId:'other'})).ok,false);
});

// "Concluir e voltar ao UlbraFlow": a ponte localiza a tarefa da conversa e pede ao app que a conclua.
function completer(h,{ok=true}={}){
 const asked=[];
 h.win.addEventListener('flow:complete-task',event=>{
  const {requestId,taskId}=event.detail;asked.push(taskId);
  if(ok){const db=h.read();db.tasks.find(t=>t.id===taskId).status='done';h.write(db);}
  queueMicrotask(()=>h.win.dispatchEvent(new CustomEvent('flow:complete-task-result',{detail:{requestId,ok,...(ok?{taskId}:{error:'Falha simulada'})}})));
 });
 return asked;
}

test('Finding a conversation reports its linked task by any capture path, and nothing for unknown threads',async()=>{
 const h=harness({cloud:false,tasks:[{id:'mobile',title:'Do celular',status:'todo',gmailCaptureId:'gmail-mobile-'+thread}]});
 assert.deepEqual(await h.send('FLOW_BRIDGE_FIND',{gmailThreadId:thread}),{ok:true,task:{id:'mobile',status:'todo'}});
 assert.deepEqual(await h.send('FLOW_BRIDGE_FIND',{gmailThreadId:'ffffffffffffffff'}),{ok:true,task:null});
 assert.deepEqual(await h.send('FLOW_BRIDGE_FIND',{gmailThreadId:'<script>'}),{ok:true,task:null});
});

test('Completing a conversation asks the app to complete the linked task and returns its id',async()=>{
 const h=harness({tasks:[{id:'linked',title:'Responder coordenação',status:'doing',gmailThreadId:thread},{id:'other',title:'Outra',status:'todo'}]});
 const asked=completer(h);
 const result=await h.send('FLOW_BRIDGE_COMPLETE',{gmailThreadId:thread});
 assert.deepEqual(result,{ok:true,taskId:'linked'});assert.deepEqual(asked,['linked']);
 assert.equal(h.read().tasks.find(t=>t.id==='linked').status,'done');assert.equal(h.read().tasks.find(t=>t.id==='other').status,'todo');
 assert.equal(h.timers.size,0,'No response timer is left behind');
});

test('Completing fails clearly for a conversation outside Flow, an app refusal or no answer',async()=>{
 const missing=harness();const unknown=await missing.send('FLOW_BRIDGE_COMPLETE',{gmailThreadId:thread});
 assert.equal(unknown.ok,false);assert.match(unknown.error,/não está no UlbraFlow/);
 const refused=harness({tasks:[{id:'linked',status:'todo',gmailThreadId:thread}]});completer(refused,{ok:false});
 assert.match((await refused.send('FLOW_BRIDGE_COMPLETE',{gmailThreadId:thread})).error,/Falha simulada/);
 const silent=harness({tasks:[{id:'linked',status:'todo',gmailThreadId:thread}]});
 const pending=silent.send('FLOW_BRIDGE_COMPLETE',{gmailThreadId:thread});await new Promise(r=>setImmediate(r));
 const [id,timer]=[...silent.timers][0];assert.equal(timer.ms,10000);silent.timers.delete(id);timer.fn();
 assert.match((await pending).error,/não respondeu/);
});
