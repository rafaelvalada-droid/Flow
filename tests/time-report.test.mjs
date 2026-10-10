import test from 'node:test';
import assert from 'node:assert/strict';
import '../time-report.js';
const api=globalThis.FlowTime;
const at=value=>+new Date(value);
const make=sessions=>({projects:[{id:'p',name:'Folha docente'}],tasks:[{id:'t',title:'Conferir folha',project:'p',sessions}]});
test('a session crossing midnight is split between days, weeks and months',()=>{
  const db=make([{start:at('2026-10-31T23:30:00'),end:at('2026-11-01T00:30:00')}]);
  const october=api.summarize(db,'month',0,at('2026-10-31T23:59:59'));
  assert.equal(october.totalMs,1799000); // Never count future work.
  const november=api.summarize(db,'month',0,at('2026-11-02T12:00:00'));
  assert.equal(november.totalMs,1800000);
  const day=api.summarize(db,'day',-1,at('2026-11-02T12:00:00'));
  assert.equal(day.totalMs,1800000);
  assert.equal(day.buckets.reduce((n,b)=>n+b.ms,0),day.totalMs);
  assert.equal(api.summarize(db,'week',0,at('2026-11-02T12:00:00')).totalMs,0);
});
test('an unfinished focus session stops contributing at the focus deadline, with no break time',()=>{
  const start=at('2026-10-10T09:00:00'),db=make([{start,end:null}]);
  db.focus={taskId:'t',phase:'work',endsAt:start+25*60000};
  const report=api.summarize(db,'day',0,start+60*60000);
  assert.equal(report.totalMs,25*60000);
  assert.equal(report.areas[0].ms,report.totalMs);
  assert.equal(report.tasks[0].ms,report.totalMs);
});
test('CSV reports include actual seconds, escape quotes and protect spreadsheet formulas',()=>{
  const db=make([{start:at('2026-10-10T09:00:00'),end:at('2026-10-10T09:25:00')}]);
  db.tasks[0].title='=HYPERLINK("example")';
  const report=api.summarize(db,'day',0,at('2026-10-10T10:00:00'));
  const text=api.csv(report);
  assert(text.includes('"00:25:00";"1500"'));
  assert(text.includes('"\'=HYPERLINK(""example"")"'));
  assert.equal(api.duration(report.totalMs),'00:25:00');
});
