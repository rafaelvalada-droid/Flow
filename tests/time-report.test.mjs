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

// Fuso trocado em tempo de execução (Node reinicia o cache ao alterar process.env.TZ); restaurado ao final.
function inZone(zone,fn){
  const previous=process.env.TZ;process.env.TZ=zone;
  try{return fn()}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
}
const iso=date=>new Date(date).toISOString();
function contiguous(report){
  assert.equal(report.buckets[0].start,+report.start);assert.equal(report.buckets.at(-1).end,+report.end);
  report.buckets.forEach((b,i)=>{assert.ok(b.end>b.start);if(i)assert.equal(b.start,report.buckets[i-1].end)});
  assert.equal(report.buckets.reduce((n,b)=>n+b.ms,0),report.totalMs);
}
test('America/Santiago: a day without local midnight starts at 01:00 and work is never counted twice',()=>inZone('America/Santiago',()=>{
  assert.equal(new Date(2026,8,6).getHours(),1,'ICU must know Chile 2026 DST (00:00 → 01:00 on 2026-09-06)');
  const noon=at('2026-09-06T12:00:00-03:00'),next=at('2026-09-07T12:00:00-03:00');
  const day=api.range('day',0,new Date(noon));
  assert.equal(iso(day.start),'2026-09-06T04:00:00.000Z');assert.equal(iso(day.end),'2026-09-07T03:00:00.000Z');
  assert.deepEqual(api.range('day',-1,new Date(next)),day);
  assert.equal(iso(api.range('day',1,new Date(noon)).start),'2026-09-07T03:00:00.000Z');
  const week=api.range('week',0,new Date(noon));
  assert.equal(iso(week.start),'2026-08-31T04:00:00.000Z');assert.equal(iso(week.end),'2026-09-07T03:00:00.000Z');
  assert.equal(iso(api.range('week',1,new Date(noon)).start),'2026-09-07T03:00:00.000Z');
  assert.equal(iso(api.range('week',-1,new Date(next)).start),'2026-08-31T04:00:00.000Z');
  const month=api.range('month',0,new Date(noon));
  assert.equal(iso(month.start),'2026-09-01T04:00:00.000Z');assert.equal(iso(month.end),'2026-10-01T03:00:00.000Z');
  const db=make([{start:at('2026-08-31T00:00:00-04:00'),end:at('2026-08-31T00:20:00-04:00')},
    {start:at('2026-09-06T01:00:00-03:00'),end:at('2026-09-06T02:00:00-03:00')},
    {start:at('2026-09-06T23:30:00-03:00'),end:at('2026-09-07T00:30:00-03:00')}]);
  const later=at('2026-09-20T12:00:00-03:00');
  const sixth=api.summarize(db,'day',-1,next),seventh=api.summarize(db,'day',0,next);
  assert.equal(sixth.totalMs,90*60000);assert.equal(seventh.totalMs,30*60000);
  assert.equal(sixth.buckets.length,23);assert.equal(sixth.buckets[0].label,'01h');contiguous(sixth);contiguous(seventh);
  const weekly=api.summarize(db,'week',-2,later);
  assert.equal(weekly.totalMs,20*60000+120*60000-30*60000,'Week of 31/08 ends at the first instant of 07/09');
  assert.equal(weekly.buckets.length,7);contiguous(weekly);
  assert.equal(new Date(weekly.buckets[6].start).getHours(),1);assert.equal(new Date(weekly.buckets[0].start).getHours(),0);
  let days=0;for(let offset=-20;offset<=-13;offset++)days+=api.summarize(db,'day',offset,later).totalMs;
  assert.equal(days,db.tasks[0].sessions.reduce((n,s)=>n+s.end-s.start,0),'Daily totals add up to the real work');
  contiguous(api.summarize(db,'month',0,noon));
  // Fim do horário de verão: 04/04 tem 25 horas.
  const longDay=api.summarize(make([{start:at('2026-04-04T22:30:00-03:00'),end:at('2026-04-04T23:30:00-04:00')}]),'day',0,at('2026-04-04T23:50:00-04:00'));
  assert.equal(+longDay.end-+longDay.start,25*3600000);assert.equal(longDay.totalMs,2*3600000);contiguous(longDay);
  const text=api.csv(sixth);assert.ok(text.includes('"Período";"2026-09-06";"2026-09-06"'));
}));
test('America/Sao_Paulo with the 2018 rules: midnight transition in November and the repeated hour in February',t=>inZone('America/Sao_Paulo',()=>{
  if(new Date(2018,10,4).getHours()!==1){t.skip('ICU without historical Brazilian DST rules');return;}
  const day=api.range('day',0,new Date(at('2018-11-04T12:00:00-02:00')));
  assert.equal(iso(day.start),'2018-11-04T03:00:00.000Z');assert.equal(iso(day.end),'2018-11-05T02:00:00.000Z');
  const week=api.range('week',0,new Date(at('2018-11-04T12:00:00-02:00')));
  assert.equal(iso(week.start),'2018-10-29T03:00:00.000Z');assert.equal(iso(week.end),'2018-11-05T02:00:00.000Z');
  const db=make([{start:at('2018-11-05T00:00:00-02:00'),end:at('2018-11-05T00:45:00-02:00')}]);
  const now=at('2018-11-05T12:00:00-02:00');
  assert.equal(api.summarize(db,'day',-1,now).totalMs,0);assert.equal(api.summarize(db,'day',0,now).totalMs,45*60000);
  assert.equal(api.summarize(db,'week',0,now).totalMs,45*60000);assert.equal(api.summarize(db,'week',-1,now).totalMs,0);
  const repeated=api.summarize(make([]),'day',0,at('2019-02-16T12:00:00-02:00'));
  assert.equal(+repeated.end-+repeated.start,25*3600000);contiguous(repeated);
}));
test('UTC and America/New_York keep ordinary 24-hour days and 7 midnight-aligned week buckets',()=>{
  for(const zone of ['UTC','America/New_York'])inZone(zone,()=>{
    const report=api.summarize(make([]),'day',0,at('2026-11-01T12:00:00Z'));
    contiguous(report);
    const week=api.summarize(make([]),'week',0,at('2026-10-14T12:00:00Z'));
    assert.equal(week.buckets.length,7);contiguous(week);assert.ok(week.buckets.every(b=>new Date(b.start).getHours()===0));
    assert.equal(api.summarize(make([]),'day',0,at('2026-10-14T12:00:00Z')).buckets.length,24);
  });
});

function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=c}
    else if(c==='"')quoted=true;else if(c===';'){row.push(cell);cell=''}
    else if(c==='\r'&&text[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++}else cell+=c;
  }
  row.push(cell);rows.push(row);return rows;
}
test('CSV has a BOM, keeps line breaks, quotes and semicolons inside cells and neutralizes formula prefixes',()=>{
  const titles=['Linha 1\nLinha "2"; fim','=1+1','+55 51','-2','@SUM(A1)','\tTabulação','\rRetorno','Texto comum'];
  const db={projects:[{id:'p',name:'=Área;"perigosa"'}],tasks:titles.map((title,i)=>({id:'t'+i,title,project:'p',
    sessions:[{start:at('2026-10-10T09:00:00')+i*60000,end:at('2026-10-10T09:00:00')+(i+1)*60000-1000*i}]}))};
  const text=api.csv(api.summarize(db,'day',0,at('2026-10-10T12:00:00')));
  assert.ok(text.startsWith('﻿'));assert.ok(!text.slice(1).includes('﻿'));
  const rows=parseCsv(text.slice(1));
  assert.deepEqual(rows[1],['Período','2026-10-10','2026-10-10']);
  assert.deepEqual(rows.find(r=>r[0]==="'=Área;\"perigosa\""),["'=Área;\"perigosa\"",'00:07:32','452','8']);
  const tasks=rows.slice(rows.findIndex(r=>r[0]==='Tarefa')+1);
  assert.equal(tasks.length,titles.length);assert.ok(tasks.every(r=>r.length===5));
  const shown=new Set(tasks.map(r=>r[0]));
  assert.ok(shown.has('Linha 1\nLinha "2"; fim'));assert.ok(shown.has('Texto comum'));
  for(const title of titles.slice(1,7))assert.ok(shown.has("'"+title),JSON.stringify(title));
  assert.ok(tasks.every(r=>r[1]==="'=Área;\"perigosa\""));
});
