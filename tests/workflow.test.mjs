import test from 'node:test';
import assert from 'node:assert/strict';
import '../areas.js';
import '../workflow.js';

const w = globalThis.FlowWorkflow;
const now = new Date('2026-10-09T12:00:00').getTime();
const task = (id, project = 'a', dueDate = '2026-10-10') => ({id, project, dueDate, status:'todo', sessions:[], subtasks:[], startedAt:null});
const database = () => w.normalize({version:1, projects:[{id:'a'},{id:'b'}], tasks:[task('one'),task('two','b')], preferences:{focusMinutes:1,breakMinutes:1}},now);

test('area and a real calendar date are both required before the shared pipeline', () => {
  const db=database();
  for(const t of [task('missing',''),task('nodate','a',''),task('invalid','a','2026-02-30')]) {
    assert.equal(w.stage(db,t),'inbox'); db.tasks.push(t); assert.equal(w.start(db,t.id,now),false);
  }
  assert.equal(w.stage(db,db.tasks[0]),'todo');
  assert.equal(w.stage(db,{status:'done'}),'done');
});
test('urgency follows deadlines across months and years, regardless of legacy manual priority', () => {
  assert.equal(w.urgency(task('late','a','2026-10-08'),'2026-10-09').tone,'late');
  assert.equal(w.urgency(task('today','a','2026-10-09'),'2026-10-09').tone,'today');
  assert.equal(w.urgency(task('tomorrow','a','2027-01-01'),'2026-12-31').tone,'soon');
  assert.equal(w.validDate('2024-02-29'),true); assert.equal(w.validDate('2026-02-29'),false);
  const tasks=[task('later','a','2026-10-15'),task('earlier','b','2026-10-09')];
  assert.equal(tasks.sort(w.byDue)[0].id,'earlier');
});
test('switching tasks stops the previous work and never starts two sessions at once', () => {
  const db=database();w.start(db,'one',now);w.start(db,'two',now+10000);
  assert.equal(db.tasks[0].sessions[0].end,now+10000);
  assert.deepEqual(db.tasks.filter(t=>t.startedAt).map(t=>t.id),['two']);
  const sessions=db.tasks[1].sessions.length;w.start(db,'two',now+12000);
  assert.equal(db.tasks[1].sessions.length,sessions);
});
test('pause and JSON reload preserve the remaining focus time, excluding time paused', () => {
  let db=database();w.start(db,'one',now);w.pause(db,now+10000);
  db=w.normalize(JSON.parse(JSON.stringify(db)),now+100000);
  assert.equal(w.remaining(db,now+100000),50000);assert.equal(db.tasks[0].startedAt,null);
  w.start(db,'one',now+100000);w.reconcile(db,now+150000);
  assert.equal(db.tasks[0].sessions[1].end,now+150000);assert.equal(db.tasks[0].focusCycles,1);
  assert.equal(db.tasks[0].sessions.reduce((sum,s)=>sum+s.end-s.start,0),60000);
  assert.equal(db.focus.phase,'break');
});
test('returning hours later ends work at the deadline and starts no unattended work cycles', () => {
  let db=database();w.start(db,'one',now);
  db=w.normalize(JSON.parse(JSON.stringify(db)),now+3600000);w.reconcile(db,now+3600000);
  assert.equal(db.tasks[0].sessions[0].end,now+60000);
  assert.equal(db.tasks[0].startedAt,null);assert.equal(db.tasks[0].focusCycles,1);
  assert.equal(db.focus.phase,'ready');assert.equal(w.remaining(db,now+3600000),0);
  assert.equal(w.reconcile(db,now+7200000),false);assert.equal(db.tasks[0].focusCycles,1);
});
test('pausing a break and completing a task never adds break time to working sessions', () => {
  const db=database();w.start(db,'one',now);w.reconcile(db,now+60000);w.pause(db,now+70000);
  assert.equal(db.focus.remainingMs,50000);w.resumeBreak(db,now+120000);
  assert.equal(db.focus.endsAt,now+170000);w.cancel(db,'one',now+150000);
  assert.equal(db.focus,null);assert.equal(db.tasks[0].sessions[0].end,now+60000);
});
test('migration keeps original areas, IDs, descriptions, historical sessions and preferences', () => {
  const db=database();db.tasks[0].description='Existing notes';db.tasks[0].sessions=[{start:now-10000,end:now-5000}];
  db.preferences.reminderDays=7;db.tasks[1].startedAt=now-2000;db.tasks[1].sessions=[{start:now-2000,end:null}];
  const old=structuredClone(db);w.normalize(db,now);
  assert.deepEqual(db.projects,old.projects);assert.deepEqual(db.tasks,old.tasks);assert.equal(db.preferences.reminderDays,7);
  assert.equal(db.focus.taskId,'two');
  // O cronômetro antigo vira um ciclo iniciado em startedAt: termina um foco depois dele, não da migração.
  w.reconcile(db,now+60000);assert.equal(db.tasks[1].sessions[0].end,now+58000);
});
test('malformed workspaces open: invalid entries go to db.recovered, valid tasks and IDs stay',()=>{
  const raw={version:1,projects:[null,{id:'a',name:'Minha área'}],preferences:'x',focus:'quebrado',tasks:[null,'texto',
    {id:'ok',title:7,project:'a',dueDate:'2026-10-10',status:'todo',sessions:{},subtasks:'x',description:42,focusCycles:'3.7'},[1,2],
    {id:'neg',project:'a',focusCycles:-2,sessions:[null,{start:1,end:2}],subtasks:[{id:'s',text:'Sub',done:false},5],description:{rich:true},startedAt:'ontem'}]};
  const db=w.normalize(structuredClone(raw),now);
  assert.deepEqual(db.tasks.map(t=>t.id),['ok','neg']);
  const [ok,neg]=db.tasks;
  assert.deepEqual(ok.sessions,[]);assert.deepEqual(ok.subtasks,[]);assert.equal(ok.description,'42');assert.equal(ok.title,'7');assert.equal(ok.focusCycles,3);
  assert.deepEqual(neg.sessions,[{start:1,end:2}]);assert.deepEqual(neg.subtasks,[{id:'s',text:'Sub',done:false}]);
  assert.equal(neg.description,'');assert.equal(neg.focusCycles,0);assert.equal(neg.startedAt,null);
  assert.deepEqual(db.preferences,{focusMinutes:25,breakMinutes:5,alerts:[true,true,true,false],reminderDays:1});
  assert.equal(db.focus,null);assert.ok(db.projects.some(p=>p.id==='a'&&p.name==='Minha área'));
  const kept=db.recovered.map(r=>[r.from,r.taskId??null,JSON.stringify(r.value)]);
  for(const entry of [['projects',null,'null'],['tasks',null,'null'],['tasks',null,'"texto"'],['tasks',null,'[1,2]'],['preferences',null,'"x"'],['focus',null,'"quebrado"'],
    ['task.sessions','ok','{}'],['task.subtasks','ok','"x"'],['task.sessions','neg','null'],['task.subtasks','neg','5'],['task.description','neg','{"rich":true}'],['task.startedAt','neg','"ontem"']])
    assert.ok(kept.some(item=>JSON.stringify(item)===JSON.stringify(entry)),'recovered '+entry);
  // A base reparada funciona e uma nova normalização não duplica o que já foi recuperado.
  assert.equal(w.start(db,'ok',now),true);w.pause(db,now+1000);
  const again=structuredClone(db);w.normalize(again,now+2000);assert.deepEqual(again,db);
});
test('missing collections, non-object workspaces and odd preferences never throw',()=>{
  for(const value of [{},null,undefined,'x',[],{tasks:{a:1},projects:'p',classificationCatalogVersion:5},{projects:[],tasks:[],preferences:null}]){
    const db=w.normalize(structuredClone(value),now);
    assert.ok(Array.isArray(db.tasks)&&Array.isArray(db.projects));assert.equal(db.version,1);
    w.reconcile(db,now);w.pause(db,now);assert.equal(w.remaining(db,now),25*60000);
  }
  assert.equal(w.normalize({}).projects.length,12,'A workspace without areas receives the catalog');
  assert.deepEqual(w.normalize('x').recovered,[{from:'workspace',value:'x'}]);
  assert.deepEqual(w.normalize({tasks:{a:1},projects:'p',classificationCatalogVersion:5}).recovered,[{from:'projects',value:'p'},{from:'tasks',value:{a:1}}]);
  const prefs=value=>w.normalize({projects:[],tasks:[],preferences:value}).preferences;
  assert.deepEqual(prefs({alerts:[false,'yes',true,null,true],reminderDays:'7',focusMinutes:'30',breakMinutes:true}),{alerts:[false,true,true,false],reminderDays:7,focusMinutes:30,breakMinutes:5});
  assert.deepEqual(prefs({alerts:'x',reminderDays:5,focusMinutes:500,breakMinutes:0}),{alerts:[true,true,true,false],reminderDays:1,focusMinutes:25,breakMinutes:5});
  for(const days of [1,2,3,7])assert.equal(prefs({reminderDays:days}).reminderDays,days);
});
test('a pre-Pomodoro timer from an old backup counts at most one focus cycle and starts no work now',()=>{
  const started=now-104*86400000;
  const raw={version:1,projects:[{id:'a'}],preferences:{focusMinutes:25,breakMinutes:5},tasks:[
    {...task('old'),startedAt:started,sessions:[{start:started-7200000,end:started-3600000},{start:started,end:null}]},
    {...task('other'),startedAt:started+60000}]};
  const db=w.normalize(raw,now);w.reconcile(db,now);
  assert.equal(db.focus??null,null);assert.deepEqual(db.tasks.filter(t=>t.startedAt).map(t=>t.id),[]);
  assert.deepEqual(db.tasks[0].sessions,[{start:started-7200000,end:started-3600000},{start:started,end:started+25*60000}],'History is preserved; the open session is capped');
  assert.deepEqual(db.tasks[1].sessions,[{start:started+60000,end:started+60000+25*60000}]);
  const worked=db.tasks.flatMap(t=>t.sessions).reduce((sum,s)=>sum+s.end-s.start,0);
  assert.equal(worked,3600000+2*25*60000,'Never the 2497 h between the old start and the import');
  assert.equal(w.normalize(structuredClone(db),now+3600000).tasks.flatMap(t=>t.sessions).length,3);
});
test('a timer started minutes before the update keeps running only for the rest of its cycle',()=>{
  const started=now-10*60000;
  const db=w.normalize({version:1,projects:[{id:'a'}],preferences:{focusMinutes:25,breakMinutes:5},tasks:[{...task('one'),startedAt:started,sessions:[{start:started,end:null}]}]},now);
  assert.equal(db.focus.taskId,'one');assert.equal(db.focus.phase,'work');assert.equal(w.remaining(db,now),15*60000);
  w.reconcile(db,now+3600000);
  assert.deepEqual(db.tasks[0].sessions,[{start:started,end:started+25*60000}]);assert.equal(db.focus.phase,'ready');
  // Relógio de outro aparelho adiantado: o ciclo começa no máximo agora.
  const ahead=w.normalize({version:1,projects:[{id:'a'}],tasks:[{...task('two'),startedAt:now+600000}]},now);
  assert.equal(ahead.focus.endsAt,now+25*60000);
});
