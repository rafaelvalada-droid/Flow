import test from 'node:test';
import assert from 'node:assert/strict';
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
  w.reconcile(db,now+60000);assert.equal(db.tasks[1].sessions[0].end,now+60000);
});
