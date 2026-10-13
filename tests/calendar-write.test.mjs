import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../areas.js';
import '../workflow.js';

const source=readFileSync(new URL('../calendar.js',import.meta.url),'utf8');
const BASE='https://www.googleapis.com/calendar/v3/calendars/primary/events';
const OLD='2026-01-01T00:00:00.000Z';
const hex=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const eventId=(owner,task)=>hex(`flow:${owner}:${task}`).then(h=>'f10'+h);

/* Google Agenda simulado conforme a documentação: o id de um evento excluído continua reservado (inserir de novo → 409),
   a leitura dele traz só {id,status:'cancelled'}, a listagem omite cancelados, filtra privateExtendedProperty e pagina. */
function fakeGoogle({pageSize=2}={}){
  const store=new Map(),log=[],failures=[];
  let serial=0,clock=Date.parse('2026-10-13T12:00:00Z');
  const stamp=()=>new Date(clock+=1000).toISOString();
  const error=(status,reason='error',headers={})=>Response.json({error:{code:status,errors:[{reason}]}},{status,headers});
  const time=(point,end)=>point?.dateTime?Date.parse(point.dateTime):point?.date?Date.parse(point.date+'T00:00:00Z'):end?Infinity:-Infinity;
  function list(query){
    let items=[...store.values()];
    if(query.get('showDeleted')!=='true')items=items.filter(e=>e.status!=='cancelled');
    for(const rule of query.getAll('privateExtendedProperty')){const [key,...rest]=rule.split('=');items=items.filter(e=>e.extendedProperties?.private?.[key]===rest.join('='));}
    if(query.get('timeMin'))items=items.filter(e=>time(e.end,true)>Date.parse(query.get('timeMin'))&&time(e.start)<Date.parse(query.get('timeMax')));
    const offset=Number(query.get('pageToken')||0),size=Math.min(pageSize,Number(query.get('maxResults')||250));
    const page=items.slice(offset,offset+size);
    return Response.json({items:page.map(e=>e.status==='cancelled'?{id:e.id,status:'cancelled'}:e),...(offset+size<items.length?{nextPageToken:String(offset+size)}:{})});
  }
  async function fetch(url,options={}){
    const method=options.method||'GET',target=new URL(url);
    assert.ok(target.href.startsWith(BASE),'Only the primary calendar events collection is used');
    const id=decodeURIComponent(target.href.slice(BASE.length).split('?')[0].replace(/^\//,''));
    const body=options.body?JSON.parse(options.body):undefined,request={method,id,query:target.searchParams,body};
    log.push(request);
    const injected=failures.findIndex(f=>f.when(request));
    if(injected>=0)return failures.splice(injected,1)[0].respond(request);
    if(!id&&method==='GET')return list(target.searchParams);
    if(!id&&method==='POST'){
      const key=body.id||`auto${++serial}`;
      if(store.has(key))return error(409,'duplicate');
      const event={...body,id:key,status:body.status||'confirmed',updated:stamp(),htmlLink:`https://calendar.google.com/event?eid=${key}`};
      store.set(key,event);return Response.json(event);
    }
    const existing=store.get(id);
    if(method==='GET')return existing?Response.json(existing.status==='cancelled'?{id,status:'cancelled'}:existing):error(404,'notFound');
    if(method==='PUT'){ // Substitui o recurso; status ausente mantém o anterior (um cancelado continua cancelado).
      if(!existing)return error(404,'notFound');
      const event={...body,id,status:body.status||existing.status,updated:stamp(),htmlLink:`https://calendar.google.com/event?eid=${id}`};
      store.set(id,event);return Response.json(event);
    }
    if(method==='PATCH'){if(!existing)return error(404,'notFound');const event={...existing,...body,updated:stamp()};store.set(id,event);return Response.json(event);}
    if(method==='DELETE'){
      if(!existing)return error(404,'notFound');
      if(existing.status==='cancelled')return error(410,'deleted');
      store.set(id,{id,status:'cancelled',updated:stamp()});return new Response(null,{status:204});
    }
    throw new Error('Unexpected request '+method+' '+url);
  }
  const writes=()=>log.filter(r=>r.method!=='GET');
  return {store,log,fetch,writes,fail:(when,respond)=>failures.push({when,respond}),error,reset:()=>log.splice(0)};
}

function setup(db,google,{owner='owner',cloudStatus='saved'}={}){
  const timers=new Map(),intervals=new Map(),listeners={};let id=0,token='provider',saves=0;
  const clock={now:Date.parse('2026-10-13T12:00:00Z')};
  class ClockDate extends Date{static now(){return clock.now}}
  const context={TextEncoder,URLSearchParams,AbortSignal,queueMicrotask,crypto:globalThis.crypto,Intl,Date:ClockDate,FlowWorkflow:globalThis.FlowWorkflow,
    FlowCloud:{calendarToken:()=>token,info:()=>({user:{id:owner},status:cloudStatus}),disconnectCalendar(){token=null}},fetch:google.fetch,
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:key=>timers.delete(key),
    setInterval:(fn,ms)=>{intervals.set(++id,{fn,ms});return id},clearInterval:key=>intervals.delete(key),
    window:{dispatchEvent(){}},CustomEvent:class{},document:{visibilityState:'visible',addEventListener:(type,fn)=>{listeners[type]=fn}}};
  vm.createContext(context);vm.runInContext(source,context);
  const calendar=context.FlowCalendar;
  calendar.initialize(()=>db,()=>{saves++;calendar.schedule()});
  const pending=()=>[...timers.values()];
  // Dispara o temporizador mais próximo (retentativa ou sincronização agendada).
  const fire=async()=>{const [key,{fn}]=[...timers.entries()].sort((a,b)=>a[1].ms-b[1].ms)[0];timers.delete(key);fn();await settle();};
  const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,0));};
  timers.clear(); // Ignora o agendamento inicial; cada teste sincroniza explicitamente.
  return {calendar,clock,timers,intervals,listeners,pending,fire,settle,saves:()=>saves};
}
const workspace=(tasks,extra={})=>({version:1,projects:[{id:'area',name:'Folha docente'}],preferences:{focusMinutes:25,breakMinutes:5},tasks,...extra});
const task=(id,extra={})=>({id,title:'Tarefa '+id,project:'area',status:'todo',dueDate:'2026-10-20',plannedDate:'2026-10-14',plannedTime:'',description:'',sessions:[],subtasks:[],...extra});

test('creating an event inserts once with the deterministic id and stores a hash instead of the event JSON',async()=>{
  const google=fakeGoogle(),db=workspace([task('a',{description:'Notas longas'})]),{calendar,pending}=setup(db,google);
  await calendar.synchronize();
  const id=await eventId('owner','a'),[insert]=google.writes();
  assert.deepEqual(google.writes().map(r=>r.method),['POST']);
  assert.equal(insert.body.id,id);assert.equal(insert.body.status,'confirmed');assert.equal(insert.body.visibility,'private');
  assert.deepEqual(insert.body.extendedProperties.private,{flowUserId:'owner',flowTaskId:'a'});
  assert.deepEqual(insert.body.start,{date:'2026-10-14'});assert.deepEqual(insert.body.end,{date:'2026-10-15'});
  assert.match(insert.body.description,/Área: Folha docente\nPrazo final: 2026-10-20\nNotas longas/);
  const record=db.calendar.events.a;
  assert.equal(record.id,id);assert.equal(record.owner,'owner');assert.match(record.signature,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(db.calendar).includes('Notas longas'),'The local record must not duplicate the description');
  assert.equal(calendar.info().status,'synced');assert.equal(pending().length,0,'A finished sync leaves no redundant sync scheduled');
  google.reset();await calendar.synchronize();
  assert.equal(google.log.length,0,'Unchanged tasks and a recent orphan sweep make no requests');
});

test('updates use one full PUT, replacing all-day with timed events without PATCH merges',async()=>{
  const google=fakeGoogle(),db=workspace([task('a')]),{calendar}=setup(db,google);
  await calendar.synchronize();google.reset();
  db.tasks[0].title='Novo título';db.tasks[0].plannedTime='09:30';
  await calendar.synchronize();
  assert.deepEqual(google.log.map(r=>r.method),['PUT']);
  const stored=google.store.get(db.calendar.events.a.id);
  assert.equal(stored.summary,'Novo título');assert.ok(stored.start.dateTime);assert.equal(stored.start.date,undefined,'All-day date must not survive');
  assert.equal(Date.parse(stored.end.dateTime)-Date.parse(stored.start.dateTime),25*60000);
  google.reset();db.tasks[0].plannedTime='';await calendar.synchronize();
  const back=google.store.get(db.calendar.events.a.id);
  assert.deepEqual(back.start,{date:'2026-10-14'});assert.equal(back.start.dateTime,undefined);
  assert.equal(google.log.filter(r=>r.method==='PATCH').length,0);
});

test('clearing the date deletes the event; dating it again revives the reserved cancelled id',async()=>{
  const google=fakeGoogle(),db=workspace([task('a'),task('b')]),{calendar}=setup(db,google);
  await calendar.synchronize();const id=db.calendar.events.a.id;google.reset();
  db.tasks[0].plannedDate='';await calendar.synchronize();
  assert.deepEqual(google.log.map(r=>r.method+':'+(r.id?'event':'list')),['GET:event','DELETE:event']);
  assert.equal(google.store.get(id).status,'cancelled');assert.equal(db.calendar.events.a,undefined);
  google.reset();db.tasks[0].plannedDate='2026-10-16';db.tasks[0].title='De volta';
  await calendar.synchronize();
  // Inserir de novo → 409; a leitura traz só {id,status:'cancelled'} (sem extendedProperties): reativa por PUT.
  assert.deepEqual(google.log.map(r=>r.method),['POST','GET','PUT']);
  assert.equal(google.log[2].body.status,'confirmed');
  const revived=google.store.get(id);
  assert.equal(revived.status,'confirmed');assert.equal(revived.summary,'De volta');assert.deepEqual(revived.start,{date:'2026-10-16'});
  assert.equal(calendar.info().status,'synced');assert.equal(db.calendar.events.a.id,id);
  // Uma tarefa excluída também remove somente o próprio evento.
  google.reset();db.tasks=db.tasks.filter(t=>t.id!=='b');await calendar.synchronize();
  assert.equal(google.store.get(await eventId('owner','b')).status,'cancelled');assert.equal(google.store.get(id).status,'confirmed');
});

test('events that are not owned are never overwritten or deleted, and other tasks keep syncing',async()=>{
  const google=fakeGoogle(),db=workspace([task('a'),task('b'),task('c',{plannedTime:'25:00'}),task('d')]),{calendar}=setup(db,google);
  const foreign=await eventId('owner','a');
  google.store.set(foreign,{id:foreign,status:'confirmed',summary:'Compromisso pessoal',updated:OLD,start:{date:'2026-10-14'},end:{date:'2026-10-15'},extendedProperties:{private:{flowUserId:'someone',flowTaskId:'a'}}});
  await calendar.synchronize();
  assert.equal(google.store.get(foreign).summary,'Compromisso pessoal');
  assert.equal(google.log.filter(r=>r.id===foreign&&['PUT','PATCH','DELETE'].includes(r.method)).length,0);
  assert.ok(google.store.get(await eventId('owner','b')));assert.ok(google.store.get(await eventId('owner','d')),'A task after the failing ones still syncs');
  const info=calendar.info();
  assert.equal(info.status,'partial');assert.match(info.error,/2 tarefas não foram sincronizadas/);
  assert.deepEqual(Array.from(info.taskErrors,e=>e.taskId),['a','c']);
  assert.match(info.taskErrors[0].message,/não pertence/);assert.match(info.taskErrors[1].message,/horário/);
  assert.equal(db.calendar.events.a,undefined);
  // Um registro antigo apontando para evento alheio: a limpeza só esquece o registro.
  google.reset();db.calendar.events.a={owner:'owner',id:foreign,signature:'x',url:''};db.tasks[0].plannedDate='';
  await calendar.synchronize();
  assert.equal(google.log.filter(r=>r.method==='DELETE').length,0);assert.equal(google.store.get(foreign).status,'confirmed');
  assert.equal(db.calendar.events.a,undefined);
});

test('old JSON signatures become hashes without re-uploading; changed ones are uploaded once',async()=>{
  const google=fakeGoogle(),db=workspace([task('a',{description:'Texto'}),task('b')]),{calendar,saves}=setup(db,google);
  const legacy=(t,id)=>({owner:'owner',id,url:'',signature:JSON.stringify({summary:t.title,description:`Área: Folha docente\nPrazo final: ${t.dueDate}\n${t.description}`,
    start:{date:t.plannedDate},end:{date:'2026-10-15'},visibility:'private',extendedProperties:{private:{flowUserId:'owner',flowTaskId:t.id}}})});
  const ida=await eventId('owner','a'),idb=await eventId('owner','b');
  for(const [t,id] of [[db.tasks[0],ida],[db.tasks[1],idb]])google.store.set(id,{id,status:'confirmed',updated:OLD,extendedProperties:{private:{flowUserId:'owner',flowTaskId:t.id}}});
  db.calendar={events:{a:legacy(db.tasks[0],ida),b:legacy({...db.tasks[1],title:'Título antigo'},idb)}};
  const before=saves();await calendar.synchronize();
  assert.deepEqual(google.writes().map(r=>r.method+':'+r.id),['PUT:'+idb],'Only the task whose content changed is sent');
  assert.match(db.calendar.events.a.signature,/^[0-9a-f]{64}$/);assert.match(db.calendar.events.b.signature,/^[0-9a-f]{64}$/);
  assert.ok(saves()>before,'The migrated signature is persisted');
  google.reset();await calendar.synchronize();assert.equal(google.writes().length,0);
});

test('orphan sweep finds own events by private property across pages, about once per hour',async()=>{
  const google=fakeGoogle({pageSize:2}),db=workspace([task('kept'),task('undated',{plannedDate:''})]),{calendar,clock}=setup(db,google);
  const add=async(owner,taskId,updated=OLD)=>{const id=await eventId(owner,taskId);google.store.set(id,{id,status:'confirmed',updated,summary:taskId,start:{date:'2026-10-14'},end:{date:'2026-10-15'},extendedProperties:{private:{flowUserId:owner,flowTaskId:taskId}}});return id;};
  // Registros locais vieram de um backup antigo: nenhum desses eventos está em db.calendar.events.
  const gone=await add('owner','gone'),undated=await add('owner','undated'),kept=await add('owner','kept'),other=await add('other-user','gone');
  const fresh=await add('owner','created-elsewhere',new Date(clock.now).toISOString());
  google.store.set('external',{id:'external',status:'confirmed',updated:OLD,summary:'Reunião',start:{date:'2026-10-14'},end:{date:'2026-10-15'}});
  await calendar.synchronize();
  const lists=google.log.filter(r=>r.method==='GET'&&!r.id);
  assert.ok(lists.length>=2&&lists.some(r=>r.query.get('pageToken')),'Every page is read');
  assert.ok(lists.every(r=>r.query.getAll('privateExtendedProperty').includes('flowUserId=owner')));
  assert.deepEqual(google.log.filter(r=>r.method==='DELETE').map(r=>r.id).sort(),[gone,undated].sort());
  for(const id of [kept,other,fresh,'external'])assert.equal(google.store.get(id).status,'confirmed',id);
  google.reset();await calendar.synchronize();assert.equal(google.log.length,0,'No sweep again within the hour');
  clock.now+=3600000;await calendar.synchronize();
  assert.equal(google.log.filter(r=>r.method==='GET'&&!r.id).length,1);assert.equal(google.log.filter(r=>r.method==='DELETE').length,0);
});

test('a local copy in conflict with the cloud skips the sweep',async()=>{
  const google=fakeGoogle(),db=workspace([]),{calendar}=setup(db,google,{cloudStatus:'conflict'});
  const id=await eventId('owner','gone');
  google.store.set(id,{id,status:'confirmed',updated:OLD,extendedProperties:{private:{flowUserId:'owner',flowTaskId:'gone'}}});
  await calendar.synchronize();assert.equal(google.log.length,0);assert.equal(google.store.get(id).status,'confirmed');
});

test('the week view never shows own UlbraFlow events as external appointments, even orphans',async()=>{
  const google=fakeGoogle(),db=workspace([task('a')]),{calendar,settle}=setup(db,google);
  const orphan=await eventId('owner','deleted-task');
  google.store.set(orphan,{id:orphan,status:'confirmed',updated:OLD,start:{date:'2026-10-14'},end:{date:'2026-10-15'},extendedProperties:{private:{flowUserId:'owner',flowTaskId:'deleted-task'}}});
  google.store.set('meeting',{id:'meeting',status:'confirmed',start:{dateTime:'2026-10-14T13:00:00Z'},end:{dateTime:'2026-10-14T14:00:00Z'}});
  google.store.set('shared',{id:'shared',status:'confirmed',start:{date:'2026-10-15'},end:{date:'2026-10-16'},extendedProperties:{private:{flowUserId:'someone-else',flowTaskId:'x'}}});
  calendar.showRange('2026-10-12T03:00:00Z','2026-10-19T03:00:00Z');await settle();
  assert.deepEqual(Array.from(calendar.info().events,e=>e.id).sort(),['meeting','shared']);
});

test('429 with Retry-After postpones writes; 5xx backs off exponentially and resets after success',async()=>{
  const google=fakeGoogle(),db=workspace([task('a'),task('b'),task('c')]),{calendar,clock,pending,fire}=setup(db,google);
  google.fail(r=>r.method==='POST',()=>google.error(429,'rateLimitExceeded',{'Retry-After':'30'}));
  await assert.rejects(calendar.synchronize(),/limitou/);
  assert.equal(calendar.info().status,'error');assert.deepEqual(pending().map(t=>t.ms),[30000]);
  assert.equal(calendar.info().retryAt,clock.now+30000);
  google.reset();await calendar.synchronize();calendar.schedule();
  assert.equal(google.log.length,0,'Manual sync and saves respect Retry-After');assert.deepEqual(pending().map(t=>t.ms),[30000]);
  // Falha transitória na tarefa "a": ela vai para o fim da fila e não bloqueia "b" e "c".
  // A tarefa "a" falhou de forma transitória: vai para o fim da fila e não bloqueia "b" e "c".
  google.fail(r=>r.method==='POST'&&r.body.extendedProperties.private.flowTaskId==='a',()=>google.error(503));
  clock.now+=30000;await fire();
  assert.deepEqual(google.writes().map(r=>r.body.extendedProperties.private.flowTaskId),['b','c','a']);
  assert.equal(calendar.info().status,'error');assert.deepEqual(pending().map(t=>t.ms),[10000],'Second failure doubles the 5 s base');
  google.reset();clock.now+=10000;await fire();
  assert.deepEqual(google.writes().map(r=>r.body.extendedProperties.private.flowTaskId),['a']);
  assert.equal(calendar.info().status,'synced');assert.equal(calendar.info().retryAt,null);
  db.tasks[0].title='Mudou';google.fail(r=>r.method==='PUT',()=>google.error(500));
  await assert.rejects(calendar.synchronize(),/indisponível/);assert.deepEqual(pending().map(t=>t.ms),[5000],'Success reset the backoff');
  google.fail(r=>r.method==='PUT',()=>google.error(403,'userRateLimitExceeded'));
  clock.now+=5000;await fire();assert.deepEqual(pending().map(t=>t.ms),[10000],'403 rate limits are transient too');
});

test('reads back off on 5xx, respect Retry-After and stop polling after showRange(null)',async()=>{
  const google=fakeGoogle(),db=workspace([]),{calendar,clock,timers,intervals,listeners,fire,settle}=setup(db,google);
  google.fail(r=>r.method==='GET'&&r.query.get('timeMin'),()=>google.error(503,'backendError',{'Retry-After':'120'}));
  calendar.showRange('2026-10-12T03:00:00Z','2026-10-19T03:00:00Z');await settle();
  assert.match(calendar.info().readError,/indisponível/);assert.equal(intervals.size,1);
  assert.deepEqual([...timers.values()].map(t=>t.ms),[120000]);
  google.reset();[...intervals.values()][0].fn();listeners.visibilitychange();await settle();
  assert.equal(google.log.length,0,'Polling waits for the retry');
  google.store.set('meeting',{id:'meeting',status:'confirmed',start:{date:'2026-10-14'},end:{date:'2026-10-15'}});
  clock.now+=120000;await fire();
  assert.deepEqual(Array.from(calendar.info().events,e=>e.id),['meeting']);assert.equal(calendar.info().readError,'');
  calendar.showRange(null);
  assert.equal(intervals.size,0,'Leaving Agenda stops the 60 s polling');assert.equal(timers.size,0);
  google.reset();listeners.visibilitychange();await calendar.refresh();await settle();
  assert.equal(google.log.length,0,'No reads without a visible week');
  // Uma leitura em andamento ao sair da Agenda é descartada.
  let release;google.fail(r=>r.query.get('timeMin'),()=>new Promise(resolve=>{release=()=>resolve(Response.json({items:[{id:'late',start:{date:'2026-10-14'},end:{date:'2026-10-15'}}]}))}));
  calendar.showRange('2026-10-19T03:00:00Z','2026-10-26T03:00:00Z');await settle();calendar.showRange(null);release();await settle();
  assert.equal(calendar.info().events.length,0);assert.equal(calendar.info().reading,false);
});

test('a 401 during sync stops the round and asks to reconnect without marking tasks as failed',async()=>{
  const google=fakeGoogle(),db=workspace([task('a'),task('b')]),{calendar}=setup(db,google);
  google.fail(r=>r.method==='POST',()=>google.error(401,'authError'));
  await assert.rejects(calendar.synchronize(),/novamente/);
  assert.equal(calendar.info().connected,false);assert.equal(google.writes().length,1);assert.equal(calendar.info().taskErrors.length,0);
});

test('malformed calendar records and tasks without IDs do not break synchronization',async()=>{
  const google=fakeGoogle(),db=workspace([task('a'),null,task(undefined,{title:'Sem id'})],{calendar:'corrompido'}),{calendar}=setup(db,google);
  await calendar.synchronize();
  assert.ok(db.calendar.events.a);assert.equal(calendar.info().status,'partial');
  assert.match(calendar.info().error,/Sem id/);
});
